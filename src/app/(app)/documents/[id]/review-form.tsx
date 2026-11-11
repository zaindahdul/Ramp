"use client";

import { AlertTriangleIcon, CheckIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmDocumentAction } from "@/app/(app)/actions";
import type { InvoiceOption } from "@/components/credit-controls";
import { SourceQuote, SystemNote } from "@/components/system-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CREDIT_STATUS_LABELS, CREDIT_STATUSES, type ConfirmInput } from "@/lib/confirm";
import { formatCents, isCurrencyCode, parseMoneyToCents } from "@/lib/money";
import { CREDIT_REASONS, REASON_LABELS } from "@/lib/reasons";
import { TOTALS_TOLERANCE_CENTS } from "@/lib/review";
import { cn } from "@/lib/utils";

interface Props {
  documentId: string;
  initial: ConfirmInput;
  alreadyConfirmed: boolean;
  matchedVendor: string | null;
  invoiceOptions: InvoiceOption[];
  /** The printed text each field was read from, keyed by form field. */
  evidence: Partial<Record<keyof ConfirmInput, string>>;
  /** Why the credit got its reason, as decided at extraction. */
  reasonBasis: string | null;
  /** The linker's last decision, in a sentence. Null before the first confirmation. */
  linkRationale: string | null;
  /** True when a person chose the link (or chose none), so it isn't shown as a system decision. */
  linkIsManual: boolean;
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-negative-ink">{message}</p> : null;
}

function Group({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b pb-1.5">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ReviewForm({
  documentId,
  initial,
  alreadyConfirmed,
  matchedVendor,
  invoiceOptions,
  evidence,
  reasonBasis,
  linkRationale,
  linkIsManual,
}: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState<ConfirmInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateOfId, setDuplicateOfId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof ConfirmInput>(key: K, value: ConfirmInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setLine = (index: number, key: keyof ConfirmInput["lineItems"][number], value: string) =>
    setForm((f) => ({
      ...f,
      lineItems: f.lineItems.map((line, i) => (i === index ? { ...line, [key]: value } : line)),
    }));

  const currency = isCurrencyCode(form.currency.trim().toUpperCase()) ? form.currency.trim().toUpperCase() : "USD";
  // Live version of the review check: lines (+ tax) should equal the total within a cent.
  const check = useMemo(() => {
    const totals = form.lineItems.map((l) => parseMoneyToCents(l.lineTotal, currency));
    if (form.lineItems.length === 0 || totals.some((t) => t === null)) return null;
    const lineSum = totals.reduce<number>((s, t) => s + (t ?? 0), 0);
    const tax = parseMoneyToCents(form.tax, currency) ?? 0;
    const total = parseMoneyToCents(form.total, currency);
    if (total === null) return null;
    return { lineSum, tax, total, ok: Math.abs(lineSum + tax - total) <= TOTALS_TOLERANCE_CENTS };
  }, [form.lineItems, form.tax, form.total, currency]);

  const isCredit = form.type === "credit_memo";
  const candidates = invoiceOptions.filter((o) => o.candidate);
  const others = invoiceOptions.filter((o) => !o.candidate);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const reasonUnchanged = form.creditReason === initial.creditReason;

  const submit = () =>
    start(async () => {
      setErrors({});
      setDuplicateOfId(null);
      const result = await confirmDocumentAction(documentId, form);
      if (result.ok) {
        toast.success(alreadyConfirmed ? "Changes saved" : "Document confirmed");
        router.refresh();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setDuplicateOfId(result.duplicateOfId ?? null);
      toast.error(result.error);
    });

  // Cmd/Ctrl + Enter confirms from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const text = (key: keyof ConfirmInput, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid min-w-0 content-start gap-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={Boolean(errors[key])}
        {...props}
      />
      {evidence[key] && form[key] === initial[key] && <SourceQuote quote={evidence[key]} />}
      <FieldError message={errors[key]} />
    </div>
  );

  return (
    <form
      ref={formRef}
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) submit();
      }}
    >
      <Group title="Document">
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <div className="grid min-w-0 content-start gap-1.5">
            <Label>Document type</Label>
            <Select value={form.type} onValueChange={(v) => set("type", v as ConfirmInput["type"])}>
              <SelectTrigger className="w-full" aria-label="Document type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">Invoice</SelectItem>
                <SelectItem value="credit_memo">Credit memo</SelectItem>
                <SelectItem value="other">Other (not counted)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <Label htmlFor="vendorName">Vendor</Label>
            <Input
              id="vendorName"
              value={form.vendorName}
              onChange={(e) => set("vendorName", e.target.value)}
              aria-invalid={Boolean(errors.vendorName)}
            />
            {form.vendorName === initial.vendorName && matchedVendor ? (
              <p className="text-xs leading-4 text-muted-foreground">
                Matches your vendor <span className="text-foreground">{matchedVendor}</span>
              </p>
            ) : (
              form.vendorName.trim() &&
              form.vendorName === initial.vendorName && (
                <p className="text-xs leading-4 text-warning-ink">New vendor, created when you confirm</p>
              )
            )}
            {evidence.vendorName && form.vendorName === initial.vendorName && <SourceQuote quote={evidence.vendorName} />}
            <FieldError message={errors.vendorName} />
          </div>
          {text("documentNumber", isCredit ? "Credit memo number" : "Invoice number", { className: "font-mono" })}
          {text("currency", "Currency", { maxLength: 3, className: "font-mono uppercase", placeholder: "USD" })}
          {text("documentDate", "Document date", { type: "date" })}
          {text("dueDate", "Due date", { type: "date" })}
          <div className="sm:col-span-2">{text("paymentTerms", "Payment terms", { placeholder: "Net 30" })}</div>
        </div>
      </Group>

      <Group
        title="Line items"
        action={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => set("lineItems", [...form.lineItems, { description: "", quantity: "", unitPrice: "", lineTotal: "" }])}
          >
            <PlusIcon /> Add line
          </Button>
        }
      >
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="pb-1.5 text-left font-normal">Description</th>
                <th className="w-20 pb-1.5 pl-2 text-right font-normal">Qty</th>
                <th className="w-28 pb-1.5 pl-2 text-right font-normal">Unit price</th>
                <th className="w-28 pb-1.5 pl-2 text-right font-normal">Line total</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {form.lineItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-xs text-muted-foreground">
                    No line items were read from this document.
                  </td>
                </tr>
              )}
              {form.lineItems.map((line, i) => (
                <tr key={i}>
                  <td className="py-1">
                    <Input
                      aria-label={`Line ${i + 1} description`}
                      value={line.description}
                      onChange={(e) => setLine(i, "description", e.target.value)}
                      aria-invalid={Boolean(errors[`lineItems.${i}.description`])}
                    />
                  </td>
                  {(["quantity", "unitPrice", "lineTotal"] as const).map((key) => (
                    <td key={key} className="py-1 pl-2">
                      <Input
                        aria-label={`Line ${i + 1} ${key}`}
                        value={line[key]}
                        inputMode="decimal"
                        onChange={(e) => setLine(i, key, e.target.value)}
                        aria-invalid={Boolean(errors[`lineItems.${i}.${key}`])}
                        className="text-right tabular-nums"
                      />
                    </td>
                  ))}
                  <td className="py-1 pl-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => set("lineItems", form.lineItems.filter((_, j) => j !== i))}
                    >
                      <XIcon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Group>

      <Group title="Totals">
        <div className="grid gap-4 sm:grid-cols-3">
          {text("subtotal", "Subtotal", { inputMode: "decimal", className: "text-right tabular-nums" })}
          {text("tax", "Tax", { inputMode: "decimal", className: "text-right tabular-nums" })}
          {text("total", "Total", { inputMode: "decimal", className: "text-right font-medium tabular-nums" })}
        </div>
        {check && (
          <p
            className={cn(
              "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm leading-5",
              check.ok ? "bg-positive-soft text-positive-ink" : "bg-warning-soft text-warning-ink",
            )}
          >
            {check.ok ? <CheckIcon className="mt-0.5 size-4 shrink-0" /> : <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />}
            <span>
              {check.tax !== 0
                ? `Lines ${formatCents(check.lineSum, currency)} + tax ${formatCents(check.tax, currency)} = ${formatCents(check.lineSum + check.tax, currency)}`
                : `Lines add up to ${formatCents(check.lineSum, currency)}`}
              {check.ok ? ", matching the total." : `, but the total is ${formatCents(check.total, currency)}.`}
            </span>
          </p>
        )}
      </Group>

      {isCredit && (
        <Group title="Credit">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-1.5 sm:col-span-2">
              <Label htmlFor="statedReason">Reason as stated on the document</Label>
              <Textarea
                id="statedReason"
                rows={2}
                value={form.statedReason}
                onChange={(e) => set("statedReason", e.target.value)}
              />
            </div>
            <div className="grid min-w-0 content-start gap-1.5">
              <Label>Reason</Label>
              <Select value={form.creditReason ?? "other"} onValueChange={(v) => set("creditReason", v as ConfirmInput["creditReason"])}>
                <SelectTrigger className="w-full" aria-label="Credit reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREDIT_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 content-start gap-1.5">
              <Label>Status</Label>
              <Select value={form.creditStatus ?? "open"} onValueChange={(v) => set("creditStatus", v as ConfirmInput["creditStatus"])}>
                <SelectTrigger className="w-full" aria-label="Credit status">
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
            </div>
            {reasonBasis && reasonUnchanged && (
              <SystemNote by="Reason rules" className="sm:col-span-2">
                {reasonBasis}
              </SystemNote>
            )}
            {text("referencedInvoiceNumber", "Invoice number printed on the memo", { className: "font-mono" })}
            <div className="grid min-w-0 content-start gap-1.5">
              <Label>Corrects invoice</Label>
              <Select value={form.link} onValueChange={(v) => set("link", v)}>
                <SelectTrigger className="w-full" aria-label="Linked invoice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Link automatically</SelectItem>
                  <SelectItem value="none">Doesn&apos;t correct an invoice</SelectItem>
                  {candidates.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Equally good matches</SelectLabel>
                        {candidates.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Invoices from this vendor</SelectLabel>
                        {others.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            {linkRationale && form.link === initial.link ? (
              linkIsManual ? (
                <p className="text-sm text-muted-foreground sm:col-span-2">{linkRationale}</p>
              ) : (
                <SystemNote by="Linker" className="sm:col-span-2">
                  {linkRationale}
                </SystemNote>
              )
            ) : (
              form.link === "auto" && (
                <p className="text-xs leading-4 text-muted-foreground sm:col-span-2">
                  Automatic linking uses the invoice number printed on the memo first, then same-vendor invoices from the
                  180 days before it. If several fit equally well, it asks you instead of guessing.
                </p>
              )
            )}
          </div>
        </Group>
      )}

      {duplicateOfId && (
        <p className="rounded-lg bg-negative-soft px-3 py-2.5 text-sm text-negative-ink">
          This matches a document already on file.{" "}
          <Link href={`/documents/${duplicateOfId}`} className="font-medium underline underline-offset-4">
            Open the other one
          </Link>
          , or delete this copy.
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur-sm">
        <Button type="submit" size="lg" disabled={pending || (alreadyConfirmed && !dirty)}>
          <CheckIcon />
          {pending ? "Saving…" : alreadyConfirmed ? "Save changes" : "Confirm"}
        </Button>
        <kbd className="hidden rounded border bg-paper px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline">
          Ctrl/⌘ + Enter
        </kbd>
        {Object.keys(errors).length > 0 ? (
          <span className="text-sm text-negative-ink">
            Fix the {Object.keys(errors).length === 1 ? "highlighted field" : `${Object.keys(errors).length} highlighted fields`}.
          </span>
        ) : (
          !alreadyConfirmed && (
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {dirty ? "Your corrections are recorded." : "Confirms the fields as read."}
            </span>
          )
        )}
      </div>
    </form>
  );
}

export function DeleteDocumentButton({ action }: { action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      className="text-negative-ink hover:bg-negative-soft hover:text-negative-ink"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Delete this document? This can't be undone.")) start(() => action());
      }}
    >
      <Trash2Icon />
      Delete
    </Button>
  );
}
