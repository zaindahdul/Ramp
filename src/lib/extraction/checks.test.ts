import { describe, expect, it } from "vitest";
import { extractorIssues, groundingIssues, type ExtractorNotes } from "@/lib/extraction/checks";

const notes = (patch: Partial<ExtractorNotes> = {}): ExtractorNotes => ({
  vendorName: "ACME Supply, Inc.",
  documentNumber: "AS-90001",
  currency: "USD",
  totalCents: 947_144,
  referencedInvoiceNumber: null,
  evidence: {
    vendorName: "ACME Supply, Inc.",
    documentNumber: "Invoice # AS-90001",
    total: "Total due $9,471.44",
  },
  uncertain: [],
  ...patch,
});

describe("groundingIssues", () => {
  it("passes when every quoted source contains its value", () => {
    expect(groundingIssues(notes())).toEqual([]);
  });

  it("flags a total that its own quote doesn't show", () => {
    const issues = groundingIssues(notes({ totalCents: 937_144 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("total was read as $9,371.44");
    expect(issues[0]).toContain("Total due $9,471.44");
  });

  it("reads amounts in other number formats", () => {
    expect(
      groundingIssues(notes({ currency: "EUR", totalCents: 283_200, evidence: { total: "Total TTC 2.832,00 €" } })),
    ).toEqual([]);
  });

  it("compares document numbers ignoring case and separators", () => {
    expect(groundingIssues(notes({ evidence: { documentNumber: "invoice no. as 90001" } }))).toEqual([]);
    expect(groundingIssues(notes({ evidence: { documentNumber: "Invoice # AS-90002" } }))).toHaveLength(1);
  });

  it("checks the referenced invoice number on credit memos", () => {
    const issues = groundingIssues(
      notes({ referencedInvoiceNumber: "AS-90001", evidence: { referencedInvoiceNumber: "Applies to invoice AS-80001" } }),
    );
    expect(issues[0]).toContain("referenced invoice number");
  });

  it("says nothing about fields that came with no quote", () => {
    expect(groundingIssues(notes({ evidence: {} }))).toEqual([]);
  });
});

describe("extractorIssues", () => {
  it("turns the extractor's own doubts into review issues", () => {
    expect(extractorIssues(notes({ uncertain: [{ field: "total", why: "The last digit is smudged." }] }))).toEqual([
      "The extractor wasn't sure about the total: The last digit is smudged.",
    ]);
  });
});
