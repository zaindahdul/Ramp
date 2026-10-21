import { daysBetween, isWithin, type PlainDate } from "@/lib/dates";
import { divRound } from "@/lib/money";
import { CREDIT_REASONS, isBillingError, type CreditReasonKey } from "@/lib/reasons";

// Scorecard metric definitions. These are the single source of truth: the UI
// tooltips quote METRIC_DEFINITIONS and the tests pin the arithmetic.
//
// All metrics are computed per vendor *and per currency*. Amounts are never
// converted, so a vendor that bills in two currencies has two scorecards.

export const METRIC_DEFINITIONS = {
  invoices: "Confirmed invoices dated in the period.",
  billingErrorRate:
    "Invoices in the period with at least one linked billing-error credit (pricing error, quantity error or duplicate billing), divided by invoices in the period. Shows — when there are no invoices.",
  totalCredits: "Sum of confirmed credit memos dated in the period, broken down by reason.",
  averageCredit: "Total credits divided by the number of credits in the period.",
  medianDaysToResolve:
    "Median of (credit date − date of the invoice it corrects), over credits in the period that are linked to an invoice. Unlinked credits are left out.",
  openBalance: "Sum of all credits whose status is open, regardless of period: money the vendor still owes.",
} as const;

export const OPEN_CREDIT_AGING_DAYS = 60;

export interface MetricInvoice {
  id: string;
  vendorId: string;
  documentDate: PlainDate;
  currency: string;
  totalCents: number;
}

export type CreditStatusKey = "open" | "applied" | "written_off";

export interface MetricCredit {
  id: string;
  vendorId: string;
  documentDate: PlainDate;
  currency: string;
  totalCents: number;
  reason: CreditReasonKey;
  status: CreditStatusKey;
  linkedInvoiceId: string | null;
}

export interface ReasonBreakdown {
  count: number;
  cents: number;
  /** Credits of this reason in the period that are still open. */
  openCents: number;
  /** Invoices in the period with at least one linked credit of this reason. */
  invoiceCount: number;
}

export interface VendorMetrics {
  vendorId: string;
  currency: string;
  invoiceCount: number;
  invoicesWithBillingError: number;
  /** 0..1, or null when there are no invoices. */
  billingErrorRate: number | null;
  creditCount: number;
  totalCreditsCents: number;
  byReason: Record<CreditReasonKey, ReasonBreakdown>;
  /** Integer cents, or null when there are no credits. */
  averageCreditCents: number | null;
  /** May be fractional (x.5) for an even number of credits. Null when none are linked. */
  medianDaysToResolve: number | null;
  linkedCreditCount: number;
  /** All open credits regardless of period. */
  openCreditCents: number;
  openCreditCount: number;
  /** Open credits older than OPEN_CREDIT_AGING_DAYS as of `today`. */
  openOver60Cents: number;
}

export interface Range {
  start: PlainDate;
  end: PlainDate;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function emptyBreakdown(): Record<CreditReasonKey, ReasonBreakdown> {
  return Object.fromEntries(
    CREDIT_REASONS.map((r) => [r, { count: 0, cents: 0, openCents: 0, invoiceCount: 0 }]),
  ) as Record<CreditReasonKey, ReasonBreakdown>;
}

export interface ComputeArgs {
  vendorId: string;
  currency: string;
  period: Range;
  today: PlainDate;
  /** Confirmed invoices. May include other vendors, currencies and dates. */
  invoices: readonly MetricInvoice[];
  /** Confirmed credits. May include other vendors, currencies and dates. */
  credits: readonly MetricCredit[];
}

export function computeVendorMetrics(args: ComputeArgs): VendorMetrics {
  const { vendorId, currency, period, today } = args;
  const invoices = args.invoices.filter((i) => i.vendorId === vendorId && i.currency === currency);
  const credits = args.credits.filter((c) => c.vendorId === vendorId && c.currency === currency);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));

  const periodInvoices = invoices.filter((i) => isWithin(i.documentDate, period.start, period.end));
  const periodInvoiceIds = new Set(periodInvoices.map((i) => i.id));
  const periodCredits = credits.filter((c) => isWithin(c.documentDate, period.start, period.end));

  // An invoice counts as having a billing error if any linked billing-error
  // credit exists, whatever the credit's date (corrections often arrive later).
  const errorInvoiceIds = new Set<string>();
  const invoicesByReason = new Map<CreditReasonKey, Set<string>>();
  for (const credit of credits) {
    if (!credit.linkedInvoiceId || !periodInvoiceIds.has(credit.linkedInvoiceId)) continue;
    if (isBillingError(credit.reason)) errorInvoiceIds.add(credit.linkedInvoiceId);
    let set = invoicesByReason.get(credit.reason);
    if (!set) invoicesByReason.set(credit.reason, (set = new Set()));
    set.add(credit.linkedInvoiceId);
  }

  const byReason = emptyBreakdown();
  let totalCreditsCents = 0;
  const resolveDays: number[] = [];
  for (const credit of periodCredits) {
    const bucket = byReason[credit.reason];
    bucket.count += 1;
    bucket.cents += credit.totalCents;
    if (credit.status === "open") bucket.openCents += credit.totalCents;
    totalCreditsCents += credit.totalCents;
    const invoice = credit.linkedInvoiceId ? invoiceById.get(credit.linkedInvoiceId) : undefined;
    if (invoice) resolveDays.push(daysBetween(invoice.documentDate, credit.documentDate));
  }
  for (const reason of CREDIT_REASONS) {
    byReason[reason].invoiceCount = invoicesByReason.get(reason)?.size ?? 0;
  }

  let openCreditCents = 0;
  let openCreditCount = 0;
  let openOver60Cents = 0;
  for (const credit of credits) {
    if (credit.status !== "open") continue;
    openCreditCents += credit.totalCents;
    openCreditCount += 1;
    if (daysBetween(credit.documentDate, today) > OPEN_CREDIT_AGING_DAYS) {
      openOver60Cents += credit.totalCents;
    }
  }

  const invoiceCount = periodInvoices.length;
  return {
    vendorId,
    currency,
    invoiceCount,
    invoicesWithBillingError: errorInvoiceIds.size,
    billingErrorRate: invoiceCount === 0 ? null : errorInvoiceIds.size / invoiceCount,
    creditCount: periodCredits.length,
    totalCreditsCents,
    byReason,
    averageCreditCents:
      periodCredits.length === 0 ? null : divRound(totalCreditsCents, periodCredits.length),
    medianDaysToResolve: median(resolveDays),
    linkedCreditCount: resolveDays.length,
    openCreditCents,
    openCreditCount,
    openOver60Cents,
  };
}

export interface ScorecardRow extends VendorMetrics {
  vendorName: string;
}

/**
 * One row per vendor that has any confirmed document in `currency`, at any date
 * (so a clean vendor with no activity this period still shows up).
 */
export function computeScorecard(args: {
  vendors: readonly { id: string; name: string }[];
  currency: string;
  period: Range;
  today: PlainDate;
  invoices: readonly MetricInvoice[];
  credits: readonly MetricCredit[];
}): ScorecardRow[] {
  const active = new Set<string>();
  for (const doc of [...args.invoices, ...args.credits]) {
    if (doc.currency === args.currency) active.add(doc.vendorId);
  }
  return args.vendors
    .filter((v) => active.has(v.id))
    .map((v) => ({
      vendorName: v.name,
      ...computeVendorMetrics({ ...args, vendorId: v.id }),
    }));
}

/** Currencies with any confirmed document, most-used first. */
export function currenciesInUse(docs: readonly { currency: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.currency, (counts.get(d.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

export const SORT_KEYS = [
  "vendor",
  "invoices",
  "errorRate",
  "totalCredits",
  "averageCredit",
  "medianDays",
  "openBalance",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === "string" && (SORT_KEYS as readonly string[]).includes(value);
}

function sortValue(row: ScorecardRow, key: SortKey): number | string | null {
  switch (key) {
    case "vendor":
      return row.vendorName.toLowerCase();
    case "invoices":
      return row.invoiceCount;
    case "errorRate":
      return row.billingErrorRate;
    case "totalCredits":
      return row.totalCreditsCents;
    case "averageCredit":
      return row.averageCreditCents;
    case "medianDays":
      return row.medianDaysToResolve;
    case "openBalance":
      return row.openCreditCents;
  }
}

/** Sorts by any metric. Rows showing "—" (null) always sort last. */
export function sortScorecard(rows: readonly ScorecardRow[], key: SortKey, dir: SortDir): ScorecardRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return a.vendorName.localeCompare(b.vendorName);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
    return cmp !== 0 ? cmp * factor : a.vendorName.localeCompare(b.vendorName);
  });
}

export type MonthlyReasonPoint = { month: string } & Record<CreditReasonKey, number>;

/** Credit cents per calendar month and reason, for the vendor detail chart. */
export function monthlyCreditsByReason(
  credits: readonly MetricCredit[],
  vendorId: string,
  currency: string,
  months: readonly string[],
): MonthlyReasonPoint[] {
  const points = new Map<string, MonthlyReasonPoint>();
  for (const month of months) {
    points.set(month, {
      month,
      ...(Object.fromEntries(CREDIT_REASONS.map((r) => [r, 0])) as Record<CreditReasonKey, number>),
    });
  }
  for (const credit of credits) {
    if (credit.vendorId !== vendorId || credit.currency !== currency) continue;
    const point = points.get(credit.documentDate.slice(0, 7));
    if (point) point[credit.reason] += credit.totalCents;
  }
  return [...points.values()];
}

export function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  const pct = rate * 100;
  if (pct > 0 && pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

export function formatDays(days: number | null): string {
  if (days === null) return "—";
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}
