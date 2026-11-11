"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateAutonomyAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUTONOMY_LABELS, AUTONOMY_LEVELS, type AutonomyLevel } from "@/lib/autonomy";
import { cn } from "@/lib/utils";

/**
 * The autonomy slider: three stops, from "a person confirms everything" to
 * "clean documents confirm themselves". The stops are radio buttons drawn on a
 * track, so the keyboard and screen readers get a plain radio group.
 */
export function AutonomyForm({
  level: savedLevel,
  limit: savedLimit,
  currency,
}: {
  level: AutonomyLevel;
  /** The saved limit as a plain decimal string, e.g. "500.00". */
  limit: string;
  currency: string;
}) {
  const [level, setLevel] = useState<AutonomyLevel>(savedLevel);
  const [limit, setLimit] = useState(savedLimit);
  const [pending, start] = useTransition();
  const index = AUTONOMY_LEVELS.indexOf(level);
  const dirty = level !== savedLevel || (level === "auto_within_limit" && limit.trim() !== savedLimit);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await updateAutonomyAction({ level, limit });
          if (result.ok) toast.success(result.message ?? "Saved");
          else toast.error(result.error);
        });
      }}
    >
      <fieldset>
        <legend className="sr-only">How much should confirm without you?</legend>
        <div className="relative mx-[calc(100%/6)] mb-5 hidden h-4 sm:block" aria-hidden>
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-line" />
          <span
            className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-ink transition-[width] duration-200"
            style={{ width: `${(index / (AUTONOMY_LEVELS.length - 1)) * 100}%` }}
          />
          {AUTONOMY_LEVELS.map((key, i) => (
            <span
              key={key}
              className={cn(
                "absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition-all duration-200",
                i === index ? "size-4 bg-ink" : i < index ? "size-2 bg-ink" : "size-2 bg-line-strong",
              )}
              style={{ left: `${(i / (AUTONOMY_LEVELS.length - 1)) * 100}%` }}
            >
              {i === index && <span className="size-1.5 rounded-full bg-solar" />}
            </span>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {AUTONOMY_LEVELS.map((key, i) => {
            const selected = key === level;
            return (
              <label
                key={key}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-4 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/40",
                  selected ? "border-ink bg-paper" : "hover:border-line-strong",
                )}
              >
                <input
                  type="radio"
                  name="level"
                  value={key}
                  checked={selected}
                  onChange={() => setLevel(key)}
                  className="sr-only"
                />
                <span className="flex items-center justify-between">
                  <span className="eyebrow">{["Off", "Guarded", "Full"][i]}</span>
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full border",
                      selected ? "border-ink bg-ink" : "border-line-strong",
                    )}
                    aria-hidden
                  >
                    {selected && <span className="size-1.5 rounded-full bg-solar" />}
                  </span>
                </span>
                <span className="text-base leading-6 tracking-[-0.01em]">{AUTONOMY_LABELS[key].name}</span>
                <span className="text-sm leading-5 text-muted-foreground">{AUTONOMY_LABELS[key].description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {level === "auto_within_limit" && (
        <div className="grid max-w-xs gap-1.5">
          <Label htmlFor="limit">Confirm automatically up to</Label>
          <div className="relative">
            <Input
              id="limit"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="pr-14 text-right tabular-nums"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              {currency}
            </span>
          </div>
          <p className="text-xs leading-4 text-muted-foreground">
            Per document, in {currency}. Documents in other currencies always wait for a person, because amounts are
            never converted.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {dirty ? "Applies to documents read from now on. The change is recorded in Activity." : "No unsaved changes."}
        </span>
      </div>
    </form>
  );
}
