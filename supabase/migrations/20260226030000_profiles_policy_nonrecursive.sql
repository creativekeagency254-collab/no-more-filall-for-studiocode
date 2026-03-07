/*
  Hard reset profiles RLS policies to prevent recursion.
  Keeps owner access + admin visibility without querying profiles inside policy expressions.
*/

begin;

create or replace function public.is_admin_uid(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = coalesce(p_uid, auth.uid())
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin_uid(uuid) from public;
grant execute on function public.is_admin_uid(uuid) to authenticated, anon, service_role;

alter table public.profiles enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end $$;

create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    or public.is_admin_uid(auth.uid())
  );

create policy profiles_update_own_or_admin
  on public.profiles
  for update
  to authenticated
  using (
    auth.uid() = id
    or public.is_admin_uid(auth.uid())
  )
  with check (
    auth.uid() = id
    or public.is_admin_uid(auth.uid())
  );

create policy profiles_insert_own_or_admin
  on public.profiles
  for insert
  to authenticated
  with check (
    auth.uid() = id
    or public.is_admin_uid(auth.uid())
  );

commit;

