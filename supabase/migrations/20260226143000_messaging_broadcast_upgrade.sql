-- Messaging + broadcast reliability upgrade
-- Non-destructive patch: extends existing tables used by dashboards.

create extension if not exists "pgcrypto";

-- Track richer message lifecycle and attachments without breaking old flows.
alter table public.messages
  add column if not exists status text not null default 'sent';

alter table public.messages
  add column if not exists edited_at timestamptz;

alter table public.messages
  add column if not exists reply_to_message_id uuid;

alter table public.messages
  add column if not exists attachment_url text;

alter table public.messages
  add column if not exists attachment_name text;

alter table public.messages
  add column if not exists attachment_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'messages'
      and c.conname = 'messages_status_check'
  ) then
    alter table public.messages
      add constraint messages_status_check
      check (status in ('sent', 'delivered', 'seen'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'messages'
      and c.conname = 'messages_reply_to_fkey'
  ) then
    alter table public.messages
      add constraint messages_reply_to_fkey
      foreign key (reply_to_message_id) references public.messages(id) on delete set null;
  end if;
end $$;

create index if not exists idx_messages_status on public.messages(status);
create index if not exists idx_messages_project_created on public.messages(project_id, created_at desc);
create index if not exists idx_messages_reply_to on public.messages(reply_to_message_id);

-- Notification extensions used for admin broadcast targeting.
alter table public.notifications
  add column if not exists channel text not null default 'inbox';

alter table public.notifications
  add column if not exists priority text not null default 'normal';

alter table public.notifications
  add column if not exists expires_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'notifications'
      and c.conname = 'notifications_priority_check'
  ) then
    alter table public.notifications
      add constraint notifications_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;
end $$;

create index if not exists idx_notifications_type_created on public.notifications(type, created_at desc);
create index if not exists idx_notifications_channel on public.notifications(channel);

-- Broadcast audit table for admin command center.
create table if not exists public.admin_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  title text not null,
  body text not null,
  target_roles text[] not null default array['client', 'developer', 'commissioner'],
  priority text not null default 'normal',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'admin_broadcasts'
      and c.conname = 'admin_broadcasts_priority_check'
  ) then
    alter table public.admin_broadcasts
      add constraint admin_broadcasts_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;
end $$;

create index if not exists idx_admin_broadcasts_created on public.admin_broadcasts(created_at desc);
create index if not exists idx_admin_broadcasts_roles on public.admin_broadcasts using gin(target_roles);

alter table public.admin_broadcasts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_broadcasts'
      and policyname = 'admin_broadcasts_admin_all'
  ) then
    create policy admin_broadcasts_admin_all on public.admin_broadcasts
      for all
      using (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.role = 'admin'
        )
      )
      with check (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.role = 'admin'
        )
      );
  end if;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.admin_broadcasts';
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

