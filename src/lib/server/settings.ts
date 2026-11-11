import { AUTONOMY_LABELS, type AutonomyLevel, type AutonomyPolicy } from "@/lib/autonomy";
import { db } from "@/lib/db";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import { recordEvent, type Actor } from "@/lib/server/audit";

const MAX_INT4 = 2_147_483_647;

export async function getAutonomy(organizationId: string): Promise<AutonomyPolicy> {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { autonomyLevel: true, autoConfirmLimitCents: true, autoConfirmCurrency: true },
  });
  return { level: org.autonomyLevel, limitCents: org.autoConfirmLimitCents, currency: org.autoConfirmCurrency };
}

/** Changes how much the system may confirm on its own. The change itself is audited. */
export async function updateAutonomy(
  organizationId: string,
  input: { level: AutonomyLevel; limit: string },
  actor: Actor,
): Promise<string> {
  const current = await getAutonomy(organizationId);
  let limitCents = current.limitCents;
  if (input.level === "auto_within_limit") {
    const parsed = parseMoneyToCents(input.limit, current.currency);
    if (parsed === null || parsed <= 0 || parsed > MAX_INT4) {
      throw new Error("Enter the limit as an amount greater than zero.");
    }
    limitCents = parsed;
  }
  if (input.level === current.level && limitCents === current.limitCents) return "No change.";

  const describe = (p: { level: AutonomyLevel; limitCents: number }) =>
    p.level === "auto_within_limit"
      ? `${AUTONOMY_LABELS[p.level].name} (up to ${formatCents(p.limitCents, current.currency)})`
      : AUTONOMY_LABELS[p.level].name;

  await db.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: organizationId },
      data: { autonomyLevel: input.level, autoConfirmLimitCents: limitCents },
    });
    await recordEvent(
      {
        organizationId,
        actor,
        action: "settings.autonomy_changed",
        summary: `Autonomy changed from “${describe(current)}” to “${describe({ level: input.level, limitCents })}”.`,
        detail: {
          from: { level: current.level, limitCents: current.limitCents },
          to: { level: input.level, limitCents },
          currency: current.currency,
        },
      },
      tx,
    );
  });
  return "Autonomy updated. It applies to documents read from now on.";
}

export interface AutomationStats {
  /** Uploaded documents confirmed so far, by any route. */
  confirmed: number;
  /** Confirmed exactly as extracted: nobody had to change a field. */
  zeroEdit: number;
  /** Confirmed by the autopilot without a person. */
  autopilot: number;
  /** Times the autopilot declined and left a document for a person. */
  held: number;
}

/**
 * How well extraction is holding up, read from the audit trail. "Zero edit" is
 * the number that matters: the share of documents a reviewer accepted untouched.
 */
export async function getAutomationStats(organizationId: string): Promise<AutomationStats> {
  const rows = await db.$queryRaw<Array<{ action: string; via: string | null; clean: boolean; count: number }>>`
    SELECT "action",
           "detail"->>'via' AS via,
           jsonb_array_length(coalesce("detail"->'changes', '[]'::jsonb)) = 0 AS clean,
           count(*)::int AS count
      FROM "AuditEvent"
     WHERE "organizationId" = ${organizationId}
       AND "action" IN ('document.confirmed', 'document.held')
     GROUP BY 1, 2, 3`;
  const stats: AutomationStats = { confirmed: 0, zeroEdit: 0, autopilot: 0, held: 0 };
  for (const row of rows) {
    if (row.action === "document.held") {
      stats.held += row.count;
      continue;
    }
    stats.confirmed += row.count;
    if (row.clean) stats.zeroEdit += row.count;
    if (row.via === "autopilot") stats.autopilot += row.count;
  }
  return stats;
}
