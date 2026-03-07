-- Allow clients to include a contact phone when creating a project.
alter table public.projects
  add column if not exists client_phone text;

comment on column public.projects.client_phone is
  'Client contact phone captured during project creation flow.';
