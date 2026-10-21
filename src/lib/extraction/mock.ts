import { PDFDocument } from "pdf-lib";
import { addDays, todayUtc } from "@/lib/dates";
import { ExtractionSchema, type RawExtraction } from "@/lib/extraction/schema";
import type { ExtractInput, Extractor } from "@/lib/extraction/types";
import { centsToDecimalString } from "@/lib/money";
import { createRng, seedFromHex, type Rng } from "@/lib/random";
import type { CreditReasonKey } from "@/lib/reasons";

// Mock mode: used when ANTHROPIC_API_KEY is not set.
//
// The PDFs in /samples carry their own correct extraction in the PDF metadata
// (Subject field, prefixed with MOCK_EXTRACTION_PREFIX), so in mock mode they
// extract exactly as Claude would. Any other file gets plausible, made-up data
// derived from its hash, so the same file always extracts the same way.

export const MOCK_EXTRACTION_PREFIX = "ap-credit-recovery/mock-extraction:";

const FALLBACK_VENDORS = ["Acme Supply", "Northwind Traders", "Globex Industrial", "Initech Office"];

const PRODUCTS = [
  ["Copy paper, 10 ream case", 4_299],
  ["Nitrile gloves, box of 100", 1_250],
  ["Paper towels, 12 roll case", 3_475],
  ["Stainless prep table 48in", 38_900],
  ["Delivery fee", 2_500],
  ["Cleaning service, monthly", 64_000],
  ["Romaine lettuce, case", 3_850],
  ["Fryer oil, 35 lb", 4_799],
] as const;

const REASON_TEXT: Array<[CreditReasonKey, string]> = [
  ["pricing_error", "Price billed above contract rate"],
  ["quantity_error", "Billed for more cases than delivered"],
  ["damaged_or_defective", "Items arrived damaged"],
  ["duplicate_billing", "Invoice billed twice"],
  ["return", "Returned merchandise"],
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function readEmbeddedExtraction(data: Buffer): Promise<RawExtraction | null> {
  try {
    const pdf = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
    const subject = pdf.getSubject();
    if (!subject?.startsWith(MOCK_EXTRACTION_PREFIX)) return null;
    const parsed = ExtractionSchema.safeParse(JSON.parse(subject.slice(MOCK_EXTRACTION_PREFIX.length)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class MockExtractor implements Extractor {
  readonly name = "mock";

  constructor(private readonly delayMs = 900) {}

  async extract(input: ExtractInput): Promise<RawExtraction> {
    const rng = createRng(seedFromHex(input.sha256));
    // Long enough that the upload screen visibly moves through "extracting".
    if (this.delayMs > 0) await sleep(this.delayMs + rng.int(0, 600));

    if (input.mimeType === "application/pdf") {
      const embedded = await readEmbeddedExtraction(input.data);
      if (embedded) return embedded;
    }
    return plausibleExtraction(input, rng);
  }
}

function plausibleExtraction(input: ExtractInput, rng: Rng): RawExtraction {
  const looksLikeCredit = /credit|\bcm\b|refund/i.test(input.filename);
  const invoiceToCredit = input.hints.recentInvoices.length > 0 ? rng.pick(input.hints.recentInvoices) : null;
  if ((looksLikeCredit || rng.chance(0.2)) && invoiceToCredit) {
    return mockCreditMemo(rng, invoiceToCredit);
  }

  const vendorName = rng.pick(input.hints.knownVendors.length > 0 ? input.hints.knownVendors : FALLBACK_VENDORS);
  const documentDate = addDays(todayUtc(), -rng.int(1, 45));
  const lines = Array.from({ length: rng.int(1, 4) }, () => {
    const [description, unit] = rng.pick(PRODUCTS);
    const quantity = rng.int(1, 12);
    return { description, quantity, unit, total: unit * quantity };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const tax = rng.chance(0.5) ? Math.round((subtotal * 8) / 100) : 0;
  // One in four mock invoices doesn't add up, so the review flow gets exercised.
  const total = subtotal + tax + (rng.chance(0.25) ? rng.int(1, 50) * 100 : 0);

  return {
    documentType: "invoice",
    vendorName,
    documentNumber: `MOCK-${rng.int(10000, 99999)}`,
    documentDate,
    dueDate: rng.chance(0.8) ? addDays(documentDate, 30) : null,
    paymentTerms: "Net 30",
    currency: "USD",
    subtotal: centsToDecimalString(subtotal),
    tax: tax ? centsToDecimalString(tax) : null,
    total: centsToDecimalString(total),
    lineItems: lines.map((l) => ({
      description: l.description,
      quantity: String(l.quantity),
      unitPrice: centsToDecimalString(l.unit),
      lineTotal: centsToDecimalString(l.total),
    })),
    referencedInvoiceNumber: null,
    statedReason: null,
    suggestedReason: null,
  };
}

function mockCreditMemo(rng: Rng, invoice: ExtractInput["hints"]["recentInvoices"][number]): RawExtraction {
  const [reason, statedReason] = rng.pick(REASON_TEXT);
  const pct = reason === "duplicate_billing" ? 100 : rng.int(3, 20);
  const amount = Math.max(100, Math.round((invoice.totalCents * pct) / 100));
  const documentDate = addDays(invoice.documentDate, rng.int(5, 40));
  const today = todayUtc();
  return {
    documentType: "credit_memo",
    vendorName: invoice.vendorName,
    documentNumber: `MOCK-CM-${rng.int(1000, 9999)}`,
    documentDate: documentDate > today ? today : documentDate,
    dueDate: null,
    paymentTerms: null,
    currency: invoice.currency,
    subtotal: centsToDecimalString(amount, invoice.currency),
    tax: null,
    total: centsToDecimalString(amount, invoice.currency),
    lineItems: [
      {
        description: `${statedReason} (invoice ${invoice.documentNumber})`,
        quantity: "1",
        unitPrice: centsToDecimalString(amount, invoice.currency),
        lineTotal: centsToDecimalString(amount, invoice.currency),
      },
    ],
    referencedInvoiceNumber: rng.chance(0.8) ? invoice.documentNumber : null,
    statedReason: rng.chance(0.7) ? statedReason : null,
    suggestedReason: reason,
  };
}
