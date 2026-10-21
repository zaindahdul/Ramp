import { describe, expect, it } from "vitest";
import { normalizeExtraction, type RawExtraction } from "@/lib/extraction/schema";
import { reviewDocument } from "@/lib/review";

const base: RawExtraction = {
  documentType: "invoice",
  vendorName: "  ACME Supply, Inc. ",
  documentNumber: "INV-1001",
  documentDate: "2026-03-04",
  dueDate: "2026-04-03",
  paymentTerms: "Net 30",
  currency: "usd",
  subtotal: "100.00",
  tax: "8.00",
  total: "108.00",
  lineItems: [
    { description: "Widget", quantity: "2", unitPrice: "25.00", lineTotal: "50.00" },
    { description: "Gadget", quantity: "1", unitPrice: "50.00", lineTotal: "50.00" },
  ],
  referencedInvoiceNumber: null,
  statedReason: null,
  suggestedReason: null,
};

describe("normalizeExtraction", () => {
  it("converts strings to typed fields and cents", () => {
    const n = normalizeExtraction(base);
    expect(n).toMatchObject({
      type: "invoice",
      vendorName: "ACME Supply, Inc.",
      currency: "USD",
      subtotalCents: 10_000,
      taxCents: 800,
      totalCents: 10_800,
    });
    expect(n.lineItems[0]).toEqual({ description: "Widget", quantity: 2, unitPriceCents: 2_500, lineTotalCents: 5_000 });
  });

  it("stores credit memo amounts as positive and keeps credit fields", () => {
    const n = normalizeExtraction({
      ...base,
      documentType: "Credit Note",
      total: "(45.10)",
      subtotal: "-45.10",
      tax: null,
      lineItems: [{ description: "Price correction", quantity: null, unitPrice: null, lineTotal: "-45.10" }],
      referencedInvoiceNumber: "INV-1001",
      statedReason: "Pricing error",
      suggestedReason: "Pricing Error",
    });
    expect(n.type).toBe("credit_memo");
    expect(n.totalCents).toBe(4_510);
    expect(n.lineItems[0].lineTotalCents).toBe(4_510);
    expect(n.referencedInvoiceNumber).toBe("INV-1001");
    expect(n.suggestedReason).toBe("pricing_error");
  });

  it("drops invalid dates and currencies instead of guessing", () => {
    const n = normalizeExtraction({ ...base, documentDate: "03/04/2026", currency: "dollars" });
    expect(n.documentDate).toBeNull();
    expect(n.currency).toBeNull();
  });

  it("maps unknown types to other and ignores credit fields on invoices", () => {
    const n = normalizeExtraction({ ...base, documentType: "statement", referencedInvoiceNumber: "X" });
    expect(n.type).toBe("other");
    expect(n.referencedInvoiceNumber).toBeNull();
  });
});

describe("reviewDocument", () => {
  const fields = () => {
    const n = normalizeExtraction(base);
    return { ...n, type: n.type as "invoice" | "credit_memo" | "other" };
  };

  it("passes a complete document that adds up", () => {
    expect(reviewDocument(fields())).toEqual({ missing: [], warnings: [] });
  });

  it("flags missing key fields", () => {
    const r = reviewDocument({ ...fields(), vendorName: null, totalCents: null, documentDate: null });
    expect(r.missing).toEqual(["Missing vendor name", "Missing document date", "Missing total"]);
  });

  it("flags line items that don't add up to the total within one cent", () => {
    expect(reviewDocument({ ...fields(), totalCents: 10_801 }).warnings).toEqual([]);
    const r = reviewDocument({ ...fields(), totalCents: 10_802 });
    expect(r.warnings[0]).toBe("Line items plus tax add up to $108.00, but the total is $108.02.");
  });

  it("flags line items that don't match the subtotal", () => {
    const r = reviewDocument({ ...fields(), subtotalCents: 9_000, totalCents: 10_800 });
    expect(r.warnings).toContain("Line items add up to $100.00, but the subtotal is $90.00.");
  });

  it("warns on documents that are neither invoices nor credits", () => {
    const r = reviewDocument({ ...fields(), type: "other" });
    expect(r.missing).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
});
