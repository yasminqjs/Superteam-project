import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { MOCK_STATE_IN_COOKIES } from "@/lib/mock/backend";

/**
 * Mock mode's state: a few named JSON values ("ledger", "db", "seeded").
 *
 * Normally they live on globalThis, because Next.js may load a module more
 * than once (one copy per route in development), and are mirrored to
 * .mock-data/ so the demo data survives a dev server restart.
 *
 * A request can instead run in its own scope (runInMockScope), with a private
 * copy of the states that came from somewhere else. That is how the mock world
 * travels in a visitor's cookies on a serverless host: see cookie-state.ts.
 *
 * RECEBI_MOCK_PERSIST=off keeps everything in memory (used by the tests).
 */
export type MockStates = Record<string, unknown>;

interface Scope {
  states: MockStates;
  /** Set by saveState: the caller needs to store the states again. */
  dirty: boolean;
}

const globalStore = globalThis as {
  __recebiMock?: MockStates;
  __recebiMockScope?: AsyncLocalStorage<Scope>;
};
// On globalThis for the same reason as the states: one instance, however many
// copies of this module exist.
const scopes = (globalStore.__recebiMockScope ??= new AsyncLocalStorage<Scope>());

/**
 * Runs `fn` against `states` instead of the shared ones, and reports what the
 * states are afterwards and whether anything was saved.
 */
export async function runInMockScope<T>(
  states: MockStates,
  fn: () => Promise<T>,
): Promise<{ result: T; states: MockStates; dirty: boolean }> {
  const scope: Scope = { states, dirty: false };
  const result = await scopes.run(scope, fn);
  return { result, states: scope.states, dirty: scope.dirty };
}

function currentScope(): Scope | null {
  const scope = scopes.getStore();
  if (!scope && MOCK_STATE_IN_COOKIES) {
    // The shared states do not exist on a serverless host. Reading them would
    // work on one machine and silently diverge on the next.
    throw new Error("Mock state was used outside a request scope. Wrap the handler in route().");
  }
  return scope ?? null;
}

function mockDir(): string {
  return process.env.RECEBI_MOCK_DIR || path.join(process.cwd(), ".mock-data");
}

function persistenceEnabled(): boolean {
  return process.env.RECEBI_MOCK_PERSIST !== "off";
}

/** Returns the state called `name`, loading it from disk or creating it. */
export function loadState<T>(name: string, create: () => T): T {
  const scope = currentScope();
  if (scope) {
    if (!(name in scope.states)) scope.states[name] = create();
    return scope.states[name] as T;
  }

  globalStore.__recebiMock ??= {};
  const cache = globalStore.__recebiMock;
  if (!(name in cache)) {
    let state: T | undefined;
    if (persistenceEnabled()) {
      try {
        state = JSON.parse(fs.readFileSync(path.join(mockDir(), `${name}.json`), "utf8")) as T;
      } catch {
        // No file yet, or unreadable: start fresh.
      }
    }
    cache[name] = state ?? create();
  }
  return cache[name] as T;
}

/** Replaces the state called `name` and stores it. */
export function saveState<T>(name: string, state: T): void {
  const scope = currentScope();
  if (scope) {
    scope.states[name] = state;
    scope.dirty = true;
    return;
  }

  globalStore.__recebiMock ??= {};
  globalStore.__recebiMock[name] = state;
  if (!persistenceEnabled()) return;
  try {
    fs.mkdirSync(mockDir(), { recursive: true });
    fs.writeFileSync(path.join(mockDir(), `${name}.json`), JSON.stringify(state, null, 2));
  } catch {
    // Read-only file system: keep working from memory.
  }
}
