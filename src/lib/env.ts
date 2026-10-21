// All configuration comes from environment variables. Every value has a local
// default so a clean clone runs without a .env file (see .env.example).

export const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/ap_credits?schema=public";

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = {
  get DATABASE_URL() {
    return read("DATABASE_URL") ?? DEFAULT_DATABASE_URL;
  },
  get ANTHROPIC_API_KEY() {
    return read("ANTHROPIC_API_KEY") ?? null;
  },
  get ANTHROPIC_MODEL() {
    return read("ANTHROPIC_MODEL") ?? "claude-opus-5-5";
  },
  get STORAGE_DIR() {
    return read("STORAGE_DIR") ?? "./storage";
  },
  get SESSION_COOKIE_SECURE() {
    return read("SESSION_COOKIE_SECURE") === "true";
  },
};

/** Mock extraction runs whenever no Anthropic API key is configured. */
export function isMockMode(): boolean {
  return env.ANTHROPIC_API_KEY === null;
}
