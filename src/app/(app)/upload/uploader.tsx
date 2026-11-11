"use client";

import { ArrowRightIcon, FileTextIcon, UploadCloudIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentStatusDto } from "@/app/api/documents/status/route";
import { DocumentStatusBadge, TYPE_LABELS } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/gif";
const PARALLEL_UPLOADS = 3;
const POLL_MS = 1500;

type Item = {
  key: string;
  filename: string;
  size: number;
  duplicate?: boolean;
  error?: string;
  doc?: DocumentStatusDto;
  id?: string;
};

type UploadResponse = {
  results?: Array<
    | { ok: true; id: string; filename: string; status: string; duplicate: boolean }
    | { ok: false; filename: string; error: string }
  >;
  error?: string;
};

const pendingStatuses = new Set(["uploaded", "extracting"]);

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Uploader() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const update = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const uploadOne = useCallback(async (item: Item, file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = (await res.json()) as UploadResponse;
      const result = body.results?.[0];
      if (!res.ok || !result) {
        update(item.key, { error: body.error ?? `Upload failed (${res.status}).` });
      } else if (!result.ok) {
        update(item.key, { error: result.error });
      } else {
        update(item.key, { id: result.id, duplicate: result.duplicate });
      }
    } catch {
      update(item.key, { error: "Network error while uploading." });
    }
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const batch = files.map((file, i) => ({
        file,
        item: { key: `${Date.now()}-${i}-${file.name}`, filename: file.name, size: file.size } as Item,
      }));
      setItems((prev) => [...batch.map((b) => b.item), ...prev]);
      // A few at a time so a big drop doesn't open dozens of requests.
      const queue = [...batch];
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, async () => {
          for (let next = queue.shift(); next; next = queue.shift()) await uploadOne(next.item, next.file);
        }),
      );
    },
    [uploadOne],
  );

  // Poll until every uploaded document has left uploaded/extracting.
  const waitingIds = items
    .filter((i) => i.id && (!i.doc || pendingStatuses.has(i.doc.status)))
    .map((i) => i.id!)
    .join(",");
  useEffect(() => {
    if (!waitingIds) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/documents/status?ids=${encodeURIComponent(waitingIds)}`);
        if (!res.ok) return;
        const { documents } = (await res.json()) as { documents: DocumentStatusDto[] };
        if (cancelled) return;
        const byId = new Map(documents.map((d) => [d.id, d]));
        setItems((prev) => prev.map((item) => (item.id && byId.has(item.id) ? { ...item, doc: byId.get(item.id) } : item)));
        if (documents.some((d) => !pendingStatuses.has(d.status))) router.refresh();
      } catch {
        // try again next tick
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waitingIds, router]);

  const reviewReady = items.filter((i) => i.doc?.status === "needs_review").length;

  return (
    <div className="space-y-6">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line-strong bg-paper px-6 py-16 text-center transition-colors outline-none hover:border-ink focus-visible:ring-3 focus-visible:ring-ring/50",
          dragging && "border-solid border-ink bg-solar-light",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-background">
          <UploadCloudIcon className="size-6" strokeWidth={1.5} />
        </span>
        <div>
          <p className="text-xl tracking-[-0.02em]">{dragging ? "Drop to upload" : "Drop invoices and credit memos here"}</p>
          <p className="mt-1 text-sm text-muted-foreground">PDF, PNG, JPEG, WebP or GIF, up to 20 MB each. One or many.</p>
        </div>
        <Button type="button" variant="ink" tabIndex={-1}>
          Browse files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <section>
          <div className="flex items-end justify-between border-b border-ink pb-2">
            <h2 className="text-base font-medium">This session&apos;s uploads</h2>
            {reviewReady > 0 && (
              <Button asChild size="sm">
                <Link href="/documents?status=needs_review">
                  Review {reviewReady} document{reviewReady === 1 ? "" : "s"}
                  <ArrowRightIcon />
                </Link>
              </Button>
            )}
          </div>
          <ul className="divide-y border-b">
            {items.map((item) => {
              const autoConfirmed = item.doc?.status === "confirmed" && !item.duplicate;
              return (
                <li key={item.key} className="flex flex-wrap items-center gap-3 py-3">
                  <FileTextIcon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.filename}</div>
                    <div className="text-xs leading-5 text-muted-foreground">
                      {formatSize(item.size)}
                      {item.duplicate && " · Already uploaded: showing the existing document"}
                      {item.doc?.type && (
                        <>
                          {" · "}
                          {TYPE_LABELS[item.doc.type]}
                          {item.doc.vendorName && ` from ${item.doc.vendorName}`}
                          {item.doc.documentNumber && ` · ${item.doc.documentNumber}`}
                          {item.doc.totalCents !== null &&
                            item.doc.currency &&
                            ` · ${formatCents(item.doc.totalCents, item.doc.currency)}`}
                        </>
                      )}
                    </div>
                    {(item.error || item.doc?.errorMessage) && (
                      <div className="mt-0.5 text-xs text-negative-ink">{item.error ?? item.doc?.errorMessage}</div>
                    )}
                    {item.doc?.status === "needs_review" && item.doc.issueCount > 0 && (
                      <div className="mt-0.5 text-xs text-warning-ink">
                        {item.doc.issueCount} issue{item.doc.issueCount === 1 ? "" : "s"} flagged for review
                      </div>
                    )}
                    {item.doc?.status === "needs_review" && item.doc.issueCount === 0 && item.doc.heldReason && (
                      <div className="mt-0.5 text-xs text-intel-ink">{item.doc.heldReason}</div>
                    )}
                    {autoConfirmed && <div className="mt-0.5 text-xs text-intel-ink">Confirmed by autopilot</div>}
                  </div>
                  {item.error ? (
                    <DocumentStatusBadge status="failed" />
                  ) : item.doc ? (
                    <DocumentStatusBadge status={item.doc.status} />
                  ) : (
                    <DocumentStatusBadge status="uploaded" className="opacity-70" />
                  )}
                  {item.id && item.doc && !pendingStatuses.has(item.doc.status) && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/documents/${item.id}`}>
                        {item.doc.status === "needs_review" ? "Review" : "Open"}
                        <ArrowRightIcon />
                      </Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
