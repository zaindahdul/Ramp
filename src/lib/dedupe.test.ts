import { describe, expect, it } from "vitest";
import {
  dedupeKey,
  findDuplicate,
  normalizeDocumentNumber,
  sha256Hex,
  vendorKeyFor,
} from "@/lib/dedupe";

describe("normalizeDocumentNumber", () => {
  it("ignores case, spaces, separators and a leading #", () => {
    expect(normalizeDocumentNumber("INV-1001")).toBe("INV1001");
    expect(normalizeDocumentNumber(" inv 1001 ")).toBe("INV1001");
    expect(normalizeDocumentNumber("#INV/1001")).toBe("INV1001");
    expect(normalizeDocumentNumber("No. 55")).toBe("55");
  });

  it("returns null for empty values", () => {
    expect(normalizeDocumentNumber("")).toBeNull();
    expect(normalizeDocumentNumber("  - ")).toBeNull();
    expect(normalizeDocumentNumber(null)).toBeNull();
  });
});

describe("file duplicates", () => {
  it("hashes identical bytes to the same sha256", () => {
    const a = new TextEncoder().encode("%PDF-1.7 same bytes");
    const b = new TextEncoder().encode("%PDF-1.7 same bytes");
    const c = new TextEncoder().encode("%PDF-1.7 other bytes");
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(sha256Hex(a)).not.toBe(sha256Hex(c));
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("record duplicates", () => {
  const existing = [
    { id: "d1", vendorKey: "v:acme", documentNumber: "INV-1001", currency: "USD", totalCents: 120000 },
    { id: "d2", vendorKey: "v:acme", documentNumber: "INV-1002", currency: "USD", totalCents: 50000 },
    { id: "d3", vendorKey: "v:globex", documentNumber: "INV-1001", currency: "USD", totalCents: 120000 },
  ];

  it("finds the same vendor + number + amount", () => {
    const dup = findDuplicate(
      { id: "new", vendorKey: "v:acme", documentNumber: "inv 1001", currency: "usd", totalCents: 120000 },
      existing,
    );
    expect(dup?.id).toBe("d1");
  });

  it("does not flag a different amount, vendor or currency", () => {
    const base = { id: "new", vendorKey: "v:acme", documentNumber: "INV-1001", currency: "USD", totalCents: 120000 };
    expect(findDuplicate({ ...base, totalCents: 120001 }, existing)).toBeNull();
    expect(findDuplicate({ ...base, vendorKey: "v:initech" }, existing)).toBeNull();
    expect(findDuplicate({ ...base, currency: "EUR" }, existing)).toBeNull();
  });

  it("does not match a document against itself", () => {
    expect(findDuplicate(existing[0], existing)).toBeNull();
  });

  it("has no key until vendor, number, currency and total are all known", () => {
    expect(dedupeKey({ vendorKey: null, documentNumber: "1", currency: "USD", totalCents: 1 })).toBeNull();
    expect(dedupeKey({ vendorKey: "v:a", documentNumber: null, currency: "USD", totalCents: 1 })).toBeNull();
    expect(dedupeKey({ vendorKey: "v:a", documentNumber: "1", currency: null, totalCents: 1 })).toBeNull();
    expect(dedupeKey({ vendorKey: "v:a", documentNumber: "1", currency: "USD", totalCents: null })).toBeNull();
    expect(dedupeKey({ vendorKey: "v:a", documentNumber: "1", currency: "USD", totalCents: 0 })).toBe("v:a|1|USD|0");
  });

  it("falls back to the normalized vendor name before a vendor exists", () => {
    expect(vendorKeyFor("abc", "acme supply")).toBe("v:abc");
    expect(vendorKeyFor(null, "acme supply")).toBe("n:acme supply");
    expect(vendorKeyFor(null, null)).toBeNull();
  });
});
