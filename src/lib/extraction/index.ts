import { env } from "@/lib/env";
import { ClaudeExtractor } from "@/lib/extraction/claude";
import { MockExtractor } from "@/lib/extraction/mock";
import type { Extractor } from "@/lib/extraction/types";

let extractor: Extractor | null = null;

/** Claude when ANTHROPIC_API_KEY is set, otherwise the mock. */
export function getExtractor(): Extractor {
  if (!extractor) {
    const apiKey = env.ANTHROPIC_API_KEY;
    extractor = apiKey ? new ClaudeExtractor(apiKey, env.ANTHROPIC_MODEL) : new MockExtractor();
  }
  return extractor;
}
