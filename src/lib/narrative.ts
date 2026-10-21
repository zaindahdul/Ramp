import type { VendorMetrics } from "@/lib/metrics";
import { formatRate, OPEN_CREDIT_AGING_DAYS } from "@/lib/metrics";
import { formatCents } from "@/lib/money";
import {
  BILLING_ERROR_REASONS,
  CREDIT_REASONS,
  REASON_ADJECTIVES,
  type CreditReasonKey,
} from "@/lib/reasons";

// Plain-English sentences for the negotiation summary, built only from the
// scorecard numbers so the page never says anything the metrics don't back up.

const NON_BILLING_NOUNS: Record<CreditReasonKey, string> = {
  pricing_error: "pricing errors",
  quantity_error: "quantity errors",
  duplicate_billing: "duplicate billing",
  damaged_or_defective: "damaged or defective goods",
  return: "returns",
  rebate_or_promo: "rebates and promos",
  service_failure: "service failures",
  other: "other reasons",
};

/** "an 18%" / "a 25%": the article follows how the number is spoken. */
export function articleFor(percentText: string): "a" | "an" {
  const whole = percentText.replace(/[^0-9.]/g, "").split(".")[0];
  if (whole.startsWith("8") || whole === "11" || whole === "18") return "an";
  return "a";
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export interface LeadInput {
  vendorName: string;
  reason: CreditReasonKey;
  currency: string;
  cents: number;
  /** Invoices in the period with a linked credit of this reason. */
  affectedInvoices: number;
  totalInvoices: number;
  openCents: number;
  phrase: string;
}

/**
 * "Acme Supply issued $120,400 in pricing-error credits across 31 invoices in
 * the last 12 months, an 18% error rate. $14,200 of those credits are still unused."
 */
export function leadSentences(input: LeadInput): string[] {
  const money = (c: number) => formatCents(c, input.currency, { wholeUnits: true });
  const what = `${input.vendorName} issued ${money(input.cents)} in ${REASON_ADJECTIVES[input.reason]} credits`;
  let first: string;
  if (input.affectedInvoices === 0) {
    first = `${what} ${input.phrase}, none of them matched to an invoice yet.`;
  } else if (input.totalInvoices === 0) {
    first = `${what} across ${plural(input.affectedInvoices, "invoice")} ${input.phrase}.`;
  } else {
    const rate = formatRate(input.affectedInvoices / input.totalInvoices);
    first = `${what} across ${plural(input.affectedInvoices, "invoice")} ${input.phrase}, ${articleFor(rate)} ${rate} error rate.`;
  }
  const sentences = [first];
  if (input.openCents > 0) {
    sentences.push(`${money(input.openCents)} of those credits are still unused.`);
  }
  return sentences;
}

export function negotiationSentences(args: {
  vendorName: string;
  metrics: VendorMetrics;
  phrase: string;
}): string[] {
  const { vendorName, metrics: m, phrase } = args;
  const money = (c: number) => formatCents(c, m.currency, { wholeUnits: true });

  if (m.invoiceCount === 0 && m.creditCount === 0) {
    const sentences = [`${vendorName} has no confirmed invoices or credits in ${m.currency} ${phrase}.`];
    if (m.openCreditCents > 0) {
      sentences.push(`${vendorName} still owes ${money(m.openCreditCents)} in open credits from earlier periods.`);
    }
    return sentences;
  }

  const sentences: string[] = [];
  const billing = BILLING_ERROR_REASONS.filter((r) => m.byReason[r].cents > 0).sort(
    (a, b) => m.byReason[b].cents - m.byReason[a].cents,
  );

  if (billing.length > 0) {
    const [top, ...rest] = billing;
    sentences.push(
      ...leadSentences({
        vendorName,
        reason: top,
        currency: m.currency,
        cents: m.byReason[top].cents,
        affectedInvoices: m.byReason[top].invoiceCount,
        totalInvoices: m.invoiceCount,
        openCents: m.byReason[top].openCents,
        phrase,
      }),
    );
    if (rest.length > 0) {
      sentences.push(
        `It also issued ${listPhrase(
          rest.map((r) => `${money(m.byReason[r].cents)} in ${REASON_ADJECTIVES[r]} credits`),
        )}.`,
      );
      if (m.invoiceCount > 0) {
        sentences.push(
          `Overall, ${m.invoicesWithBillingError} of ${plural(m.invoiceCount, "invoice")} (${formatRate(
            m.billingErrorRate,
          )}) needed at least one billing-error credit.`,
        );
      }
    }
  } else if (m.invoiceCount > 0) {
    sentences.push(
      `${vendorName} billed ${plural(m.invoiceCount, "invoice")} ${phrase} without a single billing-error credit.`,
    );
  }

  const nonBilling = CREDIT_REASONS.filter(
    (r) => !BILLING_ERROR_REASONS.includes(r) && m.byReason[r].cents > 0,
  ).sort((a, b) => m.byReason[b].cents - m.byReason[a].cents);
  if (nonBilling.length > 0) {
    const cents = nonBilling.reduce((sum, r) => sum + m.byReason[r].cents, 0);
    sentences.push(
      `${billing.length > 0 ? "Another" : "It issued"} ${money(cents)} in credits for ${listPhrase(
        nonBilling.map((r) => NON_BILLING_NOUNS[r]),
      )}, which are not billing errors.`,
    );
  }

  if (m.medianDaysToResolve !== null) {
    const days = Number.isInteger(m.medianDaysToResolve)
      ? m.medianDaysToResolve
      : m.medianDaysToResolve.toFixed(1);
    sentences.push(`Credits arrived a median of ${days} days after the invoice they corrected.`);
  }

  if (m.openCreditCents > 0) {
    const aged =
      m.openOver60Cents > 0
        ? `, ${money(m.openOver60Cents)} of it open for more than ${OPEN_CREDIT_AGING_DAYS} days`
        : "";
    sentences.push(`${vendorName} still owes ${money(m.openCreditCents)} in open credits${aged}.`);
  }
  return sentences;
}
