import "dotenv/config";
import { defineConfig } from "prisma/config";

// Matches docker-compose.yml so a clean clone works without a .env file.
const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/ap_credits?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  },
});
