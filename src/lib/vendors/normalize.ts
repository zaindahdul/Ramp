// Loose vendor matching: "ACME Supply, Inc." and "Acme Supply" normalize to the
// same key. We ignore case, accents, punctuation and trailing legal suffixes.

const LEGAL_SUFFIXES: string[][] = [
  "incorporated",
  "inc",
  "llc",
  "l l c",
  "llp",
  "l l p",
  "lp",
  "ltd",
  "limited",
  "co",
  "company",
  "corp",
  "corporation",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "s a",
  "sarl",
  "sas",
  "bv",
  "nv",
  "pty",
  "pty ltd",
  "pte",
  "pc",
  "srl",
  "spa",
  "oy",
  "ab",
]
  .map((s) => s.split(" "))
  // Longest first so "pty ltd" wins over "ltd".
  .sort((a, b) => b.length - a.length);

function endsWith(tokens: string[], suffix: string[]): boolean {
  if (suffix.length >= tokens.length) return false;
  for (let i = 1; i <= suffix.length; i++) {
    if (tokens[tokens.length - i] !== suffix[suffix.length - i]) return false;
  }
  return true;
}

export function normalizeVendorName(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  let tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens[0] === "the") tokens = tokens.slice(1);

  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (endsWith(tokens, suffix)) {
        tokens = tokens.slice(0, tokens.length - suffix.length);
        stripped = true;
        break;
      }
    }
    // "Acme Supply Co and Co" style leftovers.
    if (tokens.length > 1 && tokens[tokens.length - 1] === "and") {
      tokens = tokens.slice(0, -1);
      stripped = true;
    }
  }
  return tokens.join(" ");
}

export function sameVendor(a: string, b: string): boolean {
  return normalizeVendorName(a) === normalizeVendorName(b);
}

/** A tidy display name for a vendor created from a document. */
export function displayVendorName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
