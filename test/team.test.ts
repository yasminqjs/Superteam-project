import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode, set before any module reads it (see mock-flow.test.ts).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_RECEBI_MODE = "mock";
});

import type { Actor } from "@/lib/auth/account";
import { MOCK_USDC } from "@/lib/config/mints";
import { FileStore } from "@/lib/db/file-store";
import { fetchMockPtax } from "@/lib/fx/ptax";
import { MOCK_KEYS } from "@/lib/mock/keys";
import { seedMock } from "@/lib/mock/seed";
import type { Deps } from "@/lib/services/deps";
import { createInvoice } from "@/lib/services/invoices";
import {
  getTeamView,
  listAccounts,
  recordActivity,
  removeMember,
  roleOn,
  saveCompany,
  saveMember,
} from "@/lib/services/team";
import { createMockConnection } from "@/lib/solana/server-connection";
import { MAX_MEMBERS, can } from "@/lib/team";

const ANA = MOCK_KEYS.ana.publicKey.toBase58();
const BIA = MOCK_KEYS.bia.publicKey.toBase58();
const CAIO = MOCK_KEYS.caio.publicKey.toBase58();
const STRANGER = MOCK_KEYS.stranger.publicKey.toBase58();

const OWNER: Actor = { signer: ANA, account: ANA, role: "owner" };
const COMPANY = { name: "Baía Software Ltda", tax_id: "12.345.678/0001-90" };

let deps: Deps;

beforeEach(() => {
  seedMock(new Date("2026-10-14T15:00:00Z"));
  deps = {
    store: new FileStore(),
    connection: createMockConnection(),
    fetchPtax: fetchMockPtax,
    now: () => new Date("2026-10-14T15:00:00Z"),
  };
});

async function companyWithTeam() {
  await saveCompany(deps, OWNER, COMPANY);
  await saveMember(deps, OWNER, { wallet: BIA, name: "Bia", role: "finance" });
  await saveMember(deps, OWNER, { wallet: CAIO, name: "Caio", role: "viewer" });
}

describe("permissions", () => {
  it("gives each role exactly what it needs", () => {
    expect(["read", "write", "owner"].map((p) => can("owner", p as never))).toEqual([true, true, true]);
    expect(["read", "write", "owner"].map((p) => can("finance", p as never))).toEqual([true, true, false]);
    expect(["read", "write", "owner"].map((p) => can("viewer", p as never))).toEqual([true, false, false]);
  });
});

describe("roles on an account", () => {
  it("makes a wallet the owner of its own account and nothing on anyone else's", async () => {
    expect(await roleOn(deps.store, ANA, ANA)).toBe("owner");
    expect(await roleOn(deps.store, BIA, ANA)).toBeNull();
  });

  it("gives members the role they were added with, and strangers none", async () => {
    await companyWithTeam();
    expect(await roleOn(deps.store, BIA, ANA)).toBe("finance");
    expect(await roleOn(deps.store, CAIO, ANA)).toBe("viewer");
    expect(await roleOn(deps.store, STRANGER, ANA)).toBeNull();
    // Membership runs one way: the company gains nothing on its members' accounts.
    expect(await roleOn(deps.store, ANA, BIA)).toBeNull();
  });

  it("ends a member's access the moment they are removed", async () => {
    await companyWithTeam();
    await removeMember(deps, OWNER, BIA);
    expect(await roleOn(deps.store, BIA, ANA)).toBeNull();
    expect((await getTeamView(deps, OWNER)).members.map((m) => m.name)).toEqual(["Caio"]);
  });
});

describe("company accounts", () => {
  it("lists a personal account alone until the wallet joins a company", async () => {
    expect(await listAccounts(deps, BIA)).toEqual([
      { wallet: BIA, name: null, role: "owner", company: false },
    ]);
    await companyWithTeam();
    expect(await listAccounts(deps, BIA)).toEqual([
      { wallet: BIA, name: null, role: "owner", company: false },
      { wallet: ANA, name: COMPANY.name, role: "finance", company: true },
    ]);
    expect(await listAccounts(deps, ANA)).toEqual([
      { wallet: ANA, name: COMPANY.name, role: "owner", company: true },
    ]);
  });

  it("updates a member instead of duplicating them", async () => {
    await companyWithTeam();
    await saveMember(deps, OWNER, { wallet: BIA, name: "Bia Souza", role: "viewer" });
    const members = (await getTeamView(deps, OWNER)).members;
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.wallet === BIA)).toMatchObject({ name: "Bia Souza", role: "viewer" });
  });

  it("refuses members that make no sense", async () => {
    await expect(saveMember(deps, OWNER, { wallet: BIA, name: "Bia", role: "finance" })).rejects.toThrow(
      /Set up the company/,
    );
    await saveCompany(deps, OWNER, COMPANY);
    await expect(saveMember(deps, OWNER, { wallet: "not-a-wallet", name: "X", role: "finance" })).rejects.toThrow(
      /valid Solana wallet/,
    );
    await expect(saveMember(deps, OWNER, { wallet: ANA, name: "Ana", role: "finance" })).rejects.toThrow(
      /already the owner/,
    );
    await expect(saveMember(deps, OWNER, { wallet: BIA, name: "Bia", role: "owner" })).rejects.toThrow(
      /Choose a role/,
    );
    await expect(saveMember(deps, OWNER, { wallet: BIA, name: "", role: "finance" })).rejects.toThrow(
      /Name is required/,
    );
  });

  it("caps the team size", async () => {
    await saveCompany(deps, OWNER, COMPANY);
    for (let i = 0; i < MAX_MEMBERS; i++) {
      await deps.store.saveMember({
        org_wallet: ANA,
        member_wallet: `member-${i}`,
        name: `Member ${i}`,
        role: "viewer",
        added_by: ANA,
      });
    }
    await expect(saveMember(deps, OWNER, { wallet: BIA, name: "Bia", role: "finance" })).rejects.toThrow(
      /at most/,
    );
  });
});

describe("audit trail", () => {
  it("records who acted, by name, newest first", async () => {
    await companyWithTeam();
    await recordActivity(deps, { signer: BIA, account: ANA, role: "finance" }, "invoice.created", "INV-0001");
    const [latest, ...older] = (await getTeamView(deps, OWNER)).activity;
    expect(latest).toMatchObject({ actor_name: "Bia", label: "Created an invoice", detail: "INV-0001" });
    expect(older.every((entry) => entry.actor_name === `${COMPANY.name} (owner)`)).toBe(true);
    expect(older).toHaveLength(3); // company saved, two members added
  });

  it("keeps none for personal accounts", async () => {
    await recordActivity(deps, { signer: BIA, account: BIA, role: "owner" }, "invoice.created", "INV-0001");
    expect(await deps.store.listActivity(BIA, 10)).toEqual([]);
  });
});

describe("invoices of a company", () => {
  const invoiceBody = {
    client_name: "Acme Labs",
    description: "Web app development",
    amount: "2500",
    mint: MOCK_USDC.mint,
  };

  it("name the company inside the hashed document, so the payer commits to it", async () => {
    await saveCompany(deps, OWNER, COMPANY);
    const invoice = await createInvoice(deps, ANA, invoiceBody);
    expect(invoice).toMatchObject({ issuer_name: COMPANY.name, issuer_tax_id: COMPANY.tax_id });
    const stored = await deps.store.getInvoice(invoice.id);
    expect(JSON.parse(stored!.invoice_json)).toMatchObject({
      issuer_wallet: ANA,
      issuer_name: COMPANY.name,
      issuer_tax_id: COMPANY.tax_id,
    });
  });

  it("leave personal invoices exactly as they were", async () => {
    const invoice = await createInvoice(deps, ANA, invoiceBody);
    expect(invoice).toMatchObject({ issuer_name: null, issuer_tax_id: null });
    const document = JSON.parse((await deps.store.getInvoice(invoice.id))!.invoice_json);
    expect(Object.keys(document)).not.toContain("issuer_name");
    expect(Object.keys(document)).not.toContain("issuer_tax_id");
  });
});
