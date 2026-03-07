-- Track one-time welcome email sends for newly onboarded client accounts.
alter table public.profiles
  add column if not exists welcome_email_sent_at timestamptz;

comment on column public.profiles.welcome_email_sent_at is
  'Timestamp when automatic welcome email was sent to the profile email.';
