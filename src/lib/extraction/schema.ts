import { z } from "zod";
import { isPlainDate, type PlainDate } from "@/lib/dates";
import { isCurrencyCode, parseMoneyToCents } from "@/lib/money";
import { CREDIT_REASONS, isCreditReason, type CreditReasonKey } from "@/lib/reasons";

// What an extractor (Claude or the mock) returns. Amounts are decimal strings
// so nothing passes through a float; normalizeExtraction() turns them into cents.
//
// The two category fields are plain strings on purpose: the SDK's JSON-schema
// conversion turns enums into a description hint, so the model can still answer
// "Credit Note". normalizeExtraction() maps whatever comes back onto the enum.
export const ExtractionSchema = z.object({
  documentType: z
    .string()
    .describe("One of: invoice, credit_memo (credit note / credit memo / refund notice), other"),
  vendorName: z.string().nullable().describe("The company that issued the document"),
  documentNumber: z.string().nullable().describe("Invoice or credit memo number as printed"),
  documentDate: z.string().nullable().describe("Issue date as YYYY-MM-DD"),
  dueDate: z.string().nullable().describe("Due date as YYYY-MM-DD, if printed"),
  paymentTerms: z.string().nullable().describe("Payment terms text as printed, e.g. 'Net 30'"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. USD"),
  subtotal: z.string().nullable().describe("Decimal string like 1234.56, no symbols"),
  tax: z.string().nullable().describe("Decimal string like 12.34, no symbols"),
  total: z.string().nullable().describe("Decimal string like 1246.90, no symbols"),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.string().nullable().describe("Decimal string"),
      unitPrice: z.string().nullable().describe("Decimal string"),
      lineTotal: z.string().nullable().describe("Decimal string"),
    }),
  ),
  referencedInvoiceNumber: z
    .string()
    .nullable()
    .describe("Credit memos only: the invoice number this credit corrects, if printed"),
  statedReason: z
    .string()
    .nullable()
    .describe("Credit memos only: the reason for the credit as written on the document"),
  suggestedReason: z
    .string()
    .nullable()
    .describe(`Credit memos only: the best-fitting reason, one of: ${CREDIT_REASONS.join(", ")}`),
});

export type RawExtraction = z.infer<typeof ExtractionSchema>;

export interface NormalizedLineItem {
  description: string;
  quantity: number | null;
  unitPriceCents: number | null;
  lineTotalCents: number;
}

export interface NormalizedExtraction {
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
  suggestedReason: CreditReasonKey | null;
}

const MAX_INT4 = 2_147_483_647;

function clean(value: string | null | undefined): string | null {
  const v = value?.replace(/\s+/g, " ").trim();
  return v ? v : null;
}

function cleanDate(value: string | null): PlainDate | null {
  const v = clean(value);
  return v && isPlainDate(v) ? v : null;
}

function parseQuantity(value: string | null): number | null {
  const v = clean(value)?.replace(/,/g, "");
  if (!v || !/^-?\d*\.?\d+$/.test(v)) return null;
  return Number(v);
}

export function coerceDocumentType(value: string): NormalizedExtraction["type"] {
  const v = value.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  if (v === "invoice" || v === "bill" || v === "tax_invoice") return "invoice";
  if (v.startsWith("credit") || v === "refund" || v === "refund_notice") return "credit_memo";
  return "other";
}

function coerceReason(value: string | null): CreditReasonKey | null {
  if (!value) return null;
  const v = value.toLowerCase().trim().replace(/[^a-z]+/g, "_");
  return isCreditReason(v) ? v : null;
}

/**
 * Converts extractor output into typed fields. Credit memo amounts are stored as
 * positive numbers regardless of how the document prints them (-$50 or (50.00)).
 */
export function normalizeExtraction(raw: RawExtraction): NormalizedExtraction {
  const currencyText = clean(raw.currency)?.toUpperCase() ?? null;
  const currency = currencyText && isCurrencyCode(currencyText) ? currencyText : null;
  const moneyCurrency = currency ?? "USD";
  const type = coerceDocumentType(raw.documentType);
  const isCredit = type === "credit_memo";

  const money = (value: string | null): number | null => {
    const cents = parseMoneyToCents(value, moneyCurrency);
    if (cents === null || Math.abs(cents) > MAX_INT4) return null;
    return isCredit ? Math.abs(cents) : cents;
  };

  const lineItems: NormalizedLineItem[] = [];
  for (const line of raw.lineItems) {
    const description = clean(line.description);
    const lineTotalCents = money(line.lineTotal);
    if (!description || lineTotalCents === null) continue;
    const unitPriceCents = money(line.unitPrice);
    lineItems.push({
      description,
      quantity: parseQuantity(line.quantity),
      unitPriceCents,
      lineTotalCents,
    });
  }

  return {
    type,
    vendorName: clean(raw.vendorName),
    documentNumber: clean(raw.documentNumber),
    documentDate: cleanDate(raw.documentDate),
    dueDate: cleanDate(raw.dueDate),
    paymentTerms: clean(raw.paymentTerms),
    currency,
    subtotalCents: money(raw.subtotal),
    taxCents: money(raw.tax),
    totalCents: money(raw.total),
    lineItems,
    referencedInvoiceNumber: isCredit ? clean(raw.referencedInvoiceNumber) : null,
    statedReason: isCredit ? clean(raw.statedReason) : null,
    suggestedReason: isCredit ? coerceReason(raw.suggestedReason) : null,
  };
}
