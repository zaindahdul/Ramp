export const CREDIT_REASONS = [
  "pricing_error",
  "quantity_error",
  "damaged_or_defective",
  "duplicate_billing",
  "return",
  "rebate_or_promo",
  "service_failure",
  "other",
] as const;

export type CreditReasonKey = (typeof CREDIT_REASONS)[number];

/** Reasons that count as the vendor's billing mistake on the scorecard. */
export const BILLING_ERROR_REASONS: readonly CreditReasonKey[] = [
  "pricing_error",
  "quantity_error",
  "duplicate_billing",
];

export function isBillingError(reason: CreditReasonKey | null | undefined): boolean {
  return reason !== null && reason !== undefined && BILLING_ERROR_REASONS.includes(reason);
}

export function isCreditReason(value: unknown): value is CreditReasonKey {
  return typeof value === "string" && (CREDIT_REASONS as readonly string[]).includes(value);
}

export const REASON_LABELS: Record<CreditReasonKey, string> = {
  pricing_error: "Pricing error",
  quantity_error: "Quantity error",
  damaged_or_defective: "Damaged or defective",
  duplicate_billing: "Duplicate billing",
  return: "Return",
  rebate_or_promo: "Rebate or promo",
  service_failure: "Service failure",
  other: "Other",
};

/** Used in sentences: "pricing-error credits". */
export const REASON_ADJECTIVES: Record<CreditReasonKey, string> = {
  pricing_error: "pricing-error",
  quantity_error: "quantity-error",
  damaged_or_defective: "damaged-goods",
  duplicate_billing: "duplicate-billing",
  return: "return",
  rebate_or_promo: "rebate and promo",
  service_failure: "service-failure",
  other: "other",
};

// Ordered: the first matching rule wins, so specific phrases come first
// ("discount not applied" is a pricing error, not a promo).
const RULES: Array<[CreditReasonKey, RegExp]> = [
  ["duplicate_billing", /duplicate|double[\s-]?(bill|charg|invoic)|(billed|charged|invoiced) twice/i],
  [
    "pricing_error",
    /pric(e|ing)|overcharg|over-charg|(wrong|incorrect|contract(ed)?)\s+(rate|cost)|rate (error|correction|adjustment)|discount not applied|unit cost|mark-?up/i,
  ],
  [
    "quantity_error",
    /quantit|\bqty\b|short[\s-]?(ship|deliver)|over[\s-]?ship|(shipped|delivered|received) (fewer|less)|miscount|wrong count|units? (billed|invoiced)|not (received|delivered)|missing (items?|cases?|units?)/i,
  ],
  ["damaged_or_defective", /damage|defect|broken|faulty|spoil|expired|leak|crush|not working|doa\b|dead on arrival|recall/i],
  [
    "service_failure",
    /service (failure|credit|level)|\bsla\b|outage|downtime|late (delivery|arrival)|missed (delivery|pickup|appointment|service)|not performed|uptime/i,
  ],
  ["rebate_or_promo", /rebate|promo|promotion|volume (discount|incentive)|loyalty|incentive|co-?op|marketing (fund|allowance)|\bmdf\b/i],
  ["return", /return|\brma\b|restock|sent back/i],
];

/** The first rule that matches, with the words that triggered it. */
export function matchReasonText(
  text: string | null | undefined,
): { reason: CreditReasonKey; phrase: string } | null {
  if (!text) return null;
  for (const [reason, pattern] of RULES) {
    const match = pattern.exec(text);
    if (match) return { reason, phrase: match[0].trim() };
  }
  return null;
}

export function classifyReasonText(text: string | null | undefined): CreditReasonKey | null {
  return matchReasonText(text)?.reason ?? null;
}

export interface ReasonInput {
  statedReason: string | null;
  /** The extractor's own classification, if it gave one. */
  suggestedReason: CreditReasonKey | null;
  lineDescriptions: string[];
}

/** What a reason was based on, strongest evidence first. */
export type ReasonBasis =
  | { kind: "stated_rule"; phrase: string }
  | { kind: "stated_model" }
  | { kind: "stated_unmatched" }
  | { kind: "model" }
  | { kind: "line_rule"; phrase: string }
  | { kind: "none" };

export interface ReasonDecision {
  reason: CreditReasonKey;
  source: "stated" | "inferred";
  basis: ReasonBasis;
}

/**
 * Exactly one reason per credit, with what it rests on. A stated reason wins;
 * otherwise infer from the extractor's suggestion, then from the line item text.
 */
export function decideCreditReason(input: ReasonInput): ReasonDecision {
  if (input.statedReason && input.statedReason.trim() !== "") {
    const fromText = matchReasonText(input.statedReason);
    if (fromText) {
      return { reason: fromText.reason, source: "stated", basis: { kind: "stated_rule", phrase: fromText.phrase } };
    }
    if (input.suggestedReason) {
      return { reason: input.suggestedReason, source: "stated", basis: { kind: "stated_model" } };
    }
    return { reason: "other", source: "stated", basis: { kind: "stated_unmatched" } };
  }
  if (input.suggestedReason) {
    return { reason: input.suggestedReason, source: "inferred", basis: { kind: "model" } };
  }
  const fromLines = matchReasonText(input.lineDescriptions.join(" \n "));
  if (fromLines) {
    return { reason: fromLines.reason, source: "inferred", basis: { kind: "line_rule", phrase: fromLines.phrase } };
  }
  return { reason: "other", source: "inferred", basis: { kind: "none" } };
}

export function determineCreditReason(input: ReasonInput): {
  reason: CreditReasonKey;
  source: "stated" | "inferred";
} {
  const { reason, source } = decideCreditReason(input);
  return { reason, source };
}

/** One plain sentence saying why a credit got its reason. */
export function explainReason(decision: ReasonDecision, statedReason: string | null): string {
  const label = REASON_LABELS[decision.reason];
  const stated = statedReason?.trim() ? `“${statedReason.trim()}”` : "a reason";
  switch (decision.basis.kind) {
    case "stated_rule":
      return `The memo states ${stated}. The wording “${decision.basis.phrase}” maps to ${label}.`;
    case "stated_model":
      return `The memo states ${stated}. No keyword rule covers that wording, so the extractor's reading of it (${label}) was used.`;
    case "stated_unmatched":
      return `The memo states ${stated}, which matches no category. Filed under Other until a person picks one.`;
    case "model":
      return `The memo states no reason. ${label} is the extractor's reading of the document.`;
    case "line_rule":
      return `The memo states no reason. The line item wording “${decision.basis.phrase}” maps to ${label}.`;
    default:
      return "The memo states no reason and nothing in the line items suggests one. Filed under Other until a person picks one.";
  }
}
