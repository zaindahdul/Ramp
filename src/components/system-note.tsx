import { SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Something the system decided, with its reason. Always blue, so it is never
 * mistaken for a person's choice; the label names which part decided.
 */
export function SystemNote({
  by,
  children,
  className,
}: {
  /** "Linker", "Reason rules", "Extraction", "Autopilot". */
  by: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2.5 rounded-lg bg-intel-soft px-3 py-2.5 text-sm leading-5 text-ink", className)}>
      <SparklesIcon className="mt-0.5 size-4 shrink-0 text-intel-ink" aria-hidden />
      <p className="min-w-0">
        <span className="font-medium text-intel-ink">{by}. </span>
        {children}
      </p>
    </div>
  );
}

/** The words on the document a value was read from. */
export function SourceQuote({ quote, className }: { quote: string; className?: string }) {
  return (
    <p className={cn("flex min-w-0 items-baseline gap-1.5 text-xs leading-4 text-intel-ink", className)}>
      <span className="shrink-0 text-[10px] font-medium tracking-[0.1em] uppercase">Source</span>
      <span className="line-clamp-2 min-w-0 font-mono break-words" title={quote}>
        {quote}
      </span>
    </p>
  );
}
