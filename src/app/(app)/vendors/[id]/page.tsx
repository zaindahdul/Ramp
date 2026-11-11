import { ArrowLeftIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditsChart } from "@/app/(app)/vendors/[id]/credits-chart";
import { MergeVendorDialog } from "@/app/(app)/vendors/[id]/merge-dialog";
import { InfoTip } from "@/components/info-tip";
import { lineTabsList, lineTabsTrigger } from "@/components/line-tabs";
import { PageHeader, Section } from "@/components/page-header";
import { ScorecardFilters } from "@/components/scorecard-filters";
import { Stat } from "@/components/stat";
import { DocumentStatusBadge, Pill } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currentUser } from "@/lib/workspace";
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
  const { organizationId } = await currentUser();
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
      label: "Days to resolve",
      value: formatDays(m.medianDaysToResolve),
      detail: m.creditCount ? `Median, ${m.linkedCreditCount} of ${m.creditCount} credits linked` : "Median",
      definition: METRIC_DEFINITIONS.medianDaysToResolve,
    },
    {
      label: "Open balance",
      value: formatCents(m.openCreditCents, currency),
      detail: m.openOver60Cents ? `${formatCents(m.openOver60Cents, currency)} open 60+ days` : `${m.openCreditCount} open`,
      definition: METRIC_DEFINITIONS.openBalance,
    },
  ];

  const creditStatusDot = { open: "bg-solar", applied: "bg-positive", written_off: "bg-line-strong" } as const;

  return (
    <div className="space-y-8">
      <Link href="/vendors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Vendor scorecard
      </Link>
      <PageHeader
        className="!mt-3"
        eyebrow="Vendor"
        title={vendor.name}
        description={aliases.length > 0 ? `Also billed as ${aliases.join(", ")}` : undefined}
        actions={
          <>
            <MergeVendorDialog vendorId={vendor.id} vendorName={vendor.name} others={otherVendors} />
            <Button asChild>
              <Link href={`/vendors/${vendor.id}/summary?period=${periodKey}&currency=${currency}`}>
                <FileTextIcon />
                Negotiation summary
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScorecardFilters period={periodKey} currency={currency} currencies={currencies} hrefFor={href} />
        <p className="text-sm text-muted-foreground">
          {formatPlainDate(period.start)} to {formatPlainDate(period.end)} · {currency}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Stat
            key={t.label}
            label={<InfoTip label={t.label}>{t.definition}</InfoTip>}
            value={t.value}
            detail={t.detail}
            className={
              t.label === "Open balance" && m.openCreditCents > 0
                ? "bg-ink text-white [&_.eyebrow]:text-white/60 [&_.figure]:text-solar [&_div:last-child]:text-white/60 [&_svg]:text-white/50"
                : undefined
            }
          />
        ))}
      </div>

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-5">
        <Section className="lg:col-span-3" title="Credits by month and reason" note={`Last 12 months, by credit memo date, in ${currency}.`}>
          <div className="pt-5">
            <CreditsChart data={chart} currency={currency} />
          </div>
        </Section>
        <Section
          className="lg:col-span-2"
          title="Breakdown by reason"
          note={`${period.label}. Billing errors count toward the error rate.`}
        >
          {reasons.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No credits in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-0">Reason</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-0 text-right">Still open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reasons.map((r) => (
                  <TableRow key={r}>
                    <TableCell className="pl-0">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: REASON_COLORS[r] }} />
                        {REASON_LABELS[r]}
                        {isBillingError(r) && (
                          <span className="rounded-[3px] bg-negative-soft px-1 text-[10px] leading-4 font-medium tracking-wide text-negative-ink uppercase">
                            Billing error
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.byReason[r].count}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(m.byReason[r].cents, currency)}</TableCell>
                    <TableCell className="pr-0 text-right tabular-nums text-muted-foreground">
                      {formatCents(m.byReason[r].openCents, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>

      <Section
        title="Documents behind the numbers"
        note={`Everything from ${vendor.name} dated in the period. Open any document to see or correct its fields.`}
      >
        <Tabs defaultValue="credits" className="gap-0 pt-2">
          <TabsList variant="line" className={lineTabsList}>
            <TabsTrigger value="credits" className={lineTabsTrigger}>
              Credit memos <span className="text-xs text-muted-foreground tabular-nums">{credits.length}</span>
            </TabsTrigger>
            <TabsTrigger value="invoices" className={lineTabsTrigger}>
              Invoices <span className="text-xs text-muted-foreground tabular-nums">{invoices.length}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="credits">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-0">Credit memo</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Corrects</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-0 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-0">
                      <Link href={`/documents/${c.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                        {c.documentNumber}
                      </Link>
                      {c.status !== "confirmed" && <DocumentStatusBadge status={c.status} className="ml-2" />}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.documentDate ? formatPlainDate(toPlainDate(c.documentDate)) : "\u2014"}
                    </TableCell>
                    <TableCell>{c.creditReason ? REASON_LABELS[c.creditReason] : "\u2014"}</TableCell>
                    <TableCell>
                      {c.linkedInvoice ? (
                        <Link href={`/documents/${c.linkedInvoice.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                          {c.linkedInvoice.documentNumber}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.creditStatus ? (
                        <Pill dot={creditStatusDot[c.creditStatus]}>{CREDIT_STATUS_LABELS[c.creditStatus]}</Pill>
                      ) : (
                        "\u2014"
                      )}
                    </TableCell>
                    <TableCell className="pr-0 text-right tabular-nums">
                      {c.totalCents !== null ? formatCents(c.totalCents, currency) : "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
                {credits.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
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
                  <TableHead className="pl-0">Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead className="pr-0 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-0">
                      <Link href={`/documents/${inv.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                        {inv.documentNumber}
                      </Link>
                      {inv.status !== "confirmed" && <DocumentStatusBadge status={inv.status} className="ml-2" />}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.documentDate ? formatPlainDate(toPlainDate(inv.documentDate)) : "\u2014"}
                    </TableCell>
                    <TableCell>
                      {inv._count.credits > 0 ? (
                        <Pill dot="bg-warning">
                          {inv._count.credits} credit{inv._count.credits === 1 ? "" : "s"}
                        </Pill>
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-0 text-right tabular-nums">
                      {inv.totalCents !== null ? formatCents(inv.totalCents, currency) : "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
                {invoices.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No invoices in this period.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </Section>
    </div>
  );
}
