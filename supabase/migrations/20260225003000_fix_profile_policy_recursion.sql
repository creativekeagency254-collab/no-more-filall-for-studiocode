/*
  Fixes policy recursion issues involving public.current_role() and public.profiles.
  - Rebuilds current_role() as SECURITY DEFINER with row_security off
  - Reapplies simple own-row profile policies (no recursive references)
*/

begin;

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

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;

create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

commit;

