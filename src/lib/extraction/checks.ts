import { normalizeDocumentNumber } from "@/lib/dedupe";
import { centsToDecimalString, formatCents } from "@/lib/money";

// Checks on the extractor itself, run once when a document is read. The model
// proposes values; plain code decides whether they can be trusted unreviewed.

export const FIELD_LABELS: Record<string, string> = {
  documentType: "document type",
  vendorName: "vendor name",
  documentNumber: "document number",
  documentDate: "document date",
  dueDate: "due date",
  paymentTerms: "payment terms",
  currency: "currency",
  subtotal: "subtotal",
  tax: "tax",
  total: "total",
  lineItems: "line items",
  referencedInvoiceNumber: "referenced invoice number",
  statedReason: "stated reason",
};

export interface ExtractorNotes {
  vendorName: string | null;
  documentNumber: string | null;
  currency: string | null;
  totalCents: number | null;
  referencedInvoiceNumber: string | null;
  evidence: Partial<Record<string, string>>;
  uncertain: Array<{ field: string; why: string }>;
}

const digits = (value: string) => value.replace(/\D/g, "");
const alnum = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Grounding: a value the extractor backs with a quote must actually appear in
 * that quote. Catches a number or id that was made up or copied from elsewhere.
 */
export function groundingIssues(n: ExtractorNotes): string[] {
  const issues: string[] = [];
  const check = (field: string, shown: string | null, grounded: (quote: string) => boolean) => {
    const quote = n.evidence[field];
    if (!quote || shown === null) return;
    if (!grounded(quote)) {
      issues.push(`The ${FIELD_LABELS[field]} was read as ${shown}, but the text it cites (\u201c${quote}\u201d) doesn't show that.`);
    }
  };

  if (n.totalCents !== null) {
    const currency = n.currency ?? "USD";
    const amount = digits(centsToDecimalString(n.totalCents, currency));
    check("total", formatCents(n.totalCents, currency), (quote) => digits(quote).includes(amount));
  }
  for (const field of ["documentNumber", "referencedInvoiceNumber"] as const) {
    const value = normalizeDocumentNumber(n[field]);
    if (value) check(field, n[field], (quote) => (normalizeDocumentNumber(quote) ?? "").includes(value));
  }
  if (n.vendorName) {
    const name = alnum(n.vendorName);
    check("vendorName", n.vendorName, (quote) => alnum(quote).includes(name));
  }
  return issues;
}

/** Everything the extractor itself gives a reviewer to look at. */
export function extractorIssues(n: ExtractorNotes): string[] {
  const unsure = n.uncertain.map(
    (u) => `The extractor wasn't sure about the ${FIELD_LABELS[u.field] ?? u.field}: ${u.why.replace(/\.$/, "")}.`,
  );
  return [...unsure, ...groundingIssues(n)];
}
