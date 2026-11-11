import { formatCents } from "@/lib/money";

// How much the system may do without a person, and the guardrails that hold at
// every setting. The model never decides this: it only reads the document. This
// module takes the checked result and returns "confirm" or "hold", with the
// reason in words, so every automatic action can be explained afterward.

export const AUTONOMY_LEVELS = ["review_all", "auto_within_limit", "auto_clean"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface AutonomyPolicy {
  level: AutonomyLevel;
  /** Minor units of `currency`. Used by auto_within_limit only. */
  limitCents: number;
  currency: string;
}

export const DEFAULT_POLICY: AutonomyPolicy = { level: "review_all", limitCents: 50_000, currency: "USD" };

export const AUTONOMY_LABELS: Record<AutonomyLevel, { name: string; description: string }> = {
  review_all: {
    name: "Review everything",
    description: "Every document waits for a person. Nothing is confirmed on its own.",
  },
  auto_within_limit: {
    name: "Auto-confirm small, clean documents",
    description: "Clean documents from vendors you already have confirm themselves, up to a limit you set.",
  },
  auto_clean: {
    name: "Auto-confirm all clean documents",
    description: "Any clean document from a vendor you already have confirms itself, whatever the amount.",
  },
};

/** The checks that hold at every level above review_all. Shown on the settings page. */
export const GUARDRAILS = [
  "Every key field was read, and the line items add up to the total.",
  "The extractor flagged nothing as uncertain, and every quoted source backs its value.",
  "The vendor is already on file. A new vendor is always created by a person.",
  "It is an invoice or a credit memo, and not a duplicate of something on file.",
] as const;

export interface AutopilotCandidate {
  type: "invoice" | "credit_memo" | "other" | null;
  /** Review issues found at extraction: missing fields, arithmetic, extractor doubts. */
  issues: readonly string[];
  /** True when the vendor name matched a vendor already on file. */
  vendorKnown: boolean;
  currency: string | null;
  totalCents: number | null;
}

export type AutopilotDecision =
  | { action: "confirm"; reason: string }
  | { action: "hold"; reason: string };

const hold = (reason: string): AutopilotDecision => ({ action: "hold", reason });

export function decideAutoConfirm(policy: AutonomyPolicy, doc: AutopilotCandidate): AutopilotDecision {
  if (policy.level === "review_all") return hold("Autonomy is set to review everything.");

  if (doc.type !== "invoice" && doc.type !== "credit_memo") {
    return hold("It isn't an invoice or a credit memo.");
  }
  if (doc.issues.length > 0) {
    return hold(
      doc.issues.length === 1
        ? "The checks found an issue to look at."
        : `The checks found ${doc.issues.length} issues to look at.`,
    );
  }
  if (!doc.vendorKnown) return hold("The vendor isn't on file yet. New vendors are created by a person.");
  if (doc.currency === null || doc.totalCents === null) return hold("The amount couldn't be read.");

  const amount = formatCents(doc.totalCents, doc.currency);
  if (policy.level === "auto_clean") {
    return { action: "confirm", reason: `Every check passed and the vendor is on file (${amount}).` };
  }

  const limit = formatCents(policy.limitCents, policy.currency);
  if (doc.currency !== policy.currency) {
    return hold(`It is in ${doc.currency}. The ${limit} limit applies to ${policy.currency} only, and amounts are never converted.`);
  }
  if (doc.totalCents > policy.limitCents) {
    return hold(`${amount} is over the ${limit} auto-confirm limit.`);
  }
  return {
    action: "confirm",
    reason: `Every check passed, the vendor is on file, and ${amount} is within the ${limit} limit.`,
  };
}
