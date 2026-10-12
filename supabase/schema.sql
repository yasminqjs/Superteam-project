-- Recebi database schema.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- It is safe to run again: every statement is idempotent.

create table if not exists profiles (
  wallet text primary key,
  display_name text,
  fx_rule text not null default 'ptax_buy',   -- 'ptax_buy' | 'ptax_sell'
  created_at timestamptz default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null references profiles(wallet),
  wallet text not null,
  name text not null,
  kind text not null default 'client',        -- 'client' | 'platform' | 'self' | 'other'
  unique (owner_wallet, wallet)
);

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null references profiles(wallet),
  source text not null,                        -- 'imported' | 'invoice'
  tx_signature text not null,
  mint text not null,
  amount_raw text not null,                    -- integer in base units, stored as text
  decimals int not null,
  payer_wallet text,
  block_time timestamptz not null,
  memo text,
  category text,                               -- 'service' | 'prize' | 'grant' | 'own_transfer' | 'other'
  description text,
  contact_id uuid references contacts(id),
  invoice_id uuid,
  fx_rule text,
  fx_date date,
  fx_rate numeric,
  amount_brl numeric,
  receipt_json text,                           -- sealed canonical JSON
  receipt_hash text,
  seal_signature text,
  created_at timestamptz default now(),
  unique (owner_wallet, tx_signature, mint)
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null,                        -- e.g. INV-0001
  owner_wallet text not null references profiles(wallet),
  client_name text not null,
  client_email text,
  description text not null,
  amount_raw text not null,
  mint text not null,
  decimals int not null,
  reference text not null unique,              -- random public key (Solana Pay reference)
  invoice_json text not null,
  invoice_hash text not null,
  status text not null default 'pending',      -- 'pending' | 'paid'
  paid_signature text,
  created_at timestamptz default now(),
  paid_at timestamptz
);

create table if not exists fx_rates (
  requested_date date not null,
  rule text not null,
  quote_date date not null,                    -- business day actually used
  rate numeric not null,
  primary key (requested_date, rule)
);

create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null references profiles(wallet),
  amount_raw text not null,
  mint text not null,
  amount_brl numeric not null,
  pix_key text not null,
  provider text not null default 'simulated_pix',
  status text not null default 'simulated',
  created_at timestamptz default now()
);

-- Company accounts. An account is always one wallet (the one that receives the
-- payments); a company is that account with a name, a tax ID and a team.
create table if not exists organizations (
  wallet text primary key references profiles(wallet),
  name text not null,
  tax_id text,                                 -- CNPJ or similar, as declared
  created_at timestamptz default now()
);

-- Wallets allowed to act on a company account. The company wallet itself is
-- the owner and is not listed here.
create table if not exists organization_members (
  org_wallet text not null references organizations(wallet) on delete cascade,
  member_wallet text not null,
  name text not null,
  role text not null,                          -- 'finance' | 'viewer'
  added_by text not null,
  created_at timestamptz default now(),
  primary key (org_wallet, member_wallet)
);

-- Audit trail of a company account: who did what.
create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  account_wallet text not null,
  actor_wallet text not null,
  actor_name text not null,                    -- their name on the team at the time
  action text not null,                        -- e.g. 'invoice.created'
  detail text,
  created_at timestamptz default now()
);

create index if not exists organization_members_member_idx
  on organization_members (member_wallet);
create index if not exists activity_account_created_idx
  on activity (account_wallet, created_at desc);

-- The dashboard lists receipts by owner, newest first.
create index if not exists receipts_owner_block_time_idx
  on receipts (owner_wallet, block_time desc);

-- Row Level Security is on for every table and there are no policies, so the
-- anon and authenticated roles can read nothing. Only the server, using the
-- service_role key (which bypasses RLS), can touch the data.
alter table profiles enable row level security;
alter table contacts enable row level security;
alter table receipts enable row level security;
alter table invoices enable row level security;
alter table fx_rates enable row level security;
alter table payouts  enable row level security;
alter table organizations        enable row level security;
alter table organization_members enable row level security;
alter table activity             enable row level security;

-- Make tables created by this run visible to the API layer at once.
notify pgrst, 'reload schema';
