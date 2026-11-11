import { cn } from "@/lib/utils";

/**
 * The top of every page: a solar dash, an optional eyebrow, the title in
 * regular weight, then actions on the right.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0">
        <span className="accent-dash" aria-hidden />
        {eyebrow && <p className="eyebrow mt-4">{eyebrow}</p>}
        <h1 className={cn("text-[28px] leading-9 font-normal text-balance", eyebrow ? "mt-1" : "mt-4")}>{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </header>
  );
}

/** A titled block inside a page: eyebrow-sized label, optional note and actions, hairline under. */
export function Section({
  title,
  note,
  actions,
  children,
  className,
  id,
}: {
  title: React.ReactNode;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-8", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-ink pb-2">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-medium">{title}</h2>
          {note && <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{note}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
