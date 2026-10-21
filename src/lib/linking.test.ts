import { describe, expect, it } from "vitest";
import {
  lineOverlapScore,
  linkCreditToInvoice,
  type LinkableCredit,
  type LinkableInvoice,
} from "@/lib/linking";

function invoice(overrides: Partial<LinkableInvoice> & { id: string }): LinkableInvoice {
  return {
    vendorId: "acme",
    documentNumber: `N-${overrides.id}`,
    documentDate: "2026-06-01",
    currency: "USD",
    totalCents: 100_000,
    lineDescriptions: ["Copy paper, 10 ream case"],
    ...overrides,
  };
}

function credit(overrides: Partial<LinkableCredit> = {}): LinkableCredit {
  return {
    vendorId: "acme",
    documentDate: "2026-07-01",
    currency: "USD",
    totalCents: 5_000,
    referencedInvoiceNumber: null,
    lineDescriptions: [],
    ...overrides,
  };
}

describe("linkCreditToInvoice: referenced invoice number", () => {
  it("links by the referenced number first, ignoring formatting", () => {
    const invoices = [
      invoice({ id: "a", documentNumber: "INV-1001" }),
      invoice({ id: "b", documentNumber: "INV-1002" }),
    ];
    expect(linkCreditToInvoice(credit({ referencedInvoiceNumber: "inv 1002" }), invoices)).toEqual({
      kind: "linked",
      invoiceId: "b",
      method: "reference",
    });
  });

  it("uses the reference even when the heuristic would reject the invoice", () => {
    // Older than 180 days and smaller than the credit: the reference still wins.
    const invoices = [invoice({ id: "old", documentNumber: "INV-1", documentDate: "2025-01-01", totalCents: 100 })];
    expect(linkCreditToInvoice(credit({ referencedInvoiceNumber: "INV-1" }), invoices)).toMatchObject({
      kind: "linked",
      invoiceId: "old",
    });
  });

  it("does not match an invoice number from another vendor", () => {
    const invoices = [invoice({ id: "other", vendorId: "globex", documentNumber: "INV-1" })];
    expect(linkCreditToInvoice(credit({ referencedInvoiceNumber: "INV-1" }), invoices)).toEqual({ kind: "none" });
  });

  it("falls back to the heuristic when the referenced invoice is not on file", () => {
    const invoices = [invoice({ id: "only" })];
    expect(linkCreditToInvoice(credit({ referencedInvoiceNumber: "MISSING-9" }), invoices)).toEqual({
      kind: "linked",
      invoiceId: "only",
      method: "heuristic",
    });
  });
});

describe("linkCreditToInvoice: heuristic", () => {
  it("only considers same vendor, same currency, within 180 days before, at least the credit amount", () => {
    const invoices = [
      invoice({ id: "other-vendor", vendorId: "globex" }),
      invoice({ id: "eur", currency: "EUR" }),
      invoice({ id: "too-small", totalCents: 4_999 }),
      invoice({ id: "too-old", documentDate: "2026-01-01" }), // 181 days before 2026-07-01
      invoice({ id: "after-credit", documentDate: "2026-07-02" }),
      invoice({ id: "fits", documentDate: "2026-01-02", totalCents: 5_000 }), // exactly 180 days, exactly equal
    ];
    expect(linkCreditToInvoice(credit(), invoices)).toEqual({
      kind: "linked",
      invoiceId: "fits",
      method: "heuristic",
    });
  });

  it("returns none when nothing qualifies", () => {
    expect(linkCreditToInvoice(credit(), [])).toEqual({ kind: "none" });
    expect(linkCreditToInvoice(credit(), [invoice({ id: "x", totalCents: 1 })])).toEqual({ kind: "none" });
  });

  it("prefers the invoice with overlapping line items", () => {
    const invoices = [
      invoice({ id: "paper", lineDescriptions: ["Copy paper, 10 ream case", "Toner cartridge HP 26A"] }),
      invoice({ id: "chairs", lineDescriptions: ["Ergonomic office chair"] }),
      invoice({ id: "desks", lineDescriptions: ["Standing desk frame"] }),
    ];
    const result = linkCreditToInvoice(
      credit({ lineDescriptions: ["Price correction: toner cartridge HP 26A"] }),
      invoices,
    );
    expect(result).toEqual({ kind: "linked", invoiceId: "paper", method: "heuristic" });
  });

  it("leaves the credit unlinked when several invoices fit equally well", () => {
    const invoices = [
      invoice({ id: "may", documentDate: "2026-05-01" }),
      invoice({ id: "june", documentDate: "2026-06-01" }),
      invoice({ id: "small", totalCents: 10 }),
    ];
    expect(linkCreditToInvoice(credit(), invoices)).toEqual({
      kind: "ambiguous",
      candidateIds: ["june", "may"],
    });
  });

  it("is ambiguous when the best line overlap is tied", () => {
    const invoices = [
      invoice({ id: "a", lineDescriptions: ["Romaine lettuce case"] }),
      invoice({ id: "b", lineDescriptions: ["Romaine lettuce case", "Tomatoes"] }),
      invoice({ id: "c", lineDescriptions: ["Napkins"] }),
    ];
    const result = linkCreditToInvoice(credit({ lineDescriptions: ["Damaged romaine lettuce"] }), invoices);
    expect(result).toEqual({ kind: "ambiguous", candidateIds: ["a", "b"] });
  });
});

describe("lineOverlapScore", () => {
  it("counts credit lines that share most tokens with an invoice line", () => {
    expect(lineOverlapScore(["Toner HP 26A"], ["HP 26A toner cartridge"])).toBe(1);
    expect(lineOverlapScore(["Toner HP 26A", "Desk"], ["HP 26A toner cartridge"])).toBe(1);
    expect(lineOverlapScore(["Credit"], ["Anything"])).toBe(0);
    expect(lineOverlapScore([], ["Anything"])).toBe(0);
  });
});
