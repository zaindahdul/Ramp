import type { Prisma } from "@/generated/prisma/client";
import { decideAutoConfirm, type AutonomyPolicy } from "@/lib/autonomy";
import { fromPlainDate, toPlainDate } from "@/lib/dates";
import { db, isUniqueViolation } from "@/lib/db";
import { dedupeKey, normalizeDocumentNumber, vendorKeyFor } from "@/lib/dedupe";
import { getExtractor } from "@/lib/extraction";
import { extractorIssues } from "@/lib/extraction/checks";
import { normalizeExtraction, type NormalizedExtraction } from "@/lib/extraction/schema";
import { ExtractionError, type ExtractionHints } from "@/lib/extraction/types";
import { formatCents } from "@/lib/money";
import { decideCreditReason, explainReason } from "@/lib/reasons";
import { issueList, reviewDocument } from "@/lib/review";
import { AUTOPILOT, EXTRACTION, recordEvent } from "@/lib/server/audit";
import { confirmDocument, storedConfirmInput } from "@/lib/server/documents";
import { getAutonomy } from "@/lib/server/settings";
import { findVendorByName } from "@/lib/server/vendors";
import { getStorage } from "@/lib/storage";
import { normalizeVendorName } from "@/lib/vendors/normalize";

// uploaded -> extracting -> needs_review (or failed), then the autonomy policy
// decides whether a clean document confirms itself or waits for a person.
//
// The split of work is deliberate: the model reads the document, and plain code
// makes every decision about it (arithmetic, grounding, duplicates, the reason
// rules, the autonomy guardrails). Each decision is written to the audit trail
// with the sentence that explains it.

async function loadHints(organizationId: string): Promise<ExtractionHints> {
  const [organization, vendors, invoices] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
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
    customerName: organization.name,
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

type Applied =
  | { outcome: "needs_review" }
  | { outcome: "auto_confirm"; reason: string }
  | { outcome: "duplicate" };

async function applyExtraction(
  organizationId: string,
  documentId: string,
  n: NormalizedExtraction,
  raw: unknown,
  extractorName: string,
  policy: AutonomyPolicy,
): Promise<Applied> {
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

  const markDuplicate = async (dup: {
    id: string;
    type: string | null;
    documentNumber: string | null;
    status: string;
  }): Promise<Applied> => {
    const message = duplicateMessage(dup);
    await db.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: { ...base, status: "failed", dedupeKey: null, duplicateOfId: dup.id, errorMessage: message },
      });
      await recordEvent(
        {
          organizationId,
          documentId,
          vendorId: vendor?.id,
          actor: EXTRACTION,
          action: "document.duplicate",
          summary: `Not saved. ${message}`,
          detail: { extractor: extractorName, duplicateOfId: dup.id },
        },
        tx,
      );
    });
    return { outcome: "duplicate" };
  };

  if (key) {
    const dup = await db.document.findFirst({
      where: { organizationId, dedupeKey: key, id: { not: documentId } },
      select: { id: true, type: true, documentNumber: true, status: true },
    });
    if (dup) return markDuplicate(dup);
  }

  // Deterministic checks on what the model returned: required fields and
  // arithmetic first, then the extractor's own doubts and its quoted sources.
  const issues = [...issueList(reviewDocument({ ...n, lineItems: n.lineItems })), ...extractorIssues(n)];
  const credit =
    n.type === "credit_memo"
      ? decideCreditReason({
          statedReason: n.statedReason,
          suggestedReason: n.suggestedReason,
          lineDescriptions: n.lineItems.map((l) => l.description),
        })
      : null;

  // The autonomy setting, decided here so the outcome lands in one write. A
  // document autopilot will confirm stays `extracting` until it is confirmed;
  // nothing ever sees it as "needs review" for a moment in between.
  const decision =
    policy.level === "review_all"
      ? null
      : decideAutoConfirm(policy, {
          type: n.type,
          issues,
          vendorKnown: vendor !== null,
          currency: n.currency,
          totalCents: n.totalCents,
        });
  const autoConfirm = decision?.action === "confirm";

  try {
    await db.$transaction(async (tx) => {
      await tx.lineItem.deleteMany({ where: { documentId, organizationId } });
      await tx.document.update({
        where: { id: documentId },
        data: {
          ...base,
          status: autoConfirm ? "extracting" : "needs_review",
          dedupeKey: key,
          duplicateOfId: null,
          reviewIssues: issues,
          creditReason: credit?.reason ?? null,
          creditReasonSource: credit?.source ?? null,
          creditReasonBasis: credit ? explainReason(credit, n.statedReason) : null,
          creditStatus: credit ? "open" : null,
          lineItems: {
            create: n.lineItems.map((line, position) => ({ ...line, position, organizationId })),
          },
        },
      });
      await recordEvent(
        {
          organizationId,
          documentId,
          vendorId: vendor?.id,
          actor: EXTRACTION,
          action: "document.extracted",
          summary: extractionSummary(n, vendor?.name ?? null, issues.length),
          detail: {
            extractor: extractorName,
            issues,
            uncertain: n.uncertain,
            vendorMatched: vendor?.name ?? null,
          },
        },
        tx,
      );
      if (decision?.action === "hold") {
        await recordEvent(heldEvent(organizationId, documentId, decision.reason, policy), tx);
      }
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
  return decision?.action === "confirm" ? { outcome: "auto_confirm", reason: decision.reason } : { outcome: "needs_review" };
}

function heldEvent(organizationId: string, documentId: string, reason: string, policy: AutonomyPolicy) {
  return {
    organizationId,
    documentId,
    actor: AUTOPILOT,
    action: "document.held" as const,
    summary: `Held for review. ${reason}`,
    detail: { level: policy.level, limitCents: policy.limitCents, currency: policy.currency },
  };
}

function extractionSummary(n: NormalizedExtraction, matchedVendor: string | null, issueCount: number): string {
  const what = n.type === "credit_memo" ? "a credit memo" : n.type === "invoice" ? "an invoice" : "neither an invoice nor a credit memo";
  const from = n.vendorName ? ` from ${n.vendorName}` : "";
  const amount = n.totalCents !== null && n.currency ? ` for ${formatCents(n.totalCents, n.currency)}` : "";
  const vendor = !n.vendorName
    ? ""
    : matchedVendor
      ? matchedVendor === n.vendorName
        ? " The vendor is on file."
        : ` Matched to vendor ${matchedVendor.replace(/\.$/, "")}.`
      : " The vendor is new.";
  const checks =
    issueCount === 0 ? " Every check passed." : ` ${issueCount} issue${issueCount === 1 ? "" : "s"} flagged for review.`;
  return `Read as ${what}${from}${amount}.${vendor}${checks}`.replace(/\.\./g, ".");
}

/**
 * Confirms a clean document on the organization's behalf. If the confirmation
 * is refused after all (a duplicate that appeared meanwhile), the document goes
 * to review with that reason on the trail.
 */
async function autoConfirm(
  organizationId: string,
  documentId: string,
  reason: string,
  policy: AutonomyPolicy,
): Promise<void> {
  const input = await storedConfirmInput(organizationId, documentId);
  const result = input
    ? await confirmDocument(organizationId, documentId, input, {
        actor: AUTOPILOT,
        via: "autopilot",
        reason,
        duringExtraction: true,
      })
    : ({ ok: false, error: "The document is gone." } as const);
  if (result.ok) return;
  await db.$transaction(async (tx) => {
    await tx.document.updateMany({
      where: { id: documentId, organizationId, status: "extracting" },
      data: { status: "needs_review" },
    });
    await recordEvent(heldEvent(organizationId, documentId, result.error, policy), tx);
  });
}

/**
 * Extracts one document that a worker has already claimed (status `extracting`).
 * See queue.ts for the claim.
 */
export async function processClaimedDocument(organizationId: string, documentId: string): Promise<void> {
  let extractorName: string | null = null;
  try {
    const doc = await db.document.findFirstOrThrow({ where: { id: documentId, organizationId } });
    if (!doc.storageKey || !doc.mimeType || !doc.fileSha256) {
      throw new ExtractionError("No file is stored for this document.");
    }
    const data = await getStorage().get(doc.storageKey);
    const extractor = getExtractor();
    extractorName = extractor.name;
    const raw = await extractor.extract({
      data,
      mimeType: doc.mimeType,
      filename: doc.originalFilename ?? "document",
      sha256: doc.fileSha256,
      hints: await loadHints(organizationId),
    });
    const normalized = normalizeExtraction(raw);
    const policy = await getAutonomy(organizationId);
    const applied = await applyExtraction(organizationId, documentId, normalized, raw, extractor.name, policy);
    if (applied.outcome === "auto_confirm") {
      await autoConfirm(organizationId, documentId, applied.reason, policy);
    }
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
    await recordEvent({
      organizationId,
      documentId,
      actor: EXTRACTION,
      action: "document.extraction_failed",
      summary: message.slice(0, 500),
      detail: { extractor: extractorName },
    });
  }
}
