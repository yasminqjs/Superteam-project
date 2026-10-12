/** A failed API call: the server's message, plus the HTTP status for callers that care. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Calls one of our own API routes from the browser. Sends `json` as the body
 * and throws an ApiError carrying the server's message when the answer is not
 * 2xx, so callers can show `error.message` directly.
 */
export async function api<T>(
  path: string,
  options: { method?: string; json?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? (options.json === undefined ? "GET" : "POST"),
    headers: options.json === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (HTTP ${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

/** The message of anything thrown, for display. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
