/*
  Client/Admin reliability patch
  - Backfills missing finance tables (including payment_methods)
  - Ensures role-aware RLS and admin visibility policies exist
  - Adds platform_settings persistence for moderation/fee controls
  - Expands realtime publication for client/admin live updates
*/

begin;

create extension if not exists pgcrypto;

create or replace function public.current_role()
returns text
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_role text;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  return coalesce(v_role, 'client');
end;
$$;

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

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
  amount numeric(14,2) not null default 0,
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

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('paystack', 'mpesa', 'other')),
  event_type text not null,
  reference text,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_platform_settings_updated_at on public.platform_settings(updated_at desc);
create index if not exists idx_payment_methods_user on public.payment_methods(user_id);
create index if not exists idx_wallet_topups_user on public.wallet_topups(user_id);
create index if not exists idx_wallet_topups_status on public.wallet_topups(status);
create index if not exists idx_payout_requests_requester on public.payout_requests(requester_id);
create index if not exists idx_payout_requests_status on public.payout_requests(status);
create index if not exists idx_financial_transactions_kind on public.financial_transactions(kind);
create index if not exists idx_financial_transactions_status on public.financial_transactions(status);
create index if not exists idx_financial_transactions_invoice on public.financial_transactions(invoice_id);
create index if not exists idx_financial_transactions_project on public.financial_transactions(project_id);
create index if not exists idx_financial_transactions_topup on public.financial_transactions(topup_id);
create index if not exists idx_financial_transactions_participants on public.financial_transactions(payer_id, payee_id);
create index if not exists idx_payment_webhook_events_provider_ref on public.payment_webhook_events(provider, reference);
create index if not exists idx_payment_webhook_events_status on public.payment_webhook_events(status);

insert into public.platform_settings(key, value)
values
  ('fee_standard_pct', to_jsonb(2.5)),
  ('fee_pro_pct', to_jsonb(1.5)),
  ('commission_default_pct', to_jsonb(10)),
  ('require_developer_approval', to_jsonb(true)),
  ('allow_client_disputes', to_jsonb(true)),
  ('auto_approve_milestones', to_jsonb(false)),
  ('maintenance_mode', to_jsonb(false)),
  ('escrow_goal_ksh', to_jsonb(180000)),
  ('max_projects_per_developer', to_jsonb(5))
on conflict (key) do nothing;

alter table public.profiles add column if not exists status text default 'active';
alter table public.profiles add column if not exists available_for_work boolean default true;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists company text;
alter table public.profiles add column if not exists avatar_url text;

alter table public.invoices add column if not exists client_id uuid references public.profiles(id) on delete set null;
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

alter table public.platform_settings enable row level security;
alter table public.wallets enable row level security;
alter table public.payment_methods enable row level security;
alter table public.wallet_topups enable row level security;
alter table public.payout_requests enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.payment_webhook_events enable row level security;

do $$
begin
  if to_regclass('public.notifications') is not null then
    execute 'alter table public.notifications enable row level security';
  end if;
  if to_regclass('public.messages') is not null then
    execute 'alter table public.messages enable row level security';
  end if;
  if to_regclass('public.projects') is not null then
    execute 'alter table public.projects enable row level security';
  end if;
  if to_regclass('public.invoices') is not null then
    execute 'alter table public.invoices enable row level security';
  end if;
  if to_regclass('public.disputes') is not null then
    execute 'alter table public.disputes enable row level security';
  end if;
  if to_regclass('public.audit_logs') is not null then
    execute 'alter table public.audit_logs enable row level security';
  end if;
  if to_regclass('public.profiles') is not null then
    execute 'alter table public.profiles enable row level security';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'platform_settings' and policyname = 'platform_settings_admin_all') then
    create policy platform_settings_admin_all on public.platform_settings
      for all to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wallets' and policyname = 'wallets_select_own_or_admin') then
    create policy wallets_select_own_or_admin on public.wallets
      for select to authenticated
      using (auth.uid() = user_id or public.current_role() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wallets' and policyname = 'wallets_update_own_or_admin') then
    create policy wallets_update_own_or_admin on public.wallets
      for update to authenticated
      using (auth.uid() = user_id or public.current_role() = 'admin')
      with check (auth.uid() = user_id or public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_methods' and policyname = 'payment_methods_own') then
    create policy payment_methods_own on public.payment_methods
      for all to authenticated
      using (auth.uid() = user_id or public.current_role() = 'admin')
      with check (auth.uid() = user_id or public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wallet_topups' and policyname = 'wallet_topups_own') then
    create policy wallet_topups_own on public.wallet_topups
      for all to authenticated
      using (auth.uid() = user_id or public.current_role() = 'admin')
      with check (auth.uid() = user_id or public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payout_requests' and policyname = 'payout_requests_select') then
    create policy payout_requests_select on public.payout_requests
      for select to authenticated
      using (auth.uid() = requester_id or public.current_role() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payout_requests' and policyname = 'payout_requests_insert_own') then
    create policy payout_requests_insert_own on public.payout_requests
      for insert to authenticated
      with check (auth.uid() = requester_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payout_requests' and policyname = 'payout_requests_admin_update') then
    create policy payout_requests_admin_update on public.payout_requests
      for update to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_transactions' and policyname = 'financial_transactions_select_scope') then
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
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_transactions' and policyname = 'financial_transactions_insert_scope') then
    create policy financial_transactions_insert_scope on public.financial_transactions
      for insert to authenticated
      with check (
        public.current_role() = 'admin'
        or auth.uid() = created_by
        or auth.uid() = payer_id
        or auth.uid() = payee_id
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'financial_transactions' and policyname = 'financial_transactions_admin_update') then
    create policy financial_transactions_admin_update on public.financial_transactions
      for update to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_webhook_events' and policyname = 'payment_webhook_events_admin_only') then
    create policy payment_webhook_events_admin_only on public.payment_webhook_events
      for all to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;

  if to_regclass('public.notifications') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_select_own_or_admin') then
      create policy notifications_select_own_or_admin on public.notifications
        for select to authenticated
        using (auth.uid() = user_id or public.current_role() = 'admin');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_insert_own_or_admin') then
      create policy notifications_insert_own_or_admin on public.notifications
        for insert to authenticated
        with check (auth.uid() = user_id or public.current_role() = 'admin');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_update_own_or_admin') then
      create policy notifications_update_own_or_admin on public.notifications
        for update to authenticated
        using (auth.uid() = user_id or public.current_role() = 'admin')
        with check (auth.uid() = user_id or public.current_role() = 'admin');
    end if;
  end if;

  if to_regclass('public.messages') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_select_participants_or_admin') then
      create policy messages_select_participants_or_admin on public.messages
        for select to authenticated
        using (public.current_role() = 'admin' or auth.uid() = sender_id or auth.uid() = receiver_id);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_insert_sender_or_admin') then
      create policy messages_insert_sender_or_admin on public.messages
        for insert to authenticated
        with check (public.current_role() = 'admin' or auth.uid() = sender_id);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_update_receiver_or_admin') then
      create policy messages_update_receiver_or_admin on public.messages
        for update to authenticated
        using (public.current_role() = 'admin' or auth.uid() = receiver_id or auth.uid() = sender_id)
        with check (public.current_role() = 'admin' or auth.uid() = receiver_id or auth.uid() = sender_id);
    end if;
  end if;

  if to_regclass('public.profiles') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_admin_select_all') then
      create policy profiles_admin_select_all on public.profiles
        for select to authenticated
        using (public.current_role() = 'admin');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_admin_update_all') then
      create policy profiles_admin_update_all on public.profiles
        for update to authenticated
        using (public.current_role() = 'admin')
        with check (public.current_role() = 'admin');
    end if;
  end if;

  if to_regclass('public.projects') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_admin_select_all') then
      create policy projects_admin_select_all on public.projects
        for select to authenticated
        using (public.current_role() = 'admin');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_admin_update_all') then
      create policy projects_admin_update_all on public.projects
        for update to authenticated
        using (public.current_role() = 'admin')
        with check (public.current_role() = 'admin');
    end if;
  end if;

  if to_regclass('public.invoices') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_select_client_scope') then
      create policy invoices_select_client_scope on public.invoices
        for select to authenticated
        using (
          public.current_role() = 'admin'
          or auth.uid() = client_id
          or auth.uid() = created_by
          or client_email = (select email from public.profiles where id = auth.uid())
        );
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_insert_admin_or_creator') then
      create policy invoices_insert_admin_or_creator on public.invoices
        for insert to authenticated
        with check (public.current_role() = 'admin' or auth.uid() = created_by);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_update_admin_or_creator') then
      create policy invoices_update_admin_or_creator on public.invoices
        for update to authenticated
        using (public.current_role() = 'admin' or auth.uid() = created_by)
        with check (public.current_role() = 'admin' or auth.uid() = created_by);
    end if;
  end if;

  if to_regclass('public.disputes') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'disputes' and policyname = 'disputes_admin_select_all') then
      create policy disputes_admin_select_all on public.disputes
        for select to authenticated
        using (public.current_role() = 'admin');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'disputes' and policyname = 'disputes_admin_update_all') then
      create policy disputes_admin_update_all on public.disputes
        for update to authenticated
        using (public.current_role() = 'admin')
        with check (public.current_role() = 'admin');
    end if;
  end if;

  if to_regclass('public.audit_logs') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_logs_admin_read') then
      create policy audit_logs_admin_read on public.audit_logs
        for select to authenticated
        using (public.current_role() = 'admin');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_logs_admin_insert') then
      create policy audit_logs_admin_insert on public.audit_logs
        for insert to authenticated
        with check (public.current_role() = 'admin');
    end if;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.notifications';
    exception when duplicate_object then null; when undefined_table then null; end;
    begin
      execute 'alter publication supabase_realtime add table public.invoices';
    exception when duplicate_object then null; when undefined_table then null; end;
    begin
      execute 'alter publication supabase_realtime add table public.wallet_topups';
    exception when duplicate_object then null; when undefined_table then null; end;
    begin
      execute 'alter publication supabase_realtime add table public.financial_transactions';
    exception when duplicate_object then null; when undefined_table then null; end;
    begin
      execute 'alter publication supabase_realtime add table public.messages';
    exception when duplicate_object then null; when undefined_table then null; end;
  end if;
end $$;

commit;
