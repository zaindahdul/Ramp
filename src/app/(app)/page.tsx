import { AlertTriangleIcon, ArrowRightIcon, Link2OffIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CreditLinkSelect, CreditStatusSelect } from "@/components/credit-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { formatPlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { OPEN_CREDIT_AGING_DAYS } from "@/lib/metrics";
import { formatCents, formatTotals, totalsByCurrency } from "@/lib/money";
import { REASON_LABELS } from "@/lib/reasons";
import { getOpenCredits, getUnlinkedCredits } from "@/lib/server/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Open credits" };

export default async function OpenCreditsPage() {
  const { organizationId } = await requireSession();
  const [open, unlinked, reviewCount] = await Promise.all([
    getOpenCredits(organizationId),
    getUnlinkedCredits(organizationId),
    db.document.count({ where: { organizationId, status: "needs_review" } }),
  ]);

  const totals = totalsByCurrency(open.map((c) => ({ currency: c.currency, cents: c.totalCents })));
  const aged = open.filter((c) => c.ageDays > OPEN_CREDIT_AGING_DAYS);
  const agedTotals = totalsByCurrency(aged.map((c) => ({ currency: c.currency, cents: c.totalCents })));
  const vendorCount = new Set(open.map((c) => c.vendorId)).size;
  // Oldest first: the credits most at risk of being forgotten.
  const rows = [...open].sort((a, b) => b.ageDays - a.ageDays);

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm font-medium text-muted-foreground">Open credits, still owed to you</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {totals.length === 0 ? (
            <span className="text-5xl font-semibold tracking-tight tabular-nums">$0.00</span>
          ) : (
            totals.map((t, i) => (
              <span
                key={t.currency}
                className={cn(
                  "tracking-tight tabular-nums",
                  i === 0 ? "text-5xl font-semibold" : "text-2xl font-medium text-muted-foreground",
                )}
              >
                {formatCents(t.cents, t.currency)}
                {totals.length > 1 && <span className="ml-1 text-sm font-normal text-muted-foreground">{t.currency}</span>}
              </span>
            ))
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {open.length} open credit{open.length === 1 ? "" : "s"} from {vendorCount} vendor{vendorCount === 1 ? "" : "s"}
          {aged.length > 0 && (
            <>
              {" · "}
              <span className="font-medium text-amber-800">
                {aged.length} open more than {OPEN_CREDIT_AGING_DAYS} days ({formatTotals(agedTotals)})
              </span>
            </>
          )}
          {totals.length > 1 && " · Currencies are totaled separately, never converted."}
        </p>
      </section>

      {(reviewCount > 0 || unlinked.length > 0) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {reviewCount > 0 && (
            <Link
              href="/documents?status=needs_review"
              className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <AlertTriangleIcon className="size-5 text-amber-600" />
              <div className="flex-1">
                <div className="font-medium">
                  {reviewCount} document{reviewCount === 1 ? "" : "s"} waiting for review
                </div>
                <div className="text-sm text-muted-foreground">Extracted data isn&apos;t counted until it&apos;s confirmed.</div>
              </div>
              <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
          {unlinked.length > 0 && (
            <a
              href="#unlinked"
              className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <Link2OffIcon className="size-5 text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">
                  {unlinked.length} credit{unlinked.length === 1 ? "" : "s"} not linked to an invoice
                </div>
                <div className="text-sm text-muted-foreground">Pick the invoice each one corrects.</div>
              </div>
              <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </a>
          )}
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Open credits</CardTitle>
          <CardDescription>
            Oldest first. Rows open more than {OPEN_CREDIT_AGING_DAYS} days are highlighted. Mark a credit applied once
            it&apos;s been used against an invoice or refunded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No open credits. Nothing is owed to you right now.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Credit memo</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Corrects invoice</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const old = c.ageDays > OPEN_CREDIT_AGING_DAYS;
                  return (
                    <TableRow key={c.id} className={cn(old && "bg-amber-50/70 hover:bg-amber-50")}>
                      <TableCell className="font-medium">
                        {c.vendorId ? (
                          <Link href={`/vendors/${c.vendorId}`} className="hover:underline">
                            {c.vendorName}
                          </Link>
                        ) : (
                          c.vendorName
                        )}
                      </TableCell>
                      <TableCell>
                        <Link href={`/documents/${c.id}`} className="font-mono text-xs hover:underline">
                          {c.documentNumber ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatPlainDate(c.documentDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {old && (
                          <span className="mr-2 rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[11px] font-medium text-amber-950">
                            {OPEN_CREDIT_AGING_DAYS}+ days
                          </span>
                        )}
                        {c.ageDays}d
                      </TableCell>
                      <TableCell>{REASON_LABELS[c.reason]}</TableCell>
                      <TableCell>
                        {c.linkedInvoice ? (
                          <Link href={`/documents/${c.linkedInvoice.id}`} className="font-mono text-xs hover:underline">
                            {c.linkedInvoice.documentNumber}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not linked</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCents(c.totalCents, c.currency)}</TableCell>
                      <TableCell>
                        <CreditStatusSelect documentId={c.id} value={c.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card id="unlinked" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>Credits not linked to an invoice</CardTitle>
          <CardDescription>
            These named no invoice we have, and several invoices fit equally well (or none did). Linked credits feed the
            error rate and days-to-resolve metrics.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unlinked.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Every credit is linked.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Credit memo</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Corrects invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unlinked.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.vendorName}</TableCell>
                    <TableCell>
                      <Link href={`/documents/${c.id}`} className="font-mono text-xs hover:underline">
                        {c.documentNumber ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatPlainDate(c.documentDate)}</TableCell>
                    <TableCell>{REASON_LABELS[c.reason]}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(c.totalCents, c.currency)}</TableCell>
                    <TableCell>
                      <CreditLinkSelect documentId={c.id} options={c.options} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
