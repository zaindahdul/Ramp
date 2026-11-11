import { SearchIcon, SparklesIcon, UploadIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { ConfirmCleanButton } from "@/app/(app)/documents/confirm-clean-button";
import { LinkSegments, LinkTabs } from "@/components/link-tabs";
import { PageHeader } from "@/components/page-header";
import { DocumentStatusBadge, TYPE_LABELS } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentUser } from "@/lib/workspace";
import { formatPlainDate, toPlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "Documents" };

const PAGE_SIZE = 50;

// The tabs follow a document's life: read, reviewed, on the books.
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
  const { organizationId } = await currentUser();
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
        confirmedVia: true,
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
      <PageHeader
        title="Documents"
        description="Every invoice and credit memo on file. Only confirmed documents count toward the scorecard."
        actions={
          <>
            {cleanCount > 0 && <ConfirmCleanButton count={cleanCount} />}
            <Button asChild variant={cleanCount > 0 ? "outline" : "default"}>
              <Link href="/upload">
                <UploadIcon />
                Upload
              </Link>
            </Button>
          </>
        }
      />

      <LinkTabs
        label="Status"
        active={status}
        tabs={STATUS_TABS.map((tab) => ({
          key: tab.key,
          label: tab.label,
          href: href({ status: tab.key }),
          count: countFor(tab.key),
        }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkSegments
          label="Document type"
          active={type}
          options={TYPE_FILTERS.map((t) => ({ key: t.key, label: t.label, href: href({ type: t.key }) }))}
        />
        <form action="/documents" className="relative w-full sm:w-72">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          {type !== "all" && <input type="hidden" name="type" value={type} />}
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="Search vendor, number or file" aria-label="Search documents" className="pl-8" />
        </form>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-0">Status</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Number</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="pr-0">Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                {q ? `Nothing matches “${q}”.` : "No documents here."}
              </TableCell>
            </TableRow>
          )}
          {docs.map((d) => (
            <TableRow key={d.id} className="relative">
              <TableCell className="pl-0">
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
              <TableCell className="max-w-64 truncate pr-0 text-xs">
                {d.status === "failed" ? (
                  <span className="text-negative-ink">{d.errorMessage}</span>
                ) : d.status === "needs_review" && d.reviewIssues.length > 0 ? (
                  <span className="text-warning-ink">{d.reviewIssues[0]}</span>
                ) : d.status === "needs_review" ? (
                  <span className="text-positive-ink">Every check passed</span>
                ) : d.confirmedVia === "autopilot" ? (
                  <span className="inline-flex items-center gap-1 text-intel-ink">
                    <SparklesIcon className="size-3" aria-hidden />
                    Confirmed by autopilot
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">
            {total.toLocaleString("en-US")} documents · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: page - 1 })}>Previous</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Previous
              </Button>
            )}
            {page < pages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: page + 1 })}>Next</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Next
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
