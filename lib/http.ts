import { NextResponse } from "next/server";
import { HttpError } from "@/lib/errors";
import { MOCK_STATE_IN_COOKIES } from "@/lib/mock/backend";
import { withMockCookieState } from "@/lib/mock/cookie-state";
import { IS_MOCK } from "@/lib/mode";

/**
 * Wraps a route handler so every failure becomes a JSON answer of the form
 * { "error": "message" }. Expected errors keep their status and message;
 * anything else is logged and reported as a generic 500.
 *
 * In mock mode on a serverless host it also gives the request its mock world,
 * which travels in the visitor's cookies (see lib/mock/cookie-state.ts).
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response | object>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    const respond = async (): Promise<Response> => {
      try {
        const result = await handler(...args);
        return result instanceof Response ? result : NextResponse.json(result);
      } catch (error) {
        if (error instanceof HttpError) {
          return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[api]", error);
        const message = error instanceof Error ? error.message : "Unexpected error";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    };
    return IS_MOCK && MOCK_STATE_IN_COOKIES ? withMockCookieState(respond) : respond();
  };
}

/** Reads a JSON body as a plain object, or fails with a 400. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Fall through.
  }
  throw new HttpError(400, "The request body must be a JSON object");
}

/** The public origin of this request, e.g. "https://recebi.example". */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}
