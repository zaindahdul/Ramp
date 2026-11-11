import { describe, expect, it } from "vitest";
import { confirmFieldsToInput, diffConfirmInputs, parseConfirmInput, toConfirmInput, type DocumentFormSource } from "@/lib/confirm";

const stored: DocumentFormSource = {
  type: "credit_memo",
  vendorNameRaw: "Coastal Seafood Traders",
  documentNumber: "CM-1",
  documentDate: "2026-10-01",
  dueDate: null,
  paymentTerms: null,
  currency: "USD",
  subtotalCents: 218_440,
  taxCents: null,
  totalCents: 218_440,
  lineItems: [{ description: "Shrimp 16/20, 5 lb", quantity: 2, unitPriceCents: 109_220, lineTotalCents: 218_440 }],
  referencedInvoiceNumber: "CST-90044",
  statedReason: "Short shipped",
  creditReason: "quantity_error",
  creditStatus: "open",
  linkMethod: null,
  linkedInvoiceId: null,
};

function confirmed(patch: Partial<ReturnType<typeof toConfirmInput>>) {
  const parsed = parseConfirmInput({ ...toConfirmInput(stored), ...patch });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return confirmFieldsToInput(parsed.fields);
}

describe("diffConfirmInputs", () => {
  it("is empty when the reviewer accepts the extraction as is", () => {
    expect(diffConfirmInputs(toConfirmInput(stored), confirmed({}))).toEqual([]);
  });

  it("ignores how an amount was typed", () => {
    expect(diffConfirmInputs(toConfirmInput(stored), confirmed({ total: "2,184.40" }))).toEqual([]);
  });

  it("lists each corrected field with its old and new value", () => {
    expect(diffConfirmInputs(toConfirmInput(stored), confirmed({ total: "2284.40", creditReason: "pricing_error" }))).toEqual([
      { field: "total", label: "total", from: "2184.40", to: "2284.40" },
      { field: "creditReason", label: "reason", from: "Quantity error", to: "Pricing error" },
    ]);
  });

  it("reports line item edits without dumping them", () => {
    const changes = diffConfirmInputs(toConfirmInput(stored), confirmed({ lineItems: [] }));
    expect(changes).toEqual([{ field: "lineItems", label: "line items", from: "1 line", to: "0 lines" }]);
  });
});
