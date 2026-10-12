import { Transaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

// Mock mode, set before any module reads it (see mock-flow.test.ts).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_RECEBI_MODE = "mock";
});

import { MOCK_USDC } from "@/lib/config/mints";
import { FileStore } from "@/lib/db/file-store";
import { fetchMockPtax } from "@/lib/fx/ptax";
import { MOCK_KEYS } from "@/lib/mock/keys";
import { runInMockScope, type MockStates } from "@/lib/mock/persist";
import { ensureMockSeeded, mockPay } from "@/lib/mock/seed";
import { CHUNK_SIZE, MAX_ENCODED_SIZE, decodeStates, encodeStates, splitChunks } from "@/lib/mock/state-codec";
import type { Deps } from "@/lib/services/deps";
import { checkInvoicePayment, createInvoice } from "@/lib/services/invoices";
import { classifyReceipt, confirmSeal, importReceipts, listReceiptViews, prepareSeal } from "@/lib/services/receipts";
import { saveCompany, saveMember } from "@/lib/services/team";
import { createMemoInstruction } from "@/lib/solana/memo";
import { signAndSend } from "@/lib/solana/send";
import { createMockConnection } from "@/lib/solana/server-connection";

const ANA = MOCK_KEYS.ana.publicKey.toBase58();
const NOW = new Date("2026-10-14T15:00:00Z");

function makeDeps(): Deps {
  return { store: new FileStore(), connection: createMockConnection(), fetchPtax: fetchMockPtax, now: () => NOW };
}

/** One request against a visitor's world: decode it, run, encode what is left. */
async function request<T>(world: string, handler: (deps: Deps) => Promise<T>) {
  const outcome = await runInMockScope(world ? decodeStates(world)! : {}, async () => {
    ensureMockSeeded();
    return handler(makeDeps());
  });
  return { result: outcome.result, world: outcome.dirty ? encodeStates(outcome.states) : world, dirty: outcome.dirty };
}

describe("the codec", () => {
  it("brings back exactly what went in", () => {
    const states: MockStates = { db: { receipts: [{ id: "a", amount_brl: "6387.48" }] }, seeded: { at: "x" } };
    expect(decodeStates(encodeStates(states))).toEqual(states);
  });

  it("answers null, not an error, for anything it did not write", () => {
    for (const junk of ["", "not-base64url!", "aGVsbG8", encodeStates({ a: 1 }).slice(0, -6)]) {
      expect(decodeStates(junk)).toBeNull();
    }
    // Valid Brotli, but not an object of states.
    expect(decodeStates(encodeStates([1, 2, 3] as unknown as MockStates))).toBeNull();
  });

  it("cuts the text into cookie-sized pieces that join back together", () => {
    const text = "x".repeat(CHUNK_SIZE * 2 + 17);
    const chunks = splitChunks(text);
    expect(chunks.map((chunk) => chunk.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 17]);
    expect(chunks.join("")).toBe(text);
  });
});

describe("a visitor's world carried between requests", () => {
  it("survives with nothing kept on the server", async () => {
    // Every step is a separate request that starts from the encoded world alone.
    let { world } = await request("", (deps) => importReceipts(deps, ANA));
    const listed = await request(world, (deps) => listReceiptViews(deps, ANA));
    expect(listed.result).toHaveLength(4);
    expect(listed.dirty).toBe(false);

    const receipt = listed.result.find((entry) => entry.memo?.startsWith("Acme"))!;
    ({ world } = await request(world, (deps) =>
      classifyReceipt(deps, ANA, receipt.id, {
        category: "service",
        description: "Web app development",
        contact: { name: "Acme Labs", kind: "client" },
      }),
    ));
    const draft = await request(world, (deps) => prepareSeal(deps, ANA, receipt.id));
    world = draft.world;

    // The browser sends the seal to the node in a request of its own.
    const sent = await request(world, (deps) =>
      signAndSend({
        connection: deps.connection,
        transaction: new Transaction().add(createMemoInstruction(draft.result.memo, MOCK_KEYS.ana.publicKey)),
        feePayer: MOCK_KEYS.ana.publicKey,
        signTransaction: async (tx) => {
          tx.partialSign(MOCK_KEYS.ana);
          return tx;
        },
      }),
    );
    world = sent.world;

    const sealed = await request(world, (deps) => confirmSeal(deps, ANA, receipt.id, sent.result));
    expect(sealed.result.status).toBe("sealed");
  });

  it("keeps two visitors apart, even when their requests overlap", async () => {
    const [one, two] = await Promise.all([
      request("", async (deps) => {
        await importReceipts(deps, ANA);
        await saveCompany(deps, { signer: ANA, account: ANA, role: "owner" }, { name: "First Ltda" });
        return deps.store.getOrganization(ANA);
      }),
      request("", async (deps) => {
        await saveCompany(deps, { signer: ANA, account: ANA, role: "owner" }, { name: "Second Ltda" });
        return listReceiptViews(deps, ANA);
      }),
    ]);
    expect(one.result?.name).toBe("First Ltda");
    expect(two.result).toHaveLength(0);
    expect((await request(two.world, (deps) => deps.store.getOrganization(ANA))).result?.name).toBe("Second Ltda");
    expect((await request(one.world, (deps) => listReceiptViews(deps, ANA))).result).toHaveLength(4);
  });

  it("still fits in the cookies after a full demo session", async () => {
    const owner = { signer: ANA, account: ANA, role: "owner" as const };
    let { world } = await request("", (deps) => importReceipts(deps, ANA));
    ({ world } = await request(world, async (deps) => {
      await saveCompany(deps, owner, { name: "Baía Software Ltda", tax_id: "12.345.678/0001-90" });
      await saveMember(deps, owner, { wallet: MOCK_KEYS.bia.publicKey.toBase58(), name: "Bia", role: "finance" });
      await saveMember(deps, owner, { wallet: MOCK_KEYS.caio.publicKey.toBase58(), name: "Caio", role: "viewer" });
    }));
    for (let round = 0; round < 3; round++) {
      const created = await request(world, (deps) =>
        createInvoice(deps, ANA, {
          client_name: `Client ${round}`,
          description: "Platform engineering",
          amount: "2500",
          mint: MOCK_USDC.mint,
        }),
      );
      ({ world } = await request(created.world, async (deps) => {
        mockPay({
          payer: MOCK_KEYS.clientAcme,
          recipient: ANA,
          amount: "2500",
          memo: created.result.memo,
          reference: created.result.reference,
        });
        await checkInvoicePayment(deps, created.result.id);
      }));
    }
    expect((await request(world, (deps) => listReceiptViews(deps, ANA))).result).toHaveLength(7);
    expect(world.length).toBeLessThan(MAX_ENCODED_SIZE);
  });
});
