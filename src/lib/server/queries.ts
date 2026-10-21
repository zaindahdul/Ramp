import type { InvoiceOption } from "@/components/credit-controls";
import { addDays, daysBetween, formatPlainDate, toPlainDate, todayUtc, type PlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import type { MetricCredit, MetricInvoice } from "@/lib/metrics";
import { formatCents } from "@/lib/money";
import type { CreditReasonKey } from "@/lib/reasons";

// Read models for the pages. Every query is scoped by organizationId.

/** Confirmed invoices and credits, shaped for the pure metric functions. */
export async function loadMetricData(organizationId: string) {
  const [vendors, docs] = await Promise.all([
    db.vendor.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.document.findMany({
      where: {
        organizationId,
        status: "confirmed",
        type: { in: ["invoice", "credit_memo"] },
        vendorId: { not: null },
        documentDate: { not: null },
        currency: { not: null },
        totalCents: { not: null },
      },
      select: {
        id: true,
        type: true,
        vendorId: true,
        documentDate: true,
        currency: true,
        totalCents: true,
        creditReason: true,
        creditStatus: true,
        linkedInvoiceId: true,
      },
    }),
  ]);
  const invoices: MetricInvoice[] = [];
  const credits: MetricCredit[] = [];
  for (const d of docs) {
    const base = {
      id: d.id,
      vendorId: d.vendorId!,
      documentDate: toPlainDate(d.documentDate!),
      currency: d.currency!,
      totalCents: d.totalCents!,
    };
    if (d.type === "invoice") invoices.push(base);
    else
      credits.push({
        ...base,
        reason: d.creditReason ?? "other",
        status: d.creditStatus ?? "open",
        linkedInvoiceId: d.linkedInvoiceId,
      });
  }
  return { vendors, invoices, credits };
}

export interface CreditRow {
  id: string;
  vendorId: string | null;
  vendorName: string;
  documentNumber: string | null;
  documentDate: PlainDate;
  ageDays: number;
  currency: string;
  totalCents: number;
  reason: CreditReasonKey;
  status: "open" | "applied" | "written_off";
  linkedInvoice: { id: string; documentNumber: string | null } | null;
}

const creditSelect = {
  id: true,
  vendorId: true,
  vendorNameRaw: true,
  documentNumber: true,
  documentDate: true,
  currency: true,
  totalCents: true,
  creditReason: true,
  creditStatus: true,
  linkCandidateIds: true,
  vendor: { select: { name: true } },
  linkedInvoice: { select: { id: true, documentNumber: true } },
} as const;

type CreditRecord = {
  id: string;
  vendorId: string | null;
  vendorNameRaw: string | null;
  documentNumber: string | null;
  documentDate: Date | null;
  currency: string | null;
  totalCents: number | null;
  creditReason: CreditReasonKey | null;
  creditStatus: "open" | "applied" | "written_off" | null;
  vendor: { name: string } | null;
  linkedInvoice: { id: string; documentNumber: string | null } | null;
};

function toCreditRow(c: CreditRecord, today: PlainDate): CreditRow {
  const documentDate = c.documentDate ? toPlainDate(c.documentDate) : today;
  return {
    id: c.id,
    vendorId: c.vendorId,
    vendorName: c.vendor?.name ?? c.vendorNameRaw ?? "Unknown vendor",
    documentNumber: c.documentNumber,
    documentDate,
    ageDays: daysBetween(documentDate, today),
    currency: c.currency ?? "USD",
    totalCents: c.totalCents ?? 0,
    reason: c.creditReason ?? "other",
    status: c.creditStatus ?? "open",
    linkedInvoice: c.linkedInvoice,
  };
}

export async function getOpenCredits(organizationId: string): Promise<CreditRow[]> {
  const today = todayUtc();
  const rows = await db.document.findMany({
    where: { organizationId, type: "credit_memo", status: "confirmed", creditStatus: "open" },
    select: creditSelect,
    orderBy: [{ documentDate: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => toCreditRow(r, today));
}

export interface UnlinkedCreditRow extends CreditRow {
  options: InvoiceOption[];
}

function invoiceLabel(i: { documentNumber: string | null; documentDate: Date | null; totalCents: number | null; currency: string | null }) {
  const date = i.documentDate ? formatPlainDate(toPlainDate(i.documentDate)) : "no date";
  const amount = i.totalCents !== null ? formatCents(i.totalCents, i.currency ?? "USD") : "";
  return `${i.documentNumber ?? "(no number)"} · ${date} · ${amount}`;
}

/**
 * Confirmed credits with no invoice, except those a person marked as not
 * correcting any invoice. Each comes with dropdown options.
 */
export async function getUnlinkedCredits(organizationId: string): Promise<UnlinkedCreditRow[]> {
  const today = todayUtc();
  const credits = await db.document.findMany({
    where: {
      organizationId,
      type: "credit_memo",
      status: "confirmed",
      linkedInvoiceId: null,
      OR: [{ linkMethod: null }, { linkMethod: { not: "manual" } }],
    },
    select: creditSelect,
    orderBy: [{ documentDate: "desc" }, { id: "asc" }],
  });
  return Promise.all(
    credits.map(async (c) => ({
      ...toCreditRow(c, today),
      options: await invoiceOptionsForCredit(organizationId, c),
    })),
  );
}

export async function invoiceOptionsForCredit(
  organizationId: string,
  credit: { vendorId: string | null; currency: string | null; documentDate: Date | null; linkCandidateIds: string[] },
): Promise<InvoiceOption[]> {
  if (!credit.vendorId) return [];
  const select = { id: true, documentNumber: true, documentDate: true, totalCents: true, currency: true } as const;
  const candidates =
    credit.linkCandidateIds.length > 0
      ? await db.document.findMany({
          where: { organizationId, id: { in: credit.linkCandidateIds }, type: "invoice", status: "confirmed" },
          select,
          orderBy: { documentDate: "desc" },
        })
      : [];
  const end = credit.documentDate ? toPlainDate(credit.documentDate) : todayUtc();
  const recent = await db.document.findMany({
    where: {
      organizationId,
      vendorId: credit.vendorId,
      type: "invoice",
      status: "confirmed",
      currency: credit.currency ?? undefined,
      id: { notIn: credit.linkCandidateIds },
      documentDate: { gte: new Date(`${addDays(end, -365)}T00:00:00Z`) },
    },
    select,
    orderBy: { documentDate: "desc" },
    take: 40,
  });
  return [
    ...candidates.map((i) => ({ id: i.id, label: invoiceLabel(i), candidate: true })),
    ...recent.map((i) => ({ id: i.id, label: invoiceLabel(i), candidate: false })),
  ];
}
