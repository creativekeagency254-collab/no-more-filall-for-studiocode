/*
  Dashboard data isolation hardening
  - Enforces per-user visibility for core workflow tables
  - Preserves full access for admin role
*/

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

do $$
begin
  if to_regclass('public.messages') is not null then
    execute 'alter table public.messages enable row level security';

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_select_participants_or_admin') then
      execute $sql$
        create policy messages_select_participants_or_admin on public.messages
        for select to authenticated
        using (
          public.current_role() = 'admin'
          or auth.uid() = sender_id
          or auth.uid() = receiver_id
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_insert_sender_or_admin') then
      execute $sql$
        create policy messages_insert_sender_or_admin on public.messages
        for insert to authenticated
        with check (
          public.current_role() = 'admin'
          or auth.uid() = sender_id
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_update_receiver_or_admin') then
      execute $sql$
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
        )
      $sql$;
    end if;
  end if;

  if to_regclass('public.projects') is not null then
    execute 'alter table public.projects enable row level security';

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_select_scope') then
      execute $sql$
        create policy projects_select_scope on public.projects
        for select to authenticated
        using (
          public.current_role() = 'admin'
          or auth.uid() = client_id
          or auth.uid() = developer_id
          or auth.uid() = commissioner_id
          or (
            status = 'open'
            and public.current_role() in ('developer', 'commissioner')
          )
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_insert_scope') then
      execute $sql$
        create policy projects_insert_scope on public.projects
        for insert to authenticated
        with check (
          public.current_role() = 'admin'
          or auth.uid() = client_id
          or auth.uid() = commissioner_id
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_update_scope') then
      execute $sql$
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
        )
      $sql$;
    end if;
  end if;

  if to_regclass('public.milestones') is not null then
    execute 'alter table public.milestones enable row level security';

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'milestones' and policyname = 'milestones_select_scope') then
      execute $sql$
        create policy milestones_select_scope on public.milestones
        for select to authenticated
        using (
          public.current_role() = 'admin'
          or exists (
            select 1
            from public.projects p
            where p.id = project_id
              and (
                p.client_id = auth.uid()
                or p.developer_id = auth.uid()
                or p.commissioner_id = auth.uid()
              )
          )
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'milestones' and policyname = 'milestones_insert_scope') then
      execute $sql$
        create policy milestones_insert_scope on public.milestones
        for insert to authenticated
        with check (
          public.current_role() = 'admin'
          or exists (
            select 1
            from public.projects p
            where p.id = project_id
              and (p.commissioner_id = auth.uid() or p.developer_id = auth.uid())
          )
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'milestones' and policyname = 'milestones_update_scope') then
      execute $sql$
        create policy milestones_update_scope on public.milestones
        for update to authenticated
        using (
          public.current_role() = 'admin'
          or exists (
            select 1
            from public.projects p
            where p.id = project_id
              and (p.commissioner_id = auth.uid() or p.developer_id = auth.uid())
          )
        )
        with check (
          public.current_role() = 'admin'
          or exists (
            select 1
            from public.projects p
            where p.id = project_id
              and (p.commissioner_id = auth.uid() or p.developer_id = auth.uid())
          )
        )
      $sql$;
    end if;
  end if;

  if to_regclass('public.invoices') is not null then
    execute 'alter table public.invoices enable row level security';

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_select_scope') then
      execute $sql$
        create policy invoices_select_scope on public.invoices
        for select to authenticated
        using (
          public.current_role() = 'admin'
          or auth.uid() = created_by
          or client_email = (select email from public.profiles where id = auth.uid())
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_insert_scope') then
      execute $sql$
        create policy invoices_insert_scope on public.invoices
        for insert to authenticated
        with check (
          public.current_role() = 'admin'
          or auth.uid() = created_by
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_update_scope') then
      execute $sql$
        create policy invoices_update_scope on public.invoices
        for update to authenticated
        using (
          public.current_role() = 'admin'
          or auth.uid() = created_by
        )
        with check (
          public.current_role() = 'admin'
          or auth.uid() = created_by
        )
      $sql$;
    end if;
  end if;

  if to_regclass('public.proposals') is not null then
    execute 'alter table public.proposals enable row level security';

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proposals' and policyname = 'proposals_select_scope') then
      execute $sql$
        create policy proposals_select_scope on public.proposals
        for select to authenticated
        using (
          public.current_role() = 'admin'
          or auth.uid() = developer_id
          or exists (
            select 1
            from public.projects p
            where p.id = project_id
              and (
                p.client_id = auth.uid()
                or p.commissioner_id = auth.uid()
                or p.developer_id = auth.uid()
              )
          )
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proposals' and policyname = 'proposals_insert_scope') then
      execute $sql$
        create policy proposals_insert_scope on public.proposals
        for insert to authenticated
        with check (
          public.current_role() = 'admin'
          or auth.uid() = developer_id
        )
      $sql$;
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proposals' and policyname = 'proposals_update_scope') then
      execute $sql$
        create policy proposals_update_scope on public.proposals
        for update to authenticated
        using (
          public.current_role() = 'admin'
          or auth.uid() = developer_id
          or exists (
            select 1
            from public.projects p
            where p.id = project_id
              and p.commissioner_id = auth.uid()
          )
        )
        with check (
          public.current_role() = 'admin'
          or auth.uid() = developer_id
          or exists (
            select 1
            from public.projects p
            where p.id = project_id
              and p.commissioner_id = auth.uid()
          )
        )
      $sql$;
    end if;
  end if;
end $$;
