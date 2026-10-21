import type { Prisma } from "@/generated/prisma/client";
import { fromPlainDate, toPlainDate } from "@/lib/dates";
import { db, isUniqueViolation } from "@/lib/db";
import { dedupeKey, normalizeDocumentNumber, vendorKeyFor } from "@/lib/dedupe";
import { getExtractor } from "@/lib/extraction";
import { normalizeExtraction, type NormalizedExtraction } from "@/lib/extraction/schema";
import { ExtractionError, type ExtractionHints } from "@/lib/extraction/types";
import { determineCreditReason } from "@/lib/reasons";
import { issueList, reviewDocument } from "@/lib/review";
import { findVendorByName } from "@/lib/server/vendors";
import { getStorage } from "@/lib/storage";
import { normalizeVendorName } from "@/lib/vendors/normalize";

// uploaded -> extracting -> needs_review (or failed). Confirmation is a person's
// call, made on the review screen.

async function loadHints(organizationId: string): Promise<ExtractionHints> {
  const [vendors, invoices] = await Promise.all([
    db.vendor.findMany({ where: { organizationId }, select: { name: true }, take: 50, orderBy: { name: "asc" } }),
    db.document.findMany({
      where: { organizationId, type: "invoice", status: "confirmed" },
      orderBy: { documentDate: "desc" },
      take: 30,
      select: {
        documentNumber: true,
        documentDate: true,
        currency: true,
        totalCents: true,
        vendor: { select: { name: true } },
      },
    }),
  ]);
  return {
    knownVendors: vendors.map((v) => v.name),
    recentInvoices: invoices.flatMap((i) =>
      i.vendor && i.documentNumber && i.documentDate && i.currency && i.totalCents !== null
        ? [
            {
              vendorName: i.vendor.name,
              documentNumber: i.documentNumber,
              documentDate: toPlainDate(i.documentDate),
              currency: i.currency,
              totalCents: i.totalCents,
            },
          ]
        : [],
    ),
  };
}

export function documentFieldsFromExtraction(n: NormalizedExtraction) {
  return {
    type: n.type,
    vendorNameRaw: n.vendorName,
    documentNumber: n.documentNumber,
    documentNumberNormalized: normalizeDocumentNumber(n.documentNumber),
    documentDate: n.documentDate ? fromPlainDate(n.documentDate) : null,
    dueDate: n.dueDate ? fromPlainDate(n.dueDate) : null,
    paymentTerms: n.paymentTerms,
    currency: n.currency,
    subtotalCents: n.subtotalCents,
    taxCents: n.taxCents,
    totalCents: n.totalCents,
    referencedInvoiceNumber: n.referencedInvoiceNumber,
    statedReason: n.statedReason,
  } satisfies Prisma.DocumentUncheckedUpdateInput;
}

function duplicateMessage(dup: { type: string | null; documentNumber: string | null; status: string }): string {
  const what = dup.type === "credit_memo" ? "credit memo" : dup.type === "invoice" ? "invoice" : "document";
  const where = dup.status === "confirmed" ? "already on file" : "already uploaded and waiting for review";
  return `Duplicate: ${what} ${dup.documentNumber ?? ""} from this vendor for the same amount is ${where}.`.replace(
    /\s+/g,
    " ",
  );
}

async function applyExtraction(
  organizationId: string,
  documentId: string,
  n: NormalizedExtraction,
  raw: unknown,
  extractorName: string,
): Promise<void> {
  const vendor = n.vendorName ? await findVendorByName(organizationId, n.vendorName) : null;
  const key =
    n.type === "other"
      ? null
      : dedupeKey({
          vendorKey: vendorKeyFor(vendor?.id ?? null, n.vendorName ? normalizeVendorName(n.vendorName) : null),
          documentNumber: n.documentNumber,
          currency: n.currency,
          totalCents: n.totalCents,
        });

  const fields = documentFieldsFromExtraction(n);
  const base = {
    ...fields,
    vendorId: vendor?.id ?? null,
    extractor: extractorName,
    rawExtraction: raw as Prisma.InputJsonValue,
    errorMessage: null,
  };

  const markDuplicate = async (dup: { id: string; type: string | null; documentNumber: string | null; status: string }) => {
    await db.document.update({
      where: { id: documentId },
      data: { ...base, status: "failed", dedupeKey: null, duplicateOfId: dup.id, errorMessage: duplicateMessage(dup) },
    });
  };

  if (key) {
    const dup = await db.document.findFirst({
      where: { organizationId, dedupeKey: key, id: { not: documentId } },
      select: { id: true, type: true, documentNumber: true, status: true },
    });
    if (dup) return markDuplicate(dup);
  }

  const review = reviewDocument({ ...n, lineItems: n.lineItems });
  const credit =
    n.type === "credit_memo"
      ? determineCreditReason({
          statedReason: n.statedReason,
          suggestedReason: n.suggestedReason,
          lineDescriptions: n.lineItems.map((l) => l.description),
        })
      : null;

  try {
    await db.$transaction(async (tx) => {
      await tx.lineItem.deleteMany({ where: { documentId, organizationId } });
      await tx.document.update({
        where: { id: documentId },
        data: {
          ...base,
          status: "needs_review",
          dedupeKey: key,
          duplicateOfId: null,
          reviewIssues: issueList(review),
          creditReason: credit?.reason ?? null,
          creditReasonSource: credit?.source ?? null,
          creditStatus: credit ? "open" : null,
          lineItems: {
            create: n.lineItems.map((line, position) => ({ ...line, position, organizationId })),
          },
        },
      });
    });
  } catch (error) {
    if (key && isUniqueViolation(error)) {
      const dup = await db.document.findFirst({
        where: { organizationId, dedupeKey: key, id: { not: documentId } },
        select: { id: true, type: true, documentNumber: true, status: true },
      });
      if (dup) return markDuplicate(dup);
    }
    throw error;
  }
}

/** Extracts one uploaded document. Safe to call twice: only one caller claims it. */
export async function processDocument(organizationId: string, documentId: string): Promise<void> {
  const claimed = await db.document.updateMany({
    where: { id: documentId, organizationId, status: "uploaded" },
    data: { status: "extracting", extractionStartedAt: new Date(), extractionAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) return;

  try {
    const doc = await db.document.findFirstOrThrow({ where: { id: documentId, organizationId } });
    if (!doc.storageKey || !doc.mimeType || !doc.fileSha256) {
      throw new ExtractionError("No file is stored for this document.");
    }
    const data = await getStorage().get(doc.storageKey);
    const extractor = getExtractor();
    const raw = await extractor.extract({
      data,
      mimeType: doc.mimeType,
      filename: doc.originalFilename ?? "document",
      sha256: doc.fileSha256,
      hints: await loadHints(organizationId),
    });
    await applyExtraction(organizationId, documentId, normalizeExtraction(raw), raw, extractor.name);
  } catch (error) {
    console.error(`[extraction] document ${documentId} failed`, error);
    const message =
      error instanceof ExtractionError
        ? error.message
        : `Extraction failed: ${error instanceof Error ? error.message : String(error)}`;
    await db.document.update({
      where: { id: documentId },
      data: { status: "failed", errorMessage: message.slice(0, 1000) },
    });
  }
}
