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

/**
 * What the linker looked at. Stored next to every decision so a person can see
 * why a credit was linked, or why the linker declined to guess.
 */
export interface LinkEvidence {
  /** Invoice number printed on the credit memo, as printed. */
  reference: string | null;
  /** Same-vendor invoices on file carrying that number. */
  referenceMatches: number;
  /** Same vendor and currency, within the window, for at least the credit's amount. */
  eligible: number;
  /** Credit lines matched by the best candidate, and by the next best. */
  bestOverlap: number | null;
  runnerUpOverlap: number | null;
  /** Candidates sharing the best score. More than one means the linker abstains. */
  tied: number;
  creditLines: number;
}

export interface LinkDecision {
  result: LinkResult;
  evidence: LinkEvidence;
}

export function linkCreditToInvoice(
  credit: LinkableCredit,
  invoices: readonly LinkableInvoice[],
): LinkResult {
  return decideCreditLink(credit, invoices).result;
}

/** The linking rules, returning the decision together with the evidence behind it. */
export function decideCreditLink(
  credit: LinkableCredit,
  invoices: readonly LinkableInvoice[],
): LinkDecision {
  const sameVendor = invoices.filter((inv) => inv.vendorId === credit.vendorId);
  const evidence: LinkEvidence = {
    reference: credit.referencedInvoiceNumber?.trim() || null,
    referenceMatches: 0,
    eligible: 0,
    bestOverlap: null,
    runnerUpOverlap: null,
    tied: 0,
    creditLines: credit.lineDescriptions.length,
  };

  const reference = normalizeDocumentNumber(credit.referencedInvoiceNumber);
  if (reference) {
    const byNumber = sameVendor.filter(
      (inv) => normalizeDocumentNumber(inv.documentNumber) === reference,
    );
    evidence.referenceMatches = byNumber.length;
    if (byNumber.length === 1) {
      return { result: { kind: "linked", invoiceId: byNumber[0].id, method: "reference" }, evidence };
    }
    if (byNumber.length > 1) {
      evidence.tied = byNumber.length;
      return {
        result: { kind: "ambiguous", candidateIds: sortCandidates(byNumber).map((i) => i.id) },
        evidence,
      };
    }
    // Referenced invoice isn't on file (yet). Fall back to the heuristic.
  }

  const eligible = sameVendor.filter((inv) => {
    if (inv.currency !== credit.currency) return false;
    if (inv.totalCents < credit.totalCents) return false;
    const age = daysBetween(inv.documentDate, credit.documentDate);
    return age >= 0 && age <= LINK_WINDOW_DAYS;
  });
  evidence.eligible = eligible.length;
  if (eligible.length === 0) return { result: { kind: "none" }, evidence };

  const scored = eligible.map((inv) => ({
    inv,
    score: lineOverlapScore(credit.lineDescriptions, inv.lineDescriptions),
  }));
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best).map((s) => s.inv);
  const rest = scored.filter((s) => s.score < best).map((s) => s.score);
  evidence.bestOverlap = best;
  evidence.runnerUpOverlap = rest.length > 0 ? Math.max(...rest) : null;
  evidence.tied = top.length;
  if (top.length === 1) {
    return { result: { kind: "linked", invoiceId: top[0].id, method: "heuristic" }, evidence };
  }
  return { result: { kind: "ambiguous", candidateIds: sortCandidates(top).map((i) => i.id) }, evidence };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One plain sentence for the decision. `invoiceNumber` is the linked invoice's
 * number when there is one.
 */
export function explainLink(decision: LinkDecision, invoiceNumber: string | null = null): string {
  const { result, evidence: e } = decision;
  const named = invoiceNumber ?? "that invoice";
  const lines = `${e.bestOverlap ?? 0} of ${plural(e.creditLines, "credit line")}`;

  if (result.kind === "linked" && result.method === "reference") {
    return `The memo names invoice ${e.reference ?? named}, and exactly one invoice from this vendor carries that number.`;
  }
  const missingReference =
    e.reference && e.referenceMatches === 0
      ? `The memo names invoice ${e.reference}, which isn't among this vendor's confirmed invoices. `
      : "";
  const noReference = !e.reference ? "The memo names no invoice. " : "";
  const lead = missingReference || noReference;

  if (result.kind === "linked") {
    const runnerUp =
      e.runnerUpOverlap === null ? "it is the only one that fits" : `the next best matches ${e.runnerUpOverlap}`;
    return `${lead}Of ${plural(e.eligible, "invoice")} from this vendor in the ${LINK_WINDOW_DAYS} days before the credit, for at least its amount, ${named} matches ${lines}; ${runnerUp}.`;
  }
  if (result.kind === "ambiguous") {
    if (e.referenceMatches > 1) {
      return `The memo names invoice ${e.reference}, but ${e.referenceMatches} invoices from this vendor carry that number. Left for a person to pick.`;
    }
    return `${lead}${plural(e.tied, "invoice")} from this vendor fit equally well (same ${LINK_WINDOW_DAYS}-day window, enough amount, ${lines} matched each), so the linker didn't guess. Left for a person to pick.`;
  }
  return `${lead}No invoice from this vendor in the same currency is dated within the ${LINK_WINDOW_DAYS} days before the credit for at least its amount.`;
}

/** Most recent first: the likeliest pick for a person choosing from a dropdown. */
function sortCandidates(invoices: LinkableInvoice[]): LinkableInvoice[] {
  return [...invoices].sort(
    (a, b) => b.documentDate.localeCompare(a.documentDate) || a.id.localeCompare(b.id),
  );
}
