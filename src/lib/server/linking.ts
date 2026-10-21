import type { Prisma } from "@/generated/prisma/client";
import { toPlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { linkCreditToInvoice, type LinkableInvoice, type LinkResult } from "@/lib/linking";

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
 * Runs the automatic linker for one confirmed credit memo and saves the result.
 * Credits a person linked by hand are left alone.
 */
export async function autoLinkCredit(
  organizationId: string,
  creditId: string,
  options: { tx?: Tx; invoices?: LinkableInvoice[] } = {},
): Promise<LinkResult | null> {
  const tx = options.tx ?? db;
  const credit = await tx.document.findFirst({
    where: { id: creditId, organizationId, type: "credit_memo", status: "confirmed" },
    include: { lineItems: { select: { description: true } } },
  });
  if (!credit || credit.linkMethod === "manual") return null;
  if (!credit.vendorId || !credit.documentDate || !credit.currency || credit.totalCents === null) return null;

  const invoices = options.invoices ?? (await loadLinkableInvoices(organizationId, credit.vendorId, tx));
  const result = linkCreditToInvoice(
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

  await tx.document.update({
    where: { id: credit.id },
    data:
      result.kind === "linked"
        ? { linkedInvoiceId: result.invoiceId, linkMethod: result.method, linkCandidateIds: [] }
        : {
            linkedInvoiceId: null,
            linkMethod: null,
            linkCandidateIds: result.kind === "ambiguous" ? result.candidateIds : [],
          },
  });
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
export async function setCreditLink(organizationId: string, creditId: string, choice: string): Promise<void> {
  const credit = await db.document.findFirst({
    where: { id: creditId, organizationId, type: "credit_memo" },
    select: { id: true, vendorId: true },
  });
  if (!credit) throw new Error("Credit memo not found.");

  if (choice === "auto") {
    await db.document.update({ where: { id: credit.id }, data: { linkMethod: null } });
    await autoLinkCredit(organizationId, credit.id);
    return;
  }
  if (choice === "none") {
    await db.document.update({
      where: { id: credit.id },
      data: { linkedInvoiceId: null, linkMethod: "manual" },
    });
    return;
  }
  const invoice = await db.document.findFirst({
    where: { id: choice, organizationId, type: "invoice", status: "confirmed" },
    select: { id: true },
  });
  if (!invoice) throw new Error("Invoice not found.");
  await db.document.update({
    where: { id: credit.id },
    data: { linkedInvoiceId: invoice.id, linkMethod: "manual", linkCandidateIds: [] },
  });
}
