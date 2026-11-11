import type { Prisma } from "@/generated/prisma/client";
import { toPlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { decideCreditLink, explainLink, type LinkableInvoice, type LinkResult } from "@/lib/linking";
import { LINKER, recordEvent, type Actor } from "@/lib/server/audit";

type Tx = Prisma.TransactionClient;

export async function loadLinkableInvoices(
  organizationId: string,
  vendorId: string,
  tx: Tx = db,
): Promise<LinkableInvoice[]> {
  const rows = await tx.document.findMany({
    where: { organizationId, vendorId, type: "invoice", status: "confirmed" },
    select: {
      id: true,
      vendorId: true,
      documentNumber: true,
      documentDate: true,
      currency: true,
      totalCents: true,
      lineItems: { select: { description: true } },
    },
  });
  return rows.flatMap((r) =>
    r.vendorId && r.documentDate && r.currency && r.totalCents !== null
      ? [
          {
            id: r.id,
            vendorId: r.vendorId,
            documentNumber: r.documentNumber,
            documentDate: toPlainDate(r.documentDate),
            currency: r.currency,
            totalCents: r.totalCents,
            lineDescriptions: r.lineItems.map((l) => l.description),
          },
        ]
      : [],
  );
}

/**
 * Runs the automatic linker for one confirmed credit memo and saves the result
 * with the sentence explaining it. Credits a person linked by hand are left
 * alone. An audit event is written only when the outcome changes, so re-running
 * the linker after every new invoice doesn't fill the trail with repeats.
 */
export async function autoLinkCredit(
  organizationId: string,
  creditId: string,
  options: { tx?: Tx; invoices?: LinkableInvoice[]; force?: boolean } = {},
): Promise<LinkResult | null> {
  const tx = options.tx ?? db;
  const credit = await tx.document.findFirst({
    where: { id: creditId, organizationId, type: "credit_memo", status: "confirmed" },
    include: { lineItems: { select: { description: true } } },
  });
  if (!credit || credit.linkMethod === "manual") return null;
  if (!credit.vendorId || !credit.documentDate || !credit.currency || credit.totalCents === null) return null;

  const invoices = options.invoices ?? (await loadLinkableInvoices(organizationId, credit.vendorId, tx));
  const decision = decideCreditLink(
    {
      vendorId: credit.vendorId,
      documentDate: toPlainDate(credit.documentDate),
      currency: credit.currency,
      totalCents: credit.totalCents,
      referencedInvoiceNumber: credit.referencedInvoiceNumber,
      lineDescriptions: credit.lineItems.map((l) => l.description),
    },
    invoices,
  );
  const { result } = decision;
  const linked = result.kind === "linked" ? invoices.find((i) => i.id === result.invoiceId) : null;
  const rationale = explainLink(decision, linked?.documentNumber ?? null);

  await tx.document.update({
    where: { id: credit.id },
    data:
      result.kind === "linked"
        ? { linkedInvoiceId: result.invoiceId, linkMethod: result.method, linkCandidateIds: [], linkRationale: rationale }
        : {
            linkedInvoiceId: null,
            linkMethod: null,
            linkCandidateIds: result.kind === "ambiguous" ? result.candidateIds : [],
            linkRationale: rationale,
          },
  });

  const before = credit.linkedInvoiceId ? "linked" : credit.linkCandidateIds.length > 0 ? "ambiguous" : "none";
  // Still ambiguous among a different number of invoices is not news.
  const changed =
    options.force ||
    credit.linkRationale === null ||
    before !== result.kind ||
    (result.kind === "linked" && credit.linkedInvoiceId !== result.invoiceId);
  if (changed) {
    await recordEvent(
      {
        organizationId,
        documentId: credit.id,
        vendorId: credit.vendorId,
        actor: LINKER,
        action:
          result.kind === "linked" ? "credit.linked" : result.kind === "ambiguous" ? "credit.link_ambiguous" : "credit.link_none",
        summary:
          result.kind === "linked"
            ? `Linked to invoice ${linked?.documentNumber ?? ""}. ${rationale}`.replace(/\s+/g, " ")
            : `Not linked. ${rationale}`,
        detail: {
          outcome: result.kind,
          method: result.kind === "linked" ? result.method : null,
          invoiceId: result.kind === "linked" ? result.invoiceId : null,
          candidates: result.kind === "ambiguous" ? result.candidateIds.length : 0,
          evidence: { ...decision.evidence },
        },
      },
      tx,
    );
  }
  return result;
}

/** After a new invoice arrives, try again on that vendor's unlinked credits. */
export async function relinkUnlinkedCredits(organizationId: string, vendorId: string): Promise<void> {
  const credits = await db.document.findMany({
    where: {
      organizationId,
      vendorId,
      type: "credit_memo",
      status: "confirmed",
      linkedInvoiceId: null,
      OR: [{ linkMethod: null }, { linkMethod: { not: "manual" } }],
    },
    select: { id: true },
  });
  if (credits.length === 0) return;
  const invoices = await loadLinkableInvoices(organizationId, vendorId);
  for (const credit of credits) {
    await autoLinkCredit(organizationId, credit.id, { invoices });
  }
}

/**
 * A person's pick from the dropdown: an invoice id, "none" (deliberately
 * unlinked), or "auto" (hand it back to the automatic linker).
 */
export async function setCreditLink(
  organizationId: string,
  creditId: string,
  choice: string,
  actor: Actor,
): Promise<void> {
  const credit = await db.document.findFirst({
    where: { id: creditId, organizationId, type: "credit_memo" },
    select: { id: true, vendorId: true, linkMethod: true, linkedInvoiceId: true },
  });
  if (!credit) throw new Error("Credit memo not found.");
  const wasManual = credit.linkMethod === "manual";

  if (choice === "auto") {
    if (wasManual) await db.document.update({ where: { id: credit.id }, data: { linkMethod: null } });
    await autoLinkCredit(organizationId, credit.id, { force: wasManual });
    return;
  }
  if (choice === "none") {
    if (wasManual && credit.linkedInvoiceId === null) return;
    const rationale = `Marked by ${actor.name} as not correcting any invoice.`;
    await db.document.update({
      where: { id: credit.id },
      data: { linkedInvoiceId: null, linkMethod: "manual", linkCandidateIds: [], linkRationale: rationale },
    });
    await recordEvent({
      organizationId,
      documentId: credit.id,
      vendorId: credit.vendorId,
      actor,
      action: "credit.unlinked",
      summary: "Marked as not correcting any invoice.",
      detail: { outcome: "none", method: "manual" },
    });
    return;
  }
  const invoice = await db.document.findFirst({
    where: { id: choice, organizationId, type: "invoice", status: "confirmed" },
    select: { id: true, documentNumber: true },
  });
  if (!invoice) throw new Error("Invoice not found.");
  if (wasManual && credit.linkedInvoiceId === invoice.id) return;
  await db.document.update({
    where: { id: credit.id },
    data: {
      linkedInvoiceId: invoice.id,
      linkMethod: "manual",
      linkCandidateIds: [],
      linkRationale: `Picked by ${actor.name}.`,
    },
  });
  await recordEvent({
    organizationId,
    documentId: credit.id,
    vendorId: credit.vendorId,
    actor,
    action: "credit.linked",
    summary: `Linked to invoice ${invoice.documentNumber ?? ""} by hand.`.replace(/\s+/g, " "),
    detail: { outcome: "linked", method: "manual", invoiceId: invoice.id },
  });
}
