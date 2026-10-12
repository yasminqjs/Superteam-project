// Prepares the demo on Solana DEVNET (live mode): wallets, a test stablecoin
// and four payments to "ana". Run with:  npm run seed:demo
//
// Safe to run again: wallets and the mint are reused, and the payments are
// only sent once.
//   --again     send another round of payments to the same ana
//   --new-ana   start over with a fresh ana wallet (the old key is archived)
//   --show-key  print the private keys for importing into Phantom
import fs from "node:fs";
import path from "node:path";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { parseUnits } from "../lib/money/units";
import { buildPaymentInstructions } from "../lib/solana/pay";
import { KEYS_DIR, confirm, devnetConnection, hasKeypair, loadEnv, loadOrCreateKeypair, sendTransaction } from "./lib/devnet";

const DECIMALS = 6;
const FAUCET = "https://faucet.solana.com";
/** SOL the funder needs: rent for the mint and token accounts, plus fees for everyone. */
const FUNDER_NEEDS = 0.15 * LAMPORTS_PER_SOL;
const FEE_MONEY = 0.01 * LAMPORTS_PER_SOL;

async function ensureFunded(connection: Connection, funder: Keypair): Promise<void> {
  if ((await connection.getBalance(funder.publicKey)) >= FUNDER_NEEDS) return;
  console.log("Requesting a devnet airdrop for the funder wallet...");
  try {
    const signature = await connection.requestAirdrop(funder.publicKey, LAMPORTS_PER_SOL);
    await confirm(connection, signature);
  } catch (error) {
    console.error(
      `\nThe airdrop failed (${error instanceof Error ? error.message : error}).\n` +
        "The devnet faucet is often rate-limited. Fund this address by hand, then run the script again:\n\n" +
        `  1. Open ${FAUCET}\n` +
        `  2. Paste this address and request 1 SOL on devnet:\n\n     ${funder.publicKey.toBase58()}\n`,
    );
    process.exit(1);
  }
}

async function main() {
  loadEnv();
  const connection = await devnetConnection();
  const args = new Set(process.argv.slice(2));

  // --new-ana: start over with a fresh recipient wallet. The old key is kept
  // next to it, so nothing is lost.
  if (args.has("--new-ana") && hasKeypair("ana")) {
    const archived = path.join(KEYS_DIR, `ana.previous-${Date.now()}.json`);
    fs.renameSync(path.join(KEYS_DIR, "ana.json"), archived);
    fs.rmSync(path.join(KEYS_DIR, "seeded.json"), { force: true });
    console.log(`Archived the previous ana wallet as ${path.basename(archived)}.`);
  }

  const firstRun = !hasKeypair("ana");
  const ana = loadOrCreateKeypair("ana");
  const savings = loadOrCreateKeypair("ana-savings");
  const acme = loadOrCreateKeypair("client-acme");
  const bounty = loadOrCreateKeypair("bounty-platform");
  const mint = loadOrCreateKeypair("test-mint");
  // The client wallet doubles as the funder: one airdrop pays for everything.
  const funder = acme;

  await ensureFunded(connection, funder);

  // Fee money for every wallet that signs something, and for ana (she seals receipts).
  const stranger = Keypair.generate();
  const topUps = new Transaction();
  for (const wallet of [ana, savings, bounty, stranger]) {
    if ((await connection.getBalance(wallet.publicKey)) < FEE_MONEY) {
      topUps.add(
        SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: wallet.publicKey, lamports: FEE_MONEY }),
      );
    }
  }
  if (topUps.instructions.length > 0) {
    await sendTransaction(connection, topUps, [funder]);
    console.log("Sent fee money to the demo wallets.");
  }

  // The test stablecoin. Circle's devnet faucet gives too little USDC per request.
  if (!(await connection.getAccountInfo(mint.publicKey))) {
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    await sendTransaction(
      connection,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: funder.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports: rent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint.publicKey, DECIMALS, funder.publicKey, null),
      ),
      [funder, mint],
    );
    console.log(`Created the test mint ${mint.publicKey.toBase58()}`);
  }

  const marker = path.join(KEYS_DIR, "seeded.json");
  if (fs.existsSync(marker) && !args.has("--again")) {
    console.log("Demo payments were already sent (use --again to send another round).");
  } else {
    const payments = [
      { payer: acme, amount: "1200", memo: "Acme Labs: web app development, September" },
      { payer: bounty, amount: "500", memo: "Bounty payout: UI design" },
      { payer: savings, amount: "300", memo: undefined },
      { payer: stranger, amount: "85", memo: undefined },
    ];
    // First give every payer their tokens, in a transaction of its own.
    //
    // This must NOT happen in the same transaction as the payment: Recebi finds
    // the payer by looking for the wallet whose balance went DOWN. A payer who
    // is minted 1,200 and sends 1,200 in one transaction ends where they
    // started, and the payment would be imported with no payer at all.
    const funding = new Transaction();
    for (const { payer, amount } of payments) {
      const payerAccount = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
      // The client also gets a spare balance, to pay invoices during the demo.
      const extra = payer === acme ? parseUnits("20000", DECIMALS) : 0n;
      funding.add(
        createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, payerAccount, payer.publicKey, mint.publicKey),
        createMintToInstruction(mint.publicKey, payerAccount, funder.publicKey, parseUnits(amount, DECIMALS) + extra),
      );
    }
    await sendTransaction(connection, funding, [funder]);
    console.log("Gave the payers their test tokens.");

    // Then the payments themselves, one transaction each.
    for (const { payer, amount, memo } of payments) {
      const transaction = new Transaction().add(
        ...buildPaymentInstructions({
          payer: payer.publicKey.toBase58(),
          recipient: ana.publicKey.toBase58(),
          mint: mint.publicKey.toBase58(),
          decimals: DECIMALS,
          amountRaw: parseUnits(amount, DECIMALS),
          memo,
        }),
      );
      // The funder pays the network fee; the payer signs the transfer and the memo.
      const signers = payer === funder ? [funder] : [funder, payer];
      const signature = await sendTransaction(connection, transaction, signers);
      console.log(`Paid ${amount.padStart(5)} to ana  ${signature}`);
    }
    fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString() }));
  }

  // The test token comes first, so it is the default in the invoice and
  // cash-out forms: it is the one the demo wallets actually hold.
  const mints = [
    { mint: mint.publicKey.toBase58(), symbol: "TUSD", decimals: DECIMALS, label: "Test USD (devnet)" },
    { mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", symbol: "USDC", decimals: 6, label: "USDC (devnet)" },
  ];
  console.log(`
Done. Demo wallets (devnet):
  ana              ${ana.publicKey.toBase58()}
  ana-savings      ${savings.publicKey.toBase58()}
  client-acme      ${acme.publicKey.toBase58()}
  bounty-platform  ${bounty.publicKey.toBase58()}
  test mint        ${mint.publicKey.toBase58()}

1. Put this line in .env.local (and in Vercel, without the single quotes), then restart the app:

NEXT_PUBLIC_STABLE_MINTS='${JSON.stringify(mints)}'

2. Import ana's wallet into Phantom, with testnet mode on and the network set to Solana Devnet:
   Phantom > Add / Connect Wallet > Import Private Key. To print the key:

     npm run seed:demo -- --show-key

   To pay invoices as the client, import client-acme the same way into a second browser profile.

These are DEVNET demo keys, stored in .demo-keys/ (git-ignored). Never send real funds to them.`);

  if (args.has("--show-key")) {
    console.log(`
Private keys (base58), DEVNET ONLY:
  ana          ${bs58.encode(ana.secretKey)}
  client-acme  ${bs58.encode(acme.secretKey)}`);
  } else if (firstRun) {
    console.log("\n(First run: the keys were just created in .demo-keys/.)");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
