import { addDays, type PlainDate } from "@/lib/dates";

export const PERIOD_KEYS = ["90d", "365d", "ytd"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface Period {
  key: PeriodKey;
  start: PlainDate;
  end: PlainDate;
  /** For filters: "Last 90 days". */
  label: string;
  /** For sentences: "in the last 12 months". */
  phrase: string;
}

export function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === "string" && (PERIOD_KEYS as readonly string[]).includes(value);
}

/** Inclusive date range ending today. "Last 90 days" is today and the 89 days before. */
export function periodRange(key: PeriodKey, today: PlainDate): Period {
  switch (key) {
    case "90d":
      return { key, start: addDays(today, -89), end: today, label: "Last 90 days", phrase: "in the last 90 days" };
    case "365d":
      return { key, start: addDays(today, -364), end: today, label: "Last 365 days", phrase: "in the last 12 months" };
    case "ytd":
      return { key, start: `${today.slice(0, 4)}-01-01`, end: today, label: "Year to date", phrase: "so far this year" };
  }
}

export function parsePeriod(value: unknown, fallback: PeriodKey = "365d"): PeriodKey {
  return isPeriodKey(value) ? value : fallback;
}
