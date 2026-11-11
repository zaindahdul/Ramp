import { Undo2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The product mark: money coming back, on solar. */
export function Brand({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md bg-solar text-ink",
          size === "lg" ? "size-9" : "size-7",
        )}
        aria-hidden
      >
        <Undo2Icon className={size === "lg" ? "size-5" : "size-4"} strokeWidth={2.25} />
      </span>
      <span className={cn("tracking-[-0.02em]", size === "lg" ? "text-xl" : "text-[15px] font-medium")}>Credit Recovery</span>
    </span>
  );
}
