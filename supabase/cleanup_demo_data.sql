-- Cleanup demo/test data (profiles + related rows).
-- Review this script before running in production.
-- Run in Supabase SQL Editor.

begin;

create temporary table _demo_profile_ids as
select id, lower(email) as email
from public.profiles
where lower(email) in (
  'client@test.com',
  'admin@test.com',
  'commissioner@test.com',
  'developer@test.com'
)
or lower(email) like '%@seed.escrowmkt.local'
or lower(email) like '%@seed.codestudio.ke'
or lower(email) like '%@example.com';

do $$
begin
  if to_regclass('public.notifications') is not null then
    delete from public.notifications
    where user_id in (select id from _demo_profile_ids);
  end if;

  if to_regclass('public.messages') is not null then
    delete from public.messages
    where sender_id in (select id from _demo_profile_ids)
       or receiver_id in (select id from _demo_profile_ids);
  end if;

  if to_regclass('public.payment_methods') is not null then
    delete from public.payment_methods
    where user_id in (select id from _demo_profile_ids);
  end if;

  if to_regclass('public.wallet_topups') is not null then
    delete from public.wallet_topups
    where user_id in (select id from _demo_profile_ids);
  end if;

  if to_regclass('public.payout_requests') is not null then
    delete from public.payout_requests
    where requester_id in (select id from _demo_profile_ids)
       or approved_by in (select id from _demo_profile_ids);
  end if;

  if to_regclass('public.financial_transactions') is not null then
    delete from public.financial_transactions
    where payer_id in (select id from _demo_profile_ids)
       or payee_id in (select id from _demo_profile_ids)
       or commissioner_id in (select id from _demo_profile_ids)
       or created_by in (select id from _demo_profile_ids);
  end if;

  if to_regclass('public.disputes') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'disputes' and column_name = 'raised_by'
    ) then
      delete from public.disputes
      where raised_by in (select id from _demo_profile_ids);
    end if;
  end if;

  if to_regclass('public.audit_logs') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'actor_id'
    ) then
      delete from public.audit_logs
      where actor_id in (select id from _demo_profile_ids);
    end if;
  end if;

  if to_regclass('public.invoices') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices' and column_name = 'client_id'
    ) then
      delete from public.invoices
      where client_id in (select id from _demo_profile_ids);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices' and column_name = 'created_by'
    ) then
      delete from public.invoices
      where created_by in (select id from _demo_profile_ids);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices' and column_name = 'client_email'
    ) then
      delete from public.invoices
      where lower(client_email) in (select email from _demo_profile_ids);
    end if;
  end if;

  if to_regclass('public.projects') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'projects' and column_name = 'client_id'
    ) then
      delete from public.projects
      where client_id in (select id from _demo_profile_ids);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'projects' and column_name = 'developer_id'
    ) then
      delete from public.projects
      where developer_id in (select id from _demo_profile_ids);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'projects' and column_name = 'commissioner_id'
    ) then
      delete from public.projects
      where commissioner_id in (select id from _demo_profile_ids);
    end if;
  end if;

  if to_regclass('public.wallets') is not null then
    delete from public.wallets
    where user_id in (select id from _demo_profile_ids);
  end if;
end
$$;

delete from public.profiles
where id in (select id from _demo_profile_ids);

drop table if exists _demo_profile_ids;

commit;

-- Note:
-- This script does not delete auth.users records.
-- Remove matching auth users from Supabase Authentication -> Users,
-- or via admin API after this cleanup.
