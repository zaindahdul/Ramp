import { LinkSegments } from "@/components/link-tabs";
import { todayUtc } from "@/lib/dates";
import { PERIOD_KEYS, periodRange, type PeriodKey } from "@/lib/period";

/** Period and currency pickers as plain links, so filtered views are shareable URLs. */
export function ScorecardFilters({
  period,
  currency,
  currencies,
  hrefFor,
}: {
  period: PeriodKey;
  currency: string;
  currencies: string[];
  hrefFor: (patch: { period?: PeriodKey; currency?: string }) => string;
}) {
  const today = todayUtc();
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <LinkSegments
        label="Period"
        active={period}
        options={PERIOD_KEYS.map((key) => ({ key, label: periodRange(key, today).label, href: hrefFor({ period: key }) }))}
      />
      {currencies.length > 1 && (
        <LinkSegments
          label="Currency"
          active={currency}
          mono
          options={currencies.map((c) => ({ key: c, label: c, href: hrefFor({ currency: c }) }))}
        />
      )}
    </div>
  );
}
