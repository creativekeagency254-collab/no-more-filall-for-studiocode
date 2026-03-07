/*
  Finance/workflow core for all dashboards
  - Wallets and top-ups (Paystack/M-Pesa ready)
  - Payment methods
  - Unified financial transactions ledger
  - Sales payout requests + admin approval path
*/

create extension if not exists pgcrypto;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  currency text not null default 'KES',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('paystack', 'mpesa', 'card', 'bank', 'other')),
  label text not null,
  account_ref text,
  phone text,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  provider text not null check (provider in ('paystack', 'mpesa', 'bank', 'other')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  paystack_reference text unique,
  mpesa_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  notes text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_ref text unique,
  kind text not null check (
    kind in (
      'invoice',
      'invoice_payment',
      'wallet_topup',
      'wallet_withdrawal',
      'escrow_fund',
      'milestone_release',
      'commission_accrual',
      'commission_payout',
      'refund',
      'fee',
      'adjustment'
    )
  ),
  status text not null default 'pending' check (status in ('pending', 'held', 'paid', 'failed', 'cancelled')),
  amount numeric(14,2) not null,
  currency text not null default 'KES',
  description text,
  payer_id uuid references public.profiles(id),
  payee_id uuid references public.profiles(id),
  commissioner_id uuid references public.profiles(id),
  commission_amount numeric(14,2) not null default 0,
  project_id uuid references public.projects(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  topup_id uuid references public.wallet_topups(id) on delete set null,
  payout_request_id uuid references public.payout_requests(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_methods_user on public.payment_methods(user_id);
create index if not exists idx_wallet_topups_user on public.wallet_topups(user_id);
create index if not exists idx_wallet_topups_status on public.wallet_topups(status);
create index if not exists idx_payout_requests_requester on public.payout_requests(requester_id);
create index if not exists idx_payout_requests_status on public.payout_requests(status);
create index if not exists idx_financial_transactions_kind on public.financial_transactions(kind);
create index if not exists idx_financial_transactions_status on public.financial_transactions(status);
create index if not exists idx_financial_transactions_project on public.financial_transactions(project_id);
create index if not exists idx_financial_transactions_invoice on public.financial_transactions(invoice_id);
create index if not exists idx_financial_transactions_commissioner on public.financial_transactions(commissioner_id);

alter table public.profiles add column if not exists status text default 'active';
alter table public.profiles add column if not exists available_for_work boolean default true;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists company text;
alter table public.profiles add column if not exists avatar_url text;

alter table public.invoices add column if not exists currency text default 'KES';
alter table public.invoices add column if not exists paystack_authorization_url text;
alter table public.invoices add column if not exists paid_at timestamptz;

create or replace function public.ensure_wallet(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallets(user_id) values (uid)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.handle_profile_wallet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_wallet(new.id);
  return new;
end;
$$;

drop trigger if exists on_profile_created_wallet on public.profiles;
create trigger on_profile_created_wallet
after insert on public.profiles
for each row execute function public.handle_profile_wallet();

alter table public.wallets enable row level security;
alter table public.payment_methods enable row level security;
alter table public.wallet_topups enable row level security;
alter table public.payout_requests enable row level security;
alter table public.financial_transactions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'wallets' and policyname = 'wallets_select_own_or_admin') then
    create policy wallets_select_own_or_admin on public.wallets
      for select to authenticated
      using (auth.uid() = user_id or public.current_role() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'wallets' and policyname = 'wallets_update_own_or_admin') then
    create policy wallets_update_own_or_admin on public.wallets
      for update to authenticated
      using (auth.uid() = user_id or public.current_role() = 'admin')
      with check (auth.uid() = user_id or public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'payment_methods' and policyname = 'payment_methods_own') then
    create policy payment_methods_own on public.payment_methods
      for all to authenticated
      using (auth.uid() = user_id or public.current_role() = 'admin')
      with check (auth.uid() = user_id or public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'wallet_topups' and policyname = 'wallet_topups_own') then
    create policy wallet_topups_own on public.wallet_topups
      for all to authenticated
      using (auth.uid() = user_id or public.current_role() = 'admin')
      with check (auth.uid() = user_id or public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'payout_requests' and policyname = 'payout_requests_select') then
    create policy payout_requests_select on public.payout_requests
      for select to authenticated
      using (auth.uid() = requester_id or public.current_role() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'payout_requests' and policyname = 'payout_requests_insert_own') then
    create policy payout_requests_insert_own on public.payout_requests
      for insert to authenticated
      with check (auth.uid() = requester_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'payout_requests' and policyname = 'payout_requests_admin_update') then
    create policy payout_requests_admin_update on public.payout_requests
      for update to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'financial_transactions' and policyname = 'financial_transactions_select_scope') then
    create policy financial_transactions_select_scope on public.financial_transactions
      for select to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = payer_id
        or auth.uid() = payee_id
        or auth.uid() = commissioner_id
        or auth.uid() = created_by
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'financial_transactions' and policyname = 'financial_transactions_insert_scope') then
    create policy financial_transactions_insert_scope on public.financial_transactions
      for insert to authenticated
      with check (
        public.current_role() = 'admin'
        or auth.uid() = created_by
        or auth.uid() = payer_id
        or auth.uid() = payee_id
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'financial_transactions' and policyname = 'financial_transactions_admin_update') then
    create policy financial_transactions_admin_update on public.financial_transactions
      for update to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;
end $$;

