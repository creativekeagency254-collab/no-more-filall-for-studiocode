begin;

alter table public.invoices
  add column if not exists invoice_type text not null default 'standard';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_invoice_type_check'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_invoice_type_check
      check (invoice_type in ('standard', 'deposit', 'milestone', 'refund', 'topup'));
  end if;
end $$;

update public.invoices
set invoice_type = 'topup'
where lower(coalesce(description, '')) like '%wallet top-up%'
  and invoice_type = 'standard';

create index if not exists idx_invoices_project_type_status
  on public.invoices(project_id, invoice_type, status);

create index if not exists idx_invoices_type_created
  on public.invoices(invoice_type, created_at desc);

create or replace function public.project_has_paid_deposit(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.invoices i
    where i.project_id = p_project_id
      and i.status = 'paid'
      and (
        coalesce(i.invoice_type, 'standard') = 'deposit'
        or lower(coalesce(i.description, '')) like '%deposit%'
      )
  );
$$;

create or replace function public.enforce_project_deposit_before_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.developer_id is not null and (old.developer_id is distinct from new.developer_id) then
    if coalesce(public.current_role(), 'client') <> 'admin' and not public.project_has_paid_deposit(new.id) then
      raise exception 'Deposit payment of 45%% is required before assigning a developer';
    end if;

    if coalesce(new.status, '') in ('open', 'pending', 'pending_deposit') then
      new.status := 'in-progress';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_projects_enforce_deposit_before_assignment on public.projects;
create trigger trg_projects_enforce_deposit_before_assignment
before update on public.projects
for each row execute function public.enforce_project_deposit_before_assignment();

commit;
