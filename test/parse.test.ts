import { readFileSync } from "node:fs";
import { Connection, type FetchFn } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { extractIncomingTransfer, extractMemos, type ParsedTransactionLike } from "@/lib/solana/parse";

// Real devnet transactions, saved exactly as the RPC returned them.
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

function fixture(name: string): ParsedTransactionLike {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

describe("extractIncomingTransfer, on real devnet transactions", () => {
  it("reads amount, payer, memo and time of a transfer with a memo", () => {
    const transfer = extractIncomingTransfer(
      fixture("devnet-transfer-with-memo"),
      "75AjMdh7Gn1TLigfze541AVJGJ4TyqBEaRZk3pozfBza",
      USDC,
    );
    expect(transfer).toEqual({
      signature:
        "WssxBBHPkxz37jr2nh22SbATL9EknKYhyaPvL8jV1u6D6kgEbcHcEdyVGZt8kMXxshyXFis4H6EUGsm9BpQtZrh",
      mint: USDC,
      amountRaw: 1000n,
      decimals: 6,
      // The token owner, not the fee payer (a different account in this transaction).
      payerWallet: "8sh86hmWL4ka7U44dFn3U72ZagLsAME4iRMwajfgR8QT",
      blockTime: 1791642974,
      memo: "0c233d2f272ff6cd93a5ec0f28605b1b",
    });
  });

  it("reads a transfer that also creates the token account, with no memo", () => {
    const transfer = extractIncomingTransfer(
      fixture("devnet-transfer-create-ata"),
      "4bhPq9EZAqBJgt4eL5F6WPPD7caMDW7wug6J88RZsiSz",
      USDC,
    );
    expect(transfer?.amountRaw).toBe(1_000_000n);
    expect(transfer?.payerWallet).toBe("6ReP5NF6SrSgXnqhVUfn3Ytg9eofgEcYeRNEMV6oAnyF");
    expect(transfer?.memo).toBeNull();
  });

  it("treats a token account missing from preTokenBalances as starting at zero", () => {
    const tx = fixture("devnet-transfer-create-ata");
    tx.meta!.preTokenBalances = tx.meta!.preTokenBalances!.filter(
      (balance) => balance.owner !== "4bhPq9EZAqBJgt4eL5F6WPPD7caMDW7wug6J88RZsiSz",
    );
    const transfer = extractIncomingTransfer(tx, "4bhPq9EZAqBJgt4eL5F6WPPD7caMDW7wug6J88RZsiSz", USDC);
    // The whole post balance counts as received.
    expect(transfer?.amountRaw).toBe(237_000_000n);
  });

  it("returns null for the sender, whose balance went down", () => {
    const tx = fixture("devnet-transfer-with-memo");
    expect(extractIncomingTransfer(tx, "8sh86hmWL4ka7U44dFn3U72ZagLsAME4iRMwajfgR8QT", USDC)).toBeNull();
  });

  it("returns null for a wallet or a mint that is not in the transaction", () => {
    const tx = fixture("devnet-transfer-no-memo");
    expect(extractIncomingTransfer(tx, "11111111111111111111111111111111", USDC)).toBeNull();
    expect(
      extractIncomingTransfer(tx, "7ZvoVf", "So11111111111111111111111111111111111111112"),
    ).toBeNull();
  });

  it("returns null for a transaction of another program that moved no USDC", () => {
    const tx = fixture("devnet-unrelated-program");
    for (const key of tx.transaction.message.accountKeys) {
      expect(extractIncomingTransfer(tx, String(key.pubkey), USDC)).toBeNull();
    }
  });

  it("reports no payer when nobody's balance went down", () => {
    // E.g. the sender was minted the tokens in the same transaction, so they
    // end where they started. The payment is still imported, with payer unknown.
    const tx = fixture("devnet-transfer-with-memo");
    const sender = tx.meta!.postTokenBalances!.find(
      (balance) => balance.owner === "8sh86hmWL4ka7U44dFn3U72ZagLsAME4iRMwajfgR8QT",
    )!;
    sender.uiTokenAmount.amount = "9251000"; // same as before the transfer
    const transfer = extractIncomingTransfer(tx, "75AjMdh7Gn1TLigfze541AVJGJ4TyqBEaRZk3pozfBza", USDC);
    expect(transfer?.amountRaw).toBe(1000n);
    expect(transfer?.payerWallet).toBeNull();
  });

  it("ignores failed transactions", () => {
    const tx = fixture("devnet-transfer-with-memo");
    tx.meta!.err = { InstructionError: [2, { Custom: 1 }] };
    expect(extractIncomingTransfer(tx, "75AjMdh7Gn1TLigfze541AVJGJ4TyqBEaRZk3pozfBza", USDC)).toBeNull();
  });

  it("gives the same answer on the object web3.js builds from that JSON", async () => {
    const raw = fixture("devnet-transfer-with-memo");
    // web3.js checks that the answer carries the id of its request.
    const fetchFixture = (async (_url: unknown, init: { body: string }) => {
      const { id } = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: raw }));
    }) as unknown as FetchFn;
    const connection = new Connection("http://fixture.invalid", { fetch: fetchFixture });
    const tx = await connection.getParsedTransaction(raw.transaction.signatures[0], {
      maxSupportedTransactionVersion: 0,
    });
    const transfer = extractIncomingTransfer(tx!, "75AjMdh7Gn1TLigfze541AVJGJ4TyqBEaRZk3pozfBza", USDC);
    expect(transfer?.amountRaw).toBe(1000n);
    expect(transfer?.payerWallet).toBe("8sh86hmWL4ka7U44dFn3U72ZagLsAME4iRMwajfgR8QT");
    expect(transfer?.memo).toBe("0c233d2f272ff6cd93a5ec0f28605b1b");
  });
});

describe("extractMemos", () => {
  it("falls back to the program logs when no memo instruction was parsed", () => {
    const tx = fixture("devnet-transfer-with-memo");
    tx.transaction.message.instructions = tx.transaction.message.instructions.filter(
      (ix) => typeof ix.parsed !== "string",
    );
    expect(extractMemos(tx)).toEqual(["0c233d2f272ff6cd93a5ec0f28605b1b"]);
  });

  it("unescapes quotes in a logged memo", () => {
    const tx = fixture("devnet-transfer-no-memo");
    tx.meta!.logMessages = ['Program log: Memo (len 14): "say \\"hello\\" :)"'];
    expect(extractMemos(tx)).toEqual(['say "hello" :)']);
  });

  it("returns nothing when there is no memo", () => {
    expect(extractMemos(fixture("devnet-transfer-no-memo"))).toEqual([]);
  });
});
