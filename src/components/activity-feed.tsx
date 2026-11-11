import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import type { ActivityRow } from "@/lib/server/audit";
import { cn } from "@/lib/utils";

const TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The audit trail as a timeline. People get their initials on ink; parts of the
 * system get the blue mark, so who decided what is readable at a glance.
 */
export function ActivityFeed({
  events,
  showSubject = false,
  empty = "Nothing has happened here yet.",
}: {
  events: ActivityRow[];
  /** Link each event to its document or vendor (for the org-wide feed). */
  showSubject?: boolean;
  empty?: string;
}) {
  if (events.length === 0) return <p className="py-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="divide-y">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 py-3">
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
              e.actorType === "user" ? "bg-ink text-white" : "bg-intel-soft text-intel-ink",
            )}
            aria-hidden
          >
            {e.actorType === "user" ? initials(e.actorName) : <SparklesIcon className="size-3.5" />}
          </span>
          <div className="min-w-0 flex-1 text-sm leading-5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("font-medium", e.actorType === "system" && "text-intel-ink")}>{e.actorName}</span>
              {showSubject && e.document && (
                <Link href={`/documents/${e.document.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                  {e.document.label}
                </Link>
              )}
              {showSubject && !e.document && e.vendor && (
                <Link href={`/vendors/${e.vendor.id}`} className="text-xs underline-offset-4 hover:underline">
                  {e.vendor.name}
                </Link>
              )}
              <time className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={e.createdAt.toISOString()}>
                {TIME.format(e.createdAt)} UTC
              </time>
            </div>
            <p className="mt-0.5 text-pretty text-muted-foreground">{e.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
