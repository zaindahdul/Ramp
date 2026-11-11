import { describe, expect, it } from "vitest";
import { classifyReasonText, decideCreditReason, determineCreditReason, explainReason, isBillingError } from "@/lib/reasons";

describe("classifyReasonText", () => {
  it.each([
    ["Price charged above contract rate", "pricing_error"],
    ["Discount not applied", "pricing_error"],
    ["Short shipped 3 cases", "quantity_error"],
    ["Billed for 12 units, received 10 — quantity correction", "quantity_error"],
    ["Invoice billed twice", "duplicate_billing"],
    ["Duplicate invoice", "duplicate_billing"],
    ["Arrived damaged", "damaged_or_defective"],
    ["Customer return RMA 4411", "return"],
    ["Q2 volume rebate", "rebate_or_promo"],
    ["SLA credit for outage on 3/4", "service_failure"],
  ])("%s -> %s", (text, reason) => {
    expect(classifyReasonText(text)).toBe(reason);
  });

  it("returns null when nothing matches", () => {
    expect(classifyReasonText("Goodwill gesture")).toBeNull();
    expect(classifyReasonText(null)).toBeNull();
  });
});

describe("determineCreditReason", () => {
  it("uses the stated reason first", () => {
    expect(
      determineCreditReason({
        statedReason: "Pricing error on line 2",
        suggestedReason: "return",
        lineDescriptions: ["Returned goods"],
      }),
    ).toEqual({ reason: "pricing_error", source: "stated" });
  });

  it("keeps a stated reason it cannot classify as other, unless the extractor classified it", () => {
    expect(
      determineCreditReason({ statedReason: "Goodwill", suggestedReason: null, lineDescriptions: [] }),
    ).toEqual({ reason: "other", source: "stated" });
    expect(
      determineCreditReason({ statedReason: "Goodwill", suggestedReason: "service_failure", lineDescriptions: [] }),
    ).toEqual({ reason: "service_failure", source: "stated" });
  });

  it("infers from the line items when no reason is stated", () => {
    expect(
      determineCreditReason({ statedReason: null, suggestedReason: null, lineDescriptions: ["Damaged pallet"] }),
    ).toEqual({ reason: "damaged_or_defective", source: "inferred" });
    expect(
      determineCreditReason({ statedReason: "  ", suggestedReason: null, lineDescriptions: [] }),
    ).toEqual({ reason: "other", source: "inferred" });
  });

  it("knows which reasons are billing errors", () => {
    expect(isBillingError("pricing_error")).toBe(true);
    expect(isBillingError("quantity_error")).toBe(true);
    expect(isBillingError("duplicate_billing")).toBe(true);
    expect(isBillingError("return")).toBe(false);
    expect(isBillingError(null)).toBe(false);
  });
});

describe("explainReason", () => {
  const explain = (statedReason: string | null, suggestedReason: Parameters<typeof decideCreditReason>[0]["suggestedReason"], lines: string[] = []) =>
    explainReason(decideCreditReason({ statedReason, suggestedReason, lineDescriptions: lines }), statedReason);

  it("quotes the stated reason and the words that decided it", () => {
    expect(explain("Price billed above contract rate", "return")).toBe(
      "The memo states \u201cPrice billed above contract rate\u201d. The wording \u201cPrice\u201d maps to Pricing error.",
    );
  });

  it("says when the extractor's reading was used", () => {
    expect(explain("Goodwill", "service_failure")).toContain("the extractor's reading of it (Service failure)");
    expect(explain(null, "return")).toBe("The memo states no reason. Return is the extractor's reading of the document.");
  });

  it("says when it fell back to the line items or to Other", () => {
    expect(explain(null, null, ["Damaged pallet"])).toContain("line item wording \u201cDamage\u201d maps to Damaged or defective");
    expect(explain(null, null)).toContain("Filed under Other");
    expect(explain("Goodwill", null)).toContain("matches no category");
  });
});
