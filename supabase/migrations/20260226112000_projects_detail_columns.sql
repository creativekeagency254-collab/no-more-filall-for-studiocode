alter table if exists public.projects
  add column if not exists timeline text,
  add column if not exists software_type text,
  add column if not exists priority text,
  add column if not exists bid_deadline date,
  add column if not exists scope text,
  add column if not exists requirements jsonb;

create index if not exists idx_projects_priority on public.projects(priority);
create index if not exists idx_projects_bid_deadline on public.projects(bid_deadline);
