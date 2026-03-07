-- Business messaging expansion + developer profile details
-- Safe additive migration: no destructive changes.

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------
-- Developer profile detail table (for richer public/shareable profile)
-- ------------------------------------------------------------------
create table if not exists public.developer_profiles (
  developer_id uuid primary key references public.profiles(id) on delete cascade,
  primary_stack text,
  years_experience integer not null default 0,
  portfolio_url text,
  github_url text,
  linkedin_url text,
  rating numeric(4,2),
  completed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.developer_profiles enable row level security;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'developer_profiles' and policyname = 'developer_profiles_select_own_or_admin'
  ) then
    create policy developer_profiles_select_own_or_admin on public.developer_profiles
      for select using (developer_id = auth.uid() or public.current_user_is_admin());
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'developer_profiles' and policyname = 'developer_profiles_upsert_own_or_admin'
  ) then
    create policy developer_profiles_upsert_own_or_admin on public.developer_profiles
      for all using (developer_id = auth.uid() or public.current_user_is_admin())
      with check (developer_id = auth.uid() or public.current_user_is_admin());
  end if;
end $$;

create index if not exists idx_developer_profiles_stack on public.developer_profiles(primary_stack);

-- ------------------------------------------------------------------
-- Structured conversations layer (for role/project scoped messaging)
-- ------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  conversation_type text not null default 'direct',
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.conversations') is not null then
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'conversations' and c.conname = 'conversations_type_check'
    ) then
      alter table public.conversations
        add constraint conversations_type_check
        check (conversation_type in ('direct', 'project_group', 'internal'));
    end if;
  end if;
end $$;

create table if not exists public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create unique index if not exists ux_conversation_participants_unique
  on public.conversation_participants(conversation_id, user_id);
create index if not exists idx_conversation_participants_user
  on public.conversation_participants(user_id);

alter table public.messages
  add column if not exists conversation_id uuid;

do $$
begin
  if to_regclass('public.messages') is not null then
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'messages' and c.conname = 'messages_conversation_id_fkey'
    ) then
      alter table public.messages
        add constraint messages_conversation_id_fkey
        foreign key (conversation_id) references public.conversations(id) on delete set null;
    end if;
  end if;
end $$;

create index if not exists idx_messages_conversation_id on public.messages(conversation_id);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  storage_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_message_attachments_message_id on public.message_attachments(message_id);
create index if not exists idx_message_attachments_conversation_id on public.message_attachments(conversation_id);

create table if not exists public.read_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  delivered_at timestamptz
);

create unique index if not exists ux_read_receipts_unique on public.read_receipts(message_id, user_id);
create index if not exists idx_read_receipts_conversation_id on public.read_receipts(conversation_id);
create index if not exists idx_read_receipts_user_id on public.read_receipts(user_id);

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.message_attachments enable row level security;
alter table public.read_receipts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='conversations' and policyname='conversations_select_participant_or_admin'
  ) then
    create policy conversations_select_participant_or_admin on public.conversations
      for select using (
        public.current_user_is_admin()
        or exists (
          select 1 from public.conversation_participants cp
          where cp.conversation_id = conversations.id and cp.user_id = auth.uid() and cp.left_at is null
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='conversations' and policyname='conversations_insert_creator_or_admin'
  ) then
    create policy conversations_insert_creator_or_admin on public.conversations
      for insert with check (created_by = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='conversations' and policyname='conversations_update_creator_or_admin'
  ) then
    create policy conversations_update_creator_or_admin on public.conversations
      for update using (created_by = auth.uid() or public.current_user_is_admin())
      with check (created_by = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='conversation_participants' and policyname='participants_select_own_or_admin'
  ) then
    create policy participants_select_own_or_admin on public.conversation_participants
      for select using (user_id = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='conversation_participants' and policyname='participants_insert_creator_or_admin'
  ) then
    create policy participants_insert_creator_or_admin on public.conversation_participants
      for insert with check (
        public.current_user_is_admin()
        or exists (
          select 1 from public.conversations c
          where c.id = conversation_participants.conversation_id and c.created_by = auth.uid()
        )
        or user_id = auth.uid()
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='conversation_participants' and policyname='participants_update_self_or_admin'
  ) then
    create policy participants_update_self_or_admin on public.conversation_participants
      for update using (user_id = auth.uid() or public.current_user_is_admin())
      with check (user_id = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='message_attachments' and policyname='attachments_select_participant_or_admin'
  ) then
    create policy attachments_select_participant_or_admin on public.message_attachments
      for select using (
        public.current_user_is_admin()
        or exists (
          select 1 from public.conversation_participants cp
          where cp.conversation_id = message_attachments.conversation_id and cp.user_id = auth.uid() and cp.left_at is null
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='message_attachments' and policyname='attachments_insert_sender_or_admin'
  ) then
    create policy attachments_insert_sender_or_admin on public.message_attachments
      for insert with check (created_by = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='read_receipts' and policyname='read_receipts_select_own_or_admin'
  ) then
    create policy read_receipts_select_own_or_admin on public.read_receipts
      for select using (user_id = auth.uid() or public.current_user_is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='read_receipts' and policyname='read_receipts_insert_own_or_admin'
  ) then
    create policy read_receipts_insert_own_or_admin on public.read_receipts
      for insert with check (user_id = auth.uid() or public.current_user_is_admin());
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.conversations';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.conversation_participants';
    exception when duplicate_object then null;
    end;
    begin
      execute 'alter publication supabase_realtime add table public.read_receipts';
    exception when duplicate_object then null;
    end;
  end if;
end $$;
