import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReasonBreakdown } from "@/lib/metrics";
import { formatCents } from "@/lib/money";
import { REASON_COLORS, REASON_STACK_ORDER } from "@/lib/reason-colors";
import { REASON_LABELS, type CreditReasonKey } from "@/lib/reasons";

/** A thin share-of-total bar for the credits column; hover lists each reason. */
export function ReasonBar({
  byReason,
  totalCents,
  currency,
}: {
  byReason: Record<CreditReasonKey, ReasonBreakdown>;
  totalCents: number;
  currency: string;
}) {
  if (totalCents === 0) return null;
  const parts = REASON_STACK_ORDER.filter((r) => byReason[r].cents > 0);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Credits by reason"
          className="mt-1 ml-auto flex h-1.5 w-24 gap-[2px] overflow-hidden rounded-full"
        >
          {parts.map((r) => (
            <span
              key={r}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ flexGrow: byReason[r].cents, backgroundColor: REASON_COLORS[r] }}
            />
          ))}
        </button>
      </TooltipTrigger>
      <TooltipContent className="min-w-56">
        <ul className="space-y-1">
          {parts.map((r) => (
            <li key={r} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: REASON_COLORS[r] }} />
              <span className="flex-1">
                {REASON_LABELS[r]} ({byReason[r].count})
              </span>
              <span className="tabular-nums">{formatCents(byReason[r].cents, currency)}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
