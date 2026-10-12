/**
 * Where mock mode keeps its world (the fake ledger and the fake database).
 *
 * - "local": in this process's memory, mirrored to .mock-data/. One world for
 *   everybody who reaches this server. Right for `npm run dev:mock`.
 * - "cookie": in the visitor's own cookies. A serverless host such as Vercel
 *   shares neither memory nor disk between two requests, so the world has to
 *   travel with the request. Each visitor gets a private sandbox.
 *
 * next.config.ts picks "cookie" on Vercel and "local" elsewhere, and writes the
 * choice into this variable at build time so server and browser agree.
 */
export const MOCK_STATE_IN_COOKIES = process.env.NEXT_PUBLIC_RECEBI_MOCK_STATE === "cookie";
