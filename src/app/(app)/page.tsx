import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CreditLinkSelect, CreditStatusSelect } from "@/components/credit-controls";
import { InfoTip } from "@/components/info-tip";
import { PageHeader, Section } from "@/components/page-header";
import { Pill } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentUser } from "@/lib/workspace";
import { formatPlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { OPEN_CREDIT_AGING_DAYS } from "@/lib/metrics";
import { formatCents, formatTotals, totalsByCurrency } from "@/lib/money";
import { REASON_LABELS } from "@/lib/reasons";
import { getOpenCredits, getUnlinkedCredits, type CreditRow } from "@/lib/server/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const BUCKETS = [
  { key: "fresh", label: "0–30 days", test: (age: number) => age <= 30, bar: "bg-white/25" },
  { key: "aging", label: "31–60 days", test: (age: number) => age > 30 && age <= OPEN_CREDIT_AGING_DAYS, bar: "bg-white/60" },
  { key: "old", label: `Over ${OPEN_CREDIT_AGING_DAYS} days`, test: (age: number) => age > OPEN_CREDIT_AGING_DAYS, bar: "bg-solar" },
] as const;

/** How long the money has been sitting, for one currency. */
function aging(rows: CreditRow[], currency: string) {
  const inCurrency = rows.filter((r) => r.currency === currency);
  const total = inCurrency.reduce((s, r) => s + r.totalCents, 0);
  return BUCKETS.map((b) => {
    const matched = inCurrency.filter((r) => b.test(r.ageDays));
    const cents = matched.reduce((s, r) => s + r.totalCents, 0);
    return { ...b, cents, count: matched.length, share: total > 0 ? cents / total : 0 };
  });
}

export default async function OverviewPage() {
  const { organizationId, organizationName } = await currentUser();
  const [open, unlinked, reviewCount] = await Promise.all([
    getOpenCredits(organizationId),
    getUnlinkedCredits(organizationId),
    db.document.count({ where: { organizationId, status: "needs_review" } }),
  ]);

  const totals = totalsByCurrency(open.map((c) => ({ currency: c.currency, cents: c.totalCents })));
  const [main, ...others] = totals;
  const aged = open.filter((c) => c.ageDays > OPEN_CREDIT_AGING_DAYS);
  const agedTotals = totalsByCurrency(aged.map((c) => ({ currency: c.currency, cents: c.totalCents })));
  const vendorCount = new Set(open.map((c) => c.vendorId)).size;
  const buckets = main ? aging(open, main.currency) : [];
  // Oldest first: the credits most at risk of being forgotten, and the order they get applied.
  const rows = [...open].sort((a, b) => b.ageDays - a.ageDays);

  const todo = [
    reviewCount > 0 && {
      href: "/documents?status=needs_review",
      title: `${plural(reviewCount, "document")} waiting for review`,
      note: "Extracted data isn’t counted until it’s confirmed.",
    },
    unlinked.length > 0 && {
      href: "#unlinked",
      title: `${plural(unlinked.length, "credit")} to match with an invoice`,
      note: "The linker found more than one invoice that fits, so it left the choice to you.",
    },
    aged.length > 0 && {
      href: "#open",
      title: `${plural(aged.length, "credit")} open more than ${OPEN_CREDIT_AGING_DAYS} days`,
      note: `${formatTotals(agedTotals)} that vendors have owed you for over two months.`,
    },
  ].filter((item): item is { href: string; title: string; note: string } => Boolean(item));

  return (
    <div className="space-y-12">
      <PageHeader eyebrow={organizationName} title="Overview" />

      <section className="dark -mt-6 overflow-hidden rounded-2xl bg-background text-foreground">
        <div className="grid gap-10 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-end">
          <div className="min-w-0">
            <p className="eyebrow text-solar">Open credits, still owed to you</p>
            <p className="figure mt-3 text-[56px] leading-none break-words text-solar sm:text-[72px]">
              {main ? formatCents(main.cents, main.currency) : "$0.00"}
            </p>
            {others.length > 0 && (
              <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xl font-light tabular-nums text-white/85">
                {others.map((t) => (
                  <span key={t.currency}>
                    {formatCents(t.cents, t.currency)}
                    <span className="ml-1.5 align-middle font-mono text-[11px] text-white/50">{t.currency}</span>
                  </span>
                ))}
              </p>
            )}
            <p className="mt-5 max-w-xl text-sm leading-5 text-muted-foreground">
              {plural(open.length, "open credit")} from {plural(vendorCount, "vendor")}.
              {totals.length > 1 && " Each currency is totaled on its own and never converted."}
            </p>
          </div>

          {main && (
            <div>
              <p className="eyebrow">
                How long it has been owed{totals.length > 1 ? `, ${main.currency}` : ""}
              </p>
              <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                {buckets
                  .filter((b) => b.cents > 0)
                  .map((b) => (
                    <span key={b.key} className={cn("h-full", b.bar)} style={{ flexGrow: b.cents }} />
                  ))}
              </div>
              <dl className="mt-4 divide-y divide-white/10 text-sm">
                {buckets.map((b) => (
                  <div key={b.key} className="flex items-baseline gap-3 py-2">
                    <span className={cn("size-2 shrink-0 translate-y-[-1px] rounded-full", b.bar)} aria-hidden />
                    <dt className="flex-1 text-white/80">
                      {b.label}
                      <span className="ml-2 text-xs text-muted-foreground">{plural(b.count, "credit")}</span>
                    </dt>
                    <dd className={cn("tabular-nums", b.key === "old" && b.cents > 0 ? "text-solar" : "text-white")}>
                      {formatCents(b.cents, main.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </section>

      <Section title="To do">
        {todo.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">Nothing needs you right now.</p>
        ) : (
          <ol className="divide-y border-b">
            {todo.map((item, i) => (
              <li key={item.href}>
                <Link href={item.href} className="group flex items-center gap-5 py-4 outline-offset-2">
                  <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xl leading-7 tracking-[-0.02em]">{item.title}</span>
                    <span className="block text-sm text-muted-foreground">{item.note}</span>
                  </span>
                  <ArrowRightIcon className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        id="open"
        title="Open credits"
        note="Oldest first, the order credits should be used. Mark one applied once it has been used against an invoice or refunded."
      >
        {rows.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">No open credits. Nothing is owed to you right now.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-0">Vendor</TableHead>
                <TableHead>Credit memo</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Corrects invoice</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="pr-0">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const old = c.ageDays > OPEN_CREDIT_AGING_DAYS;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-56 truncate pl-0 font-medium">
                      {c.vendorId ? (
                        <Link href={`/vendors/${c.vendorId}`} className="underline-offset-4 hover:underline">
                          {c.vendorName}
                        </Link>
                      ) : (
                        c.vendorName
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/documents/${c.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                        {c.documentNumber ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatPlainDate(c.documentDate)}</TableCell>
                    <TableCell>
                      {old ? (
                        <Pill dot="bg-warning" className="bg-warning-soft text-warning-ink tabular-nums">
                          {c.ageDays} days
                        </Pill>
                      ) : (
                        <span className="px-2 text-xs text-muted-foreground tabular-nums">{c.ageDays} days</span>
                      )}
                    </TableCell>
                    <TableCell>{REASON_LABELS[c.reason]}</TableCell>
                    <TableCell>
                      {c.linkedInvoice ? (
                        <Link href={`/documents/${c.linkedInvoice.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                          {c.linkedInvoice.documentNumber}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatCents(c.totalCents, c.currency)}</TableCell>
                    <TableCell className="pr-0">
                      <CreditStatusSelect documentId={c.id} value={c.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        id="unlinked"
        title="Credits to match with an invoice"
        note="A wrong link would quietly skew a vendor's error rate, so when several invoices fit equally well the linker asks instead of guessing."
      >
        {unlinked.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">Every credit is linked.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-0">Vendor</TableHead>
                <TableHead>Credit memo</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="pr-0">Corrects invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unlinked.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-56 truncate pl-0 font-medium">{c.vendorName}</TableCell>
                  <TableCell>
                    <Link href={`/documents/${c.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {c.documentNumber ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatPlainDate(c.documentDate)}</TableCell>
                  <TableCell>{REASON_LABELS[c.reason]}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(c.totalCents, c.currency)}</TableCell>
                  <TableCell className="pr-0">
                    <span className="flex items-center gap-2">
                      <CreditLinkSelect documentId={c.id} options={c.options} />
                      {c.linkRationale && (
                        <InfoTip label={<span className="sr-only">Why this wasn&apos;t linked automatically</span>}>
                          {c.linkRationale}
                        </InfoTip>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
