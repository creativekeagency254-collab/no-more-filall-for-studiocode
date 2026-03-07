-- Client support + timeline reliability patch
-- Safe additive migration to keep dashboard features stable.

alter table if exists public.projects
  add column if not exists timeline text;

alter table if exists public.messages
  add column if not exists is_read boolean default false;

create index if not exists idx_messages_receiver_created_at
  on public.messages(receiver_id, created_at desc);

create index if not exists idx_messages_sender_receiver
  on public.messages(sender_id, receiver_id);
