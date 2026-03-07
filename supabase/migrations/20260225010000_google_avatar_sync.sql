/*
  # Sync Google OAuth avatars into profiles

  ## Why
  - New Google signups should automatically carry the Google profile picture.
  - Existing profiles without an avatar should be backfilled from auth metadata.
*/

alter table public.profiles
  add column if not exists avatar_url text;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, first_name, last_name, role, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    'client',
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    first_name = case
      when coalesce(public.profiles.first_name, '') = '' then excluded.first_name
      else public.profiles.first_name
    end,
    last_name = case
      when coalesce(public.profiles.last_name, '') = '' then excluded.last_name
      else public.profiles.last_name
    end,
    avatar_url = case
      when coalesce(public.profiles.avatar_url, '') = '' then excluded.avatar_url
      else public.profiles.avatar_url
    end;

  return new;
end;
$$ language plpgsql security definer;

update public.profiles p
set avatar_url = coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
from auth.users u
where p.id = u.id
  and coalesce(p.avatar_url, '') = ''
  and coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', '') <> '';
