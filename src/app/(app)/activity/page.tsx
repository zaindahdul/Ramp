import type { Metadata } from "next";
import Link from "next/link";
import { ActivityFeed } from "@/components/activity-feed";
import { LinkTabs } from "@/components/link-tabs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/lib/workspace";
import { db } from "@/lib/db";
import { getActivity } from "@/lib/server/audit";

export const metadata: Metadata = { title: "Activity" };

const PAGE_SIZE = 50;
const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "user", label: "People" },
  { key: "system", label: "System" },
] as const;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const { organizationId } = await currentUser();
  const params = await searchParams;
  const by = FILTERS.find((f) => f.key === one(params.by))?.key ?? "all";
  const page = Math.max(1, Number(one(params.page)) || 1);
  const actorType = by === "all" ? undefined : by;

  const [events, counts] = await Promise.all([
    getActivity(organizationId, { actorType, take: PAGE_SIZE + 1, skip: (page - 1) * PAGE_SIZE }),
    db.auditEvent.groupBy({ by: ["actorType"], where: { organizationId }, _count: { _all: true } }),
  ]);
  const countFor = (key: (typeof FILTERS)[number]["key"]) =>
    counts.filter((c) => key === "all" || c.actorType === key).reduce((sum, c) => sum + c._count._all, 0);
  const href = (patch: { by?: string; page?: number }) => {
    const next = new URLSearchParams();
    const merged = { by, page: 1, ...patch };
    if (merged.by !== "all") next.set("by", merged.by);
    if (merged.page > 1) next.set("page", String(merged.page));
    const qs = next.toString();
    return qs ? `/activity?${qs}` : "/activity";
  };
  const hasMore = events.length > PAGE_SIZE;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="The audit trail: every change to a document, credit, vendor or setting, with who made it. Entries are never edited or removed."
      />
      <LinkTabs
        label="Who"
        active={by}
        tabs={FILTERS.map((f) => ({ key: f.key, label: f.label, href: href({ by: f.key }), count: countFor(f.key) }))}
      />
      <ActivityFeed
        events={events.slice(0, PAGE_SIZE)}
        showSubject
        empty="Nothing yet. Upload a document, confirm one or change a credit, and it will be recorded here. The seed data has no history."
      />
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">Page {page}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: page - 1 })}>Newer</Link>
              </Button>
            )}
            {hasMore && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: page + 1 })}>Older</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
