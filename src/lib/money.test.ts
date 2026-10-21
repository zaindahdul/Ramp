import { describe, expect, it } from "vitest";
import {
  centsToDecimalString,
  divRound,
  formatCents,
  formatTotals,
  parseMoneyToCents,
  totalsByCurrency,
} from "@/lib/money";

describe("parseMoneyToCents", () => {
  it.each([
    ["1234.56", 123456],
    ["$1,234.56", 123456],
    ["1,234", 123400],
    ["1234", 123400],
    ["0.5", 50],
    [".99", 99],
    ["-12.50", -1250],
    ["(12.50)", -1250],
    ["12.50-", -1250],
    ["USD 99.10", 9910],
    ["1.234,56", 123456],
    ["12,5", 1250],
    ["1.234.567", 123456700],
    ["10.005", 1001],
    ["10.004", 1000],
    ["0", 0],
  ])("parses %s", (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  it("returns null for non-amounts", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents("1-2")).toBeNull();
  });

  it("parses JS numbers without float drift", () => {
    expect(parseMoneyToCents(0.1 + 0.2)).toBe(30);
    expect(parseMoneyToCents(19.99)).toBe(1999);
  });

  it("respects zero-decimal currencies", () => {
    expect(parseMoneyToCents("1,200", "JPY")).toBe(1200);
    expect(parseMoneyToCents("1200.6", "JPY")).toBe(1201);
  });
});

describe("formatting", () => {
  it("formats cents exactly", () => {
    expect(formatCents(123456, "USD")).toBe("$1,234.56");
    expect(formatCents(-1250, "USD")).toBe("-$12.50");
    expect(formatCents(5, "USD")).toBe("$0.05");
    expect(formatCents(100, "EUR")).toBe("€1.00");
    expect(formatCents(1200, "JPY")).toBe("¥1,200");
  });

  it("rounds to whole units for headlines", () => {
    expect(formatCents(12040050, "USD", { wholeUnits: true })).toBe("$120,401");
  });

  it("keeps precision beyond float-friendly sizes", () => {
    expect(centsToDecimalString(900719925474099)).toBe("9007199254740.99");
    expect(formatCents(900719925474099, "USD")).toBe("$9,007,199,254,740.99");
  });

  it("rejects non-integer cents", () => {
    expect(() => formatCents(10.5, "USD")).toThrow();
  });
});

describe("totalsByCurrency", () => {
  it("groups and sums without converting", () => {
    const totals = totalsByCurrency([
      { currency: "USD", cents: 1000 },
      { currency: "EUR", cents: 500 },
      { currency: "usd", cents: 250 },
      { currency: "GBP", cents: 500 },
    ]);
    expect(totals).toEqual([
      { currency: "USD", cents: 1250 },
      { currency: "EUR", cents: 500 },
      { currency: "GBP", cents: 500 },
    ]);
    expect(formatTotals(totals)).toBe("$12.50 · €5.00 · £5.00");
  });

  it("handles nothing", () => {
    expect(totalsByCurrency([])).toEqual([]);
    expect(formatTotals([])).toBe("—");
  });
});

describe("divRound", () => {
  it("rounds half away from zero using integers", () => {
    expect(divRound(10, 4)).toBe(3);
    expect(divRound(10, 3)).toBe(3);
    expect(divRound(-10, 4)).toBe(-3);
    expect(divRound(7, 2)).toBe(4);
    expect(() => divRound(1, 0)).toThrow();
  });
});
