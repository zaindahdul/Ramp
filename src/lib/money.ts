// Money is always an integer count of minor units ("cents") plus an ISO 4217
// currency code. Nothing here multiplies or divides by 100 using floats: parsing
// and formatting work on decimal strings.

export type Cents = number;

export interface MoneyAmount {
  currency: string;
  cents: Cents;
}

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of cents, got ${value}`);
  }
}

const minorDigitsCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (2 for USD, 0 for JPY). */
export function minorUnitDigits(currency: string): number {
  const code = currency.toUpperCase();
  const cached = minorDigitsCache.get(code);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  minorDigitsCache.set(code, digits);
  return digits;
}

export function isCurrencyCode(value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses a human or model-written amount ("$1,234.56", "(12.50)", "1.234,56",
 * "-7") into integer minor units. Returns null when the text is not an amount.
 * Rounds half away from zero past the currency's minor-unit digits.
 */
export function parseMoneyToCents(
  input: string | number | null | undefined,
  currency = "USD",
): Cents | null {
  if (input === null || input === undefined) return null;
  let text = typeof input === "number" ? numberToPlainString(input) : input;
  text = text.trim();
  if (text === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  // Strip currency symbols, codes and spaces.
  text = text.replace(/[A-Za-z$€£¥₹\s ]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (text.startsWith("+")) text = text.slice(1);
  if (!/^[\d.,']+$/.test(text) || !/\d/.test(text)) return null;
  text = text.replace(/'/g, "");

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let whole: string;
  let fraction: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever separator comes last is the decimal separator.
    const decimalAt = Math.max(lastDot, lastComma);
    whole = text.slice(0, decimalAt).replace(/[.,]/g, "");
    fraction = text.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    const after = text.slice(lastComma + 1);
    const commaCount = text.split(",").length - 1;
    if (commaCount === 1 && after.length !== 3) {
      // "12,5" or "12,50": decimal comma.
      whole = text.slice(0, lastComma);
      fraction = after;
    } else {
      whole = text.replace(/,/g, "");
      fraction = "";
    }
  } else if (lastDot >= 0) {
    const dotCount = text.split(".").length - 1;
    if (dotCount > 1) {
      // "1.234.567": dots as thousands separators.
      whole = text.replace(/\./g, "");
      fraction = "";
    } else {
      whole = text.slice(0, lastDot);
      fraction = text.slice(lastDot + 1);
    }
  } else {
    whole = text;
    fraction = "";
  }
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;

  const digits = minorUnitDigits(currency);
  const kept = fraction.slice(0, digits).padEnd(digits, "0");
  const roundingDigit = fraction.length > digits ? Number(fraction[digits]) : 0;
  let cents = Number((whole || "0") + kept);
  if (roundingDigit >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) return "";
  // toFixed(6) avoids exponent notation; the parser rounds the extra digits.
  return value.toFixed(6);
}

/** "123456" cents -> "1234.56" (no grouping, no symbol). Exact. */
export function centsToDecimalString(cents: Cents, currency = "USD"): string {
  assertCents(cents);
  const digits = minorUnitDigits(currency);
  const negative = cents < 0;
  const abs = String(Math.abs(cents));
  if (digits === 0) return (negative ? "-" : "") + abs;
  const padded = abs.padStart(digits + 1, "0");
  const whole = padded.slice(0, padded.length - digits);
  const fraction = padded.slice(padded.length - digits);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, wholeUnits: boolean): Intl.NumberFormat {
  const key = `${currency}:${wholeUnits}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(wholeUnits ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    });
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Formats integer cents for display: formatCents(1234567, "USD") -> "$12,345.67".
 * `wholeUnits` rounds to whole dollars for headline numbers and sentences.
 */
export function formatCents(
  cents: Cents,
  currency: string,
  options: { wholeUnits?: boolean } = {},
): string {
  assertCents(cents);
  const code = currency.toUpperCase();
  // Intl formats decimal strings exactly, so no float conversion happens here.
  const decimal = centsToDecimalString(cents, code) as `${number}`;
  return formatter(code, options.wholeUnits ?? false).format(decimal);
}

/** Groups amounts by currency and sums each group. Never converts currencies. */
export function totalsByCurrency(amounts: Iterable<MoneyAmount>): MoneyAmount[] {
  const sums = new Map<string, number>();
  for (const { currency, cents } of amounts) {
    assertCents(cents);
    const code = currency.toUpperCase();
    sums.set(code, (sums.get(code) ?? 0) + cents);
  }
  return [...sums.entries()]
    .map(([currency, cents]) => ({ currency, cents }))
    .sort((a, b) => b.cents - a.cents || a.currency.localeCompare(b.currency));
}

/** "$1,200.00 · €300.00", or "—" when there is nothing to show. */
export function formatTotals(
  totals: MoneyAmount[],
  options: { wholeUnits?: boolean } = {},
): string {
  if (totals.length === 0) return "—";
  return totals.map((t) => formatCents(t.cents, t.currency, options)).join(" · ");
}

/** Integer division rounded half away from zero, for averages of cents. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("division by zero");
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}
