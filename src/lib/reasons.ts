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

export function classifyReasonText(text: string | null | undefined): CreditReasonKey | null {
  if (!text) return null;
  for (const [reason, pattern] of RULES) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

export interface ReasonInput {
  statedReason: string | null;
  /** The extractor's own classification, if it gave one. */
  suggestedReason: CreditReasonKey | null;
  lineDescriptions: string[];
}

/**
 * Exactly one reason per credit. A stated reason wins; otherwise infer from the
 * extractor's suggestion, then from the line item text.
 */
export function determineCreditReason(input: ReasonInput): {
  reason: CreditReasonKey;
  source: "stated" | "inferred";
} {
  if (input.statedReason && input.statedReason.trim() !== "") {
    const fromText = classifyReasonText(input.statedReason);
    return { reason: fromText ?? input.suggestedReason ?? "other", source: "stated" };
  }
  const inferred =
    input.suggestedReason ?? classifyReasonText(input.lineDescriptions.join(" \n ")) ?? "other";
  return { reason: inferred, source: "inferred" };
}
