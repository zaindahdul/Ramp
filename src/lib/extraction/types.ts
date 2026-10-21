import type { RawExtraction } from "@/lib/extraction/schema";

export interface ExtractionHints {
  /** Vendor names already on file, to make mock output look like real traffic. */
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
