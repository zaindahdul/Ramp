import { describe, expect, it } from "vitest";
import {
  computeScorecard,
  computeVendorMetrics,
  median,
  monthlyCreditsByReason,
  sortScorecard,
  type MetricCredit,
  type MetricInvoice,
} from "@/lib/metrics";
import { leadSentences, negotiationSentences } from "@/lib/narrative";

// Hand-built dataset. Period: 2026-01-01 .. 2026-06-30, "today" 2026-06-30.
const period = { start: "2026-01-01", end: "2026-06-30" };
const today = "2026-06-30";

const invoices: MetricInvoice[] = [
  // Acme, USD, in period
  { id: "inv1", vendorId: "acme", documentDate: "2026-01-10", currency: "USD", totalCents: 100_000 },
  { id: "inv2", vendorId: "acme", documentDate: "2026-02-15", currency: "USD", totalCents: 50_000 },
  { id: "inv3", vendorId: "acme", documentDate: "2026-03-20", currency: "USD", totalCents: 20_000 },
  { id: "inv4", vendorId: "acme", documentDate: "2026-05-05", currency: "USD", totalCents: 80_000 },
  // Acme, outside the period
  { id: "inv0", vendorId: "acme", documentDate: "2025-12-01", currency: "USD", totalCents: 30_000 },
  // Acme, other currency
  { id: "invE", vendorId: "acme", documentDate: "2026-02-01", currency: "EUR", totalCents: 40_000 },
  // Clean vendor: one invoice, no credits
  { id: "b1", vendorId: "clean", documentDate: "2026-02-01", currency: "USD", totalCents: 10_000 },
];

const credits: MetricCredit[] = [
  // in period, linked to inv1 (20 days), billing error
  { id: "c1", vendorId: "acme", documentDate: "2026-01-30", currency: "USD", totalCents: 5_000, reason: "pricing_error", status: "applied", linkedInvoiceId: "inv1" },
  // in period, linked to inv2 (10 days), billing error, open and 125 days old
  { id: "c2", vendorId: "acme", documentDate: "2026-02-25", currency: "USD", totalCents: 2_000, reason: "quantity_error", status: "open", linkedInvoiceId: "inv2" },
  // in period, second credit on inv1 (50 days), open and 121 days old
  { id: "c3", vendorId: "acme", documentDate: "2026-03-01", currency: "USD", totalCents: 1_500, reason: "pricing_error", status: "open", linkedInvoiceId: "inv1" },
  // in period, linked to inv3 (26 days), NOT a billing error
  { id: "c4", vendorId: "acme", documentDate: "2026-04-15", currency: "USD", totalCents: 3_000, reason: "damaged_or_defective", status: "applied", linkedInvoiceId: "inv3" },
  // in period, unlinked, open, 29 days old
  { id: "c5", vendorId: "acme", documentDate: "2026-06-01", currency: "USD", totalCents: 1_000, reason: "rebate_or_promo", status: "open", linkedInvoiceId: null },
  // in period, linked to inv0 which is outside the period (35 days)
  { id: "c6", vendorId: "acme", documentDate: "2026-01-05", currency: "USD", totalCents: 4_000, reason: "duplicate_billing", status: "applied", linkedInvoiceId: "inv0" },
  // outside the period, open, 192 days old: counts toward the open balance only
  { id: "c7", vendorId: "acme", documentDate: "2025-12-20", currency: "USD", totalCents: 700, reason: "pricing_error", status: "open", linkedInvoiceId: "inv0" },
  // other currency: excluded from the USD scorecard
  { id: "c8", vendorId: "acme", documentDate: "2026-03-01", currency: "EUR", totalCents: 900, reason: "pricing_error", status: "open", linkedInvoiceId: "invE" },
  // vendor with credits but no invoices
  { id: "x1", vendorId: "nocredit-invoices", documentDate: "2026-03-01", currency: "USD", totalCents: 500, reason: "pricing_error", status: "written_off", linkedInvoiceId: null },
];

function metricsFor(vendorId: string, currency = "USD") {
  return computeVendorMetrics({ vendorId, currency, period, today, invoices, credits });
}

describe("computeVendorMetrics (hand-calculated)", () => {
  const m = metricsFor("acme");

  it("Invoices: confirmed invoices in the period", () => {
    // inv1..inv4. inv0 is before the period, invE is EUR.
    expect(m.invoiceCount).toBe(4);
  });

  it("Billing error rate: invoices with a linked billing-error credit / invoices", () => {
    // inv1 (c1, c3 pricing) and inv2 (c2 quantity). inv3 only has a damaged-goods credit.
    expect(m.invoicesWithBillingError).toBe(2);
    expect(m.billingErrorRate).toBe(0.5);
  });

  it("Total credits: sum of credits in the period, by reason", () => {
    // c1 5000 + c2 2000 + c3 1500 + c4 3000 + c5 1000 + c6 4000
    expect(m.creditCount).toBe(6);
    expect(m.totalCreditsCents).toBe(16_500);
    expect(m.byReason.pricing_error).toEqual({ count: 2, cents: 6_500, openCents: 1_500, invoiceCount: 1 });
    expect(m.byReason.quantity_error).toEqual({ count: 1, cents: 2_000, openCents: 2_000, invoiceCount: 1 });
    expect(m.byReason.duplicate_billing.cents).toBe(4_000);
    // c6 corrects inv0, which is outside the period, so no in-period invoice is affected.
    expect(m.byReason.duplicate_billing.invoiceCount).toBe(0);
    expect(m.byReason.damaged_or_defective.cents).toBe(3_000);
    expect(m.byReason.rebate_or_promo.cents).toBe(1_000);
    expect(m.byReason.return.cents).toBe(0);
  });

  it("Average credit size: total credits / number of credits", () => {
    expect(m.averageCreditCents).toBe(2_750); // 16500 / 6
  });

  it("Median days to resolve: linked credits only", () => {
    // c2 10, c1 20, c4 26, c6 35, c3 50. c5 is unlinked.
    expect(m.linkedCreditCount).toBe(5);
    expect(m.medianDaysToResolve).toBe(26);
  });

  it("Open credit balance: all open credits regardless of period", () => {
    // c2 2000 + c3 1500 + c5 1000 + c7 700 (c7 is before the period)
    expect(m.openCreditCents).toBe(5_200);
    expect(m.openCreditCount).toBe(4);
    // Older than 60 days on 2026-06-30: c2 (125), c3 (121), c7 (192). c5 is 29 days.
    expect(m.openOver60Cents).toBe(4_200);
  });

  it("keeps currencies apart", () => {
    const eur = metricsFor("acme", "EUR");
    expect(eur.invoiceCount).toBe(1);
    expect(eur.totalCreditsCents).toBe(900);
    expect(eur.billingErrorRate).toBe(1);
    expect(eur.openCreditCents).toBe(900);
  });
});

describe("edge cases", () => {
  it("zero invoices: error rate is null (shown as —)", () => {
    const m = metricsFor("nocredit-invoices");
    expect(m.invoiceCount).toBe(0);
    expect(m.billingErrorRate).toBeNull();
    expect(m.totalCreditsCents).toBe(500);
    expect(m.averageCreditCents).toBe(500);
    // unlinked credit: nothing to measure
    expect(m.medianDaysToResolve).toBeNull();
    // written off, not open
    expect(m.openCreditCents).toBe(0);
  });

  it("zero credits: totals are 0 and averages are null", () => {
    const m = metricsFor("clean");
    expect(m.invoiceCount).toBe(1);
    expect(m.billingErrorRate).toBe(0);
    expect(m.creditCount).toBe(0);
    expect(m.totalCreditsCents).toBe(0);
    expect(m.averageCreditCents).toBeNull();
    expect(m.medianDaysToResolve).toBeNull();
    expect(m.openCreditCents).toBe(0);
  });

  it("a vendor with no documents at all", () => {
    const m = metricsFor("nobody");
    expect(m.invoiceCount).toBe(0);
    expect(m.billingErrorRate).toBeNull();
    expect(m.averageCreditCents).toBeNull();
    expect(m.medianDaysToResolve).toBeNull();
  });

  it("only unlinked credits: no median, no error invoices", () => {
    const m = computeVendorMetrics({
      vendorId: "v",
      currency: "USD",
      period,
      today,
      invoices: [{ id: "i", vendorId: "v", documentDate: "2026-02-01", currency: "USD", totalCents: 1000 }],
      credits: [
        { id: "c", vendorId: "v", documentDate: "2026-02-10", currency: "USD", totalCents: 100, reason: "pricing_error", status: "open", linkedInvoiceId: null },
      ],
    });
    expect(m.billingErrorRate).toBe(0);
    expect(m.medianDaysToResolve).toBeNull();
    expect(m.totalCreditsCents).toBe(100);
  });

  it("median of an even count averages the middle two", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
  });

  it("rounds the average to the nearest cent with integer math", () => {
    const m = computeVendorMetrics({
      vendorId: "v",
      currency: "USD",
      period,
      today,
      invoices: [],
      credits: [100, 100, 101].map((cents, i) => ({
        id: `c${i}`, vendorId: "v", documentDate: "2026-02-10", currency: "USD", totalCents: cents,
        reason: "other" as const, status: "applied" as const, linkedInvoiceId: null,
      })),
    });
    expect(m.averageCreditCents).toBe(100); // 301 / 3 = 100.33
  });
});

describe("scorecard", () => {
  const vendors = [
    { id: "acme", name: "Acme Supply" },
    { id: "clean", name: "Clean Co" },
    { id: "nocredit-invoices", name: "Credits Only" },
    { id: "nobody", name: "Dormant" },
  ];

  it("includes vendors with any document in the currency", () => {
    const rows = computeScorecard({ vendors, currency: "USD", period, today, invoices, credits });
    expect(rows.map((r) => r.vendorName)).toEqual(["Acme Supply", "Clean Co", "Credits Only"]);
    const eurRows = computeScorecard({ vendors, currency: "EUR", period, today, invoices, credits });
    expect(eurRows.map((r) => r.vendorName)).toEqual(["Acme Supply"]);
  });

  it("sorts by any metric with — (null) last in both directions", () => {
    const rows = computeScorecard({ vendors, currency: "USD", period, today, invoices, credits });
    expect(sortScorecard(rows, "errorRate", "desc").map((r) => r.vendorId)).toEqual(["acme", "clean", "nocredit-invoices"]);
    expect(sortScorecard(rows, "errorRate", "asc").map((r) => r.vendorId)).toEqual(["clean", "acme", "nocredit-invoices"]);
    expect(sortScorecard(rows, "totalCredits", "desc").map((r) => r.vendorId)).toEqual(["acme", "nocredit-invoices", "clean"]);
    expect(sortScorecard(rows, "vendor", "asc").map((r) => r.vendorId)).toEqual(["acme", "clean", "nocredit-invoices"]);
  });

  it("buckets credits by month and reason", () => {
    const points = monthlyCreditsByReason(credits, "acme", "USD", ["2026-01", "2026-02", "2026-03"]);
    expect(points[0].pricing_error).toBe(5_000);
    expect(points[0].duplicate_billing).toBe(4_000);
    expect(points[1].quantity_error).toBe(2_000);
    expect(points[2].pricing_error).toBe(1_500);
  });
});

describe("negotiation sentences", () => {
  it("reproduces the spec example", () => {
    expect(
      leadSentences({
        vendorName: "Acme Supply",
        reason: "pricing_error",
        currency: "USD",
        cents: 12_040_000,
        affectedInvoices: 31,
        totalInvoices: 172,
        openCents: 1_420_000,
        phrase: "in the last 12 months",
      }).join(" "),
    ).toBe(
      "Acme Supply issued $120,400 in pricing-error credits across 31 invoices in the last 12 months, an 18% error rate. $14,200 of those credits are still unused.",
    );
  });

  it("builds the full summary from the hand-built dataset", () => {
    const sentences = negotiationSentences({
      vendorName: "Acme Supply",
      metrics: metricsFor("acme"),
      phrase: "in the first half of 2026",
    });
    expect(sentences).toEqual([
      "Acme Supply issued $65 in pricing-error credits across 1 invoice in the first half of 2026, a 25% error rate.",
      "$15 of those credits are still unused.",
      "It also issued $40 in duplicate-billing credits and $20 in quantity-error credits.",
      "Overall, 2 of 4 invoices (50%) needed at least one billing-error credit.",
      "Another $40 in credits for damaged or defective goods and rebates and promos, which are not billing errors.",
      "Credits arrived a median of 26 days after the invoice they corrected.",
      "Acme Supply still owes $52 in open credits, $42 of it open for more than 60 days.",
    ]);
  });

  it("praises a clean vendor and handles an empty one", () => {
    expect(negotiationSentences({ vendorName: "Clean Co", metrics: metricsFor("clean"), phrase: "this year" })).toEqual([
      "Clean Co billed 1 invoice this year without a single billing-error credit.",
    ]);
    expect(negotiationSentences({ vendorName: "Dormant", metrics: metricsFor("nobody"), phrase: "this year" })).toEqual([
      "Dormant has no confirmed invoices or credits in USD this year.",
    ]);
  });
});
