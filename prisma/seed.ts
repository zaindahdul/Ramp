// pnpm seed: the demo workspace, a fake restaurant group with 18 months of AP data.
//
// Deterministic apart from "today": rerunning wipes the demo organization and
// rebuilds it relative to the current date. The data itself comes from
// demo-data.ts, which the eval script replays too.

import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { addDays, fromPlainDate, todayUtc } from "../src/lib/dates";
import { createPrismaClient } from "../src/lib/db";
import { dedupeKey, normalizeDocumentNumber, vendorKeyFor } from "../src/lib/dedupe";
import { DEMO_EMAIL, DEMO_USER_NAME } from "../src/lib/demo";
import { decideCreditLink, explainLink, type LinkableInvoice } from "../src/lib/linking";
import { decideCreditReason, explainReason } from "../src/lib/reasons";
import { normalizeVendorName } from "../src/lib/vendors/normalize";
import { DEMO_COMPANY, generateDemoData } from "./demo-data";

const db = createPrismaClient();

async function main() {
  const data = generateDemoData(todayUtc());
  console.log(`Seeding ${DEMO_COMPANY} (today is ${data.today}, history from ${data.start})`);

  await db.organization.deleteMany({ where: { users: { some: { email: DEMO_EMAIL } } } });
  const org = await db.organization.create({ data: { name: DEMO_COMPANY } });
  const organizationId = org.id;
  await db.user.create({ data: { organizationId, email: DEMO_EMAIL, name: DEMO_USER_NAME } });

  for (const { id, profile } of data.vendors) {
    const aliases = [...new Set(profile.rawNames.map(normalizeVendorName))];
    await db.vendor.create({
      data: {
        id,
        organizationId,
        name: profile.name,
        aliases: {
          create: aliases.map((normalizedName) => ({
            organizationId,
            normalizedName,
            rawName: profile.rawNames.find((r) => normalizeVendorName(r) === normalizedName)!,
          })),
        },
      },
    });
  }

  const documents: Prisma.DocumentCreateManyInput[] = [];
  const lineItems: Prisma.LineItemCreateManyInput[] = [];
  const linkableByVendor = new Map<string, LinkableInvoice[]>();

  for (const inv of data.invoices) {
    const { profile } = inv;
    documents.push({
      id: inv.id,
      organizationId,
      source: "seed",
      status: "confirmed",
      type: "invoice",
      vendorId: inv.vendorId,
      vendorNameRaw: inv.rawName,
      documentNumber: inv.number,
      documentNumberNormalized: normalizeDocumentNumber(inv.number),
      documentDate: fromPlainDate(inv.date),
      dueDate: fromPlainDate(addDays(inv.date, 30)),
      paymentTerms: profile.terms,
      currency: profile.currency,
      subtotalCents: inv.subtotalCents,
      taxCents: inv.totalCents - inv.subtotalCents,
      totalCents: inv.totalCents,
      dedupeKey: dedupeKey({
        vendorKey: vendorKeyFor(inv.vendorId, null),
        documentNumber: inv.number,
        currency: profile.currency,
        totalCents: inv.totalCents,
      }),
      extractor: "seed",
      confirmedAt: fromPlainDate(inv.confirmedOn),
      confirmedVia: "seed",
      createdAt: fromPlainDate(inv.date),
    });
    inv.lines.forEach((line, position) =>
      lineItems.push({ organizationId, documentId: inv.id, position, ...line }),
    );
    const linkable = linkableByVendor.get(inv.vendorId) ?? [];
    linkable.push({
      id: inv.id,
      vendorId: inv.vendorId,
      documentNumber: inv.number,
      documentDate: inv.date,
      currency: profile.currency,
      totalCents: inv.totalCents,
      lineDescriptions: inv.lines.map((l) => l.description),
    });
    linkableByVendor.set(inv.vendorId, linkable);
  }

  // Credit memos, linked with the real linker and explained in its own words.
  let linked = 0;
  let ambiguous = 0;
  for (const credit of data.credits) {
    const { profile } = credit;
    const linkable = linkableByVendor.get(credit.vendorId) ?? [];
    const decision = decideCreditLink(
      {
        vendorId: credit.vendorId,
        documentDate: credit.date,
        currency: profile.currency,
        totalCents: credit.amountCents,
        referencedInvoiceNumber: credit.reference,
        lineDescriptions: [credit.description],
      },
      linkable,
    );
    const { result } = decision;
    if (result.kind === "linked") linked++;
    if (result.kind === "ambiguous") ambiguous++;
    const linkedNumber =
      result.kind === "linked" ? (linkable.find((i) => i.id === result.invoiceId)?.documentNumber ?? null) : null;

    // The stored reason is the generator's ground truth. It gets an explanation
    // only when the reason rules reach the same answer from the memo's text.
    const reasoned = decideCreditReason({
      statedReason: credit.statedReason,
      suggestedReason: null,
      lineDescriptions: [credit.description],
    });

    documents.push({
      id: credit.id,
      organizationId,
      source: "seed",
      status: "confirmed",
      type: "credit_memo",
      vendorId: credit.vendorId,
      vendorNameRaw: credit.rawName,
      documentNumber: credit.number,
      documentNumberNormalized: normalizeDocumentNumber(credit.number),
      documentDate: fromPlainDate(credit.date),
      currency: profile.currency,
      subtotalCents: credit.amountCents,
      taxCents: 0,
      totalCents: credit.amountCents,
      dedupeKey: dedupeKey({
        vendorKey: vendorKeyFor(credit.vendorId, null),
        documentNumber: credit.number,
        currency: profile.currency,
        totalCents: credit.amountCents,
      }),
      referencedInvoiceNumber: credit.reference,
      statedReason: credit.statedReason,
      creditReason: credit.reason,
      creditReasonSource: credit.statedReason ? "stated" : "inferred",
      creditReasonBasis: reasoned.reason === credit.reason ? explainReason(reasoned, credit.statedReason) : null,
      creditStatus: credit.status,
      creditStatusChangedAt: credit.statusChangedOn ? fromPlainDate(credit.statusChangedOn) : null,
      linkedInvoiceId: result.kind === "linked" ? result.invoiceId : null,
      linkMethod: result.kind === "linked" ? result.method : null,
      linkCandidateIds: result.kind === "ambiguous" ? result.candidateIds.slice(0, 25) : [],
      linkRationale: explainLink(decision, linkedNumber),
      extractor: "seed",
      confirmedAt: fromPlainDate(credit.date),
      confirmedVia: "seed",
      createdAt: fromPlainDate(credit.date),
    });
    lineItems.push({
      organizationId,
      documentId: credit.id,
      position: 0,
      description: credit.description,
      quantity: 1,
      unitPriceCents: credit.amountCents,
      lineTotalCents: credit.amountCents,
    });
  }

  // Invoices first so credit links point at existing rows.
  const invoiceDocs = documents.filter((d) => d.type === "invoice");
  const creditDocs = documents.filter((d) => d.type === "credit_memo");
  for (const batch of chunks([...invoiceDocs, ...creditDocs], 500)) {
    await db.document.createMany({ data: batch });
  }
  for (const batch of chunks(lineItems, 2_000)) {
    await db.lineItem.createMany({ data: batch });
  }

  console.log(
    `Created ${data.vendors.length} vendors, ${invoiceDocs.length} invoices, ${creditDocs.length} credit memos ` +
      `(${linked} linked, ${ambiguous} ambiguous, ${creditDocs.length - linked - ambiguous} with no match).`,
  );
  console.log("Open http://localhost:3000 (pnpm dev). There is no sign-in.");
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
