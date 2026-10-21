# Decisions

Judgment calls made while building the MVP, each with a one-line reason.

## Tooling and stack

- **Next.js 16.4 (App Router) with Cache Components off.** Every page is per-user and reads the session cookie, so a prerendered static shell buys nothing and adds Suspense rules.
- **Prisma 7.10.1, not the npm `latest` tag.** `latest` currently points at an 8.0 release candidate; 7.10.1 is the newest stable.
- **Prisma 7 with the `pg` driver adapter.** Prisma 7 requires a driver adapter; `@prisma/adapter-pg` is the standard one for Postgres.
- **shadcn/ui on the Radix base, Nova preset.** Radix is the long-standing shadcn base, and Nova is the default preset.
- **pnpm build scripts are allow-listed in `pnpm-workspace.yaml`.** pnpm 12 blocks dependency build scripts by default, and Prisma's engines need theirs.
- **Every env var has a working default** (`src/lib/env.ts`, `prisma.config.ts`). The setup steps never copy `.env.example`, so a clean clone has to run without a `.env`.
- **`pnpm db:migrate` runs `prisma migrate dev` and then `prisma generate`.** Prisma 7 no longer generates the client as a side effect of migrating.
- **The repo branch is `main`.** The GitHub repo was empty, and `main` is GitHub's default.

## Money, dates and currencies

- **Amounts are `Int` cents in Postgres (max about $21.4M per document).** This avoids BigInt serialization everywhere; amounts above the cap are rejected at extraction and on the form, not overflowed.
- **Cents are JavaScript integers, checked with `Number.isSafeInteger`.** Sums stay exact up to 2^53 cents, far beyond any real AP balance.
- **Parsing and formatting work on decimal strings.** `parseMoneyToCents` never multiplies a float by 100, and `formatCents` passes a decimal string to `Intl.NumberFormat`.
- **"Cents" means the currency's minor unit** (yen for JPY). The digit count comes from `Intl`, so zero-decimal currencies format correctly.
- **Averages round half away from zero with integer math** (`divRound`). This keeps the "no floats for money" rule even when dividing.
- **Credit memo totals are stored as positive numbers.** Documents print credits as -$50, ($50) or $50; the document type already says it's a credit.
- **Quantity is a `Float`.** It isn't money and can be fractional (2.5 hours); line totals in cents remain the source of truth.
- **Unit prices are rounded to whole cents.** Sub-cent unit prices are rare in AP, and the line total carries the exact amount.
- **Currencies are never converted or summed together.** The home page shows one total per currency; the scorecard, vendor page and summary are per currency, with a currency switcher.
- **The scorecard shows one currency at a time.** Sorting by money needs a single currency, and mixing USD and EUR in one column would imply a conversion.
- **Business dates are `DATE` columns, handled as `YYYY-MM-DD` strings in app code.** No time zone can shift an invoice date by a day.
- **"Today" is the UTC date.** It's simple and consistent across server and seed; a per-organization time zone is listed as future work.

## Documents, extraction and review

- **Every extracted document goes to `needs_review`; nothing is auto-confirmed.** The spec's status flow always passes through review, and financial data from an LLM deserves a human look in an MVP.
- **The review rule decides what is flagged, not what is skipped.** Documents with missing key fields or totals that don't add up show the issues at the top; clean ones show "Ready to confirm".
- **A "Confirm N clean documents" button exists for bulk work.** It gets you straight-through processing without giving up the review step.
- **Key fields are type, vendor, document number, document date, currency and total.** Due date and terms are often absent on real invoices and on all credit memos.
- **Missing key fields block confirmation; a totals mismatch is a warning.** Discounts, freight and rounding legitimately break the arithmetic on some documents.
- **"Add up within $0.01" means lines + tax = total, and lines = subtotal when a subtotal is printed.** Line items are usually pre-tax.
- **Documents classified `other` can be confirmed but never count in metrics.** A statement or quote uploaded by mistake is kept for the record.
- **The vendor is matched at extraction but created only on confirm.** A misread vendor name shouldn't create a junk vendor.
- **Extraction uses `client.beta.messages.parse` with a Zod schema and `fallbacks: "default"`.** This gives structured output validated by Zod, plus a server-side retry if the model declines for policy reasons.
- **The default model is `claude-opus-5-5` at `medium` effort, overridable with `ANTHROPIC_MODEL`.** It's the current default model, and extraction is a single, bounded call.
- **The extraction schema uses plain strings for the document type and reason.** The SDK turns Zod enums into a description hint, so the code maps whatever comes back onto the enum instead of failing.
- **Amounts in the extraction schema are decimal strings.** Model output never passes through a JavaScript float.
- **Mock mode applies whenever `ANTHROPIC_API_KEY` is unset.** The spec ties mock mode to that variable, even though the SDK can find other credentials.
- **Sample PDFs carry their own correct extraction in the PDF Subject metadata.** In mock mode they extract exactly as Claude would read the visible text; any other file gets plausible data derived from its hash.
- **The mock adds a 0.9–1.5 second delay.** The upload page should visibly move through `extracting`.
- **The background queue is in-process, with two workers, on `globalThis`.** The spec allows it; each document is claimed with an `updateMany` on its status, so it never runs twice.
- **Polling the status endpoint also recovers stuck jobs.** A dev-server restart would otherwise leave documents in `uploaded` or `extracting` forever.
- **Files are content-addressed per organization (`{org}/{sha256}.{ext}`).** The same file always maps to the same key, which makes same-file dedupe free.
- **Seeded documents have no file.** Generating about 2,000 PDFs would slow the seed for no benefit; the review screen says it's a seeded record.

## Duplicates

- **Same file: unique `(organizationId, fileSha256)`.** Re-uploading returns the existing document instead of creating one.
- **Same record: unique `(organizationId, dedupeKey)`, where the key is vendor, normalized document number, currency and total.** The spec's rule, enforced by the database rather than a pre-check alone.
- **Currency is part of the dedupe key.** 100 USD and 100 EUR are different amounts.
- **Document numbers are normalized by uppercasing and dropping separators** (`INV-1001` = `inv 1001`). Extraction often varies spacing and dashes; the cost is that `1-23` and `12-3` collide.
- **Before a vendor exists, the key uses the normalized vendor name.** Two uploads for a brand-new vendor still collide before either is confirmed.
- **A duplicate found during extraction is kept as `failed`, with a link to the original.** The user sees why the upload didn't create a record, and it never counts in metrics.
- **Duplicates revealed by a vendor merge are flagged, not deleted.** Deleting confirmed financial records automatically is too risky.

## Vendors

- **Matching ignores case, accents, punctuation, a leading "The" and trailing legal suffixes** (Inc, LLC, Co., Corp, Ltd, GmbH, SA, …). `&` is treated as "and". This is the spec's rule, extended with common international suffixes.
- **No fuzzy or abbreviation matching** ("Svc" ≠ "Service"). False merges corrupt metrics; the manual merge exists for the rest.
- **A `VendorAlias` table holds every normalized name that maps to a vendor.** After a merge, uploads under the old name keep matching the merged vendor.
- **Merge moves documents and aliases, then deletes the source vendor.** It is simple to reason about; there is no unmerge yet.

## Linking credits to invoices

- **A referenced invoice number is only matched within the same vendor.** Invoice numbers are only unique per vendor.
- **A referenced number wins even outside the 180-day window or amount rule.** An explicit reference is stronger evidence than any heuristic.
- **If the referenced invoice isn't on file, the heuristic runs.** The invoice may simply not have been uploaded yet.
- **The heuristic also requires the same currency.** Comparing "at least as large" across currencies would be a conversion.
- **"Within 180 days before" includes both the same day and exactly 180 days.** These are inclusive boundaries.
- **Line overlap counts how many credit lines match an invoice line.** Two lines match when they share at least half the significant words of the shorter one, ignoring stop words like "credit" and "price".
- **Ties are not broken by date proximity.** The spec says equally good fits stay unlinked for a person to pick; the dropdown lists the tied invoices first, newest first.
- **When an invoice is confirmed, that vendor's unlinked credits are re-linked.** Credits often arrive before the invoice they correct is uploaded.
- **A manual pick is never overridden by auto-linking.** Choosing "Doesn't correct an invoice" is also remembered.

## Credit reasons and status

- **A stated reason is classified with keyword rules first, then the model's suggestion, then "other".** The stated text is the strongest signal, and rules are cheap and testable.
- **With no stated reason, the model's suggestion wins, then keyword rules on the line items.**
- **Rule order matters: duplicate, pricing, quantity, damaged, service failure, rebate, return.** "Discount not applied" is a pricing error, not a promo.
- **A user-chosen reason is stored with source `user`.** That keeps an audit trail of what the extractor said versus what a person decided.
- **New credits start `open`.** An unprocessed credit is money still owed.
- **Credit age is measured from the credit memo date, not the upload date.** Age is about how long the vendor has owed the money.
- **"More than 60 days" means age > 60.** A credit exactly 60 days old isn't highlighted yet.

## Scorecard metrics

- **Metrics are computed in TypeScript (`src/lib/metrics.ts`) from confirmed documents, not in SQL.** One pure, unit-tested implementation feeds the scorecard, vendor page and summary; about 2,000 rows load in milliseconds.
- **Billing error rate counts a linked billing-error credit of any date against invoices in the period.** Corrections often arrive after the period ends; the denominator is still invoices in the period.
- **Open credit balance is all-time, not period-filtered.** The spec's definition has no period, and an open balance is a point-in-time number; the tooltip says so.
- **Median days to resolve uses credits dated in the period that are linked.** Unlinked credits have no invoice date; the spec says linked only.
- **A median over an even count is the mean of the middle two** (it can show "46.5 days").
- **"—" appears for an error rate with no invoices, and for an average or median with nothing to measure.** A 0 would claim a measurement that wasn't made.
- **Rows that show "—" always sort last**, in both directions.
- **The scorecard lists vendors with any confirmed document in the selected currency.** Clean, quiet vendors still appear, with zeros.
- **Periods are inclusive and end today: the last 90 days is today and the 89 days before.** "Last 365 days" reads "in the last 12 months" in sentences.

## Negotiation summary

- **Sentences are built only from the computed metrics.** The page can't say anything the numbers don't back up, and the logic is unit-tested against the spec's example sentence.
- **The lead sentence covers the largest billing-error reason, with that reason's own error rate.** It matches the spec's example; an "Overall …" sentence follows when there are several billing-error reasons.
- **"$X of those credits are still unused" counts open credits of that reason in the period.** "Those" refers to the credits in the sentence; the all-time open balance gets its own sentence.
- **Sentence amounts round to whole dollars; tables keep cents.** The spec's example uses whole dollars.
- **Printing uses the browser's print-to-PDF with print CSS.** It needs no extra dependency, and the app chrome hides itself when printing.

## Auth and tenancy

- **Auth is hand-rolled: bcrypt passwords plus database sessions.** A random token goes in an httpOnly cookie and only its sha256 is stored. It's small, with no beta auth library in the critical path.
- **Every tenant table has `organizationId`, and every query filters by it.** The org comes from the session, never from request input.
- **Signup creates a new organization.** There are no invitations yet, so one org per signup is the only option.
- **The proxy (Next 16's renamed middleware) only checks that the cookie exists.** The real validation happens in `requireSession` and the API routes; the proxy skips `/api` so uploads aren't buffered by it.

## Seed data

- **The seed is a fictional restaurant group, Bluebird Hospitality Group.** Its vendors (food, linen, equipment, services) make the credit reasons feel natural.
- **The seed is deterministic except for "today".** Data is generated relative to the current date, so ages and periods always look current.
- **Seeded credits are linked with the real linker.** The 10% of credits without a reference, plus rebates, show real ambiguous and unlinked cases.
- **"Pacific Linen Svc" and "Pacific Linen Service" are deliberately two vendors.** They demonstrate manual merge.
- **Non-USD documents come from whole vendors** (EUR, GBP, CAD). Vendors usually bill in one currency.
- **Rerunning `pnpm seed` deletes and rebuilds the demo organization.** That keeps it idempotent; it touches no other organization.
