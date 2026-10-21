import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InfoTip } from "@/components/info-tip";
import { ReasonBar } from "@/components/reason-bar";
import { ScorecardFilters } from "@/components/scorecard-filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { formatPlainDate, todayUtc } from "@/lib/dates";
import {
  computeScorecard,
  currenciesInUse,
  formatDays,
  formatRate,
  isSortKey,
  METRIC_DEFINITIONS,
  sortScorecard,
  type SortDir,
  type SortKey,
} from "@/lib/metrics";
import { formatCents } from "@/lib/money";
import { parsePeriod, periodRange, type PeriodKey } from "@/lib/period";
import { loadMetricData } from "@/lib/server/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Vendor scorecard" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const COLUMNS: Array<{ key: SortKey; label: string; definition?: string; numeric: boolean }> = [
  { key: "vendor", label: "Vendor", numeric: false },
  { key: "invoices", label: "Invoices", definition: METRIC_DEFINITIONS.invoices, numeric: true },
  { key: "errorRate", label: "Billing error rate", definition: METRIC_DEFINITIONS.billingErrorRate, numeric: true },
  { key: "totalCredits", label: "Total credits", definition: METRIC_DEFINITIONS.totalCredits, numeric: true },
  { key: "averageCredit", label: "Avg credit", definition: METRIC_DEFINITIONS.averageCredit, numeric: true },
  { key: "medianDays", label: "Median days to resolve", definition: METRIC_DEFINITIONS.medianDaysToResolve, numeric: true },
  { key: "openBalance", label: "Open balance", definition: METRIC_DEFINITIONS.openBalance, numeric: true },
];

export default async function VendorsPage({ searchParams }: PageProps<"/vendors">) {
  const { organizationId } = await requireSession();
  const params = await searchParams;
  const today = todayUtc();
  const periodKey = parsePeriod(one(params.period));
  const period = periodRange(periodKey, today);
  const data = await loadMetricData(organizationId);
  const currencies = currenciesInUse([...data.invoices, ...data.credits]);
  const requested = one(params.currency);
  const currency = requested && currencies.includes(requested) ? requested : (currencies[0] ?? "USD");
  const sortParam = one(params.sort);
  const sort: SortKey = isSortKey(sortParam) ? sortParam : "errorRate";
  const dir: SortDir = one(params.dir) === "asc" ? "asc" : one(params.dir) === "desc" ? "desc" : sort === "vendor" ? "asc" : "desc";

  const rows = sortScorecard(computeScorecard({ ...data, currency, period, today }), sort, dir);
  const otherCurrencies = currencies.filter((c) => c !== currency);

  const href = (patch: { period?: PeriodKey; currency?: string; sort?: SortKey; dir?: SortDir }) => {
    const next = new URLSearchParams();
    const merged = { period: periodKey, currency, sort, dir, ...patch };
    if (merged.period !== "365d") next.set("period", merged.period);
    if (merged.currency !== currencies[0]) next.set("currency", merged.currency);
    next.set("sort", merged.sort);
    next.set("dir", merged.dir);
    return `/vendors?${next.toString()}`;
  };

  const totals = rows.reduce(
    (acc, r) => ({
      invoices: acc.invoices + r.invoiceCount,
      errorInvoices: acc.errorInvoices + r.invoicesWithBillingError,
      credits: acc.credits + r.totalCreditsCents,
      open: acc.open + r.openCreditCents,
    }),
    { invoices: 0, errorInvoices: 0, credits: 0, open: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendor scorecard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {period.label}: {formatPlainDate(period.start)} to {formatPlainDate(period.end)} · amounts in {currency}
          </p>
        </div>
        <ScorecardFilters period={periodKey} currency={currency} currencies={currencies} hrefFor={href} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Invoices", String(totals.invoices)],
          ["Billing error rate", formatRate(totals.invoices ? totals.errorInvoices / totals.invoices : null)],
          ["Total credits", formatCents(totals.credits, currency, { wholeUnits: true })],
          ["Open balance", formatCents(totals.open, currency, { wholeUnits: true })],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">{label}, all vendors</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => {
                const active = sort === col.key;
                const nextDir: SortDir = active ? (dir === "asc" ? "desc" : "asc") : col.numeric ? "desc" : "asc";
                return (
                  <TableHead key={col.key} className={cn(col.numeric && "text-right")}>
                    <div className={cn("inline-flex items-center gap-1", col.numeric && "justify-end")}>
                      {col.definition ? <InfoTip label={<span className="sr-only">Definition of</span>}>{col.definition}</InfoTip> : null}
                      <Link
                        href={href({ sort: col.key, dir: nextDir })}
                        className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
                        aria-label={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {active && (dir === "asc" ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
                      </Link>
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} className="py-10 text-center text-muted-foreground">
                  No confirmed documents in {currency} yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.vendorId}>
                <TableCell className="font-medium">
                  <Link href={`/vendors/${r.vendorId}?period=${periodKey}&currency=${currency}`} className="hover:underline">
                    {r.vendorName}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.invoiceCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className={cn(r.billingErrorRate !== null && r.billingErrorRate >= 0.1 && "font-semibold text-red-800")}>
                    {formatRate(r.billingErrorRate)}
                  </span>
                  {r.invoiceCount > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {r.invoicesWithBillingError} of {r.invoiceCount}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.creditCount === 0 ? (
                    <span className="text-muted-foreground">{formatCents(0, currency)}</span>
                  ) : (
                    <>
                      {formatCents(r.totalCreditsCents, currency)}
                      <div className="text-xs text-muted-foreground">
                        {r.creditCount} credit{r.creditCount === 1 ? "" : "s"}
                      </div>
                      <ReasonBar byReason={r.byReason} totalCents={r.totalCreditsCents} currency={currency} />
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.averageCreditCents === null ? "—" : formatCents(r.averageCreditCents, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDays(r.medianDaysToResolve)}
                  {r.medianDaysToResolve !== null && r.linkedCreditCount < r.creditCount && (
                    <div className="text-xs text-muted-foreground">{r.linkedCreditCount} linked</div>
                  )}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", r.openCreditCents > 0 && "font-medium")}>
                  {formatCents(r.openCreditCents, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {otherCurrencies.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Some vendors bill in {otherCurrencies.join(", ")}. Amounts are never converted between currencies; switch
          currency above to see them.
        </p>
      )}
    </div>
  );
}
