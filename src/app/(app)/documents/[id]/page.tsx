import { AlertCircleIcon, AlertTriangleIcon, ArrowLeftIcon, FileXIcon, LoaderIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteDocumentAction } from "@/app/(app)/actions";
import { AutoRefresh } from "@/app/(app)/documents/[id]/auto-refresh";
import { DeleteDocumentButton, ReviewForm } from "@/app/(app)/documents/[id]/review-form";
import { RetryButton } from "@/app/(app)/documents/[id]/retry-button";
import { DocumentStatusBadge, TYPE_LABELS } from "@/components/status-badge";
import { requireSession } from "@/lib/auth";
import { toConfirmInput } from "@/lib/confirm";
import { formatPlainDate, toPlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { REASON_LABELS } from "@/lib/reasons";
import { invoiceOptionsForCredit } from "@/lib/server/queries";
import { findVendorByName } from "@/lib/server/vendors";

export const metadata: Metadata = { title: "Review document" };

const LINK_METHOD_LABELS = {
  reference: "matched on the referenced invoice number",
  heuristic: "matched on vendor, date window, amount and line items",
  manual: "picked by hand",
} as const;

export default async function ReviewPage({ params }: PageProps<"/documents/[id]">) {
  const { organizationId } = await requireSession();
  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, organizationId },
    include: {
      lineItems: { orderBy: { position: "asc" } },
      vendor: { select: { id: true, name: true } },
      linkedInvoice: { select: { id: true, documentNumber: true, documentDate: true, totalCents: true, currency: true } },
      credits: {
        where: { status: "confirmed" },
        select: { id: true, documentNumber: true, documentDate: true, totalCents: true, currency: true, creditReason: true },
        orderBy: { documentDate: "asc" },
      },
    },
  });
  if (!doc) notFound();

  const extracting = doc.status === "uploaded" || doc.status === "extracting";
  const matched =
    doc.vendor ?? (doc.vendorNameRaw ? await findVendorByName(organizationId, doc.vendorNameRaw) : null);
  const invoiceOptions = doc.type === "credit_memo" ? await invoiceOptionsForCredit(organizationId, doc) : [];
  const title = `${doc.type ? TYPE_LABELS[doc.type] : "Document"} ${doc.documentNumber ?? ""}`.trim();
  const isImage = doc.mimeType?.startsWith("image/");
  const fileUrl = `/api/documents/${doc.id}/file`;

  return (
    <div className="space-y-6">
      {extracting && <AutoRefresh />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="size-4" /> Documents
          </Link>
          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {title}
            <DocumentStatusBadge status={doc.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {doc.source === "seed" ? "Seed data" : doc.originalFilename}
            {doc.extractor && doc.extractor !== "seed" && ` · extracted by ${doc.extractor}`}
            {doc.confirmedAt && ` · confirmed ${doc.confirmedAt.toLocaleDateString("en-US", { timeZone: "UTC" })}`}
          </p>
        </div>
        <div className="flex gap-2">
          {doc.storageKey && !extracting && <RetryButton documentId={doc.id} />}
          <DeleteDocumentButton action={deleteDocumentAction.bind(null, doc.id)} />
        </div>
      </div>

      {doc.status === "failed" && (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{doc.duplicateOfId ? "Not saved: duplicate" : "Extraction failed"}</p>
            <p className="mt-0.5">{doc.errorMessage}</p>
            {doc.duplicateOfId && (
              <Link href={`/documents/${doc.duplicateOfId}`} className="mt-1 inline-block font-medium underline">
                Open the existing document
              </Link>
            )}
          </div>
        </div>
      )}

      {doc.status !== "failed" && doc.reviewIssues.length > 0 && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{doc.status === "needs_review" ? "Check before confirming" : "Noted at review"}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {doc.reviewIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-xl border bg-muted/30">
            {!doc.storageKey ? (
              <div className="flex h-[70vh] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <FileXIcon className="size-8" />
                <p>This is a seeded record, so there&apos;s no original file to show.</p>
              </div>
            ) : isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- authenticated, user-uploaded file
              <img src={fileUrl} alt={doc.originalFilename ?? "Uploaded document"} className="mx-auto max-h-[80vh] w-auto" />
            ) : (
              <iframe src={fileUrl} title="Original document" className="h-[80vh] w-full bg-white" />
            )}
          </div>
          {doc.storageKey && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Open the original in a new tab
            </a>
          )}
        </section>

        <section className="space-y-6">
          {extracting ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border text-sm text-muted-foreground">
              <LoaderIcon className="size-6 animate-spin" />
              Reading the document…
            </div>
          ) : (
            <ReviewForm
              key={doc.updatedAt.toISOString()}
              documentId={doc.id}
              alreadyConfirmed={doc.status === "confirmed"}
              matchedVendor={matched?.name ?? null}
              invoiceOptions={invoiceOptions}
              initial={toConfirmInput({
                ...doc,
                documentDate: doc.documentDate ? toPlainDate(doc.documentDate) : null,
                dueDate: doc.dueDate ? toPlainDate(doc.dueDate) : null,
              })}
            />
          )}

          {doc.status === "confirmed" && doc.type === "credit_memo" && (
            <div className="rounded-xl border p-4 text-sm">
              <h3 className="font-medium">Link</h3>
              {doc.linkedInvoice ? (
                <p className="mt-1 text-muted-foreground">
                  Corrects invoice{" "}
                  <Link href={`/documents/${doc.linkedInvoice.id}`} className="font-mono text-foreground underline">
                    {doc.linkedInvoice.documentNumber}
                  </Link>
                  {doc.linkedInvoice.documentDate && ` (${formatPlainDate(toPlainDate(doc.linkedInvoice.documentDate))})`},{" "}
                  {doc.linkMethod ? LINK_METHOD_LABELS[doc.linkMethod] : "linked"}.
                </p>
              ) : doc.linkCandidateIds.length > 0 ? (
                <p className="mt-1 text-amber-900">
                  Not linked: {doc.linkCandidateIds.length} invoices fit equally well. Pick one under &quot;Corrects
                  invoice&quot; above and save.
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  {doc.linkMethod === "manual" ? "Marked as not correcting any invoice." : "No matching invoice on file."}
                </p>
              )}
            </div>
          )}

          {doc.type === "invoice" && doc.credits.length > 0 && (
            <div className="rounded-xl border p-4 text-sm">
              <h3 className="font-medium">Credits against this invoice</h3>
              <ul className="mt-2 divide-y">
                {doc.credits.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                    <Link href={`/documents/${c.id}`} className="font-mono text-xs underline">
                      {c.documentNumber}
                    </Link>
                    <span className="text-muted-foreground">{c.creditReason ? REASON_LABELS[c.creditReason] : ""}</span>
                    <span className="tabular-nums">
                      {c.totalCents !== null && c.currency ? formatCents(c.totalCents, c.currency) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
