import { createHash } from "node:crypto";

// Two kinds of duplicate are rejected:
// 1. The same file uploaded twice: same sha256 within an organization.
// 2. A different file for the same record: same vendor, document number and
//    amount (currency included, since 100 USD and 100 EUR are different amounts).

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** "inv #00-123 " -> "INV00123". Separators and case are noise on document numbers. */
export function normalizeDocumentNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .toUpperCase()
    .replace(/^\s*(NO\.?|NUMBER|#)\s*/, "")
    .replace(/[^A-Z0-9]/g, "");
  return normalized === "" ? null : normalized;
}

export interface DedupeFields {
  /** Vendor id when known, otherwise the normalized vendor name. */
  vendorKey: string | null;
  documentNumber: string | null;
  currency: string | null;
  totalCents: number | null;
}

export function dedupeKey(fields: DedupeFields): string | null {
  const number = normalizeDocumentNumber(fields.documentNumber);
  if (!fields.vendorKey || !number || !fields.currency || fields.totalCents === null) {
    return null;
  }
  return [fields.vendorKey, number, fields.currency.toUpperCase(), fields.totalCents].join("|");
}

export function vendorKeyFor(vendorId: string | null, normalizedVendorName: string | null): string | null {
  if (vendorId) return `v:${vendorId}`;
  if (normalizedVendorName) return `n:${normalizedVendorName}`;
  return null;
}

export interface DedupeCandidate extends DedupeFields {
  id: string;
}

/** The first other record with the same vendor, number and amount, if any. */
export function findDuplicate<T extends DedupeCandidate>(
  candidate: DedupeCandidate,
  existing: readonly T[],
): T | null {
  const key = dedupeKey(candidate);
  if (!key) return null;
  return existing.find((doc) => doc.id !== candidate.id && dedupeKey(doc) === key) ?? null;
}
