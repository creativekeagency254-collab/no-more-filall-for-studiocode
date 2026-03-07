/*
  Expand projects.status constraint to support deposit-first workflow and
  cross-dashboard lifecycle states without breaking legacy rows.
*/

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'projects'
      and c.conname = 'projects_status_check'
  ) then
    alter table public.projects drop constraint projects_status_check;
  end if;
end $$;

alter table public.projects
  add constraint projects_status_check
  check (
    status in (
      'pending',
      'pending_deposit',
      'open',
      'active',
      'assigned',
      'in-progress',
      'in_progress',
      'in-review',
      'in_review',
      'completed',
      'complete',
      'delivered',
      'paid',
      'disputed',
      'cancelled',
      'on_hold'
    )
  );

