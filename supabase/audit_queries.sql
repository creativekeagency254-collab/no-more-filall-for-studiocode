-- Full-stack integration audit queries for local/staging Supabase
-- Run in Supabase SQL editor or psql.

-- 1) Tables present
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

-- 2) Core columns for profiles
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
order by ordinal_position;

-- 3) RLS enabled?
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- 4) Active policies
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 5) Finance objects expected by this project
select to_regclass('public.wallets') as wallets,
       to_regclass('public.wallet_topups') as wallet_topups,
       to_regclass('public.financial_transactions') as financial_transactions,
       to_regclass('public.payment_webhook_events') as payment_webhook_events;

-- 6) Role distribution
select role, count(*) as total
from public.profiles
group by role
order by role;

-- 7) Recent invoices
select id, status, amount, currency, paystack_reference, created_at, paid_at
from public.invoices
order by created_at desc
limit 20;

-- 8) Recent topups
select id, user_id, amount, currency, status, created_at, updated_at
from public.wallet_topups
order by created_at desc
limit 20;

-- 9) Recent finance ledger events
select id, kind, status, amount, currency, invoice_id, topup_id, created_at
from public.financial_transactions
order by created_at desc
limit 30;

-- 10) Recent webhook events
select id, provider, event_type, reference, status, created_at, processed_at
from public.payment_webhook_events
order by created_at desc
limit 30;

