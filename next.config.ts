import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The sidebar's account block sits bottom-left; keep the dev badge off it.
  devIndicators: { position: "bottom-right" },
  // Cache Components is off on purpose: every page reads live data from
  // Postgres on each request, so there is nothing to prerender. See DECISIONS.md.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
