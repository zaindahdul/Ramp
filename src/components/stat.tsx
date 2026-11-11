import { cn } from "@/lib/utils";

/** A metric on a paper tile: tracked label, light display figure, optional detail line. */
export function Stat({
  label,
  value,
  detail,
  tone = "paper",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "paper" | "plain";
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl p-4", tone === "paper" ? "bg-paper" : "border", className)}>
      <div className="eyebrow">{label}</div>
      <div className="figure mt-2 text-[28px] leading-8">{value}</div>
      {detail && <div className="mt-1 text-xs leading-4 text-muted-foreground">{detail}</div>}
    </div>
  );
}
