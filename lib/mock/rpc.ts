import bs58 from "bs58";
import { MOCK_GENESIS_HASH } from "@/lib/mock/keys";
import {
  MockRpcError,
  getSignatureStatus,
  getSignaturesForAddress,
  getTokenAccountsByOwner,
  getTransaction,
  ledgerSlot,
  processTransaction,
} from "@/lib/mock/ledger";

/**
 * The mock node's JSON-RPC interface: just the methods Recebi calls through
 * @solana/web3.js, answering in the shapes that library validates. Anything
 * else returns "method not found", so an accidental dependency on an
 * unimplemented method fails loudly instead of returning something made up.
 */

interface RpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function withContext(value: unknown) {
  return { context: { apiVersion: "recebi-mock", slot: ledgerSlot() }, value };
}

/** A base58 "blockhash" that changes with the slot. The ledger does not check it. */
function mockBlockhash(): string {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(28, ledgerSlot());
  bytes[0] = 0x4d; // "M" for mock, so the value is recognisable in a debugger
  return bs58.encode(bytes);
}

function call(method: string, params: unknown[]): unknown {
  switch (method) {
    case "getGenesisHash":
      return MOCK_GENESIS_HASH;
    case "getHealth":
      return "ok";
    case "getVersion":
      return { "solana-core": "recebi-mock", "feature-set": 0 };
    case "getSlot":
    case "getBlockHeight":
      return ledgerSlot();
    case "getBalance":
      // SOL is not modelled: every wallet simply has enough for fees.
      return withContext(5_000_000_000);
    case "getLatestBlockhash":
      return withContext({ blockhash: mockBlockhash(), lastValidBlockHeight: ledgerSlot() + 150 });
    case "getTokenAccountsByOwner": {
      const [owner, filter] = params as [string, { mint?: string }];
      return withContext(getTokenAccountsByOwner(owner, filter?.mint));
    }
    case "getSignaturesForAddress": {
      const [address, options] = params as [string, { limit?: number; before?: string }?];
      return getSignaturesForAddress(address, options);
    }
    case "getTransaction": {
      const [signature] = params as [string];
      return getTransaction(signature);
    }
    case "getSignatureStatuses": {
      const [signatures] = params as [string[]];
      return withContext(signatures.map(getSignatureStatus));
    }
    case "sendTransaction": {
      const [encoded, options] = params as [string, { encoding?: string }?];
      const raw =
        options?.encoding === "base64" ? Buffer.from(encoded, "base64") : bs58.decode(encoded);
      return processTransaction(raw);
    }
    default:
      throw new MockRpcError(-32601, `Method not found in the Yvex Chain mock node: ${method}`);
  }
}

function handleOne(request: RpcRequest): unknown {
  const id = request.id ?? null;
  try {
    if (typeof request.method !== "string") {
      throw new MockRpcError(-32600, "Invalid request");
    }
    const params = Array.isArray(request.params) ? request.params : [];
    return { jsonrpc: "2.0", id, result: call(request.method, params) };
  } catch (error) {
    const rpcError =
      error instanceof MockRpcError
        ? { code: error.code, message: error.message }
        : { code: -32603, message: error instanceof Error ? error.message : "Internal error" };
    return { jsonrpc: "2.0", id, error: rpcError };
  }
}

/** Handles one JSON-RPC request, or a batch of them. */
export function handleMockRpc(body: unknown): unknown {
  return Array.isArray(body)
    ? body.map((request) => handleOne(request as RpcRequest))
    : handleOne(body as RpcRequest);
}
