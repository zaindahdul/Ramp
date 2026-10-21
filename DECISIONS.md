# Decisions

Judgment calls made while building the MVP, each with a one-line reason.

## Tooling and stack

- **Next.js 16.4 (App Router) with Cache Components off.** Every page is per-user and reads the session cookie, so a prerendered static shell buys nothing and adds Suspense rules.
- **Prisma 7.10.1, not the npm `latest` tag.** `latest` currently points at an 8.0 release candidate; 7.10.1 is the newest stable.
- **Prisma 7 with the `pg` driver adapter.** Prisma 7 requires a driver adapter; `@prisma/adapter-pg` is the standard one for Postgres.
- **shadcn/ui on the Radix base, Nova preset.** Radix is the long-standing shadcn base, and Nova is the default preset.
- **pnpm build scripts are allow-listed in `pnpm-workspace.yaml`.** pnpm 12 blocks dependency build scripts by default, and Prisma's engines need theirs.
- **Every env var has a working default** (`src/lib/env.ts`). The setup steps never copy `.env.example`, so a clean clone has to run without a `.env`.
- **The repo branch is `main`.** The GitHub repo was empty, and `main` is GitHub's default.
