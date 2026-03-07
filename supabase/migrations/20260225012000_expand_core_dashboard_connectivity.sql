/*
  Expand core dashboard connectivity for all roles (client/developer/commissioner/admin)
  - Ensures required workflow tables/columns/FKs exist
  - Adds admin profile visibility/update policy
  - Enables/repairs RLS policies for cross-dashboard operations
  - Adds realtime publication wiring for live dashboard updates
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

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled Project',
  description text,
  status text not null default 'open',
  total_value numeric(14,2) not null default 0,
  progress numeric(5,2) not null default 0,
  due_date date,
  client_id uuid,
  developer_id uuid,
  commissioner_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects add column if not exists title text not null default 'Untitled Project';
alter table public.projects add column if not exists description text;
alter table public.projects add column if not exists status text not null default 'open';
alter table public.projects add column if not exists total_value numeric(14,2) not null default 0;
alter table public.projects add column if not exists progress numeric(5,2) not null default 0;
alter table public.projects add column if not exists due_date date;
alter table public.projects add column if not exists client_id uuid;
alter table public.projects add column if not exists developer_id uuid;
alter table public.projects add column if not exists commissioner_id uuid;
alter table public.projects add column if not exists created_by uuid;
alter table public.projects add column if not exists created_at timestamptz not null default now();
alter table public.projects add column if not exists updated_at timestamptz not null default now();

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  title text not null default 'Milestone',
  description text,
  amount numeric(14,2) not null default 0,
  status text not null default 'pending',
  due_date date,
  submitted_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.milestones add column if not exists project_id uuid;
alter table public.milestones add column if not exists title text not null default 'Milestone';
alter table public.milestones add column if not exists description text;
alter table public.milestones add column if not exists amount numeric(14,2) not null default 0;
alter table public.milestones add column if not exists status text not null default 'pending';
alter table public.milestones add column if not exists due_date date;
alter table public.milestones add column if not exists submitted_at timestamptz;
alter table public.milestones add column if not exists approved_at timestamptz;
alter table public.milestones add column if not exists paid_at timestamptz;
alter table public.milestones add column if not exists created_at timestamptz not null default now();
alter table public.milestones add column if not exists updated_at timestamptz not null default now();

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  developer_id uuid not null,
  commissioner_id uuid,
  amount numeric(14,2) not null default 0,
  message text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.proposals add column if not exists project_id uuid;
alter table public.proposals add column if not exists developer_id uuid;
alter table public.proposals add column if not exists commissioner_id uuid;
alter table public.proposals add column if not exists amount numeric(14,2) not null default 0;
alter table public.proposals add column if not exists message text;
alter table public.proposals add column if not exists status text not null default 'pending';
alter table public.proposals add column if not exists created_at timestamptz not null default now();
alter table public.proposals add column if not exists updated_at timestamptz not null default now();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  sender_id uuid not null,
  receiver_id uuid not null,
  content text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists project_id uuid;
alter table public.messages add column if not exists sender_id uuid;
alter table public.messages add column if not exists receiver_id uuid;
alter table public.messages add column if not exists content text;
update public.messages set content = '' where content is null;
alter table public.messages alter column content set default '';
alter table public.messages add column if not exists is_read boolean not null default false;
alter table public.messages add column if not exists read_at timestamptz;
alter table public.messages add column if not exists created_at timestamptz not null default now();

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  client_id uuid,
  created_by uuid,
  client_email text,
  client_name text,
  description text not null default 'Invoice',
  amount numeric(14,2) not null default 0,
  currency text not null default 'KES',
  status text not null default 'pending',
  due_date date,
  notes text,
  paystack_reference text unique,
  paystack_authorization_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoices add column if not exists project_id uuid;
alter table public.invoices add column if not exists client_id uuid;
alter table public.invoices add column if not exists created_by uuid;
alter table public.invoices add column if not exists client_email text;
alter table public.invoices add column if not exists client_name text;
alter table public.invoices add column if not exists description text not null default 'Invoice';
alter table public.invoices add column if not exists amount numeric(14,2) not null default 0;
alter table public.invoices add column if not exists currency text not null default 'KES';
alter table public.invoices add column if not exists status text not null default 'pending';
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists notes text;
alter table public.invoices add column if not exists paystack_reference text;
alter table public.invoices add column if not exists paystack_authorization_url text;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists created_at timestamptz not null default now();
alter table public.invoices add column if not exists updated_at timestamptz not null default now();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null default 'info',
  title text,
  body text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications add column if not exists user_id uuid;
alter table public.notifications add column if not exists type text not null default 'info';
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists body text;
alter table public.notifications add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.notifications add column if not exists created_at timestamptz not null default now();

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  milestone_id uuid,
  raised_by uuid,
  reason text not null default '',
  status text not null default 'open',
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.disputes add column if not exists project_id uuid;
alter table public.disputes add column if not exists milestone_id uuid;
alter table public.disputes add column if not exists raised_by uuid;
alter table public.disputes add column if not exists reason text not null default '';
alter table public.disputes add column if not exists status text not null default 'open';
alter table public.disputes add column if not exists resolution text;
alter table public.disputes add column if not exists resolved_by uuid;
alter table public.disputes add column if not exists resolved_at timestamptz;
alter table public.disputes add column if not exists created_at timestamptz not null default now();

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_table text,
  target_id text,
  diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs add column if not exists actor_id uuid;
alter table public.audit_logs add column if not exists action text not null default 'unknown_action';
alter table public.audit_logs add column if not exists target_table text;
alter table public.audit_logs add column if not exists target_id text;
alter table public.audit_logs add column if not exists diff jsonb not null default '{}'::jsonb;
alter table public.audit_logs add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'projects' and c.conname = 'projects_client_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_client_id_fkey
      foreign key (client_id) references public.profiles(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'projects' and c.conname = 'projects_developer_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_developer_id_fkey
      foreign key (developer_id) references public.profiles(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'projects' and c.conname = 'projects_commissioner_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_commissioner_id_fkey
      foreign key (commissioner_id) references public.profiles(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'milestones' and c.conname = 'milestones_project_id_fkey'
  ) then
    alter table public.milestones
      add constraint milestones_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'proposals' and c.conname = 'proposals_project_id_fkey'
  ) then
    alter table public.proposals
      add constraint proposals_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'proposals' and c.conname = 'proposals_developer_id_fkey'
  ) then
    alter table public.proposals
      add constraint proposals_developer_id_fkey
      foreign key (developer_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'proposals' and c.conname = 'proposals_commissioner_id_fkey'
  ) then
    alter table public.proposals
      add constraint proposals_commissioner_id_fkey
      foreign key (commissioner_id) references public.profiles(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'messages' and c.conname = 'messages_project_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'messages' and c.conname = 'messages_sender_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_sender_id_fkey
      foreign key (sender_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'messages' and c.conname = 'messages_receiver_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_receiver_id_fkey
      foreign key (receiver_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'invoices' and c.conname = 'invoices_project_id_fkey'
  ) then
    alter table public.invoices
      add constraint invoices_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'invoices' and c.conname = 'invoices_client_id_fkey'
  ) then
    alter table public.invoices
      add constraint invoices_client_id_fkey
      foreign key (client_id) references public.profiles(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'invoices' and c.conname = 'invoices_created_by_fkey'
  ) then
    alter table public.invoices
      add constraint invoices_created_by_fkey
      foreign key (created_by) references public.profiles(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'notifications' and c.conname = 'notifications_user_id_fkey'
  ) then
    alter table public.notifications
      add constraint notifications_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'disputes' and c.conname = 'disputes_project_id_fkey'
  ) then
    alter table public.disputes
      add constraint disputes_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null not valid;
  end if;
end $$;

create unique index if not exists idx_invoices_paystack_reference on public.invoices(paystack_reference) where paystack_reference is not null;
create index if not exists idx_projects_client_id on public.projects(client_id);
create index if not exists idx_projects_developer_id on public.projects(developer_id);
create index if not exists idx_projects_commissioner_id on public.projects(commissioner_id);
create index if not exists idx_projects_status on public.projects(status);
create index if not exists idx_milestones_project_id on public.milestones(project_id);
create index if not exists idx_milestones_status on public.milestones(status);
create index if not exists idx_proposals_project_id on public.proposals(project_id);
create index if not exists idx_proposals_developer_id on public.proposals(developer_id);
create index if not exists idx_messages_sender_id on public.messages(sender_id);
create index if not exists idx_messages_receiver_id on public.messages(receiver_id);
create index if not exists idx_messages_created_at on public.messages(created_at desc);
create index if not exists idx_invoices_client_email on public.invoices(client_email);
create index if not exists idx_invoices_status on public.invoices(status);
create index if not exists idx_notifications_user_id on public.notifications(user_id);
create index if not exists idx_disputes_project_id on public.disputes(project_id);

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.touch_updated_at();

drop trigger if exists trg_milestones_updated_at on public.milestones;
create trigger trg_milestones_updated_at
before update on public.milestones
for each row execute function public.touch_updated_at();

drop trigger if exists trg_proposals_updated_at on public.proposals;
create trigger trg_proposals_updated_at
before update on public.proposals
for each row execute function public.touch_updated_at();

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
before update on public.invoices
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.milestones enable row level security;
alter table public.proposals enable row level security;
alter table public.messages enable row level security;
alter table public.invoices enable row level security;
alter table public.notifications enable row level security;
alter table public.disputes enable row level security;
alter table public.audit_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_admin_select_all'
  ) then
    create policy profiles_admin_select_all on public.profiles
      for select to authenticated
      using (public.current_role() = 'admin');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_admin_update_all'
  ) then
    create policy profiles_admin_update_all on public.profiles
      for update to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_select_scope'
  ) then
    create policy projects_select_scope on public.projects
      for select to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = client_id
        or auth.uid() = developer_id
        or auth.uid() = commissioner_id
        or (status = 'open' and public.current_role() in ('developer', 'commissioner'))
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_insert_scope'
  ) then
    create policy projects_insert_scope on public.projects
      for insert to authenticated
      with check (
        public.current_role() = 'admin'
        or auth.uid() = client_id
        or auth.uid() = commissioner_id
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_update_scope'
  ) then
    create policy projects_update_scope on public.projects
      for update to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = client_id
        or auth.uid() = developer_id
        or auth.uid() = commissioner_id
      )
      with check (
        public.current_role() = 'admin'
        or auth.uid() = client_id
        or auth.uid() = developer_id
        or auth.uid() = commissioner_id
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'milestones' and policyname = 'milestones_select_scope'
  ) then
    create policy milestones_select_scope on public.milestones
      for select to authenticated
      using (
        public.current_role() = 'admin'
        or exists (
          select 1 from public.projects p
          where p.id = project_id
            and (p.client_id = auth.uid() or p.developer_id = auth.uid() or p.commissioner_id = auth.uid())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'milestones' and policyname = 'milestones_insert_scope'
  ) then
    create policy milestones_insert_scope on public.milestones
      for insert to authenticated
      with check (
        public.current_role() = 'admin'
        or exists (
          select 1 from public.projects p
          where p.id = project_id
            and (p.developer_id = auth.uid() or p.commissioner_id = auth.uid())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'milestones' and policyname = 'milestones_update_scope'
  ) then
    create policy milestones_update_scope on public.milestones
      for update to authenticated
      using (
        public.current_role() = 'admin'
        or exists (
          select 1 from public.projects p
          where p.id = project_id
            and (p.developer_id = auth.uid() or p.commissioner_id = auth.uid() or p.client_id = auth.uid())
        )
      )
      with check (
        public.current_role() = 'admin'
        or exists (
          select 1 from public.projects p
          where p.id = project_id
            and (p.developer_id = auth.uid() or p.commissioner_id = auth.uid() or p.client_id = auth.uid())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'proposals' and policyname = 'proposals_select_scope'
  ) then
    create policy proposals_select_scope on public.proposals
      for select to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = developer_id
        or exists (
          select 1 from public.projects p
          where p.id = project_id
            and (p.client_id = auth.uid() or p.developer_id = auth.uid() or p.commissioner_id = auth.uid())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'proposals' and policyname = 'proposals_insert_scope'
  ) then
    create policy proposals_insert_scope on public.proposals
      for insert to authenticated
      with check (
        public.current_role() = 'admin'
        or auth.uid() = developer_id
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'proposals' and policyname = 'proposals_update_scope'
  ) then
    create policy proposals_update_scope on public.proposals
      for update to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = developer_id
        or exists (
          select 1 from public.projects p
          where p.id = project_id and p.commissioner_id = auth.uid()
        )
      )
      with check (
        public.current_role() = 'admin'
        or auth.uid() = developer_id
        or exists (
          select 1 from public.projects p
          where p.id = project_id and p.commissioner_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_select_participants_or_admin'
  ) then
    create policy messages_select_participants_or_admin on public.messages
      for select to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = sender_id
        or auth.uid() = receiver_id
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_insert_sender_or_admin'
  ) then
    create policy messages_insert_sender_or_admin on public.messages
      for insert to authenticated
      with check (
        public.current_role() = 'admin'
        or auth.uid() = sender_id
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_update_receiver_or_admin'
  ) then
    create policy messages_update_receiver_or_admin on public.messages
      for update to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = receiver_id
        or auth.uid() = sender_id
      )
      with check (
        public.current_role() = 'admin'
        or auth.uid() = receiver_id
        or auth.uid() = sender_id
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_select_scope'
  ) then
    create policy invoices_select_scope on public.invoices
      for select to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = created_by
        or auth.uid() = client_id
        or client_email = (select email from public.profiles where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_insert_scope'
  ) then
    create policy invoices_insert_scope on public.invoices
      for insert to authenticated
      with check (
        public.current_role() = 'admin'
        or auth.uid() = created_by
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_update_scope'
  ) then
    create policy invoices_update_scope on public.invoices
      for update to authenticated
      using (
        public.current_role() = 'admin'
        or auth.uid() = created_by
      )
      with check (
        public.current_role() = 'admin'
        or auth.uid() = created_by
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_select_own_or_admin'
  ) then
    create policy notifications_select_own_or_admin on public.notifications
      for select to authenticated
      using (public.current_role() = 'admin' or auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_insert_own_or_admin'
  ) then
    create policy notifications_insert_own_or_admin on public.notifications
      for insert to authenticated
      with check (public.current_role() = 'admin' or auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'notifications_update_own_or_admin'
  ) then
    create policy notifications_update_own_or_admin on public.notifications
      for update to authenticated
      using (public.current_role() = 'admin' or auth.uid() = user_id)
      with check (public.current_role() = 'admin' or auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'disputes' and policyname = 'disputes_select_scope'
  ) then
    create policy disputes_select_scope on public.disputes
      for select to authenticated
      using (
        public.current_role() = 'admin'
        or raised_by = auth.uid()
        or exists (
          select 1 from public.projects p
          where p.id = project_id
            and (p.client_id = auth.uid() or p.developer_id = auth.uid() or p.commissioner_id = auth.uid())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'disputes' and policyname = 'disputes_insert_scope'
  ) then
    create policy disputes_insert_scope on public.disputes
      for insert to authenticated
      with check (
        public.current_role() = 'admin' or raised_by = auth.uid()
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'disputes' and policyname = 'disputes_admin_update'
  ) then
    create policy disputes_admin_update on public.disputes
      for update to authenticated
      using (public.current_role() = 'admin')
      with check (public.current_role() = 'admin');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_logs_admin_read'
  ) then
    create policy audit_logs_admin_read on public.audit_logs
      for select to authenticated
      using (public.current_role() = 'admin');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and policyname = 'audit_logs_admin_insert'
  ) then
    create policy audit_logs_admin_insert on public.audit_logs
      for insert to authenticated
      with check (public.current_role() = 'admin');
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.messages';
    exception when duplicate_object then null; when undefined_table then null; end;

    begin
      execute 'alter publication supabase_realtime add table public.projects';
    exception when duplicate_object then null; when undefined_table then null; end;

    begin
      execute 'alter publication supabase_realtime add table public.milestones';
    exception when duplicate_object then null; when undefined_table then null; end;

    begin
      execute 'alter publication supabase_realtime add table public.invoices';
    exception when duplicate_object then null; when undefined_table then null; end;

    begin
      execute 'alter publication supabase_realtime add table public.financial_transactions';
    exception when duplicate_object then null; when undefined_table then null; end;

    begin
      execute 'alter publication supabase_realtime add table public.payout_requests';
    exception when duplicate_object then null; when undefined_table then null; end;

    begin
      execute 'alter publication supabase_realtime add table public.notifications';
    exception when duplicate_object then null; when undefined_table then null; end;
  end if;
end $$;

commit;

