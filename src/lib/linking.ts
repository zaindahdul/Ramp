import { daysBetween, type PlainDate } from "@/lib/dates";
import { normalizeDocumentNumber } from "@/lib/dedupe";

// Credit-to-invoice linking rules:
// 1. If the credit names an invoice number, link to that invoice (same vendor).
// 2. Otherwise consider invoices from the same vendor and currency, dated within
//    180 days before the credit, for at least the credit's amount. Prefer the one
//    with the most overlapping line items.
// 3. If more than one invoice fits equally well, leave the credit unlinked and
//    return the tied invoices so a person can pick.

export const LINK_WINDOW_DAYS = 180;

export interface LinkableInvoice {
  id: string;
  vendorId: string;
  documentNumber: string | null;
  documentDate: PlainDate;
  currency: string;
  totalCents: number;
  lineDescriptions: string[];
}

export interface LinkableCredit {
  vendorId: string;
  documentDate: PlainDate;
  currency: string;
  totalCents: number;
  referencedInvoiceNumber: string | null;
  lineDescriptions: string[];
}

export type LinkResult =
  | { kind: "linked"; invoiceId: string; method: "reference" | "heuristic" }
  | { kind: "ambiguous"; candidateIds: string[] }
  | { kind: "none" };

const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "for", "to", "on", "in", "per", "x", "ea", "each",
  "credit", "adjustment", "correction", "refund", "price", "pricing", "qty", "quantity",
  "return", "returned", "damaged", "billed", "overcharge", "re", "inv", "invoice",
]);

export function descriptionTokens(description: string): Set<string> {
  return new Set(
    description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+$/.test(t)),
  );
}

function linesMatch(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  // Overlap coefficient: share at least half of the shorter description.
  return shared / Math.min(a.size, b.size) >= 0.5;
}

/** Number of credit lines that match at least one invoice line. */
export function lineOverlapScore(creditLines: string[], invoiceLines: string[]): number {
  const invoiceTokens = invoiceLines.map(descriptionTokens);
  let score = 0;
  for (const line of creditLines) {
    const tokens = descriptionTokens(line);
    if (invoiceTokens.some((inv) => linesMatch(tokens, inv))) score++;
  }
  return score;
}

export function linkCreditToInvoice(
  credit: LinkableCredit,
  invoices: readonly LinkableInvoice[],
): LinkResult {
  const sameVendor = invoices.filter((inv) => inv.vendorId === credit.vendorId);

  const reference = normalizeDocumentNumber(credit.referencedInvoiceNumber);
  if (reference) {
    const byNumber = sameVendor.filter(
      (inv) => normalizeDocumentNumber(inv.documentNumber) === reference,
    );
    if (byNumber.length === 1) {
      return { kind: "linked", invoiceId: byNumber[0].id, method: "reference" };
    }
    if (byNumber.length > 1) {
      return { kind: "ambiguous", candidateIds: sortCandidates(byNumber).map((i) => i.id) };
    }
    // Referenced invoice isn't on file (yet). Fall back to the heuristic.
  }

  const eligible = sameVendor.filter((inv) => {
    if (inv.currency !== credit.currency) return false;
    if (inv.totalCents < credit.totalCents) return false;
    const age = daysBetween(inv.documentDate, credit.documentDate);
    return age >= 0 && age <= LINK_WINDOW_DAYS;
  });
  if (eligible.length === 0) return { kind: "none" };

  const scored = eligible.map((inv) => ({
    inv,
    score: lineOverlapScore(credit.lineDescriptions, inv.lineDescriptions),
  }));
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best).map((s) => s.inv);
  if (top.length === 1) {
    return { kind: "linked", invoiceId: top[0].id, method: "heuristic" };
  }
  return { kind: "ambiguous", candidateIds: sortCandidates(top).map((i) => i.id) };
}

/** Most recent first: the likeliest pick for a person choosing from a dropdown. */
function sortCandidates(invoices: LinkableInvoice[]): LinkableInvoice[] {
  return [...invoices].sort(
    (a, b) => b.documentDate.localeCompare(a.documentDate) || a.id.localeCompare(b.id),
  );
}
