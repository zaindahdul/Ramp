import { AlertTriangleIcon, ArrowLeftIcon, ArrowRightIcon, CheckIcon, ExternalLinkIcon, FileXIcon, LoaderIcon, XCircleIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteDocumentAction } from "@/app/(app)/actions";
import { AutoRefresh } from "@/app/(app)/documents/[id]/auto-refresh";
import { DeleteDocumentButton, ReviewForm } from "@/app/(app)/documents/[id]/review-form";
import { RetryButton } from "@/app/(app)/documents/[id]/retry-button";
import { ActivityFeed } from "@/components/activity-feed";
import { lineTabsList, lineTabsTrigger } from "@/components/line-tabs";
import { PageHeader } from "@/components/page-header";
import { DocumentStatusBadge, TYPE_LABELS } from "@/components/status-badge";
import { SystemNote } from "@/components/system-note";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currentUser } from "@/lib/workspace";
import { toConfirmInput, type ConfirmInput } from "@/lib/confirm";
import { formatPlainDate, toPlainDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { extractionNotes } from "@/lib/extraction/schema";
import { formatCents } from "@/lib/money";
import { REASON_LABELS } from "@/lib/reasons";
import { getActivity } from "@/lib/server/audit";
import { invoiceOptionsForCredit } from "@/lib/server/queries";
import { findVendorByName } from "@/lib/server/vendors";

export const metadata: Metadata = { title: "Review document" };

const CONFIRMED_VIA = {
  review: "confirmed by a reviewer",
  bulk: "confirmed in bulk",
  autopilot: "confirmed by autopilot",
  seed: "seed data",
} as const;

export default async function ReviewPage({ params }: PageProps<"/documents/[id]">) {
  const { organizationId } = await currentUser();
  const { id } = await params;
  const doc = await db.document.findFirst({
    where: { id, organizationId },
    include: {
      lineItems: { orderBy: { position: "asc" } },
      vendor: { select: { id: true, name: true } },
      credits: {
        where: { status: "confirmed" },
        select: { id: true, documentNumber: true, documentDate: true, totalCents: true, currency: true, creditReason: true },
        orderBy: { documentDate: "asc" },
      },
    },
  });
  if (!doc) notFound();

  const extracting = doc.status === "uploaded" || doc.status === "extracting";
  const [nextInQueue, activity] = await Promise.all([
    db.document.findFirst({
      where: { organizationId, status: "needs_review", id: { not: doc.id } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
    getActivity(organizationId, { documentId: doc.id, take: 50 }),
  ]);
  const matched =
    doc.vendor ?? (doc.vendorNameRaw ? await findVendorByName(organizationId, doc.vendorNameRaw) : null);
  const invoiceOptions = doc.type === "credit_memo" ? await invoiceOptionsForCredit(organizationId, doc) : [];
  const typeLabel = doc.type ? TYPE_LABELS[doc.type] : "Document";
  const isImage = doc.mimeType?.startsWith("image/");
  const fileUrl = `/api/documents/${doc.id}/file`;

  // What the extractor quoted as its source for each field, keyed by form field.
  const notes = extractionNotes(doc.rawExtraction);
  const evidence: Partial<Record<keyof ConfirmInput, string>> = {
    vendorName: notes.evidence.vendorName,
    documentNumber: notes.evidence.documentNumber,
    documentDate: notes.evidence.documentDate,
    total: notes.evidence.total,
    referencedInvoiceNumber: notes.evidence.referencedInvoiceNumber,
  };
  // The autopilot's latest word on this document, if it declined to confirm it.
  const held = doc.status === "needs_review" ? activity.find((e) => e.action === "document.held") : undefined;
  const meta = [
    doc.source === "seed" ? null : doc.originalFilename,
    doc.extractor && doc.extractor !== "seed" ? `read by ${doc.extractor}` : null,
    doc.status === "confirmed" && doc.confirmedVia ? CONFIRMED_VIA[doc.confirmedVia] : null,
    doc.confirmedAt && doc.confirmedVia !== "seed"
      ? doc.confirmedAt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
      : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {extracting && <AutoRefresh />}
      <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeftIcon className="size-4" /> Documents
      </Link>
      <PageHeader
        className="!mt-3"
        eyebrow={[typeLabel, doc.vendor?.name ?? doc.vendorNameRaw].filter(Boolean).join(" · ")}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className={doc.documentNumber ? "font-mono text-2xl tracking-tight" : undefined}>
              {doc.documentNumber ?? doc.originalFilename ?? typeLabel}
            </span>
            <DocumentStatusBadge status={doc.status} />
          </span>
        }
        description={meta.join(" · ")}
        actions={
          <>
            {doc.storageKey && !extracting && <RetryButton documentId={doc.id} label="Read again" />}
            <DeleteDocumentButton action={deleteDocumentAction.bind(null, doc.id)} />
            {nextInQueue && doc.status !== "needs_review" && (
              <Button asChild>
                <Link href={`/documents/${nextInQueue.id}`}>
                  Next in review queue
                  <ArrowRightIcon />
                </Link>
              </Button>
            )}
          </>
        }
      />

      {doc.status === "failed" && (
        <div className="flex gap-3 rounded-lg bg-negative-soft p-4 text-sm leading-5 text-negative-ink">
          <XCircleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">{doc.duplicateOfId ? "Not saved: this is a duplicate" : "This document couldn’t be read"}</p>
            <p className="mt-0.5">{doc.errorMessage}</p>
            {doc.duplicateOfId && (
              <Link href={`/documents/${doc.duplicateOfId}`} className="mt-1 inline-block font-medium underline underline-offset-4">
                Open the document already on file
              </Link>
            )}
          </div>
        </div>
      )}

      {doc.status !== "failed" && doc.reviewIssues.length > 0 && (
        <div className="flex gap-3 rounded-lg bg-warning-soft p-4 text-sm leading-5 text-warning-ink">
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

      {doc.status === "needs_review" && doc.reviewIssues.length === 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-positive-soft px-4 py-3 text-sm text-positive-ink">
          <CheckIcon className="size-4 shrink-0" />
          Every check passed: all key fields were read and the lines add up. Compare with the original, then confirm.
        </p>
      )}

      {held && <SystemNote by="Autopilot">{held.summary}</SystemNote>}

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-2xl bg-paper p-2">
            {!doc.storageKey ? (
              <div className="flex h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                <FileXIcon className="size-8" strokeWidth={1.5} />
                <p className="max-w-56">This record came with the seed data, so there is no original file to show.</p>
              </div>
            ) : isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- authenticated, user-uploaded file
              <img src={fileUrl} alt={doc.originalFilename ?? "Uploaded document"} className="mx-auto max-h-[78vh] w-auto rounded-lg" />
            ) : (
              <iframe src={fileUrl} title="Original document" className="h-[78vh] w-full rounded-lg bg-white" />
            )}
          </div>
          {doc.storageKey && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Open the original in a new tab
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </section>

        <section className="min-w-0">
          <Tabs defaultValue="details" className="gap-6">
            <TabsList variant="line" className={lineTabsList}>
              <TabsTrigger value="details" className={lineTabsTrigger}>
                Details
              </TabsTrigger>
              <TabsTrigger value="activity" className={lineTabsTrigger}>
                Activity
                <span className="text-xs text-muted-foreground tabular-nums">{activity.length}</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-8">
              {extracting ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl bg-paper text-sm text-muted-foreground">
                  <LoaderIcon className="size-5 animate-spin" />
                  Reading the document…
                </div>
              ) : (
                <ReviewForm
                  key={doc.updatedAt.toISOString()}
                  documentId={doc.id}
                  alreadyConfirmed={doc.status === "confirmed"}
                  matchedVendor={matched?.name ?? null}
                  invoiceOptions={invoiceOptions}
                  evidence={evidence}
                  reasonBasis={doc.creditReasonBasis}
                  linkRationale={doc.status === "confirmed" ? doc.linkRationale : null}
                  linkIsManual={doc.linkMethod === "manual"}
                  initial={toConfirmInput({
                    ...doc,
                    documentDate: doc.documentDate ? toPlainDate(doc.documentDate) : null,
                    dueDate: doc.dueDate ? toPlainDate(doc.dueDate) : null,
                  })}
                />
              )}

              {doc.type === "invoice" && doc.credits.length > 0 && (
                <section>
                  <h2 className="eyebrow border-b pb-1.5">Credits against this invoice</h2>
                  <ul className="divide-y text-sm">
                    {doc.credits.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                        <Link href={`/documents/${c.id}`} className="font-mono text-xs underline underline-offset-4">
                          {c.documentNumber}
                        </Link>
                        <span className="flex-1 text-muted-foreground">
                          {c.creditReason ? REASON_LABELS[c.creditReason] : ""}
                          {c.documentDate && ` · ${formatPlainDate(toPlainDate(c.documentDate))}`}
                        </span>
                        <span className="tabular-nums">
                          {c.totalCents !== null && c.currency ? formatCents(c.totalCents, c.currency) : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </TabsContent>

            <TabsContent value="activity">
              <p className="mb-2 text-sm text-muted-foreground">
                Everything that happened to this document, newest first: who did it, and for the system&apos;s own steps, why.
              </p>
              <ActivityFeed
                events={activity}
                empty={
                  doc.source === "seed"
                    ? "This record came with the seed data, so it has no history. Changes you make from here on are recorded."
                    : "Nothing has happened here yet."
                }
              />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}
