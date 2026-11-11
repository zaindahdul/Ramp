import {
  confirmFieldsToInput,
  ConfirmInputSchema,
  CREDIT_STATUS_LABELS,
  diffConfirmInputs,
  parseConfirmInput,
  toConfirmInput,
  type ConfirmInput,
  type CreditStatusKey,
} from "@/lib/confirm";
import { fromPlainDate, toPlainDate } from "@/lib/dates";
import { db, isUniqueViolation } from "@/lib/db";
import { dedupeKey, normalizeDocumentNumber, sha256Hex, vendorKeyFor } from "@/lib/dedupe";
import { formatCents } from "@/lib/money";
import { REASON_LABELS } from "@/lib/reasons";
import { issueList, reviewDocument } from "@/lib/review";
import { recordEvent, type Actor } from "@/lib/server/audit";
import { relinkUnlinkedCredits, setCreditLink } from "@/lib/server/linking";
import { kickExtraction } from "@/lib/server/queue";
import { findOrCreateVendor, findVendorByName } from "@/lib/server/vendors";
import { detectMimeType, getStorage, MAX_UPLOAD_BYTES, storageKeyFor } from "@/lib/storage";
import { normalizeVendorName } from "@/lib/vendors/normalize";

export type UploadResult =
  | { ok: true; id: string; filename: string; status: string; duplicate: boolean }
  | { ok: false; filename: string; error: string };

/** Stores the file and creates an `uploaded` document. The same file twice returns the existing one. */
export async function createUploadedDocument(
  organizationId: string,
  file: { name: string; type: string; bytes: Uint8Array },
  actor: Actor,
): Promise<UploadResult> {
  const filename = file.name || "document";
  const mimeType = detectMimeType(filename, file.type);
  if (!mimeType) return { ok: false, filename, error: "Only PDF, PNG, JPEG, WebP and GIF files are supported." };
  if (file.bytes.byteLength === 0) return { ok: false, filename, error: "The file is empty." };
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, filename, error: "Files must be 20 MB or smaller." };

  const fileSha256 = sha256Hex(file.bytes);
  const existing = await db.document.findUnique({
    where: { organizationId_fileSha256: { organizationId, fileSha256 } },
    select: { id: true, status: true },
  });
  if (existing) return { ok: true, id: existing.id, filename, status: existing.status, duplicate: true };

  const storageKey = storageKeyFor(organizationId, fileSha256, mimeType);
  await getStorage().put(storageKey, file.bytes);
  try {
    const doc = await db.document.create({
      data: {
        organizationId,
        originalFilename: filename.slice(0, 255),
        mimeType,
        sizeBytes: file.bytes.byteLength,
        fileSha256,
        storageKey,
      },
      select: { id: true, status: true },
    });
    await recordEvent({
      organizationId,
      documentId: doc.id,
      actor,
      action: "document.uploaded",
      summary: `Uploaded ${filename}.`,
      detail: { filename, mimeType, sizeBytes: file.bytes.byteLength, sha256: fileSha256 },
    });
    return { ok: true, id: doc.id, filename, status: doc.status, duplicate: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await db.document.findUnique({
        where: { organizationId_fileSha256: { organizationId, fileSha256 } },
        select: { id: true, status: true },
      });
      if (raced) return { ok: true, id: raced.id, filename, status: raced.status, duplicate: true };
    }
    throw error;
  }
}

export type ConfirmResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; duplicateOfId?: string };

export interface ConfirmContext {
  actor: Actor;
  /** How the confirmation happened: one at a time, in bulk, or by the autopilot. */
  via: "review" | "bulk" | "autopilot";
  /** For the autopilot: the policy sentence that allowed it. */
  reason?: string;
  /** The pipeline confirming a document it is still holding as `extracting`. */
  duringExtraction?: boolean;
}

/** Saves the reviewed fields and marks the document confirmed. */
export async function confirmDocument(
  organizationId: string,
  documentId: string,
  rawInput: ConfirmInput,
  context: ConfirmContext,
): Promise<ConfirmResult> {
  const input = ConfirmInputSchema.safeParse(rawInput);
  if (!input.success) return { ok: false, error: "The form data was malformed." };
  const parsed = parseConfirmInput(input.data);
  if (!parsed.ok) return { ok: false, error: "Fix the highlighted fields.", fieldErrors: parsed.errors };
  const f = parsed.fields;

  const doc = await db.document.findFirst({
    where: { id: documentId, organizationId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status === "uploaded" || (doc.status === "extracting" && !context.duringExtraction)) {
    return { ok: false, error: "This document is still being extracted." };
  }
  const wasConfirmed = doc.status === "confirmed";
  // What changed relative to what was stored: on the first confirmation, the
  // reviewer's corrections to the extraction.
  const changes = diffConfirmInputs(
    toConfirmInput({
      ...doc,
      documentDate: doc.documentDate ? toPlainDate(doc.documentDate) : null,
      dueDate: doc.dueDate ? toPlainDate(doc.dueDate) : null,
    }),
    confirmFieldsToInput(f),
  );

  // Duplicate check before creating anything. A document waiting for review
  // may hold the key under the vendor's name if the vendor didn't exist yet.
  if (f.type !== "other" && f.vendorName) {
    const known = await findVendorByName(organizationId, f.vendorName);
    const keys = [
      known ? vendorKeyFor(known.id, null) : null,
      vendorKeyFor(null, normalizeVendorName(f.vendorName)),
    ]
      .map((vendorKey) =>
        dedupeKey({ vendorKey, documentNumber: f.documentNumber, currency: f.currency, totalCents: f.totalCents }),
      )
      .filter((k): k is string => k !== null);
    const dup = await db.document.findFirst({
      where: { organizationId, dedupeKey: { in: keys }, id: { not: documentId } },
      select: { id: true, status: true },
    });
    if (dup) {
      return {
        ok: false,
        error:
          dup.status === "confirmed"
            ? "A document with this vendor, number and amount is already on file."
            : "A document with this vendor, number and amount is already waiting for review.",
        duplicateOfId: dup.id,
      };
    }
  }

  const vendor = f.vendorName ? await findOrCreateVendor(organizationId, f.vendorName) : null;
  const vendorId = vendor?.id ?? null;
  const key =
    f.type === "other"
      ? null
      : dedupeKey({
          vendorKey: vendorKeyFor(vendorId, null),
          documentNumber: f.documentNumber,
          currency: f.currency,
          totalCents: f.totalCents,
        });
  const isCredit = f.type === "credit_memo";
  const reasonKept = isCredit && f.creditReason === doc.creditReason;
  const now = new Date();

  try {
    await db.$transaction(async (tx) => {
      await tx.lineItem.deleteMany({ where: { documentId, organizationId } });
      await tx.document.update({
        where: { id: documentId },
        data: {
          type: f.type,
          vendorId,
          vendorNameRaw: f.vendorName,
          documentNumber: f.documentNumber,
          documentNumberNormalized: normalizeDocumentNumber(f.documentNumber),
          documentDate: f.documentDate ? fromPlainDate(f.documentDate) : null,
          dueDate: f.dueDate ? fromPlainDate(f.dueDate) : null,
          paymentTerms: f.paymentTerms,
          currency: f.currency,
          subtotalCents: f.subtotalCents,
          taxCents: f.taxCents,
          totalCents: f.totalCents,
          dedupeKey: key,
          duplicateOfId: null,
          errorMessage: null,
          reviewIssues: issueList(reviewDocument(f)),
          status: "confirmed",
          confirmedAt: now,
          confirmedVia: wasConfirmed ? (doc.confirmedVia ?? context.via) : context.via,
          referencedInvoiceNumber: isCredit ? f.referencedInvoiceNumber : null,
          statedReason: isCredit ? f.statedReason : null,
          creditReason: isCredit ? f.creditReason : null,
          creditReasonSource: !isCredit ? null : reasonKept ? (doc.creditReasonSource ?? "user") : "user",
          creditReasonBasis: !isCredit
            ? null
            : reasonKept
              ? doc.creditReasonBasis
              : `${REASON_LABELS[f.creditReason ?? "other"]} was chosen by ${context.actor.name}.`,
          creditStatus: isCredit ? f.creditStatus : null,
          creditStatusChangedAt: isCredit && f.creditStatus !== doc.creditStatus ? now : doc.creditStatusChangedAt,
          ...(isCredit ? {} : { linkedInvoiceId: null, linkMethod: null, linkCandidateIds: [], linkRationale: null }),
          lineItems: {
            create: f.lineItems.map((line, position) => ({ ...line, position, organizationId })),
          },
        },
      });
      if (f.type !== "invoice") {
        // No longer an invoice: credits that pointed at it need a new home.
        await tx.document.updateMany({
          where: { organizationId, linkedInvoiceId: documentId },
          data: { linkedInvoiceId: null, linkMethod: null },
        });
      }

      if (vendor?.created) {
        await recordEvent(
          {
            organizationId,
            documentId,
            vendorId,
            actor: context.actor,
            action: "vendor.created",
            summary: `Created vendor ${vendor.name}.`,
          },
          tx,
        );
      }
      if (!wasConfirmed || changes.length > 0) {
        await recordEvent(
          {
            organizationId,
            documentId,
            vendorId,
            actor: context.actor,
            action: wasConfirmed ? "document.edited" : "document.confirmed",
            summary: confirmSummary(wasConfirmed, context, changes),
            detail: {
              via: context.via,
              reason: context.reason ?? null,
              changes: changes.map((c) => ({ ...c })),
              // Kept so corrections can be replayed against the extractor later.
              extractor: doc.extractor,
            },
          },
          tx,
        );
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "A document with this vendor, number and amount is already on file." };
    }
    throw error;
  }

  if (isCredit) await setCreditLink(organizationId, documentId, f.link, context.actor);
  if (f.type === "invoice" && vendorId) await relinkUnlinkedCredits(organizationId, vendorId);
  if (doc.vendorId && doc.vendorId !== vendorId) await relinkUnlinkedCredits(organizationId, doc.vendorId);
  return { ok: true };
}

function confirmSummary(
  wasConfirmed: boolean,
  context: ConfirmContext,
  changes: Array<{ label: string; from: string; to: string }>,
): string {
  const list = changes
    .slice(0, 4)
    .map((c) => `${c.label} ${c.from} \u2192 ${c.to}`)
    .join("; ");
  const more = changes.length > 4 ? `; and ${changes.length - 4} more` : "";
  if (wasConfirmed) return `Edited after confirmation: ${list}${more}.`;
  if (context.via === "autopilot") return `Confirmed automatically. ${context.reason ?? ""}`.trim();
  const how = context.via === "bulk" ? "Confirmed in bulk, as extracted." : "Confirmed as extracted.";
  if (changes.length === 0) return how;
  return `Confirmed with ${changes.length} correction${changes.length === 1 ? "" : "s"}: ${list}${more}.`;
}

/** Loads a stored document in the shape the confirm step takes. */
export async function storedConfirmInput(organizationId: string, documentId: string): Promise<ConfirmInput | null> {
  const doc = await db.document.findFirst({
    where: { id: documentId, organizationId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!doc) return null;
  return toConfirmInput({
    ...doc,
    documentDate: doc.documentDate ? toPlainDate(doc.documentDate) : null,
    dueDate: doc.dueDate ? toPlainDate(doc.dueDate) : null,
  });
}

/** Confirms every document in review that has no open issues, as extracted. */
export async function confirmAllClean(
  organizationId: string,
  actor: Actor,
): Promise<{ confirmed: number; failed: number }> {
  const docs = await db.document.findMany({
    where: { organizationId, status: "needs_review", reviewIssues: { isEmpty: true } },
    include: { lineItems: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  let confirmed = 0;
  let failed = 0;
  for (const doc of docs) {
    const result = await confirmDocument(
      organizationId,
      doc.id,
      toConfirmInput({
        ...doc,
        documentDate: doc.documentDate ? toPlainDate(doc.documentDate) : null,
        dueDate: doc.dueDate ? toPlainDate(doc.dueDate) : null,
      }),
      { actor, via: "bulk" },
    );
    if (result.ok) confirmed++;
    else failed++;
  }
  return { confirmed, failed };
}

export async function setCreditStatus(
  organizationId: string,
  documentId: string,
  status: CreditStatusKey,
  actor: Actor,
) {
  const credit = await db.document.findFirst({
    where: { id: documentId, organizationId, type: "credit_memo" },
    select: { id: true, vendorId: true, creditStatus: true, totalCents: true, currency: true },
  });
  if (!credit) throw new Error("Credit memo not found.");
  if (credit.creditStatus === status) return;
  await db.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: credit.id },
      data: { creditStatus: status, creditStatusChangedAt: new Date() },
    });
    const amount =
      credit.totalCents !== null && credit.currency ? ` (${formatCents(credit.totalCents, credit.currency)})` : "";
    await recordEvent(
      {
        organizationId,
        documentId: credit.id,
        vendorId: credit.vendorId,
        actor,
        action: "credit.status_changed",
        summary: `Marked ${CREDIT_STATUS_LABELS[status].toLowerCase()}${amount}. Was ${CREDIT_STATUS_LABELS[credit.creditStatus ?? "open"].toLowerCase()}.`,
        detail: { from: credit.creditStatus, to: status },
      },
      tx,
    );
  });
}

export async function retryExtraction(organizationId: string, documentId: string, actor: Actor) {
  const result = await db.document.updateMany({
    where: { id: documentId, organizationId, status: { in: ["failed", "needs_review"] }, storageKey: { not: null } },
    data: { status: "uploaded", errorMessage: null, duplicateOfId: null, dedupeKey: null },
  });
  if (result.count === 0) throw new Error("This document can't be re-extracted.");
  await recordEvent({
    organizationId,
    documentId,
    actor,
    action: "document.reextract_requested",
    summary: "Asked for the document to be read again.",
  });
  kickExtraction();
}

export async function deleteDocument(organizationId: string, documentId: string, actor: Actor) {
  const doc = await db.document.findFirst({
    where: { id: documentId, organizationId },
    select: {
      id: true,
      storageKey: true,
      type: true,
      status: true,
      vendorId: true,
      documentNumber: true,
      originalFilename: true,
      totalCents: true,
      currency: true,
      vendor: { select: { name: true } },
    },
  });
  if (!doc) throw new Error("Document not found.");
  const what = doc.type === "credit_memo" ? "credit memo" : doc.type === "invoice" ? "invoice" : "document";
  const amount = doc.totalCents !== null && doc.currency ? ` (${formatCents(doc.totalCents, doc.currency)})` : "";
  const from = doc.vendor ? ` from ${doc.vendor.name}` : "";
  // Written first: the event keeps the description after the row is gone.
  await recordEvent({
    organizationId,
    documentId: doc.id,
    vendorId: doc.vendorId,
    actor,
    action: "document.deleted",
    summary: `Deleted ${what} ${doc.documentNumber ?? doc.originalFilename ?? ""}${from}${amount}.`.replace(/\s+/g, " "),
    detail: { status: doc.status, type: doc.type, documentNumber: doc.documentNumber },
  });
  await db.document.delete({ where: { id: doc.id } });
  if (doc.storageKey) await getStorage().delete(doc.storageKey);
  // Credits that were linked to a deleted invoice get another chance to link.
  if (doc.type === "invoice" && doc.status === "confirmed" && doc.vendorId) {
    await relinkUnlinkedCredits(organizationId, doc.vendorId);
  }
}
