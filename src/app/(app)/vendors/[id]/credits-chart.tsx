"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMonth } from "@/lib/dates";
import type { MonthlyReasonPoint } from "@/lib/metrics";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { REASON_COLORS, REASON_STACK_ORDER } from "@/lib/reason-colors";
import { REASON_LABELS, type CreditReasonKey } from "@/lib/reasons";

// Monthly credits by reason, stacked. Colors follow the reason (fixed slots),
// so a reason keeps its color whatever else is on screen. A legend is always
// shown and the reason table beside the chart is the accessible fallback.

interface TooltipEntry {
  dataKey?: unknown;
  value?: unknown;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0).reverse();
  const total = rows.reduce((s, p) => s + Number(p.value), 0);
  return (
    <div className="min-w-52 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">{formatMonth(String(label))}</div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground">No credits</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((p) => (
            <li key={String(p.dataKey)} className="flex items-center gap-2">
              <span className="size-2 rounded-sm" style={{ backgroundColor: p.color }} />
              <span className="flex-1">{REASON_LABELS[p.dataKey as CreditReasonKey]}</span>
              <span className="tabular-nums">{formatCents(Number(p.value), currency)}</span>
            </li>
          ))}
          {rows.length > 1 && (
            <li className="mt-1 flex justify-between border-t pt-1 font-medium">
              <span>Total</span>
              <span className="tabular-nums">{formatCents(total, currency)}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function CreditsChart({ data, currency }: { data: MonthlyReasonPoint[]; currency: string }) {
  const present = REASON_STACK_ORDER.filter((r) => data.some((d) => d[r] > 0));
  if (present.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No credits in the last 12 months.
      </div>
    );
  }
  return (
    <div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => formatMonth(m)}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <YAxis
              tickFormatter={(v: number) => formatCentsCompact(Math.round(v), currency)}
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(props) => (
                <ChartTooltip active={props.active} payload={props.payload} label={props.label} currency={currency} />
              )} />
            {present.map((reason) => (
              <Bar
                key={reason}
                dataKey={reason}
                stackId="credits"
                fill={REASON_COLORS[reason]}
                stroke="var(--card)"
                strokeWidth={2}
                maxBarSize={36}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {present.map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: REASON_COLORS[r] }} />
            {REASON_LABELS[r]}
          </li>
        ))}
      </ul>
    </div>
  );
}
