/*
  Payment reconciliation layer
  - webhook event log
  - invoice paid reconciliation (invoice_payment + commission accrual)
  - wallet topup paid reconciliation (wallet credit + tx status)
*/

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

create index if not exists idx_payment_webhook_events_provider_ref on public.payment_webhook_events(provider, reference);
create index if not exists idx_payment_webhook_events_status on public.payment_webhook_events(status);

alter table public.payment_webhook_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'payment_webhook_events' and policyname = 'payment_webhook_events_admin_only') then
    create policy payment_webhook_events_admin_only on public.payment_webhook_events
      for all to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;
end $$;

create or replace function public.reconcile_invoice_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_commissioner uuid;
  comm_rate numeric := 0.30;
  comm_amount numeric := 0;
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    select commissioner_id into project_commissioner
    from public.projects
    where id = new.project_id;

    if project_commissioner is null then
      project_commissioner := new.created_by;
    end if;

    comm_amount := round((coalesce(new.amount, 0) * comm_rate)::numeric, 2);

    insert into public.financial_transactions (
      transaction_ref, kind, status, amount, currency, description,
      payer_id, payee_id, commissioner_id, commission_amount,
      project_id, invoice_id, created_by
    )
    values (
      'INV-PAY-' || left(new.id::text, 8),
      'invoice_payment',
      'paid',
      coalesce(new.amount, 0),
      coalesce(new.currency, 'KES'),
      'Invoice payment reconciled',
      null,
      null,
      project_commissioner,
      comm_amount,
      new.project_id,
      new.id,
      new.created_by
    )
    on conflict (transaction_ref) do update
      set status = excluded.status,
          amount = excluded.amount,
          commission_amount = excluded.commission_amount,
          commissioner_id = excluded.commissioner_id,
          description = excluded.description;

    if project_commissioner is not null and comm_amount > 0 then
      insert into public.financial_transactions (
        transaction_ref, kind, status, amount, currency, description,
        commissioner_id, payee_id, commission_amount,
        project_id, invoice_id, created_by
      )
      values (
        'COMM-' || left(new.id::text, 8),
        'commission_accrual',
        'paid',
        comm_amount,
        coalesce(new.currency, 'KES'),
        'Commission accrued from paid invoice',
        project_commissioner,
        project_commissioner,
        comm_amount,
        new.project_id,
        new.id,
        new.created_by
      )
      on conflict (transaction_ref) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reconcile_invoice_paid on public.invoices;
create trigger trg_reconcile_invoice_paid
after update on public.invoices
for each row
execute function public.reconcile_invoice_paid();

create or replace function public.reconcile_wallet_topup_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    perform public.ensure_wallet(new.user_id);

    update public.wallets
      set balance = balance + coalesce(new.amount, 0),
          updated_at = now()
      where user_id = new.user_id;

    update public.financial_transactions
      set status = 'paid',
          amount = coalesce(new.amount, amount)
      where topup_id = new.id
        and kind = 'wallet_topup';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reconcile_wallet_topup_paid on public.wallet_topups;
create trigger trg_reconcile_wallet_topup_paid
after update on public.wallet_topups
for each row
execute function public.reconcile_wallet_topup_paid();
