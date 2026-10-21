import { z } from "zod";
import { isPlainDate, type PlainDate } from "@/lib/dates";
import type { NormalizedLineItem } from "@/lib/extraction/schema";
import { centsToDecimalString, isCurrencyCode, parseMoneyToCents } from "@/lib/money";
import { CREDIT_REASONS, type CreditReasonKey } from "@/lib/reasons";

// The review form posts strings exactly as typed. parseConfirmInput() validates
// them and turns amounts into integer cents (or reports per-field errors).

export const CREDIT_STATUSES = ["open", "applied", "written_off"] as const;
export type CreditStatusKey = (typeof CREDIT_STATUSES)[number];

export const CREDIT_STATUS_LABELS: Record<CreditStatusKey, string> = {
  open: "Open (still owed)",
  applied: "Applied or refunded",
  written_off: "Written off",
};

export const ConfirmInputSchema = z.object({
  type: z.enum(["invoice", "credit_memo", "other"]),
  vendorName: z.string(),
  documentNumber: z.string(),
  documentDate: z.string(),
  dueDate: z.string(),
  paymentTerms: z.string(),
  currency: z.string(),
  subtotal: z.string(),
  tax: z.string(),
  total: z.string(),
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.string(),
        unitPrice: z.string(),
        lineTotal: z.string(),
      }),
    )
    .max(500),
  referencedInvoiceNumber: z.string(),
  statedReason: z.string(),
  creditReason: z.enum(CREDIT_REASONS).nullable(),
  creditStatus: z.enum(CREDIT_STATUSES).nullable(),
  /** "auto", "none" or an invoice id. */
  link: z.string(),
});

export type ConfirmInput = z.infer<typeof ConfirmInputSchema>;

export interface ConfirmFields {
  type: "invoice" | "credit_memo" | "other";
  vendorName: string | null;
  documentNumber: string | null;
  documentDate: PlainDate | null;
  dueDate: PlainDate | null;
  paymentTerms: string | null;
  currency: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  lineItems: NormalizedLineItem[];
  referencedInvoiceNumber: string | null;
  statedReason: string | null;
  creditReason: CreditReasonKey | null;
  creditStatus: CreditStatusKey | null;
  link: string;
}

export type ParseResult =
  | { ok: true; fields: ConfirmFields }
  | { ok: false; errors: Record<string, string> };

const MAX_INT4 = 2_147_483_647;

const text = (v: string) => {
  const t = v.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

export function parseConfirmInput(input: ConfirmInput): ParseResult {
  const errors: Record<string, string> = {};
  const isFinancial = input.type !== "other";
  const currency = text(input.currency)?.toUpperCase() ?? null;
  if (currency && !isCurrencyCode(currency)) errors.currency = "Use a 3-letter ISO code such as USD.";
  const moneyCurrency = currency && isCurrencyCode(currency) ? currency : "USD";

  const money = (field: string, value: string, required: boolean): number | null => {
    if (!text(value)) {
      if (required) errors[field] = "Required.";
      return null;
    }
    const cents = parseMoneyToCents(value, moneyCurrency);
    if (cents === null) {
      errors[field] = "Not an amount.";
      return null;
    }
    if (cents < 0) {
      errors[field] = "Enter a positive amount.";
      return null;
    }
    if (cents > MAX_INT4) {
      errors[field] = "Amount too large.";
      return null;
    }
    return cents;
  };

  const date = (field: string, value: string, required: boolean): PlainDate | null => {
    const v = text(value);
    if (!v) {
      if (required) errors[field] = "Required.";
      return null;
    }
    if (!isPlainDate(v)) {
      errors[field] = "Use YYYY-MM-DD.";
      return null;
    }
    return v;
  };

  const vendorName = text(input.vendorName);
  const documentNumber = text(input.documentNumber);
  if (isFinancial && !vendorName) errors.vendorName = "Required.";
  if (isFinancial && !documentNumber) errors.documentNumber = "Required.";
  if (isFinancial && !currency) errors.currency = "Required.";

  const lineItems: NormalizedLineItem[] = [];
  input.lineItems.forEach((line, i) => {
    const description = text(line.description);
    const blank = !description && !text(line.lineTotal) && !text(line.quantity) && !text(line.unitPrice);
    if (blank) return;
    if (!description) errors[`lineItems.${i}.description`] = "Required.";
    const lineTotalCents = money(`lineItems.${i}.lineTotal`, line.lineTotal, true);
    const unitPriceCents = money(`lineItems.${i}.unitPrice`, line.unitPrice, false);
    const q = text(line.quantity)?.replace(/,/g, "") ?? null;
    let quantity: number | null = null;
    if (q !== null) {
      if (/^\d*\.?\d+$/.test(q)) quantity = Number(q);
      else errors[`lineItems.${i}.quantity`] = "Not a number.";
    }
    if (description && lineTotalCents !== null) {
      lineItems.push({ description, quantity, unitPriceCents, lineTotalCents });
    }
  });

  const fields: ConfirmFields = {
    type: input.type,
    vendorName,
    documentNumber,
    documentDate: date("documentDate", input.documentDate, isFinancial),
    dueDate: date("dueDate", input.dueDate, false),
    paymentTerms: text(input.paymentTerms),
    currency: currency && isCurrencyCode(currency) ? currency : null,
    subtotalCents: money("subtotal", input.subtotal, false),
    taxCents: money("tax", input.tax, false),
    totalCents: money("total", input.total, isFinancial),
    lineItems,
    referencedInvoiceNumber: input.type === "credit_memo" ? text(input.referencedInvoiceNumber) : null,
    statedReason: input.type === "credit_memo" ? text(input.statedReason) : null,
    creditReason: input.type === "credit_memo" ? (input.creditReason ?? "other") : null,
    creditStatus: input.type === "credit_memo" ? (input.creditStatus ?? "open") : null,
    link: input.link,
  };

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, fields };
}

/** The shape the review form starts from: a document as stored. */
export interface DocumentFormSource {
  type: "invoice" | "credit_memo" | "other" | null;
  vendorNameRaw: string | null;
  documentNumber: string | null;
  documentDate: PlainDate | null;
  dueDate: PlainDate | null;
  paymentTerms: string | null;
  currency: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  lineItems: Array<{
    description: string;
    quantity: number | null;
    unitPriceCents: number | null;
    lineTotalCents: number;
  }>;
  referencedInvoiceNumber: string | null;
  statedReason: string | null;
  creditReason: CreditReasonKey | null;
  creditStatus: CreditStatusKey | null;
  linkMethod: "reference" | "heuristic" | "manual" | null;
  linkedInvoiceId: string | null;
}

export function toConfirmInput(doc: DocumentFormSource): ConfirmInput {
  const currency = doc.currency && isCurrencyCode(doc.currency) ? doc.currency : "USD";
  const amount = (cents: number | null) => (cents === null ? "" : centsToDecimalString(cents, currency));
  return {
    type: doc.type ?? "invoice",
    vendorName: doc.vendorNameRaw ?? "",
    documentNumber: doc.documentNumber ?? "",
    documentDate: doc.documentDate ?? "",
    dueDate: doc.dueDate ?? "",
    paymentTerms: doc.paymentTerms ?? "",
    currency: doc.currency ?? "",
    subtotal: amount(doc.subtotalCents),
    tax: amount(doc.taxCents),
    total: amount(doc.totalCents),
    lineItems: doc.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity === null ? "" : String(l.quantity),
      unitPrice: amount(l.unitPriceCents),
      lineTotal: amount(l.lineTotalCents),
    })),
    referencedInvoiceNumber: doc.referencedInvoiceNumber ?? "",
    statedReason: doc.statedReason ?? "",
    creditReason: doc.creditReason,
    creditStatus: doc.creditStatus,
    link: doc.linkMethod === "manual" ? (doc.linkedInvoiceId ?? "none") : "auto",
  };
}
