import type { Metadata } from "next";
import Link from "next/link";
import { AutonomyForm } from "@/app/(app)/settings/autonomy-form";
import { ActivityFeed } from "@/components/activity-feed";
import { PageHeader, Section } from "@/components/page-header";
import { Stat } from "@/components/stat";
import { currentUser } from "@/lib/workspace";
import { GUARDRAILS } from "@/lib/autonomy";
import { centsToDecimalString } from "@/lib/money";
import { AUTOPILOT, getActivity } from "@/lib/server/audit";
import { getAutomationStats, getAutonomy } from "@/lib/server/settings";

export const metadata: Metadata = { title: "Autonomy" };

const rate = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`);

export default async function SettingsPage() {
  const { organizationId } = await currentUser();
  const [policy, stats, decisions] = await Promise.all([
    getAutonomy(organizationId),
    getAutomationStats(organizationId),
    getActivity(organizationId, { actorType: "system", actorName: AUTOPILOT.name, take: 6 }),
  ]);

  return (
    <div className="space-y-12">
      <PageHeader
        title="Autonomy"
        description="How much the system may confirm without you. It reads every document either way; this decides who signs off."
      />

      <AutonomyForm
        key={`${policy.level}:${policy.limitCents}`}
        level={policy.level}
        limit={centsToDecimalString(policy.limitCents, policy.currency)}
        currency={policy.currency}
      />

      <Section
        title="Guardrails that always hold"
        note="These are checked by plain code, not by the model. A document that fails any of them waits for a person at every setting."
      >
        <ol className="divide-y border-b">
          {GUARDRAILS.map((rule, i) => (
            <li key={rule} className="flex items-baseline gap-5 py-3.5">
              <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-base leading-6 tracking-[-0.01em]">{rule}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="How it is going"
        note="Counted from the audit trail, for documents uploaded to this workspace. Zero-edit is the share a reviewer accepted without changing a field."
      >
        <div className="grid grid-cols-2 gap-3 pt-5 lg:grid-cols-4">
          <Stat label="Confirmed" value={stats.confirmed.toLocaleString("en-US")} detail="Uploaded documents on the books" />
          <Stat
            label="Zero-edit rate"
            value={rate(stats.zeroEdit, stats.confirmed)}
            detail={`${stats.zeroEdit} of ${stats.confirmed} confirmed as read`}
          />
          <Stat label="By autopilot" value={stats.autopilot.toLocaleString("en-US")} detail="Confirmed with no one involved" />
          <Stat label="Held for you" value={stats.held.toLocaleString("en-US")} detail="Times autopilot declined, with a reason" />
        </div>
      </Section>

      <Section
        title="Recent autopilot decisions"
        actions={
          <Link href="/activity?by=system" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            All system activity
          </Link>
        }
      >
        <ActivityFeed
          events={decisions}
          showSubject
          empty="Autopilot hasn't decided anything yet. With autonomy on, every document it confirms or holds shows up here with its reason."
        />
      </Section>
    </div>
  );
}
