import type { NextConfig } from "next";

// Vercel sets VERCEL=1 while building and while running.
const onVercel = Boolean(process.env.VERCEL);

// Values written into the bundle at build time, for server and browser alike.
const env: Record<string, string> = {
  // A serverless host shares neither memory nor disk between requests, so
  // there the mock world travels in the visitor's cookies. See lib/mock/backend.ts.
  NEXT_PUBLIC_RECEBI_MOCK_STATE:
    process.env.RECEBI_MOCK_STATE === "cookie" || (onVercel && process.env.RECEBI_MOCK_STATE !== "local")
      ? "cookie"
      : "local",
};
// Deployed to Vercel with no mode chosen: the sandbox, which needs no
// configuration, instead of a live site with no database behind it.
// Set NEXT_PUBLIC_RECEBI_MODE=live (and the variables in .env.example) for the real thing.
if (onVercel && !process.env.NEXT_PUBLIC_RECEBI_MODE) env.NEXT_PUBLIC_RECEBI_MODE = "mock";

const nextConfig: NextConfig = {
  env,
  // Cache Components is intentionally off: see DECISIONS.md.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
