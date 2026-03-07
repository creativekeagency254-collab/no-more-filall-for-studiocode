/*
  Compatibility layer:
  Some checklists refer to a public.top_ups object while this project uses public.wallet_topups.
  This view provides a stable read surface without changing UI/UX or existing flows.
*/

begin;

create or replace view public.top_ups as
select
  wt.id,
  wt.user_id as profile_id,
  wt.amount,
  'KES'::text as currency,
  wt.status,
  wt.metadata as provider_payload,
  wt.created_at,
  coalesce(wt.completed_at, wt.created_at) as updated_at
from public.wallet_topups wt;

comment on view public.top_ups is 'Compatibility view mapped to wallet_topups (profile_id -> user_id).';

grant select on public.top_ups to authenticated;
grant select on public.top_ups to service_role;

commit;
