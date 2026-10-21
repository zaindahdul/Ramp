# AP Credit Recovery & Vendor Scorecard

When a vendor overbills you, they later issue a **credit memo**: "we owe you $X". Those credits get lost. This app reads uploaded invoices and credit memos, links each credit to the invoice it corrects, shows which credits are still unused (money you're owed), and scores vendors on how often they make billing mistakes. Each vendor also gets a printable negotiation summary.

Nothing in this app moves money.

## Setup

Requirements: Node 22+ (tested on 24), pnpm, and Docker for Postgres.

```bash
pnpm install          # also generates the Prisma client
docker compose up -d  # Postgres 16 on localhost:5432
pnpm db:migrate       # applies prisma/migrations
pnpm seed             # demo login + 18 months of fake AP data
pnpm dev              # http://localhost:3000
```

**Demo login:** `demo@example.com` / `demo1234`

No `.env` is needed. Every setting has a local default that matches `docker-compose.yml`. To change anything, copy `.env.example` to `.env`:

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/ap_credits` | Postgres connection |
| `ANTHROPIC_API_KEY` | unset | Unset means **mock extraction mode** (a banner says so) |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model used for extraction |
| `STORAGE_DIR` | `./storage` | Where uploaded files are written |
| `SESSION_COOKIE_SECURE` | `false` | Set `true` behind HTTPS |

### Other scripts

| Command | |
| --- | --- |
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` | Generates Next route types, then `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm samples` | Regenerates the PDFs in `/samples` |
| `pnpm db:reset` | Drops and recreates the database (then run `pnpm seed`) |

## Try it

1. Sign in. The home page shows the **open credits total** per currency, the open credits (rows older than 60 days are highlighted), and the credits that couldn't be linked to an invoice automatically.
2. Go to **Upload** and drop all five files from `/samples`. Each one moves `uploaded → extracting → needs_review`.
3. Open each one. The original is on the left and the extracted fields are on the right. Click **Confirm**.
   - `1-invoice-acme-supply.pdf`: "ACME Supply, Inc." matches the existing vendor **Acme Supply**.
   - `2-credit-memo-acme-supply-pricing.pdf` links to invoice AS-90001 through its referenced invoice number.
   - `3-credit-memo-harbor-produce-no-reference.pdf` names no invoice, and many invoices fit equally well, so it stays unlinked with a dropdown.
   - `4-invoice-new-vendor-eur.pdf` creates a new EUR vendor, shown under the EUR currency filter.
   - `5-invoice-coastal-seafood-needs-review.pdf` is flagged: its lines add up to $100 less than the printed total. Fix the total (2284.40) and confirm.
4. Upload sample 1 again. It's recognized as already uploaded and no new record is created.
5. Open **Vendor scorecard** → **Acme Supply** → **Negotiation summary**, then print it or save it as a PDF.
6. On **Pacific Linen Svc**, use **Merge into…** to fold it into **Pacific Linen Service**.

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

- **Upload.** `POST /api/upload` stores each file under `{org}/{sha256}` and creates an `uploaded` document. The same file twice returns the existing document. An in-process queue (two workers) runs extraction in the background, and the upload page polls `/api/documents/status`.
- **Extraction.** Claude reads the PDF or image and returns a Zod-validated structured result (`client.beta.messages.parse` with server-side fallback). In mock mode, the sample PDFs carry their correct extraction in their metadata, and other files get plausible made-up data. Amounts arrive as decimal strings and become integer cents.
- **Review.** Missing key fields block confirmation. Totals that don't add up within $0.01 are flagged. Nothing is auto-confirmed; a "Confirm N clean documents" button covers bulk work.
- **Duplicates.** Rejected two ways: the same file (unique on the file hash), or the same vendor + document number + currency + amount (a unique dedupe key enforced by Postgres).
- **Vendors.** Names are matched loosely: case, accents and punctuation are ignored, and suffixes like Inc, LLC and Co. are stripped. Every known spelling is kept as an alias. Vendors can be merged by hand.
- **Linking.** The referenced invoice number is tried first. Otherwise the candidates are same-vendor, same-currency invoices from the 180 days before the credit, for at least the credit's amount, ranked by line-item overlap. Ties stay unlinked for a person to pick. New invoices trigger re-linking of that vendor's unlinked credits.
- **Reasons.** Each credit gets exactly one reason: the stated reason if there is one, otherwise inferred. People can change it on the review screen.

See [DECISIONS.md](DECISIONS.md) for every judgment call and why.

## Code map

```
prisma/
  schema.prisma            Data model: every tenant table carries organizationId
  migrations/              SQL migrations
  seed.ts                  pnpm seed: demo org, 25 vendors, ~2,000 invoices, 150 credits
scripts/generate-samples.ts  pnpm samples: the five PDFs in /samples
samples/                   Sample invoices and credit memos for uploading

src/lib/                   Pure domain logic (unit tested) + infrastructure
  money.ts                 Integer cents: parse, format, totals by currency
  dates.ts, period.ts      Plain YYYY-MM-DD dates, period ranges
  vendors/normalize.ts     Loose vendor-name matching
  dedupe.ts                File hashes and vendor/number/amount duplicate keys
  linking.ts               Credit → invoice linking rules
  reasons.ts               Credit reasons, billing-error set, reason classifier
  metrics.ts               Scorecard metric definitions and computation
  narrative.ts             Negotiation-summary sentences
  review.ts                What sends a document to review
  confirm.ts               Review-form schema and validation
  extraction/              Extractor interface, Claude extractor, mock extractor, Zod schema
  storage.ts               FileStorage interface + local filesystem driver
  auth.ts                  Password hashing and database sessions
  env.ts, db.ts            Config with defaults, Prisma client (pg adapter)
  server/                  Database-backed services, all scoped by organizationId
    pipeline.ts            Extract one document: uploaded → extracting → needs_review/failed
    queue.ts               In-process background queue with stuck-job recovery
    documents.ts           Upload, confirm, re-extract, delete, credit status
    linking.ts             Run the linker against the database, manual links
    vendors.ts             Find/create vendors by alias, merge
    queries.ts             Read models for the pages

src/app/
  (auth)/                  Login and signup
  (app)/page.tsx           Home: open credits total, open and unlinked credits
  (app)/upload/            Drag-and-drop upload with live status
  (app)/documents/         Document list and the review screen ([id])
  (app)/vendors/           Scorecard, vendor detail ([id]), negotiation summary ([id]/summary)
  (app)/actions.ts         Server actions (each one resolves the org from the session)
  api/                     Upload, status polling, original-file download
src/proxy.ts               Redirects signed-out visitors to /login
src/components/            Shared UI; components/ui is shadcn/ui
```

## Tests

`pnpm test` runs the Vitest suites in `src/lib/**/*.test.ts`:

- **Scorecard metrics**: a hand-built dataset with hand-calculated answers. It covers every metric, zero invoices, zero credits, unlinked credits, other currencies, sorting, and the spec's example sentence.
- **Vendor name matching**, **credit-to-invoice linking**, **duplicate detection**, **money parsing, formatting and totals by currency**, **credit reasons**, and **extraction normalization and review checks**.
