import Link from "next/link";
import { PERIOD_KEYS, periodRange, type PeriodKey } from "@/lib/period";
import { todayUtc } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Period and currency pickers as plain links, so filtered views are shareable URLs. */
export function ScorecardFilters({
  period,
  currency,
  currencies,
  hrefFor,
}: {
  period: PeriodKey;
  currency: string;
  currencies: string[];
  hrefFor: (patch: { period?: PeriodKey; currency?: string }) => string;
}) {
  const today = todayUtc();
  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Period">
        {PERIOD_KEYS.map((key) => (
          <Link
            key={key}
            href={hrefFor({ period: key })}
            className={cn(
              "rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
              period === key && "bg-background font-medium text-foreground shadow-sm",
            )}
          >
            {periodRange(key, today).label}
          </Link>
        ))}
      </div>
      {currencies.length > 1 && (
        <div className="flex items-center gap-1" role="group" aria-label="Currency">
          <span className="mr-1 text-xs text-muted-foreground">Currency</span>
          {currencies.map((c) => (
            <Link
              key={c}
              href={hrefFor({ currency: c })}
              className={cn(
                "rounded-md border px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground",
                currency === c && "border-foreground/30 bg-muted font-medium text-foreground",
              )}
            >
              {c}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
