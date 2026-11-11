import { describe, expect, it } from "vitest";
import { decideAutoConfirm, type AutonomyPolicy, type AutopilotCandidate } from "@/lib/autonomy";

const clean: AutopilotCandidate = {
  type: "invoice",
  issues: [],
  vendorKnown: true,
  currency: "USD",
  totalCents: 21_476,
};

const policy = (level: AutonomyPolicy["level"], limitCents = 50_000): AutonomyPolicy => ({
  level,
  limitCents,
  currency: "USD",
});

describe("decideAutoConfirm", () => {
  it("never confirms when autonomy is off", () => {
    expect(decideAutoConfirm(policy("review_all"), clean).action).toBe("hold");
  });

  it("confirms a clean document from a known vendor within the limit, and says why", () => {
    expect(decideAutoConfirm(policy("auto_within_limit"), clean)).toEqual({
      action: "confirm",
      reason: "Every check passed, the vendor is on file, and $214.76 is within the $500.00 limit.",
    });
  });

  it("treats the limit as inclusive", () => {
    expect(decideAutoConfirm(policy("auto_within_limit"), { ...clean, totalCents: 50_000 }).action).toBe("confirm");
    expect(decideAutoConfirm(policy("auto_within_limit"), { ...clean, totalCents: 50_001 })).toEqual({
      action: "hold",
      reason: "$500.01 is over the $500.00 auto-confirm limit.",
    });
  });

  it("ignores the limit at the highest level", () => {
    expect(decideAutoConfirm(policy("auto_clean"), { ...clean, totalCents: 9_000_000 }).action).toBe("confirm");
  });

  it("never converts: other currencies are held under a limit", () => {
    const decision = decideAutoConfirm(policy("auto_within_limit"), { ...clean, currency: "EUR", totalCents: 100 });
    expect(decision.action).toBe("hold");
    expect(decision.reason).toContain("EUR");
  });

  it.each([
    ["an open issue", { issues: ["Missing total"] }],
    ["a new vendor", { vendorKnown: false }],
    ["a document that is neither invoice nor credit", { type: "other" as const }],
    ["an unread amount", { totalCents: null }],
  ])("holds %s at every level", (_name, patch) => {
    for (const level of ["auto_within_limit", "auto_clean"] as const) {
      expect(decideAutoConfirm(policy(level), { ...clean, ...patch }).action).toBe("hold");
    }
  });

  it("confirms credit memos under the same rules", () => {
    expect(decideAutoConfirm(policy("auto_clean"), { ...clean, type: "credit_memo" }).action).toBe("confirm");
  });
});
