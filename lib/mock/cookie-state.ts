import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieOptions } from "@/lib/auth/session";
import { runInMockScope, type MockStates } from "@/lib/mock/persist";
import { MAX_ENCODED_SIZE, decodeStates, encodeStates, splitChunks } from "@/lib/mock/state-codec";

/**
 * Mock mode on a serverless host: the visitor's cookies are the database.
 *
 * Each request reads the mock world from the cookies, runs against that
 * private copy and, if anything changed, writes the world back. Nothing is
 * kept on the server, so it does not matter which machine answers next.
 *
 * What this costs: the world belongs to one browser. A link to a receipt or
 * an invoice opens only where it was created, and two requests that both
 * change the world at the same instant keep only the later change. Both are
 * fine for a sandbox one person clicks through, and wrong for anything real,
 * which is why this exists only in mock mode.
 */
const COOKIE = "recebi_mock";
const DAYS = 7;
const MAX_CHUNKS = 8;

const chunkName = (index: number) => `${COOKIE}_${index}`;

type Jar = Awaited<ReturnType<typeof cookies>>;

function readStates(jar: Jar): { states: MockStates; chunks: number } {
  const chunks = Number(jar.get(COOKIE)?.value);
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS) return { states: {}, chunks: 0 };
  let encoded = "";
  for (let index = 0; index < chunks; index++) encoded += jar.get(chunkName(index))?.value ?? "";
  // A world that does not decode (a lost chunk, an edited cookie) is dropped:
  // the visitor starts again from the demo data.
  return { states: decodeStates(encoded) ?? {}, chunks };
}

export async function withMockCookieState(run: () => Promise<Response>): Promise<Response> {
  const jar = await cookies();
  const before = readStates(jar);
  const outcome = await runInMockScope(before.states, run);
  if (!outcome.dirty) return outcome.result;

  const encoded = encodeStates(outcome.states);
  if (encoded.length > MAX_ENCODED_SIZE) {
    return NextResponse.json(
      { error: 'This demo sandbox is full. Click "Reset demo data" at the top to start again.' },
      { status: 507 },
    );
  }

  const chunks = splitChunks(encoded);
  const options = cookieOptions(DAYS * 24 * 60 * 60);
  chunks.forEach((chunk, index) => jar.set(chunkName(index), chunk, options));
  for (let index = chunks.length; index < before.chunks; index++) jar.delete(chunkName(index));
  jar.set(COOKIE, String(chunks.length), options);
  return outcome.result;
}
