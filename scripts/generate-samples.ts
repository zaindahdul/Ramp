// pnpm samples: writes the sample invoices and credit memos in /samples.
//
// Each PDF is a readable document (what Claude extracts in real mode) and also
// carries the same data as JSON in its Subject metadata, which the mock
// extractor reads so uploads behave the same without an API key.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { addDays, formatPlainDate, todayUtc } from "../src/lib/dates";
import type { RawExtraction } from "../src/lib/extraction/schema";
import { MOCK_EXTRACTION_PREFIX } from "../src/lib/extraction/mock";
import { centsToDecimalString, formatCents } from "../src/lib/money";

interface Line {
  description: string;
  quantity: number;
  unitCents: number;
}

interface Sample {
  file: string;
  kind: "INVOICE" | "CREDIT MEMO";
  vendor: string;
  vendorAddress: string[];
  number: string;
  date: string;
  dueDate: string | null;
  terms: string | null;
  currency: string;
  lines: Line[];
  taxRateBps: number;
  taxLabel: string;
  /** Printed total when it deliberately differs from the lines. */
  printedTotalCents?: number;
  referencedInvoice?: string;
  reason?: string;
  suggestedReason?: RawExtraction["suggestedReason"];
}

const today = todayUtc();
const invoiceDate = addDays(today, -12);

const SAMPLES: Sample[] = [
  {
    file: "1-invoice-acme-supply.pdf",
    kind: "INVOICE",
    vendor: "ACME Supply, Inc.",
    vendorAddress: ["1200 Industrial Way", "Oakland, CA 94607"],
    number: "AS-90001",
    date: invoiceDate,
    dueDate: addDays(invoiceDate, 30),
    terms: "Net 30",
    currency: "USD",
    lines: [
      { description: "Copy paper, 10 ream case", quantity: 30, unitCents: 12_897 },
      { description: "Nitrile gloves, box of 100", quantity: 60, unitCents: 3_750 },
      { description: "Toner cartridge HP 26A", quantity: 8, unitCents: 26_997 },
    ],
    taxRateBps: 825,
    taxLabel: "Sales tax (8.25%)",
  },
  {
    file: "2-credit-memo-acme-supply-pricing.pdf",
    kind: "CREDIT MEMO",
    vendor: "Acme Supply Co.",
    vendorAddress: ["1200 Industrial Way", "Oakland, CA 94607"],
    number: "CM-AS-9001",
    date: addDays(invoiceDate, 9),
    dueDate: null,
    terms: null,
    currency: "USD",
    lines: [{ description: "Price correction: copy paper, 10 ream case", quantity: 30, unitCents: 1_200 }],
    taxRateBps: 0,
    taxLabel: "Tax",
    referencedInvoice: "AS-90001",
    reason: "Price billed above contract rate (billed $128.97 per case, contract $116.97)",
    suggestedReason: "pricing_error",
  },
  {
    file: "3-credit-memo-harbor-produce-no-reference.pdf",
    kind: "CREDIT MEMO",
    vendor: "Harbor Produce Company",
    vendorAddress: ["Pier 45, Shed C", "San Francisco, CA 94133"],
    number: "HP-CM-7781",
    date: addDays(today, -6),
    dueDate: null,
    terms: null,
    currency: "USD",
    lines: [{ description: "Romaine lettuce, case of 24 - damaged on arrival", quantity: 3, unitCents: 11_550 }],
    taxRateBps: 0,
    taxLabel: "Tax",
    reason: "Product arrived damaged",
    suggestedReason: "damaged_or_defective",
  },
  {
    file: "4-invoice-new-vendor-eur.pdf",
    kind: "INVOICE",
    vendor: "Lumière Cuisine Équipement SARL",
    vendorAddress: ["18 rue de la Verrerie", "75004 Paris, France"],
    number: "LCE-2026-0147",
    date: addDays(today, -20),
    dueDate: addDays(today, 10),
    terms: "30 jours",
    currency: "EUR",
    lines: [
      { description: "Copper saucepan set, 5 pieces", quantity: 2, unitCents: 89_000 },
      { description: "Chef knife, 24 cm", quantity: 4, unitCents: 14_500 },
    ],
    taxRateBps: 2000,
    taxLabel: "TVA (20%)",
  },
  {
    file: "5-invoice-coastal-seafood-needs-review.pdf",
    kind: "INVOICE",
    vendor: "Coastal Seafood Traders",
    vendorAddress: ["77 Harbor Road", "Half Moon Bay, CA 94019"],
    number: "CST-90044",
    date: addDays(today, -4),
    dueDate: null,
    terms: "Net 7",
    currency: "USD",
    lines: [
      { description: "Atlantic salmon fillet, 10 lb", quantity: 6, unitCents: 15_490 },
      { description: "Shrimp 16/20, 5 lb", quantity: 8, unitCents: 7_450 },
      { description: "Sea scallops U10, 5 lb", quantity: 4, unitCents: 18_975 },
    ],
    taxRateBps: 0,
    taxLabel: "Tax",
    // The printed total is $100 more than the lines: a typo the review step should catch.
    printedTotalCents: 6 * 15_490 + 8 * 7_450 + 4 * 18_975 + 10_000,
  },
];

function totals(s: Sample) {
  const lineTotals = s.lines.map((l) => l.quantity * l.unitCents);
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const tax = Math.round((subtotal * s.taxRateBps) / 10_000);
  return { lineTotals, subtotal, tax, total: s.printedTotalCents ?? subtotal + tax };
}

function extractionFor(s: Sample): RawExtraction {
  const t = totals(s);
  const money = (c: number) => centsToDecimalString(c, s.currency);
  return {
    documentType: s.kind === "INVOICE" ? "invoice" : "credit_memo",
    vendorName: s.vendor,
    documentNumber: s.number,
    documentDate: s.date,
    dueDate: s.dueDate,
    paymentTerms: s.terms,
    currency: s.currency,
    subtotal: money(t.subtotal),
    tax: s.taxRateBps ? money(t.tax) : null,
    total: money(t.total),
    lineItems: s.lines.map((l, i) => ({
      description: l.description,
      quantity: String(l.quantity),
      unitPrice: money(l.unitCents),
      lineTotal: money(t.lineTotals[i]),
    })),
    referencedInvoiceNumber: s.referencedInvoice ?? null,
    statedReason: s.reason ?? null,
    suggestedReason: s.suggestedReason ?? null,
  };
}

function text(page: PDFPage, value: string, x: number, y: number, font: PDFFont, size = 10, color = rgb(0.1, 0.1, 0.1)) {
  page.drawText(value, { x, y, size, font, color });
}

function rightText(page: PDFPage, value: string, right: number, y: number, font: PDFFont, size = 10) {
  text(page, value, right - font.widthOfTextAtSize(value, size), y, font, size);
}

async function render(s: Sample): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const t = totals(s);
  const money = (c: number) => formatCents(c, s.currency);
  const muted = rgb(0.4, 0.4, 0.4);

  text(page, s.vendor, 50, 730, bold, 16);
  s.vendorAddress.forEach((line, i) => text(page, line, 50, 712 - i * 13, regular, 9, muted));
  rightText(page, s.kind, 562, 730, bold, 20);

  const meta: Array<[string, string]> = [
    [s.kind === "INVOICE" ? "Invoice #" : "Credit memo #", s.number],
    ["Date", formatPlainDate(s.date)],
  ];
  if (s.dueDate) meta.push(["Due date", formatPlainDate(s.dueDate)]);
  if (s.terms) meta.push(["Terms", s.terms]);
  if (s.referencedInvoice) meta.push(["Applies to invoice", s.referencedInvoice]);
  meta.push(["Currency", s.currency]);
  meta.forEach(([label, value], i) => {
    const y = 700 - i * 14;
    rightText(page, label, 470, y, regular, 9);
    rightText(page, value, 562, y, bold, 9);
  });

  text(page, "Bill to", 50, 640, bold, 9);
  ["Bluebird Hospitality Group", "Accounts Payable", "500 Market Street, San Francisco, CA 94105"].forEach((line, i) =>
    text(page, line, 50, 626 - i * 12, regular, 9),
  );

  let y = 560;
  page.drawRectangle({ x: 50, y: y - 6, width: 512, height: 20, color: rgb(0.94, 0.94, 0.94) });
  text(page, "Description", 56, y, bold, 9);
  rightText(page, "Qty", 380, y, bold, 9);
  rightText(page, "Unit price", 470, y, bold, 9);
  rightText(page, "Amount", 556, y, bold, 9);
  y -= 22;
  s.lines.forEach((line, i) => {
    const desc = line.description.length > 62 ? `${line.description.slice(0, 60)}…` : line.description;
    text(page, desc, 56, y, regular, 9);
    rightText(page, String(line.quantity), 380, y, regular, 9);
    rightText(page, money(line.unitCents), 470, y, regular, 9);
    rightText(page, money(t.lineTotals[i]), 556, y, regular, 9);
    y -= 18;
  });
  page.drawLine({ start: { x: 50, y: y + 6 }, end: { x: 562, y: y + 6 }, thickness: 0.5, color: muted });

  y -= 10;
  const summary: Array<[string, string, boolean]> = [["Subtotal", money(t.subtotal), false]];
  if (s.taxRateBps) summary.push([s.taxLabel, money(t.tax), false]);
  summary.push([s.kind === "INVOICE" ? "Total due" : "Total credit", money(t.total), true]);
  summary.forEach(([label, value, strong]) => {
    rightText(page, label, 470, y, strong ? bold : regular, strong ? 11 : 9);
    rightText(page, value, 556, y, strong ? bold : regular, strong ? 11 : 9);
    y -= 18;
  });

  if (s.reason) {
    y -= 16;
    text(page, "Reason for credit", 50, y, bold, 9);
    text(page, s.reason, 50, y - 13, regular, 9);
  }
  text(
    page,
    s.kind === "INVOICE"
      ? "Thank you for your business."
      : "This credit may be applied against future invoices or refunded on request.",
    50,
    60,
    regular,
    8,
    muted,
  );

  pdf.setTitle(`${s.kind === "INVOICE" ? "Invoice" : "Credit memo"} ${s.number}`);
  pdf.setAuthor(s.vendor);
  pdf.setSubject(MOCK_EXTRACTION_PREFIX + JSON.stringify(extractionFor(s)));
  pdf.setCreator("ap-credit-recovery sample generator");
  pdf.setCreationDate(new Date(`${s.date}T12:00:00Z`));
  pdf.setModificationDate(new Date(`${s.date}T12:00:00Z`));
  return pdf.save();
}

async function main() {
  const dir = path.resolve("samples");
  mkdirSync(dir, { recursive: true });
  for (const sample of SAMPLES) {
    writeFileSync(path.join(dir, sample.file), await render(sample));
    console.log(`wrote samples/${sample.file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
