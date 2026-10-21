// Business dates (document date, due date) are plain calendar dates with no
// time zone. In application code they are "YYYY-MM-DD" strings; in Postgres they
// are DATE columns, which Prisma hands back as a Date at UTC midnight.

export type PlainDate = string;

const MS_PER_DAY = 86_400_000;
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPlainDate(value: string): value is PlainDate {
  const m = PLAIN_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Date (as returned for a DATE column) -> "YYYY-MM-DD". */
export function toPlainDate(date: Date): PlainDate {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> Date at UTC midnight, for writing to a DATE column. */
export function fromPlainDate(value: PlainDate): Date {
  if (!isPlainDate(value)) throw new Error(`Not a plain date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function todayUtc(now: Date = new Date()): PlainDate {
  return now.toISOString().slice(0, 10);
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return toPlainDate(new Date(fromPlainDate(date).getTime() + days * MS_PER_DAY));
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: PlainDate, to: PlainDate): number {
  return Math.round((fromPlainDate(to).getTime() - fromPlainDate(from).getTime()) / MS_PER_DAY);
}

export function monthKey(date: PlainDate): string {
  return date.slice(0, 7);
}

/** The `count` calendar months ending with the month of `today`, oldest first. */
export function lastMonths(today: PlainDate, count: number): string[] {
  const [y, m] = today.split("-").map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

export function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function formatPlainDate(date: PlainDate | null | undefined): string {
  if (!date) return "—";
  return fromPlainDate(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function isWithin(date: PlainDate, start: PlainDate, end: PlainDate): boolean {
  return date >= start && date <= end;
}
