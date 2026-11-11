import { cn } from "@/lib/utils";

export type DocumentStatusKey = "uploaded" | "extracting" | "needs_review" | "confirmed" | "failed";

const STYLES: Record<DocumentStatusKey, { label: string; dot: string }> = {
  uploaded: { label: "Queued", dot: "bg-line-strong" },
  extracting: { label: "Reading", dot: "bg-intel animate-pulse" },
  needs_review: { label: "Needs review", dot: "bg-warning" },
  confirmed: { label: "Confirmed", dot: "bg-positive" },
  failed: { label: "Failed", dot: "bg-negative" },
};

/** A neutral pill with a colored dot. The color carries the state; the pill stays quiet. */
export function Pill({
  dot,
  children,
  className,
}: {
  dot?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full bg-paper px-2 text-xs whitespace-nowrap text-ink",
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />}
      {children}
    </span>
  );
}

export function DocumentStatusBadge({ status, className }: { status: DocumentStatusKey; className?: string }) {
  const { label, dot } = STYLES[status];
  return (
    <Pill dot={dot} className={className}>
      {label}
    </Pill>
  );
}

export const TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  credit_memo: "Credit memo",
  other: "Other",
};
