import { ArrowLeftIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditsChart } from "@/app/(app)/vendors/[id]/credits-chart";
import { MergeVendorDialog } from "@/app/(app)/vendors/[id]/merge-dialog";
import { InfoTip } from "@/components/info-tip";
import { ScorecardFilters } from "@/components/scorecard-filters";
import { DocumentStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSession } from "@/lib/auth";
import { CREDIT_STATUS_LABELS } from "@/lib/confirm";
import { fromPlainDate, formatPlainDate, lastMonths, toPlainDate, todayUtc } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  computeVendorMetrics,
  currenciesInUse,
  formatDays,
  formatRate,
  METRIC_DEFINITIONS,
  monthlyCreditsByReason,
} from "@/lib/metrics";
import { formatCents } from "@/lib/money";
import { parsePeriod, periodRange, type PeriodKey } from "@/lib/period";
import { REASON_COLORS, REASON_STACK_ORDER } from "@/lib/reason-colors";
import { isBillingError, REASON_LABELS } from "@/lib/reasons";
import { loadMetricData } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Vendor" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VendorPage({ params, searchParams }: PageProps<"/vendors/[id]">) {
  const { organizationId } = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const vendor = await db.vendor.findFirst({
    where: { id, organizationId },
    include: { aliases: { select: { rawName: true, normalizedName: true } } },
  });
  if (!vendor) notFound();

  const today = todayUtc();
  const periodKey = parsePeriod(one(query.period));
  const period = periodRange(periodKey, today);
  const data = await loadMetricData(organizationId);
  const vendorDocs = [...data.invoices, ...data.credits].filter((d) => d.vendorId === vendor.id);
  const currencies = currenciesInUse(vendorDocs);
  const requested = one(query.currency);
  const currency = requested && currencies.includes(requested) ? requested : (currencies[0] ?? "USD");
  const m = computeVendorMetrics({ ...data, vendorId: vendor.id, currency, period, today });
  const months = lastMonths(today, 12);
  const chart = monthlyCreditsByReason(data.credits, vendor.id, currency, months);

  const [docs, otherVendors] = await Promise.all([
    db.document.findMany({
      where: {
        organizationId,
        vendorId: vendor.id,
        currency,
        type: { in: ["invoice", "credit_memo"] },
        documentDate: { gte: fromPlainDate(period.start), lte: fromPlainDate(period.end) },
      },
      orderBy: [{ documentDate: "desc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        status: true,
        documentNumber: true,
        documentDate: true,
        totalCents: true,
        creditReason: true,
        creditStatus: true,
        linkedInvoice: { select: { id: true, documentNumber: true } },
        _count: { select: { credits: { where: { status: "confirmed" } } } },
      },
    }),
    db.vendor.findMany({
      where: { organizationId, id: { not: vendor.id } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const credits = docs.filter((d) => d.type === "credit_memo");
  const invoices = docs.filter((d) => d.type === "invoice");

  const href = (patch: { period?: PeriodKey; currency?: string }) => {
    const next = new URLSearchParams({ period: patch.period ?? periodKey, currency: patch.currency ?? currency });
    return `/vendors/${vendor.id}?${next.toString()}`;
  };
  const aliases = vendor.aliases.map((a) => a.rawName).filter((n) => n !== vendor.name);
  const reasons = REASON_STACK_ORDER.filter((r) => m.byReason[r].count > 0);

  const tiles: Array<{ label: string; value: string; detail?: string; definition: string }> = [
    { label: "Invoices", value: String(m.invoiceCount), definition: METRIC_DEFINITIONS.invoices },
    {
      label: "Billing error rate",
      value: formatRate(m.billingErrorRate),
      detail: m.invoiceCount ? `${m.invoicesWithBillingError} of ${m.invoiceCount} invoices` : undefined,
      definition: METRIC_DEFINITIONS.billingErrorRate,
    },
    {
      label: "Total credits",
      value: formatCents(m.totalCreditsCents, currency),
      detail: `${m.creditCount} credit${m.creditCount === 1 ? "" : "s"}`,
      definition: METRIC_DEFINITIONS.totalCredits,
    },
    {
      label: "Average credit",
      value: m.averageCreditCents === null ? "—" : formatCents(m.averageCreditCents, currency),
      definition: METRIC_DEFINITIONS.averageCredit,
    },
    {
      label: "Median days to resolve",
      value: formatDays(m.medianDaysToResolve),
      detail: m.creditCount ? `${m.linkedCreditCount} of ${m.creditCount} credits linked` : undefined,
      definition: METRIC_DEFINITIONS.medianDaysToResolve,
    },
    {
      label: "Open balance",
      value: formatCents(m.openCreditCents, currency),
      detail: m.openOver60Cents ? `${formatCents(m.openOver60Cents, currency)} open 60+ days` : `${m.openCreditCount} open`,
      definition: METRIC_DEFINITIONS.openBalance,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/vendors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Vendor scorecard
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{vendor.name}</h1>
            {aliases.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">Also matched as: {aliases.join(" · ")}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/vendors/${vendor.id}/summary?period=${periodKey}&currency=${currency}`}>
                <FileTextIcon />
                Negotiation summary
              </Link>
            </Button>
            <MergeVendorDialog vendorId={vendor.id} vendorName={vendor.name} others={otherVendors} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScorecardFilters period={periodKey} currency={currency} currencies={currencies} hrefFor={href} />
        <p className="text-sm text-muted-foreground">
          {formatPlainDate(period.start)} to {formatPlainDate(period.end)} · {currency}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">
              <InfoTip label={t.label}>{t.definition}</InfoTip>
            </div>
            <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{t.value}</div>
            {t.detail && <div className="mt-0.5 text-xs text-muted-foreground">{t.detail}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Credits by month and reason</CardTitle>
            <CardDescription>Last 12 months, by credit memo date, in {currency}.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreditsChart data={chart} currency={currency} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Breakdown by reason</CardTitle>
            <CardDescription>{period.label}. Billing errors are what count toward the error rate.</CardDescription>
          </CardHeader>
          <CardContent>
            {reasons.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No credits in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Still open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reasons.map((r) => (
                    <TableRow key={r}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: REASON_COLORS[r] }} />
                          {REASON_LABELS[r]}
                          {isBillingError(r) && (
                            <span className="rounded bg-red-50 px-1 text-[10px] font-medium text-red-800 uppercase">billing error</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.byReason[r].count}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(m.byReason[r].cents, currency)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatCents(m.byReason[r].openCents, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents behind the numbers</CardTitle>
          <CardDescription>
            Everything from {vendor.name} dated in the period. Open any document to see or correct its extracted fields.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="credits">
            <TabsList>
              <TabsTrigger value="credits">Credit memos ({credits.length})</TabsTrigger>
              <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="credits">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Credit memo</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Corrects</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/documents/${c.id}`} className="font-mono text-xs hover:underline">
                          {c.documentNumber}
                        </Link>
                        {c.status !== "confirmed" && <DocumentStatusBadge status={c.status} className="ml-2" />}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.documentDate ? formatPlainDate(toPlainDate(c.documentDate)) : "—"}
                      </TableCell>
                      <TableCell>{c.creditReason ? REASON_LABELS[c.creditReason] : "—"}</TableCell>
                      <TableCell>
                        {c.linkedInvoice ? (
                          <Link href={`/documents/${c.linkedInvoice.id}`} className="font-mono text-xs hover:underline">
                            {c.linkedInvoice.documentNumber}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not linked</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{c.creditStatus ? CREDIT_STATUS_LABELS[c.creditStatus] : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.totalCents !== null ? formatCents(c.totalCents, currency) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {credits.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                        No credit memos in this period.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="invoices">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Link href={`/documents/${inv.id}`} className="font-mono text-xs hover:underline">
                          {inv.documentNumber}
                        </Link>
                        {inv.status !== "confirmed" && <DocumentStatusBadge status={inv.status} className="ml-2" />}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {inv.documentDate ? formatPlainDate(toPlainDate(inv.documentDate)) : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {inv._count.credits > 0 ? (
                          <span className="text-amber-800">{inv._count.credits} credit{inv._count.credits === 1 ? "" : "s"}</span>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inv.totalCents !== null ? formatCents(inv.totalCents, currency) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {invoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        No invoices in this period.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
