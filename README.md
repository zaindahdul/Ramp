# AP Credit Recovery & Vendor Scorecard

When a vendor overbills you, they later issue a **credit memo**: "we owe you $X". Those credits get lost. This app reads uploaded invoices and credit memos, links each credit to the invoice it corrects, shows which credits are still unused (money you're owed), and scores vendors on how often they make billing mistakes. Each vendor also gets a printable negotiation summary.

Nothing in this app moves money.

**How it is built, in one line:** the model reads each document, plain code makes every decision about it, and every decision is stored with the reason for it. The design and several of the architecture choices follow what Ramp has published about its own product; see [Architecture](#architecture).

## Setup

Requirements: Node 22+ (tested on 24), pnpm, and Docker for Postgres.

```bash
pnpm install          # also generates the Prisma client
docker compose up -d  # Postgres 16 on localhost:5432
pnpm db:migrate       # applies prisma/migrations
pnpm seed             # demo workspace: 18 months of fake AP data
pnpm dev              # http://localhost:3000
```

There is no sign-in. The app opens straight into the demo workspace.

No `.env` is needed. Every setting has a local default that matches `docker-compose.yml`. To change anything, copy `.env.example` to `.env`:

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/ap_credits` | Postgres connection |
| `ANTHROPIC_API_KEY` | unset | Unset means **mock extraction mode** (a banner says so) |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model used for extraction |
| `STORAGE_DIR` | `./storage` | Where uploaded files are written |

### Other scripts

| Command | |
| --- | --- |
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` | Generates Next route types, then `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm eval` | Scores the linker and reason rules against known answers (free, offline). Add `-- --extraction` to also run the model on `/samples` (5 API calls) |
| `pnpm samples` | Regenerates the PDFs in `/samples` |
| `pnpm db:reset` | Drops and recreates the database (then run `pnpm seed`) |

## Try it

1. Open the app. **Overview** shows the amount still owed to you per currency, how long it has been owed, a to-do list, the open credits (oldest first) and the credits waiting to be matched with an invoice.
2. Open **Autonomy** and pick **Auto-confirm small, clean documents** (the limit defaults to $500), then **Save**. Skip this step to review everything by hand.
3. Go to **Upload** and drop all five files from `/samples`. Each one moves `Queued → Reading → Needs review`, or straight to `Confirmed` when autopilot takes it. With the setting from step 2:
   - `2-credit-memo-acme-supply-pricing.pdf` and `3-credit-memo-harbor-produce-no-reference.pdf` confirm themselves: every check passed, the vendor is on file, and the amount is under the limit.
   - `1-invoice-acme-supply.pdf` is held: it is over the limit.
   - `4-invoice-new-vendor-eur.pdf` is held: a new vendor is always created by a person.
   - `5-invoice-coastal-seafood-needs-review.pdf` is held: its lines add up to $100 less than the printed total.
4. Open each held document from **Documents → Needs review**. The original is on the left and the fields are on the right. Under each key field is the text it was read from; blue notes say what the system decided and why. **Confirm** with the button or Ctrl/⌘ + Enter.
   - Sample 1: "ACME Supply, Inc." matches the existing vendor **Acme Supply**. Once it is confirmed, credit memo CM-AS-9001 links to it through the invoice number printed on the memo.
   - Sample 3 names no invoice, and many invoices fit equally well, so the linker leaves it for you with a dropdown instead of guessing.
   - Sample 4 creates a new EUR vendor, shown under the EUR currency filter.
   - Sample 5: fix the total (2284.40) and confirm. The **Activity** tab records the correction as `total 2384.40 → 2284.40`.
5. Upload sample 1 again. It's recognized as already uploaded and no new record is created.
6. Open **Activity** to see the whole trail: who did what, and for the system's own steps, why. **Autonomy** now shows the zero-edit rate.
7. Open **Vendors** → **Acme Supply** → **Negotiation summary**, then print it or save it as a PDF.
8. On **Pacific Linen Svc**, use **Merge into…** to fold it into **Pacific Linen Service**.

## Metric definitions

All metrics use **confirmed** documents only. They are computed per vendor **and per currency**, since amounts are never converted. The same definitions appear as tooltips in the app; the source of truth is `METRIC_DEFINITIONS` in `src/lib/metrics.ts`.

| Metric | Definition |
| --- | --- |
| **Invoices** | Confirmed invoices dated in the period. |
| **Billing error rate** | Invoices in the period with at least one linked billing-error credit, divided by invoices in the period. Billing errors are `pricing_error`, `quantity_error` and `duplicate_billing`. The credit can be dated any time. Shows **—** when there are no invoices. |
| **Total credits** | Sum of confirmed credit memos dated in the period, with a breakdown by reason. |
| **Average credit size** | Total credits ÷ number of credits in the period (integer cents, rounded half up). **—** when there are no credits. |
| **Median days to resolve** | Median of (credit date − date of the invoice it corrects), over credits in the period that are linked to an invoice. Unlinked credits are left out. **—** when none are linked. |
| **Open credit balance** | Sum of all credits whose status is `open`, regardless of period. This is what the vendor still owes. |

Periods are inclusive and end today (UTC): last 90 days, last 365 days ("last 12 months" in sentences), and year to date. Credits more than 60 days old are flagged on the home page.

## How it works

- **Upload.** `POST /api/upload` stores each file under `{org}/{sha256}` and creates an `uploaded` document. The same file twice returns the existing document. That row is the job: a worker claims the oldest one with `FOR UPDATE SKIP LOCKED`, so two workers never take the same document and a restart loses nothing. The upload page polls `/api/documents/status`.
- **Extraction.** Claude reads the PDF or image once and returns a Zod-validated structured result (`client.beta.messages.parse` with server-side fallback): the fields, the exact printed text behind each key field, and a list of anything it wasn't sure about. Amounts arrive as decimal strings and become integer cents. In mock mode, the sample PDFs carry their correct extraction in their metadata, and other files get plausible made-up data.
- **Checks.** Plain code then decides whether the reading can be trusted: missing key fields block confirmation; totals that don't add up within $0.01 are flagged; a quoted source that doesn't contain its value is flagged; anything the extractor listed as uncertain is flagged. There are no confidence scores.
- **Autonomy.** Each organization picks a level: review everything (the default), auto-confirm clean documents up to a limit, or auto-confirm all clean documents. The guardrails hold at every level: no open issue, vendor already on file, an invoice or credit memo, not a duplicate. Anything else waits for a person, and the trail says why.
- **Duplicates.** Rejected two ways: the same file (unique on the file hash), or the same vendor + document number + currency + amount (a unique dedupe key enforced by Postgres).
- **Vendors.** Names are matched loosely: case, accents and punctuation are ignored, and suffixes like Inc, LLC and Co. are stripped. Every known spelling is kept as an alias. Vendors can be merged by hand.
- **Linking.** The invoice number printed on the memo is tried first. Otherwise the candidates are same-vendor, same-currency invoices from the 180 days before the credit, for at least the credit's amount, ranked by line-item overlap. Ties stay unlinked for a person to pick. Either way the linker stores a sentence saying what it did and why. New invoices trigger re-linking of that vendor's unlinked credits.
- **Reasons.** Each credit gets exactly one reason: the stated reason if there is one, otherwise inferred. The basis (which words, or the extractor's reading) is stored with it. People can change it on the review screen.
- **Audit trail.** Every change writes an append-only `AuditEvent` with its actor: a signed-in person, or a named part of the system (Extraction, Linker, Autopilot). A reviewer's confirmation records each field they corrected.

See [DECISIONS.md](DECISIONS.md) for every judgment call and why.

## Architecture

```
upload ─► Postgres: a Document row with status "uploaded" is the job
              │
              ▼   worker claims it (FOR UPDATE SKIP LOCKED)
        Claude reads the file once
        fields + source quotes + "not sure about" list      ◄── the only model call
              │
              ▼
        checks in plain code
        required fields · arithmetic · grounding · duplicates · reason rules
              │
              ▼
        autonomy level + guardrails ──► confirms itself, or waits for a person
              │
              ▼
        linker: links, or abstains and offers the candidates
              │
              ▼
        AuditEvent (actor, action, reason) ──► metrics in pure TypeScript
```

One Next.js app, TypeScript end to end, Postgres as the only store. The pieces under `src/lib` that make decisions are pure functions with unit tests; `src/lib/server` wraps them with database access.

### What it borrows from Ramp

| Ramp's published practice | Where it is here |
| --- | --- |
| "Every decision needs a 'why'": show reasoning and cite sources ([How to build agents users can trust](https://builders.ramp.com/post/how-to-build-agents-users-can-trust)) | Source quotes per field, `linkRationale`, `creditReasonBasis`, and the summary on every audit event |
| Escape hatches, and "confidence scores are hallucinations" (same post) | The extractor lists what it is unsure of; the linker abstains on ties. Outcomes are categories (`needs_review`, `ambiguous`), never a score |
| An autonomy slider bounded by deterministic guardrails such as dollar limits (same post) | The **Autonomy** page and `src/lib/autonomy.ts` |
| "Evals are the new unit tests" (same post) | `pnpm eval`, which fails the run when a rule change makes things worse |
| The model for the fuzzy part, deterministic code for dates and amounts ([receipt matching](https://builders.ramp.com/post/apple-intelligence-receipt-matching)) | The model reads; arithmetic, grounding, dedupe, linking and autonomy are plain code |
| A task queue built natively in Postgres, unique constraints against duplicates, a row lock so each update is processed once ([payments platform](https://builders.ramp.com/post/payments-platform)) | `src/lib/server/queue.ts`; unique file hash and dedupe key |
| Agent actions are logged with attribution that tells the person from the agent acting for them ([agent identity](https://builders.ramp.com/post/agent-identity-introduction)) | `AuditEvent.actorType` / `actorName`: a person, or Extraction, Linker, Autopilot |
| Invoice OCR is judged by "Perfect Extraction Rate (% of invoices with 0 edits required)" ([financial benchmarks](https://builders.ramp.com/post/financial-benchmarks)) | Zero-edit rate on the Autonomy page, counted from reviewer corrections |
| "Most Ramp API monetary values use integers in the smallest denomination of the relevant currency" ([API docs](https://docs.ramp.com/llms-guides/monetary-values.txt)) | Integer cents everywhere, never floats |
| Vendor credits are applied oldest first ([Bill Pay help](https://support.ramp.com/hc/en-us/articles/21321389409683-Vendor-credits-Credit-memos-on-Ramp-Bill-Pay)) | Open credits are listed oldest first |
| The Ryu design system: solar accent, warm neutrals, accent-filled primary button, a separate blue for AI | `src/app/globals.css` and the components in `src/components` |

Where it differs: Ramp's backend is Python (Flask and SQLAlchemy) with Celery workers and a React front end. This is one TypeScript codebase, because a team of three ships faster with one language and one deploy. The shape is the same: Postgres as the source of truth, constraints in the database, work done in the background.

## Code map

```
prisma/
  schema.prisma            Data model: every tenant table carries organizationId
  migrations/              SQL migrations
  demo-data.ts             The demo dataset as a pure generator, with the true answer for every credit
  seed.ts                  pnpm seed: writes demo-data to Postgres
scripts/generate-samples.ts  pnpm samples: the five PDFs in /samples
scripts/eval.ts            pnpm eval: replays demo-data against the linker and reason rules
samples/                   Sample invoices and credit memos for uploading

src/lib/                   Pure domain logic (unit tested) + infrastructure
  money.ts                 Integer cents: parse, format, totals by currency
  dates.ts, period.ts      Plain YYYY-MM-DD dates, period ranges
  vendors/normalize.ts     Loose vendor-name matching
  dedupe.ts                File hashes and vendor/number/amount duplicate keys
  linking.ts               Credit → invoice linking rules, their evidence and explanation
  reasons.ts               Credit reasons, billing-error set, reason classifier and its basis
  autonomy.ts              Autonomy levels and the guardrails that decide confirm or hold
  metrics.ts               Scorecard metric definitions and computation
  narrative.ts             Negotiation-summary sentences
  review.ts                What sends a document to review
  confirm.ts               Review-form schema, validation, and the diff of a reviewer's corrections
  extraction/              Extractor interface, Claude extractor, mock extractor, Zod schema,
                           and the grounding checks on the extractor's quoted sources
  storage.ts               FileStorage interface + local filesystem driver
  workspace.ts             The user and organization the app runs as (there is no sign-in)
  env.ts, db.ts            Config with defaults, Prisma client (pg adapter)
  server/                  Database-backed services, all scoped by organizationId
    pipeline.ts            Extract one document, run the checks, apply the autonomy setting
    queue.ts               Postgres-backed queue: claim with SKIP LOCKED, stuck-job recovery
    audit.ts               The audit trail: actors, recordEvent, activity read model
    settings.ts            Autonomy setting and the automation stats
    documents.ts           Upload, confirm, re-extract, delete, credit status
    linking.ts             Run the linker against the database, manual links
    vendors.ts             Find/create vendors by alias, merge
    queries.ts             Read models for the pages

src/app/
  (app)/page.tsx           Overview: amount owed, aging, to-do list, open and unlinked credits
  (app)/upload/            Drag-and-drop upload with live status
  (app)/documents/         Document list and the review screen ([id])
  (app)/vendors/           Scorecard, vendor detail ([id]), negotiation summary ([id]/summary)
  (app)/settings/          Autonomy: level, guardrails, zero-edit rate
  (app)/activity/          The audit trail
  (app)/actions.ts         Server actions (each one resolves the org from the current user)
  api/                     Upload, status polling, original-file download
src/components/            Shared UI; components/ui is shadcn/ui
```

## Tests and evals

`pnpm test` runs the Vitest suites in `src/lib/**/*.test.ts`:

- **Scorecard metrics**: a hand-built dataset with hand-calculated answers. It covers every metric, zero invoices, zero credits, unlinked credits, other currencies, sorting, and the spec's example sentence.
- **Vendor name matching**, **credit-to-invoice linking and its explanations**, **duplicate detection**, **money parsing, formatting and totals by currency**, **credit reasons and their basis**, **extraction normalization and review checks**, **grounding of quoted sources**, **the autonomy policy**, and **the diff of reviewer corrections**.

`pnpm eval` replays the demo dataset, where the generator knows which invoice every credit really corrects and why it was issued. Current results on 150 credits:

| | Linked automatically | Precision | Left for a person (right invoice offered) |
| --- | --- | --- | --- |
| As seeded (about 9 in 10 memos print the invoice number) | 120 (80%) | 100% | 30 |
| No memo prints an invoice number (heuristic only) | 2 (1.3%) | 100% | 148 |

The reason rules classify all 150 correctly without the model; always guessing the most common reason scores 30%. The run fails if the linker makes a wrong link or the reason rules drop below 95%.

These are regression gates on synthetic data, not accuracy on real documents: the synthetic memos use regular wording. `pnpm eval -- --extraction` runs the configured model on the five sample PDFs and reports the zero-edit rate; it is a smoke test until a labeled set of real documents replaces it.
