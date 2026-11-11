import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ExtractionSchema, type RawExtraction } from "@/lib/extraction/schema";
import { ExtractionError, type ExtractInput, type Extractor } from "@/lib/extraction/types";

const SYSTEM_PROMPT = `You read accounts-payable documents (vendor invoices and credit memos) and return their fields as structured data.

Classify the document:
- invoice: a vendor bill asking to be paid.
- credit_memo: a credit memo, credit note or refund notice saying the vendor owes the customer money.
- other: anything else (statements, quotes, receipts, purchase orders, unrelated files).

Rules:
- Copy what is printed. Use null for any field the document does not show; never invent numbers, dates or invoice numbers.
- vendorName is the company that issued the document, not the customer it is addressed to.
- Dates are YYYY-MM-DD. Interpret ambiguous numeric dates using the document's locale and currency.
- Amounts are plain decimal strings with a dot as the decimal separator and no currency symbols or thousands separators, e.g. "1234.56".
- Credit memo amounts are positive, even if printed as negative or in parentheses.
- currency is an ISO 4217 code. Use the printed code or symbol; "$" alone means USD unless the document indicates otherwise.
- lineItems lists every billed line with its own line total. Leave out subtotal, tax, shipping-summary and total rows unless shipping or fees are billed as their own line.
- For credit memos, referencedInvoiceNumber is the invoice the credit corrects, if printed. statedReason is the reason exactly as written, if any.
- suggestedReason (credit memos only) is the single best category:
  pricing_error (charged the wrong price or rate), quantity_error (billed for more units than delivered),
  damaged_or_defective, duplicate_billing (billed twice), return, rebate_or_promo,
  service_failure (missed SLA, late or failed service), other.
  Use null for invoices and other documents.

Show where each value came from. In evidence, give the exact printed text behind vendorName, documentNumber, documentDate, total, referencedInvoiceNumber and statedReason, for each of those you filled in. Copy the text as printed, including its label when there is one ("Total due $1,246.90"). A person checks your reading against these quotes, and so does a program.

Say when you are not sure. If a value is smudged, handwritten over, cut off, or printed two different ways, still give your best reading, and list the field in uncertain with one sentence on what is wrong. An uncertain reading goes to a person; a confident wrong one may not, so do not guess silently. Leave uncertain empty when the document is clear.`;

// Server-side fallback: if the model declines for policy reasons, the API
// retries on Anthropic's recommended fallback model. With "default", models
// that don't support fallbacks just run alone.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ClaudeExtractor implements Extractor {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.name = `claude:${model}`;
    this.client = new Anthropic({ apiKey });
  }

  async extract(input: ExtractInput): Promise<RawExtraction> {
    const data = input.data.toString("base64");
    const file: Anthropic.Beta.BetaContentBlockParam =
      input.mimeType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
              data,
            },
          };

    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [file, { type: "text", text: userText(input) }],
          },
        ],
        output_config: { effort: "medium", format: betaZodOutputFormat(ExtractionSchema) },
      });
    } catch (error) {
      throw toExtractionError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new ExtractionError("The model declined to read this document.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new ExtractionError("The extraction was cut off before it finished. The document may be too long.");
    }
    if (!response.parsed_output) {
      throw new ExtractionError("The model's answer didn't match the extraction schema.");
    }
    return response.parsed_output;
  }
}

/**
 * Per-request context, kept out of the system prompt so that prompt stays
 * byte-identical across organizations. The customer's name guards against the
 * most common misread: taking the "bill to" party for the vendor.
 */
function userText(input: ExtractInput): string {
  const lines = [`File name: ${input.filename}`];
  const { customerName, knownVendors } = input.hints;
  if (customerName) {
    lines.push(`This document was sent to ${customerName}, the customer. ${customerName} is never the vendor.`);
  }
  if (knownVendors.length > 0) {
    lines.push(
      `Vendors already on file, for context only (still copy the issuer's name exactly as printed): ${knownVendors.join("; ")}.`,
    );
  }
  lines.push("Extract this document.");
  return lines.join("\n");
}

function toExtractionError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new ExtractionError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ExtractionError("Rate limited by the Anthropic API. Retry in a minute.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ExtractionError(`The Anthropic API rejected the request: ${error.message}`);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ExtractionError("Couldn't reach the Anthropic API.");
  }
  if (error instanceof Anthropic.APIError) {
    return new ExtractionError(`Anthropic API error ${error.status ?? ""}: ${error.message}`.trim());
  }
  return error instanceof Error ? error : new Error(String(error));
}
