import { AlertCircleIcon, CheckCircle2Icon, CircleDashedIcon, EyeIcon, LoaderIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DocumentStatusKey = "uploaded" | "extracting" | "needs_review" | "confirmed" | "failed";

const STYLES: Record<DocumentStatusKey, { label: string; className: string; Icon: typeof CheckCircle2Icon }> = {
  uploaded: { label: "Uploaded", className: "bg-muted text-muted-foreground", Icon: CircleDashedIcon },
  extracting: { label: "Extracting", className: "bg-sky-50 text-sky-900", Icon: LoaderIcon },
  needs_review: { label: "Needs review", className: "bg-amber-50 text-amber-900", Icon: EyeIcon },
  confirmed: { label: "Confirmed", className: "bg-emerald-50 text-emerald-900", Icon: CheckCircle2Icon },
  failed: { label: "Failed", className: "bg-red-50 text-red-900", Icon: AlertCircleIcon },
};

export function DocumentStatusBadge({ status, className }: { status: DocumentStatusKey; className?: string }) {
  const { label, className: tone, Icon } = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon className={cn("size-3", status === "extracting" && "animate-spin")} />
      {label}
    </span>
  );
}

export const TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  credit_memo: "Credit memo",
  other: "Other",
};
