begin;

create extension if not exists pgcrypto;

create table if not exists public.avatar_presets (
  id uuid primary key default gen_random_uuid(),
  role text not null default 'all' check (role in ('all','client','developer','commissioner','admin')),
  label text not null,
  image_url text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_avatar_presets_role_image
  on public.avatar_presets(role, image_url);
create index if not exists idx_avatar_presets_role_active
  on public.avatar_presets(role, is_active, sort_order);

insert into public.avatar_presets (role, label, image_url, sort_order)
values
  ('all', 'Preset A', 'https://api.dicebear.com/7.x/personas/svg?seed=CodeStudioPresetA', 10),
  ('all', 'Preset B', 'https://api.dicebear.com/7.x/personas/svg?seed=CodeStudioPresetB', 20),
  ('all', 'Preset C', 'https://api.dicebear.com/7.x/personas/svg?seed=CodeStudioPresetC', 30),
  ('all', 'Preset D', 'https://api.dicebear.com/7.x/thumbs/svg?seed=CodeStudioPresetD', 40),
  ('all', 'Preset E', 'https://api.dicebear.com/7.x/lorelei/svg?seed=CodeStudioPresetE', 50),
  ('all', 'Preset F', 'https://api.dicebear.com/7.x/lorelei/svg?seed=CodeStudioPresetF', 60)
on conflict (role, image_url) do nothing;

alter table public.projects add column if not exists software_type text;
alter table public.projects add column if not exists timeline_text text;
alter table public.projects add column if not exists priority text default 'normal';
alter table public.projects add column if not exists bid_deadline date;
alter table public.projects add column if not exists lead_scope text;
alter table public.projects add column if not exists requirements_json jsonb not null default '{}'::jsonb;

create index if not exists idx_projects_software_type on public.projects(software_type);
create index if not exists idx_projects_priority on public.projects(priority);
create index if not exists idx_projects_bid_deadline on public.projects(bid_deadline);

alter table public.avatar_presets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'avatar_presets' and policyname = 'avatar_presets_select_all_authenticated'
  ) then
    create policy avatar_presets_select_all_authenticated on public.avatar_presets
      for select to authenticated
      using (is_active = true or public.current_role() = 'admin');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'avatar_presets' and policyname = 'avatar_presets_admin_manage'
  ) then
    create policy avatar_presets_admin_manage on public.avatar_presets
      for all to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;
end $$;

do $$
begin
  if to_regclass('public.proposals') is not null then
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proposals' and policyname = 'proposals_insert_scope') then
      drop policy proposals_insert_scope on public.proposals;
    end if;
    create policy proposals_insert_scope on public.proposals
      for insert to authenticated
      with check (
        public.current_role() = 'admin'
        or (
          auth.uid() = developer_id
          and exists (
            select 1
            from public.projects p
            where p.id = project_id
              and coalesce(p.status, 'open') in ('open', 'pending')
          )
        )
      );
  end if;
end $$;

do $$
begin
  if to_regclass('public.payout_requests') is not null then
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payout_requests' and policyname = 'payout_requests_insert_own') then
      drop policy payout_requests_insert_own on public.payout_requests;
    end if;
    create policy payout_requests_insert_own on public.payout_requests
      for insert to authenticated
      with check (
        auth.uid() = requester_id
        and public.current_role() in ('developer', 'commissioner', 'admin')
      );
  end if;
end $$;

do $$
declare
  t text;
  tables text[] := array[
    'projects',
    'proposals',
    'payout_requests',
    'financial_transactions',
    'wallet_topups',
    'payment_methods',
    'messages',
    'invoices'
  ];
  policy_name text;
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    policy_name := t || '_admin_godmode_all';
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.current_role() = ''admin'') with check (public.current_role() = ''admin'')',
        policy_name,
        t
      );
    end if;
  end loop;
end $$;

do $$
begin
  if to_regclass('public.avatar_presets') is not null then
    begin
      execute 'alter publication supabase_realtime add table public.avatar_presets';
    exception when others then
      null;
    end;
  end if;
end $$;

commit;

