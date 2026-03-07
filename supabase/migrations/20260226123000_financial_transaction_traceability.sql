/*
  Financial transaction traceability patch
  - Auto-populates payer/payee/created_by from invoice/top-up context
  - Backfills missing participants for existing ledger records
  - Adds explicit metadata breadcrumbs for client/account audit trails
*/

begin;

create or replace function public.normalize_financial_transaction_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_client_email text;
  v_invoice_creator uuid;
  v_topup_user uuid;
  v_meta jsonb;
begin
  v_meta := coalesce(new.metadata, '{}'::jsonb);

  if new.invoice_id is not null then
    select i.client_id, i.client_email, i.created_by
      into v_client_id, v_client_email, v_invoice_creator
    from public.invoices i
    where i.id = new.invoice_id
    limit 1;

    if v_client_id is null and coalesce(v_client_email, '') <> '' then
      select p.id into v_client_id
      from public.profiles p
      where lower(coalesce(p.email, '')) = lower(v_client_email)
      limit 1;
    end if;

    if new.payer_id is null then
      new.payer_id := v_client_id;
    end if;

    if new.payee_id is null and v_invoice_creator is not null and v_invoice_creator <> coalesce(new.payer_id, v_invoice_creator) then
      new.payee_id := v_invoice_creator;
    end if;

    if new.created_by is null then
      new.created_by := coalesce(v_invoice_creator, new.payer_id, new.payee_id);
    end if;

    v_meta := v_meta || jsonb_build_object(
      'invoice_client_id', v_client_id,
      'invoice_client_email', v_client_email,
      'invoice_created_by', v_invoice_creator
    );
  end if;

  if new.topup_id is not null then
    select wt.user_id into v_topup_user
    from public.wallet_topups wt
    where wt.id = new.topup_id
    limit 1;

    if new.payer_id is null then
      new.payer_id := v_topup_user;
    end if;

    if new.created_by is null then
      new.created_by := coalesce(v_topup_user, new.payer_id, new.payee_id);
    end if;

    v_meta := v_meta || jsonb_build_object(
      'topup_user_id', v_topup_user
    );
  end if;

  if new.payer_id is null and new.kind = 'wallet_topup' and (new.metadata ? 'user_id') then
    begin
      new.payer_id := (new.metadata ->> 'user_id')::uuid;
    exception when others then
      null;
    end;
  end if;

  if coalesce(trim(new.transaction_ref), '') = '' then
    new.transaction_ref := 'TX-' || to_char(now(), 'YYYYMMDDHH24MISSMS') || '-' || left(gen_random_uuid()::text, 8);
  end if;

  new.metadata := v_meta || jsonb_build_object(
    'trace_normalized', true,
    'trace_normalized_at', now()
  );

  return new;
end;
$$;

drop trigger if exists trg_normalize_financial_transactions on public.financial_transactions;
create trigger trg_normalize_financial_transactions
before insert or update on public.financial_transactions
for each row
execute function public.normalize_financial_transaction_participants();

update public.financial_transactions ft
set
  payer_id = coalesce(
    ft.payer_id,
    i.client_id,
    p.id
  ),
  payee_id = coalesce(
    ft.payee_id,
    case
      when i.created_by is not null and i.created_by <> coalesce(ft.payer_id, i.client_id, p.id) then i.created_by
      else null
    end
  ),
  created_by = coalesce(
    ft.created_by,
    i.created_by,
    ft.payer_id,
    i.client_id,
    p.id
  ),
  metadata = coalesce(ft.metadata, '{}'::jsonb) || jsonb_build_object(
    'trace_backfilled', true,
    'trace_backfilled_at', now(),
    'trace_backfilled_source', '20260226123000_financial_transaction_traceability'
  )
from public.invoices i
left join public.profiles p
  on lower(coalesce(p.email, '')) = lower(coalesce(i.client_email, ''))
where ft.invoice_id = i.id
  and (
    ft.payer_id is null
    or ft.payee_id is null
    or ft.created_by is null
  );

update public.financial_transactions ft
set
  payer_id = coalesce(ft.payer_id, wt.user_id),
  created_by = coalesce(ft.created_by, wt.user_id, ft.payer_id),
  metadata = coalesce(ft.metadata, '{}'::jsonb) || jsonb_build_object(
    'trace_backfilled', true,
    'trace_backfilled_at', now(),
    'trace_backfilled_source', '20260226123000_financial_transaction_traceability_topup'
  )
from public.wallet_topups wt
where ft.topup_id = wt.id
  and (
    ft.payer_id is null
    or ft.created_by is null
  );

commit;
