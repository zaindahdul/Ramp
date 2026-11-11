// pnpm eval: scores the decision logic against cases with known answers.
//
//   pnpm eval                 linker and reason rules (free, offline, ~1 second)
//   pnpm eval --extraction    also runs the configured extractor on /samples
//                             (5 API calls; needs ANTHROPIC_API_KEY)
//
// Where the answers come from:
// - Linker and reasons: the demo-data generator. It creates every credit from a
//   specific invoice for a specific reason, so the truth is known by
//   construction, not labeled after the fact.
// - Extraction: the five sample PDFs, whose correct fields were written by the
//   same script that drew the page.
//
// What this is not: a measure of accuracy on real documents. Synthetic memos
// use regular wording. Treat the linker and reason numbers as regression gates
// (they fail the run when a rule change makes things worse) and the extraction
// number as a smoke test until a labeled set of real documents replaces it.

import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateDemoData, type DemoCredit, type DemoData } from "../prisma/demo-data";
import { todayUtc } from "../src/lib/dates";
import { normalizeDocumentNumber, sha256Hex } from "../src/lib/dedupe";
import { env, isMockMode } from "../src/lib/env";
import { ClaudeExtractor } from "../src/lib/extraction/claude";
import { extractorIssues } from "../src/lib/extraction/checks";
import { readEmbeddedExtraction } from "../src/lib/extraction/mock";
import { normalizeExtraction, type NormalizedExtraction } from "../src/lib/extraction/schema";
import { decideCreditLink, type LinkableInvoice } from "../src/lib/linking";
import { CREDIT_REASONS, decideCreditReason, REASON_LABELS, type CreditReasonKey } from "../src/lib/reasons";
import { issueList, reviewDocument } from "../src/lib/review";
import { normalizeVendorName } from "../src/lib/vendors/normalize";

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const failures: string[] = [];

function table(rows: Array<[string, string | number]>) {
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.log(`  ${label.padEnd(width)}  ${value}`);
}

// ---------------------------------------------------------------------------
// Linker
// ---------------------------------------------------------------------------

interface LinkScore {
  total: number;
  correct: number;
  wrong: number;
  /** Abstained, and the true invoice was among the candidates offered. */
  abstainedWithTruth: number;
  /** Abstained or found nothing, and the true invoice was not offered. */
  missed: number;
  byMethod: Record<"reference" | "heuristic", { correct: number; wrong: number }>;
}

function scoreLinker(data: DemoData, mutate: (credit: DemoCredit) => DemoCredit = (c) => c): LinkScore {
  const linkable = new Map<string, LinkableInvoice[]>();
  for (const inv of data.invoices) {
    const list = linkable.get(inv.vendorId) ?? [];
    list.push({
      id: inv.id,
      vendorId: inv.vendorId,
      documentNumber: inv.number,
      documentDate: inv.date,
      currency: inv.profile.currency,
      totalCents: inv.totalCents,
      lineDescriptions: inv.lines.map((l) => l.description),
    });
    linkable.set(inv.vendorId, list);
  }

  const score: LinkScore = {
    total: 0,
    correct: 0,
    wrong: 0,
    abstainedWithTruth: 0,
    missed: 0,
    byMethod: { reference: { correct: 0, wrong: 0 }, heuristic: { correct: 0, wrong: 0 } },
  };
  for (const original of data.credits) {
    const credit = mutate(original);
    const { result } = decideCreditLink(
      {
        vendorId: credit.vendorId,
        documentDate: credit.date,
        currency: credit.profile.currency,
        totalCents: credit.amountCents,
        referencedInvoiceNumber: credit.reference,
        lineDescriptions: [credit.description],
      },
      linkable.get(credit.vendorId) ?? [],
    );
    score.total++;
    if (result.kind === "linked") {
      const right = result.invoiceId === credit.trueInvoiceId;
      score[right ? "correct" : "wrong"]++;
      score.byMethod[result.method][right ? "correct" : "wrong"]++;
    } else if (result.kind === "ambiguous" && result.candidateIds.includes(credit.trueInvoiceId)) {
      score.abstainedWithTruth++;
    } else {
      score.missed++;
    }
  }
  return score;
}

function reportLinker(title: string, s: LinkScore) {
  const linked = s.correct + s.wrong;
  console.log(`\n${title}`);
  table([
    ["Credits", s.total],
    ["Linked automatically", `${linked} (${pct(linked, s.total)})`],
    ["  correct", `${s.correct}  precision ${pct(s.correct, linked)}`],
    ["  wrong", s.wrong],
    ["  by referenced number", `${s.byMethod.reference.correct} correct, ${s.byMethod.reference.wrong} wrong`],
    ["  by heuristic", `${s.byMethod.heuristic.correct} correct, ${s.byMethod.heuristic.wrong} wrong`],
    ["Left for a person, right invoice offered", `${s.abstainedWithTruth} (${pct(s.abstainedWithTruth, s.total)})`],
    ["Left for a person, right invoice not offered", s.missed],
  ]);
}

function evalLinker(data: DemoData) {
  console.log("\n== Credit-to-invoice linker ==");
  console.log("A wrong link corrupts the vendor's error rate silently. An abstention costs a person one click.");

  const asSeeded = scoreLinker(data);
  reportLinker("As seeded (about 9 in 10 memos print the invoice number)", asSeeded);
  if (asSeeded.wrong > 0) failures.push(`Linker made ${asSeeded.wrong} wrong link(s) on the seeded data.`);
  if (asSeeded.byMethod.reference.wrong > 0) failures.push("A referenced invoice number linked to the wrong invoice.");

  // Stress: no memo prints an invoice number, so only the heuristic can link.
  const noReference = scoreLinker(data, (c) => ({ ...c, reference: null }));
  reportLinker("Stress: no memo prints an invoice number (heuristic only)", noReference);
  const heuristicLinked = noReference.correct + noReference.wrong;
  if (heuristicLinked > 0 && noReference.correct / heuristicLinked < 0.9) {
    failures.push(`Heuristic precision fell to ${pct(noReference.correct, heuristicLinked)} (gate: 90%).`);
  }

  // Stress: the memo prints the number in a different format ("as 90001" for "AS-90001").
  const reformatted = scoreLinker(data, (c) => ({
    ...c,
    reference: c.reference ? c.reference.toLowerCase().replace(/-/g, " ") : null,
  }));
  reportLinker("Stress: invoice numbers printed in a different format", reformatted);
  if (reformatted.correct !== asSeeded.correct) {
    failures.push("Reformatted invoice numbers changed the linker's answers.");
  }
}

// ---------------------------------------------------------------------------
// Reason rules
// ---------------------------------------------------------------------------

function evalReasons(data: DemoData) {
  console.log("\n== Credit reason rules (no model: keyword rules only) ==");
  let correct = 0;
  const byTruth = new Map<CreditReasonKey, { total: number; correct: number }>();
  const misses = new Map<string, number>();
  for (const credit of data.credits) {
    const decided = decideCreditReason({
      statedReason: credit.statedReason,
      suggestedReason: null,
      lineDescriptions: [credit.description],
    });
    const bucket = byTruth.get(credit.reason) ?? { total: 0, correct: 0 };
    bucket.total++;
    if (decided.reason === credit.reason) {
      correct++;
      bucket.correct++;
    } else {
      const key = `${REASON_LABELS[credit.reason]} read as ${REASON_LABELS[decided.reason]}: "${credit.statedReason ?? credit.description}"`;
      misses.set(key, (misses.get(key) ?? 0) + 1);
    }
    byTruth.set(credit.reason, bucket);
  }
  const total = data.credits.length;
  const majority = Math.max(...[...byTruth.values()].map((b) => b.total));
  table([
    ["Credits", total],
    ["Correct reason", `${correct} (${pct(correct, total)})`],
    ["Always guessing the most common reason", pct(majority, total)],
  ]);
  console.log("\n  By true reason");
  table(
    CREDIT_REASONS.filter((r) => byTruth.has(r)).map((r) => {
      const b = byTruth.get(r)!;
      return [`  ${REASON_LABELS[r]}`, `${b.correct}/${b.total}`];
    }),
  );
  if (misses.size > 0) {
    console.log("\n  Misses");
    for (const [miss, count] of [...misses].sort((a, b) => b[1] - a[1])) console.log(`    ${count}x ${miss}`);
  }
  if (correct / total < 0.95) failures.push(`Reason rules scored ${pct(correct, total)} (gate: 95%).`);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

type FieldCheck = [name: string, same: (truth: NormalizedExtraction, got: NormalizedExtraction) => boolean];

const FIELD_CHECKS: FieldCheck[] = [
  ["type", (t, g) => t.type === g.type],
  ["vendor", (t, g) => normalizeVendorName(t.vendorName ?? "") === normalizeVendorName(g.vendorName ?? "")],
  ["number", (t, g) => normalizeDocumentNumber(t.documentNumber) === normalizeDocumentNumber(g.documentNumber)],
  ["date", (t, g) => t.documentDate === g.documentDate],
  ["due date", (t, g) => t.dueDate === g.dueDate],
  ["currency", (t, g) => t.currency === g.currency],
  ["subtotal", (t, g) => t.subtotalCents === g.subtotalCents],
  ["tax", (t, g) => (t.taxCents ?? 0) === (g.taxCents ?? 0)],
  ["total", (t, g) => t.totalCents === g.totalCents],
  [
    "line totals",
    (t, g) =>
      JSON.stringify(t.lineItems.map((l) => l.lineTotalCents)) === JSON.stringify(g.lineItems.map((l) => l.lineTotalCents)),
  ],
  [
    "referenced invoice",
    (t, g) => normalizeDocumentNumber(t.referencedInvoiceNumber) === normalizeDocumentNumber(g.referencedInvoiceNumber),
  ],
  ["reason", (t, g) => t.suggestedReason === g.suggestedReason],
];

async function evalExtraction() {
  console.log("\n== Extraction on /samples ==");
  if (isMockMode()) {
    console.log("  Skipped: ANTHROPIC_API_KEY isn't set, and the mock extractor reads the answer key.");
    return;
  }
  const extractor = new ClaudeExtractor(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_MODEL);
  const dir = path.resolve("samples");
  const files = readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort();
  let fieldsRight = 0;
  let fieldsTotal = 0;
  let zeroEdit = 0;
  let sameVerdict = 0;

  for (const file of files) {
    const data = readFileSync(path.join(dir, file));
    const embedded = await readEmbeddedExtraction(data);
    if (!embedded) {
      console.log(`  ${file}: no answer key embedded, skipped`);
      continue;
    }
    const truth = normalizeExtraction(embedded);
    const got = normalizeExtraction(
      await extractor.extract({
        data,
        mimeType: "application/pdf",
        filename: file,
        sha256: sha256Hex(data),
        hints: { customerName: "Bluebird Hospitality Group", knownVendors: [], recentInvoices: [] },
      }),
    );
    const wrong = FIELD_CHECKS.filter(([, same]) => !same(truth, got)).map(([name]) => name);
    fieldsTotal += FIELD_CHECKS.length;
    fieldsRight += FIELD_CHECKS.length - wrong.length;
    if (wrong.length === 0) zeroEdit++;

    // The checks should reach the same verdict on the model's reading as on the truth.
    const flagged = (n: NormalizedExtraction) => [...issueList(reviewDocument(n)), ...extractorIssues(n)].length > 0;
    if (flagged(truth) === flagged(got)) sameVerdict++;
    console.log(`  ${wrong.length === 0 ? "ok  " : "MISS"} ${file}${wrong.length ? `: ${wrong.join(", ")}` : ""}`);
  }
  console.log("");
  table([
    ["Model", extractor.name],
    ["Documents needing zero edits", `${zeroEdit}/${files.length}`],
    ["Fields correct", `${fieldsRight}/${fieldsTotal} (${pct(fieldsRight, fieldsTotal)})`],
    ["Review checks agree with the answer key", `${sameVerdict}/${files.length}`],
  ]);
  if (zeroEdit < files.length) failures.push(`Extraction: ${files.length - zeroEdit} sample(s) needed an edit.`);
}

async function main() {
  const data = generateDemoData(todayUtc());
  console.log(
    `Dataset: ${data.vendors.length} vendors, ${data.invoices.length} invoices, ${data.credits.length} credit memos (generated, answers known by construction).`,
  );
  evalLinker(data);
  evalReasons(data);
  if (process.argv.includes("--extraction")) await evalExtraction();
  else console.log("\n== Extraction on /samples ==\n  Not run. Add --extraction to run the model on the five samples (5 API calls).");

  console.log("");
  if (failures.length > 0) {
    console.log("FAILED");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("PASSED");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
