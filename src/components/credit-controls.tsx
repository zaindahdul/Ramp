"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setCreditLinkAction, setCreditStatusAction, type ActionResult } from "@/app/(app)/actions";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CREDIT_STATUS_LABELS, CREDIT_STATUSES, type CreditStatusKey } from "@/lib/confirm";
import { cn } from "@/lib/utils";

function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, success?: string) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error);
      else if (success) toast.success(success);
    });
  return { pending, run };
}

export function CreditStatusSelect({ documentId, value }: { documentId: string; value: CreditStatusKey }) {
  const { pending, run } = useAction();
  return (
    <Select
      value={value}
      disabled={pending}
      onValueChange={(next) => run(() => setCreditStatusAction(documentId, next), `Marked ${CREDIT_STATUS_LABELS[next as CreditStatusKey].toLowerCase()}`)}
    >
      <SelectTrigger size="sm" aria-label="Credit status" className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CREDIT_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {CREDIT_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface InvoiceOption {
  id: string;
  label: string;
  candidate: boolean;
}

/** Pick the invoice an unlinked credit corrects. Tied candidates are listed first. */
export function CreditLinkSelect({
  documentId,
  options,
  className,
}: {
  documentId: string;
  options: InvoiceOption[];
  className?: string;
}) {
  const { pending, run } = useAction();
  const candidates = options.filter((o) => o.candidate);
  const others = options.filter((o) => !o.candidate);
  return (
    <Select disabled={pending} onValueChange={(next) => run(() => setCreditLinkAction(documentId, next), "Credit linked")}>
      <SelectTrigger size="sm" aria-label="Link to invoice" className={cn("min-w-52", className)}>
        <SelectValue placeholder={candidates.length > 0 ? `Pick from ${candidates.length} matches…` : "Pick an invoice…"} />
      </SelectTrigger>
      <SelectContent>
        {candidates.length > 0 && (
          <SelectGroup>
            <SelectLabel>Equally good matches</SelectLabel>
            {candidates.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {candidates.length > 0 && others.length > 0 && <SelectSeparator />}
        {others.length > 0 && (
          <SelectGroup>
            <SelectLabel>Other invoices from this vendor</SelectLabel>
            {others.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectSeparator />
        <SelectItem value="none">Doesn&apos;t correct an invoice</SelectItem>
      </SelectContent>
    </Select>
  );
}
