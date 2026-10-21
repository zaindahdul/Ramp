"use client";

import { AlertTriangleIcon, CheckCircle2Icon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmDocumentAction } from "@/app/(app)/actions";
import type { InvoiceOption } from "@/components/credit-controls";
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
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-red-700">{message}</p> : null;
}

export function ReviewForm({ documentId, initial, alreadyConfirmed, matchedVendor, invoiceOptions }: Props) {
  const router = useRouter();
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

  const text = (key: keyof ConfirmInput, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={Boolean(errors[key])}
        {...props}
      />
      <FieldError message={errors[key]} />
    </div>
  );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
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
        <div className="grid gap-1.5">
          <Label htmlFor="vendorName">Vendor</Label>
          <Input
            id="vendorName"
            value={form.vendorName}
            onChange={(e) => set("vendorName", e.target.value)}
            aria-invalid={Boolean(errors.vendorName)}
          />
          {matchedVendor ? (
            <p className="text-xs text-muted-foreground">
              Matches existing vendor <span className="font-medium text-foreground">{matchedVendor}</span>
            </p>
          ) : (
            form.vendorName.trim() && <p className="text-xs text-muted-foreground">New vendor: created on confirm</p>
          )}
          <FieldError message={errors.vendorName} />
        </div>
        {text("documentNumber", isCredit ? "Credit memo number" : "Invoice number", { className: "font-mono" })}
        {text("currency", "Currency", { maxLength: 3, className: "uppercase", placeholder: "USD" })}
        {text("documentDate", "Document date", { type: "date" })}
        {text("dueDate", "Due date", { type: "date" })}
        <div className="sm:col-span-2">{text("paymentTerms", "Payment terms", { placeholder: "Net 30" })}</div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Line items</h3>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              set("lineItems", [...form.lineItems, { description: "", quantity: "", unitPrice: "", lineTotal: "" }])
            }
          >
            <PlusIcon /> Add line
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Description</th>
                <th className="w-20 px-2 py-1.5 text-right font-medium">Qty</th>
                <th className="w-28 px-2 py-1.5 text-right font-medium">Unit price</th>
                <th className="w-28 px-2 py-1.5 text-right font-medium">Line total</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {form.lineItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-xs text-muted-foreground">
                    No line items extracted.
                  </td>
                </tr>
              )}
              {form.lineItems.map((line, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">
                    <Input
                      aria-label={`Line ${i + 1} description`}
                      value={line.description}
                      onChange={(e) => setLine(i, "description", e.target.value)}
                      aria-invalid={Boolean(errors[`lineItems.${i}.description`])}
                      className="h-7"
                    />
                  </td>
                  {(["quantity", "unitPrice", "lineTotal"] as const).map((key) => (
                    <td key={key} className="p-1">
                      <Input
                        aria-label={`Line ${i + 1} ${key}`}
                        value={line[key]}
                        inputMode="decimal"
                        onChange={(e) => setLine(i, key, e.target.value)}
                        aria-invalid={Boolean(errors[`lineItems.${i}.${key}`])}
                        className="h-7 text-right tabular-nums"
                      />
                    </td>
                  ))}
                  <td className="p-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
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
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {text("subtotal", "Subtotal", { inputMode: "decimal", className: "text-right tabular-nums" })}
        {text("tax", "Tax", { inputMode: "decimal", className: "text-right tabular-nums" })}
        {text("total", "Total", { inputMode: "decimal", className: "text-right font-medium tabular-nums" })}
        {check && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm sm:col-span-3",
              check.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900",
            )}
          >
            {check.ok ? <CheckCircle2Icon className="size-4" /> : <AlertTriangleIcon className="size-4" />}
            {check.tax !== 0
              ? `Lines ${formatCents(check.lineSum, currency)} + tax ${formatCents(check.tax, currency)} = ${formatCents(check.lineSum + check.tax, currency)}`
              : `Lines add up to ${formatCents(check.lineSum, currency)}`}
            {check.ok ? ", matching the total." : `, but the total is ${formatCents(check.total, currency)}.`}
          </div>
        )}
      </section>

      {isCredit && (
        <section className="space-y-4 rounded-xl border bg-muted/30 p-4">
          <h3 className="text-sm font-medium">Credit memo</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("referencedInvoiceNumber", "Referenced invoice number", { className: "font-mono" })}
            <div className="grid gap-1.5">
              <Label>Reason</Label>
              <Select
                value={form.creditReason ?? "other"}
                onValueChange={(v) => set("creditReason", v as ConfirmInput["creditReason"])}
              >
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
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="statedReason">Reason as stated on the document</Label>
              <Textarea
                id="statedReason"
                rows={2}
                value={form.statedReason}
                onChange={(e) => set("statedReason", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={form.creditStatus ?? "open"}
                onValueChange={(v) => set("creditStatus", v as ConfirmInput["creditStatus"])}
              >
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
            <div className="grid gap-1.5">
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
              <p className="text-xs text-muted-foreground">
                Automatic linking uses the referenced invoice number first, then the 180-day window, amount and line items.
              </p>
            </div>
          </div>
        </section>
      )}

      {duplicateOfId && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          This matches an existing document.{" "}
          <Link href={`/documents/${duplicateOfId}`} className="font-medium underline">
            Open the other one
          </Link>
          , or delete this copy.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={pending}>
          <CheckCircle2Icon />
          {pending ? "Saving…" : alreadyConfirmed ? "Save changes" : "Confirm"}
        </Button>
        {Object.keys(errors).length > 0 && (
          <span className="text-sm text-red-700">Fix {Object.keys(errors).length} highlighted field(s).</span>
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
      size="sm"
      className="text-red-700 hover:text-red-800"
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
