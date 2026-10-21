import { SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { ConfirmCleanButton } from "@/app/(app)/documents/confirm-clean-button";
import { DocumentStatusBadge, TYPE_LABELS } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { formatPlainDate, toPlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Documents" };

const PAGE_SIZE = 50;

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "processing", label: "Processing" },
  { key: "confirmed", label: "Confirmed" },
  { key: "failed", label: "Failed" },
] as const;

const TYPE_FILTERS = [
  { key: "all", label: "All types" },
  { key: "invoice", label: "Invoices" },
  { key: "credit_memo", label: "Credit memos" },
  { key: "other", label: "Other" },
] as const;

type StatusTab = (typeof STATUS_TABS)[number]["key"];
type TypeFilter = (typeof TYPE_FILTERS)[number]["key"];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const { organizationId } = await requireSession();
  const params = await searchParams;
  const status = (STATUS_TABS.find((t) => t.key === one(params.status))?.key ?? "all") as StatusTab;
  const type = (TYPE_FILTERS.find((t) => t.key === one(params.type))?.key ?? "all") as TypeFilter;
  const q = one(params.q)?.trim() ?? "";
  const page = Math.max(1, Number(one(params.page)) || 1);

  const where: Prisma.DocumentWhereInput = { organizationId };
  if (status === "processing") where.status = { in: ["uploaded", "extracting"] };
  else if (status !== "all") where.status = status;
  if (type !== "all") where.type = type;
  if (q) {
    where.OR = [
      { documentNumber: { contains: q, mode: "insensitive" } },
      { vendorNameRaw: { contains: q, mode: "insensitive" } },
      { vendor: { name: { contains: q, mode: "insensitive" } } },
      { originalFilename: { contains: q, mode: "insensitive" } },
    ];
  }

  const [docs, total, statusCounts, cleanCount] = await Promise.all([
    db.document.findMany({
      where,
      // Work waiting on a person first, then newest.
      orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        status: true,
        type: true,
        source: true,
        originalFilename: true,
        vendorNameRaw: true,
        documentNumber: true,
        documentDate: true,
        currency: true,
        totalCents: true,
        reviewIssues: true,
        errorMessage: true,
        vendor: { select: { id: true, name: true } },
      },
    }),
    db.document.count({ where }),
    db.document.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    db.document.count({ where: { organizationId, status: "needs_review", reviewIssues: { isEmpty: true } } }),
  ]);

  const countFor = (key: StatusTab) =>
    statusCounts
      .filter((s) =>
        key === "all" ? true : key === "processing" ? s.status === "uploaded" || s.status === "extracting" : s.status === key,
      )
      .reduce((sum, s) => sum + s._count._all, 0);

  const href = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    const merged = { status, type, q, page: 1, ...patch };
    if (merged.status !== "all") next.set("status", String(merged.status));
    if (merged.type !== "all") next.set("type", String(merged.type));
    if (merged.q) next.set("q", String(merged.q));
    if (Number(merged.page) > 1) next.set("page", String(merged.page));
    const qs = next.toString();
    return qs ? `/documents?${qs}` : "/documents";
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every uploaded and seeded invoice and credit memo. Only confirmed documents count toward the scorecard.
          </p>
        </div>
        <div className="flex gap-2">
          {cleanCount > 0 && <ConfirmCleanButton count={cleanCount} />}
          <Button asChild variant="outline" size="sm">
            <Link href="/upload">Upload</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {STATUS_TABS.map((tab) => (
            <Link
              key={tab.key}
              href={href({ status: tab.key })}
              className={cn(
                "rounded-md px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
                status === tab.key && "bg-background font-medium text-foreground shadow-sm",
              )}
            >
              {tab.label} <span className="tabular-nums opacity-60">{countFor(tab.key)}</span>
            </Link>
          ))}
        </div>
        <div className="flex gap-1">
          {TYPE_FILTERS.map((t) => (
            <Link
              key={t.key}
              href={href({ type: t.key })}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground",
                type === t.key && "border-foreground/30 bg-muted font-medium text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <form action="/documents" className="ml-auto flex items-center gap-2">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          {type !== "all" && <input type="hidden" name="type" value={type} />}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Vendor, number or file" className="w-64 pl-8" />
          </div>
        </form>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No documents match.
                </TableCell>
              </TableRow>
            )}
            {docs.map((d) => (
              <TableRow key={d.id} className="relative">
                <TableCell>
                  <Link href={`/documents/${d.id}`} className="after:absolute after:inset-0" aria-label="Open document">
                    <DocumentStatusBadge status={d.status} />
                  </Link>
                </TableCell>
                <TableCell>{d.type ? TYPE_LABELS[d.type] : "—"}</TableCell>
                <TableCell className="max-w-52 truncate font-medium">{d.vendor?.name ?? d.vendorNameRaw ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{d.documentNumber ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {d.documentDate ? formatPlainDate(toPlainDate(d.documentDate)) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.totalCents !== null && d.currency ? formatCents(d.totalCents, d.currency) : "—"}
                </TableCell>
                <TableCell className="max-w-44 truncate text-xs text-muted-foreground">
                  {d.source === "seed" ? "Seed data" : d.originalFilename}
                </TableCell>
                <TableCell className="max-w-64 truncate text-xs">
                  {d.status === "failed" ? (
                    <span className="text-red-700">{d.errorMessage}</span>
                  ) : d.status === "needs_review" && d.reviewIssues.length > 0 ? (
                    <span className="text-amber-800">{d.reviewIssues[0]}</span>
                  ) : d.status === "needs_review" ? (
                    <span className="text-emerald-800">Ready to confirm</span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {total} documents · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <Link href={href({ page: Math.max(1, page - 1) })} aria-disabled={page <= 1}>
                Previous
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" disabled={page >= pages}>
              <Link href={href({ page: Math.min(pages, page + 1) })} aria-disabled={page >= pages}>
                Next
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
