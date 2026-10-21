import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/app/(app)/vendors/[id]/summary/print-button";
import { ScorecardFilters } from "@/components/scorecard-filters";
import { requireSession } from "@/lib/auth";
import { daysBetween, formatPlainDate, fromPlainDate, toPlainDate, todayUtc } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  computeVendorMetrics,
  currenciesInUse,
  formatDays,
  formatRate,
  METRIC_DEFINITIONS,
  OPEN_CREDIT_AGING_DAYS,
} from "@/lib/metrics";
import { formatCents } from "@/lib/money";
import { negotiationSentences } from "@/lib/narrative";
import { parsePeriod, periodRange, type PeriodKey } from "@/lib/period";
import { REASON_STACK_ORDER } from "@/lib/reason-colors";
import { BILLING_ERROR_REASONS, isBillingError, REASON_LABELS } from "@/lib/reasons";
import { loadMetricData } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Negotiation summary" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-2 border-b pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

export default async function NegotiationSummaryPage({ params, searchParams }: PageProps<"/vendors/[id]/summary">) {
  const session = await requireSession();
  const { organizationId } = session;
  const { id } = await params;
  const query = await searchParams;
  const vendor = await db.vendor.findFirst({ where: { id, organizationId }, select: { id: true, name: true } });
  if (!vendor) notFound();

  const today = todayUtc();
  const periodKey = parsePeriod(one(query.period));
  const period = periodRange(periodKey, today);
  const data = await loadMetricData(organizationId);
  const currencies = currenciesInUse([...data.invoices, ...data.credits].filter((d) => d.vendorId === vendor.id));
  const requested = one(query.currency);
  const currency = requested && currencies.includes(requested) ? requested : (currencies[0] ?? "USD");
  const m = computeVendorMetrics({ ...data, vendorId: vendor.id, currency, period, today });
  const sentences = negotiationSentences({ vendorName: vendor.name, metrics: m, phrase: period.phrase });
  const [lead, ...rest] = sentences;
  const money = (c: number) => formatCents(c, currency);

  const creditSelect = {
    id: true,
    documentNumber: true,
    documentDate: true,
    totalCents: true,
    creditReason: true,
    linkedInvoice: { select: { documentNumber: true } },
  } as const;
  const [openCredits, largestErrors] = await Promise.all([
    db.document.findMany({
      where: { organizationId, vendorId: vendor.id, currency, type: "credit_memo", status: "confirmed", creditStatus: "open" },
      orderBy: { documentDate: "asc" },
      select: creditSelect,
    }),
    db.document.findMany({
      where: {
        organizationId,
        vendorId: vendor.id,
        currency,
        type: "credit_memo",
        status: "confirmed",
        creditReason: { in: [...BILLING_ERROR_REASONS] },
        documentDate: { gte: fromPlainDate(period.start), lte: fromPlainDate(period.end) },
      },
      orderBy: [{ totalCents: "desc" }, { id: "asc" }],
      take: 10,
      select: creditSelect,
    }),
  ]);

  const billingCents = BILLING_ERROR_REASONS.reduce((s, r) => s + m.byReason[r].cents, 0);
  const href = (patch: { period?: PeriodKey; currency?: string }) =>
    `/vendors/${vendor.id}/summary?${new URLSearchParams({ period: patch.period ?? periodKey, currency: patch.currency ?? currency })}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/vendors/${vendor.id}?period=${periodKey}&currency=${currency}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> {vendor.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <ScorecardFilters period={periodKey} currency={currency} currencies={currencies} hrefFor={href} />
          <PrintButton />
        </div>
      </div>

      <article className="space-y-8 rounded-xl border bg-card p-8 print:rounded-none print:border-0 print:p-0">
        <header>
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Vendor billing summary</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{vendor.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Prepared for {session.organizationName} · {formatPlainDate(period.start)} to {formatPlainDate(period.end)} ·{" "}
            amounts in {currency} · generated {formatPlainDate(today)}
          </p>
        </header>

        <section className="space-y-3">
          <p className="text-lg leading-relaxed font-medium">{lead}</p>
          {rest.length > 0 && <p className="leading-relaxed text-foreground/90">{rest.join(" ")}</p>}
        </section>

        <Section title="Key figures">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ["Invoices", String(m.invoiceCount)],
              ["Billing error rate", `${formatRate(m.billingErrorRate)}${m.invoiceCount ? ` (${m.invoicesWithBillingError} of ${m.invoiceCount})` : ""}`],
              ["Billing-error credits", money(billingCents)],
              ["All credits", `${money(m.totalCreditsCents)} (${m.creditCount})`],
              ["Average credit", m.averageCreditCents === null ? "—" : money(m.averageCreditCents)],
              ["Median days to resolve", formatDays(m.medianDaysToResolve)],
              ["Open balance", money(m.openCreditCents)],
              [`Open ${OPEN_CREDIT_AGING_DAYS}+ days`, money(m.openOver60Cents)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Credits by reason">
          {m.creditCount === 0 ? (
            <p className="text-sm text-muted-foreground">No credits in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Reason</th>
                  <th className="py-1 text-right font-medium">Credits</th>
                  <th className="py-1 text-right font-medium">Invoices affected</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                  <th className="py-1 text-right font-medium">Still open</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {REASON_STACK_ORDER.filter((r) => m.byReason[r].count > 0).map((r) => (
                  <tr key={r}>
                    <td className="py-1.5">
                      {REASON_LABELS[r]}
                      {isBillingError(r) && <span className="ml-1 text-xs text-muted-foreground">(billing error)</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{m.byReason[r].count}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.byReason[r].invoiceCount}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(m.byReason[r].cents)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(m.byReason[r].openCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title={`Open credits (${openCredits.length})`}>
          {openCredits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing open. Every credit has been applied or written off.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Credit memo</th>
                  <th className="py-1 font-medium">Date</th>
                  <th className="py-1 text-right font-medium">Age</th>
                  <th className="py-1 font-medium">Reason</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {openCredits.map((c) => {
                  const date = c.documentDate ? toPlainDate(c.documentDate) : today;
                  return (
                    <tr key={c.id}>
                      <td className="py-1.5 font-mono text-xs">{c.documentNumber}</td>
                      <td className="py-1.5">{formatPlainDate(date)}</td>
                      <td className="py-1.5 text-right tabular-nums">{daysBetween(date, today)} days</td>
                      <td className="py-1.5">{c.creditReason ? REASON_LABELS[c.creditReason] : "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.totalCents !== null ? money(c.totalCents) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>

        {largestErrors.length > 0 && (
          <Section title="Largest billing-error credits">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Credit memo</th>
                  <th className="py-1 font-medium">Date</th>
                  <th className="py-1 font-medium">Invoice</th>
                  <th className="py-1 font-medium">Reason</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {largestErrors.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 font-mono text-xs">{c.documentNumber}</td>
                    <td className="py-1.5">{c.documentDate ? formatPlainDate(toPlainDate(c.documentDate)) : "—"}</td>
                    <td className="py-1.5 font-mono text-xs">{c.linkedInvoice?.documentNumber ?? "not linked"}</td>
                    <td className="py-1.5">{c.creditReason ? REASON_LABELS[c.creditReason] : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.totalCents !== null ? money(c.totalCents) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <Section title="How these numbers are calculated">
          <dl className="space-y-1.5 text-xs text-muted-foreground">
            {(
              [
                ["Invoices", METRIC_DEFINITIONS.invoices],
                ["Billing error rate", METRIC_DEFINITIONS.billingErrorRate],
                ["Total credits", METRIC_DEFINITIONS.totalCredits],
                ["Average credit", METRIC_DEFINITIONS.averageCredit],
                ["Median days to resolve", METRIC_DEFINITIONS.medianDaysToResolve],
                ["Open balance", METRIC_DEFINITIONS.openBalance],
              ] as const
            ).map(([label, text]) => (
              <div key={label}>
                <dt className="inline font-medium text-foreground">{label}: </dt>
                <dd className="inline">{text}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </article>
    </div>
  );
}
