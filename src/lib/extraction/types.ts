import type { RawExtraction } from "@/lib/extraction/schema";

export interface ExtractionHints {
  /** The organization receiving the documents. It is the customer, never the vendor. */
  customerName: string;
  /** Vendor names already on file: context for reading the issuer's name. */
  knownVendors: string[];
  recentInvoices: Array<{
    vendorName: string;
    documentNumber: string;
    documentDate: string;
    currency: string;
    totalCents: number;
  }>;
}

export interface ExtractInput {
  data: Buffer;
  mimeType: string;
  filename: string;
  sha256: string;
  hints: ExtractionHints;
}

export interface Extractor {
  /** Stored on the document, e.g. "claude:claude-opus-5-5" or "mock". */
  readonly name: string;
  extract(input: ExtractInput): Promise<RawExtraction>;
}

/** An extraction failure with a message that is safe to show the user. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}
