import type { CreditReasonKey } from "@/lib/reasons";

// Categorical slots from the validated default palette, in fixed stacking
// order (billing errors first). "Other" is a neutral gray, not a ninth hue.
// Three slots sit under 3:1 contrast on white, so charts always ship with a
// legend and the reason table next to them.
export const REASON_STACK_ORDER: CreditReasonKey[] = [
  "pricing_error",
  "quantity_error",
  "duplicate_billing",
  "damaged_or_defective",
  "return",
  "rebate_or_promo",
  "service_failure",
  "other",
];

export const REASON_COLORS: Record<CreditReasonKey, string> = {
  pricing_error: "#2a78d6",
  quantity_error: "#eb6834",
  duplicate_billing: "#1baf7a",
  damaged_or_defective: "#eda100",
  return: "#e87ba4",
  rebate_or_promo: "#008300",
  service_failure: "#6250d6",
  other: "#8a8984",
};
