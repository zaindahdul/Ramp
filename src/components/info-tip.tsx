import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A label with its definition on hover or focus. */
export function InfoTip({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-left decoration-dotted underline-offset-4 hover:underline">
          {label}
          <InfoIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-left leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}
