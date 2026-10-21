import { describe, expect, it } from "vitest";
import { normalizeVendorName, sameVendor } from "@/lib/vendors/normalize";

describe("normalizeVendorName", () => {
  it("treats the spec example as one vendor", () => {
    expect(sameVendor("ACME Supply, Inc.", "Acme Supply")).toBe(true);
    expect(normalizeVendorName("ACME Supply, Inc.")).toBe("acme supply");
  });

  it.each([
    "Acme Supply",
    "ACME SUPPLY",
    "Acme Supply Inc",
    "Acme Supply, Inc.",
    "Acme Supply LLC",
    "Acme Supply, L.L.C.",
    "Acme Supply Co.",
    "Acme Supply Company",
    "Acme Supply Corp.",
    "Acme Supply Corporation",
    "Acme Supply Ltd",
    "Acme Supply Company, LLC",
    "  acme   supply  ",
    "Acme-Supply",
    "The Acme Supply Co.",
  ])("matches %j", (name) => {
    expect(normalizeVendorName(name)).toBe("acme supply");
  });

  it("handles ampersands, apostrophes and accents", () => {
    expect(normalizeVendorName("Johnson & Johnson")).toBe("johnson and johnson");
    expect(normalizeVendorName("O'Brien's Produce")).toBe("obriens produce");
    expect(normalizeVendorName("Société Générale S.A.")).toBe("societe generale");
    expect(sameVendor("Smith & Co.", "Smith and Co")).toBe(true);
  });

  it("only strips suffixes at the end", () => {
    expect(normalizeVendorName("Co-op Foods")).toBe("co op foods");
    expect(normalizeVendorName("Inc Design Studio")).toBe("inc design studio");
  });

  it("never strips a name down to nothing", () => {
    expect(normalizeVendorName("Inc.")).toBe("inc");
    expect(normalizeVendorName("The Company")).toBe("company");
  });

  it("keeps genuinely different vendors apart", () => {
    expect(sameVendor("Acme Supply", "Acme Supplies")).toBe(false);
    expect(sameVendor("Acme Supply", "Acme Supply West")).toBe(false);
    expect(sameVendor("Pacific Linen Service", "Pacific Linen Svc")).toBe(false);
  });
});
