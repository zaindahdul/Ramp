import { formatCents } from "@/lib/money";

// Why a document needs a human. Missing key fields block confirmation; a
// totals mismatch is a warning the reviewer can accept.

export const TOTALS_TOLERANCE_CENTS = 1;

export interface ReviewFields {
  type: "invoice" | "credit_memo" | "other" | null;
  vendorName: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  currency: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  lineItems: { lineTotalCents: number }[];
}

export interface ReviewResult {
  /** Must be fixed before the document can be confirmed. */
  missing: string[];
  /** Shown to the reviewer; confirmation is still allowed. */
  warnings: string[];
}

const KEY_FIELDS: Array<[keyof ReviewFields, string]> = [
  ["vendorName", "vendor name"],
  ["documentNumber", "document number"],
  ["documentDate", "document date"],
  ["currency", "currency"],
  ["totalCents", "total"],
];

export function reviewDocument(fields: ReviewFields): ReviewResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (fields.type === null) {
    missing.push("Document type");
  } else if (fields.type === "other") {
    warnings.push("Classified as neither an invoice nor a credit memo. It won't count in any metric.");
    return { missing, warnings };
  }

  for (const [key, label] of KEY_FIELDS) {
    const value = fields[key];
    if (value === null || value === "") missing.push(`Missing ${label}`);
  }

  if (fields.totalCents !== null && fields.lineItems.length > 0) {
    const currency = fields.currency ?? "USD";
    const lineSum = fields.lineItems.reduce((sum, l) => sum + l.lineTotalCents, 0);
    const tax = fields.taxCents ?? 0;
    if (Math.abs(lineSum + tax - fields.totalCents) > TOTALS_TOLERANCE_CENTS) {
      warnings.push(
        `Line items${tax ? " plus tax" : ""} add up to ${formatCents(lineSum + tax, currency)}, but the total is ${formatCents(fields.totalCents, currency)}.`,
      );
    }
    if (
      fields.subtotalCents !== null &&
      Math.abs(lineSum - fields.subtotalCents) > TOTALS_TOLERANCE_CENTS
    ) {
      warnings.push(
        `Line items add up to ${formatCents(lineSum, currency)}, but the subtotal is ${formatCents(fields.subtotalCents, currency)}.`,
      );
    }
  }

  return { missing, warnings };
}

export function issueList(result: ReviewResult): string[] {
  return [...result.missing, ...result.warnings];
}
