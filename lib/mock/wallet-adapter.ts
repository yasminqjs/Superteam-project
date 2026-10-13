import {
  BaseMessageSignerWalletAdapter,
  WalletNotConnectedError,
  WalletReadyState,
  type SupportedTransactionVersions,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { Transaction, type PublicKey, type VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { currentMockIdentity } from "@/lib/mock/identity";

export const MOCK_WALLET_NAME = "Yvex Chain demo wallet" as WalletName<"Yvex Chain demo wallet">;

const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#14171a"/></svg>',
  );

/**
 * Mock mode's wallet: plays the part of Phantom with one of the demo keys
 * ("ana" unless another demo person was picked in the mock banner).
 *
 * It plugs into the same wallet-adapter interface, so the app's code does not
 * change: it still asks "the wallet" to sign messages and transactions, and
 * the signatures are real ed25519 signatures. It just never asks for approval,
 * and its key is public (see lib/mock/keys.ts), so it is only ever registered
 * in mock mode.
 */
export class MockWalletAdapter extends BaseMessageSignerWalletAdapter<"Yvex Chain demo wallet"> {
  name = MOCK_WALLET_NAME;
  url = "https://github.com/";
  icon = ICON;
  readyState = WalletReadyState.Installed;
  supportedTransactionVersions: SupportedTransactionVersions = null;

  private keypair = currentMockIdentity().keypair;
  private currentKey: PublicKey | null = null;
  private isConnecting = false;

  get publicKey(): PublicKey | null {
    return this.currentKey;
  }

  get connecting(): boolean {
    return this.isConnecting;
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.isConnecting = true;
    // Real wallets answer asynchronously, and wallet-adapter-react relies on
    // that: it must have its listeners attached before "connect" fires. (In
    // development React mounts everything twice, so an instant answer would be
    // delivered to listeners that are about to be thrown away.)
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.keypair = currentMockIdentity().keypair;
    this.currentKey = this.keypair.publicKey;
    this.isConnecting = false;
    this.emit("connect", this.currentKey);
  }

  async disconnect(): Promise<void> {
    if (!this.currentKey) return;
    this.currentKey = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    if (!this.connected) throw new WalletNotConnectedError();
    if (transaction instanceof Transaction) transaction.partialSign(this.keypair);
    else transaction.sign([this.keypair]);
    return transaction;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.connected) throw new WalletNotConnectedError();
    return nacl.sign.detached(message, this.keypair.secretKey);
  }
}
