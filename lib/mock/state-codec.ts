import zlib from "node:zlib";
import type { MockStates } from "@/lib/mock/persist";

/**
 * Packs mock mode's states into text small enough to live in cookies:
 * JSON, compressed with Brotli, written in base64url.
 *
 * The numbers come from the host, not from taste. Vercel refuses a request
 * whose Cookie header is larger than 16 KB, and browsers refuse a cookie
 * larger than about 4 KB. So the text is cut into chunks, and a world that
 * would not fit is rejected instead of being saved half-way.
 */
export const CHUNK_SIZE = 3600;
export const MAX_ENCODED_SIZE = 11_000;
/** A decompressed world this large did not come from us. */
const MAX_DECODED_BYTES = 4_000_000;

export function encodeStates(states: MockStates): string {
  return zlib.brotliCompressSync(Buffer.from(JSON.stringify(states), "utf8")).toString("base64url");
}

/** The states inside `encoded`, or null if it is not something encodeStates produced. */
export function decodeStates(encoded: string): MockStates | null {
  try {
    const json = zlib
      .brotliDecompressSync(Buffer.from(encoded, "base64url"), { maxOutputLength: MAX_DECODED_BYTES })
      .toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as MockStates;
  } catch {
    return null;
  }
}

export function splitChunks(encoded: string, size = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < encoded.length; start += size) chunks.push(encoded.slice(start, start + size));
  return chunks;
}
