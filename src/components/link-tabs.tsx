import Link from "next/link";
import { cn } from "@/lib/utils";

export interface LinkTab {
  key: string;
  label: string;
  href: string;
  count?: number;
}

/** Underlined tabs that are plain links, so every view has a URL. */
export function LinkTabs({ tabs, active, label }: { tabs: LinkTab[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-6 overflow-x-auto border-b">
      {tabs.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent text-sm text-muted-foreground transition-colors hover:text-foreground",
              current && "border-ink text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn("text-xs tabular-nums", current ? "text-muted-foreground" : "text-muted-foreground/80")}>
                {tab.count.toLocaleString("en-US")}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** A compact either/or switch (period, currency), also as links. */
export function LinkSegments({
  options,
  active,
  label,
  mono,
}: {
  options: Array<{ key: string; label: string; href: string }>;
  active: string;
  label: string;
  mono?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-paper p-0.5">
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          aria-current={o.key === active ? "true" : undefined}
          className={cn(
            "flex h-7 items-center rounded-[3px] px-2.5 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
            mono && "font-mono text-xs",
            o.key === active && "bg-background text-foreground shadow-[0_0_0_1px_var(--line)]",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
