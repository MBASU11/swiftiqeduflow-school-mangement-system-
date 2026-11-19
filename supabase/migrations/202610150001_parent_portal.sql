-- Parent portal: a parent gets their own login and sees ONLY their own children's
-- published report cards, fee balance, class timetable, attendance and notices.
-- Apply after 202610140001_roles_and_team.sql.
--
-- Parents have the role 'parent', which has no access to school records at all
-- (see role_collection_access). Everything they see comes through parent_portal(),
-- which looks up the children linked to their parent record and nothing else.

alter table public.school_memberships add column if not exists parent_record_id text;
alter table public.school_invites add column if not exists parent_record_id text;
alter table public.school_invites drop constraint if exists school_invites_role_check;
alter table public.school_invites add constraint school_invites_role_check
  check (role in ('school_admin', 'accountant', 'registrar', 'teacher', 'parent'));
create unique index if not exists school_memberships_one_login_per_parent
  on public.school_memberships (school_id, parent_record_id) where parent_record_id is not null;

-- Parents are managed from the student's profile, not from the staff team list.
create or replace function public.list_school_team()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  school_key uuid := public.require_school_admin();
begin
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'name', coalesce(m.full_name, ''),
        'email', coalesce(m.email, ''),
        'role', m.role,
        'isOwner', s.owner_user_id = m.user_id,
        'isMe', m.user_id = (select auth.uid()),
        'joinedAt', m.created_at
      ) order by (s.owner_user_id = m.user_id) desc, m.created_at)
      from public.school_memberships m join public.schools s on s.id = m.school_id
      where m.school_id = school_key and m.role <> 'parent'
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'name', coalesce(i.full_name, ''), 'role', i.role,
        'code', i.code, 'expiresAt', i.expires_at, 'expired', i.expires_at <= now()
      ) order by i.created_at desc)
      from public.school_invites i
      where i.school_id = school_key and i.accepted_at is null and i.role <> 'parent'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_member_role(target_user_id uuid, new_role text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid := public.require_school_admin();
  current_role_name text;
  owner_id uuid;
begin
  if new_role not in ('school_admin', 'accountant', 'registrar', 'teacher') then raise exception 'Choose a valid role.'; end if;
  select m.role, s.owner_user_id into current_role_name, owner_id
  from public.school_memberships m join public.schools s on s.id = m.school_id
  where m.school_id = school_key and m.user_id = target_user_id;
  if current_role_name is null then raise exception 'That person is not on your team.'; end if;
  if current_role_name = 'parent' then raise exception 'Parent access is managed from the student''s profile.'; end if;
  if target_user_id = owner_id and new_role <> 'school_admin' then raise exception 'The school owner is always an administrator.'; end if;
  if current_role_name = 'school_admin' and new_role <> 'school_admin'
     and (select count(*) from public.school_memberships where school_id = school_key and role = 'school_admin') <= 1 then
    raise exception 'A school needs at least one administrator.';
  end if;
  update public.school_memberships set role = new_role where school_id = school_key and user_id = target_user_id;
  insert into public.school_history (school_id, actor_user_id, action, note)
  values (school_key, (select auth.uid()), 'Team role changed', target_user_id::text || ' → ' || new_role);
end;
$$;

-- Accepting an invitation now also carries the parent link.
create or replace function public.accept_school_invite(invite_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  invite public.school_invites%rowtype;
begin
  if caller is null then raise exception 'Sign in to join a school.'; end if;
  if exists (select 1 from public.school_memberships where user_id = caller) then
    raise exception 'This account already belongs to a school.';
  end if;
  select * into invite from public.school_invites
  where code = upper(regexp_replace(coalesce(invite_code, ''), '[^A-Za-z0-9]', '', 'g'))
    and lower(email) = caller_email and accepted_at is null and expires_at > now();
  if invite.id is null then
    raise exception 'That invitation code is not valid for this email, or it has expired.';
  end if;
  insert into public.school_memberships (school_id, user_id, role, full_name, email, parent_record_id)
  values (invite.school_id, caller, invite.role, coalesce(invite.full_name, ''), caller_email, invite.parent_record_id);
  update public.school_invites set accepted_at = now(), accepted_by = caller where id = invite.id;
  insert into public.school_history (school_id, actor_user_id, action, note)
  values (invite.school_id, caller, case when invite.role = 'parent' then 'Parent joined the portal' else 'Team member joined' end, caller_email || ' as ' || invite.role);
  return jsonb_build_object('role', invite.role);
end;
$$;

-- Administrators and registrars (who look after student records) manage parent access.
create or replace function public.require_parent_manager()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  school_key uuid;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and m.role in ('school_admin', 'registrar') and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then raise exception 'Only an administrator or registrar can manage parent access.'; end if;
  return school_key;
end;
$$;

create or replace function public.invite_parent(target_parent_id text, invite_email text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid := public.require_parent_manager();
  clean_email text := lower(trim(coalesce(invite_email, '')));
  parent_payload jsonb;
  display_name text;
  new_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  existing_id uuid;
begin
  select payload into parent_payload from public.school_records
  where school_id = school_key and collection = 'parents' and record_id = target_parent_id;
  if parent_payload is null then raise exception 'That parent record does not exist.'; end if;
  if clean_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address.'; end if;
  if exists (select 1 from public.school_memberships where school_id = school_key and parent_record_id = target_parent_id) then
    raise exception 'This parent already has portal access.';
  end if;
  if exists (select 1 from public.school_memberships where school_id = school_key and lower(email) = clean_email) then
    raise exception 'That email already belongs to someone at your school.';
  end if;
  display_name := trim(coalesce(parent_payload ->> 'firstName', '') || ' ' || coalesce(parent_payload ->> 'lastName', ''));
  select id into existing_id from public.school_invites
  where school_id = school_key and parent_record_id = target_parent_id and accepted_at is null;
  if existing_id is not null then
    update public.school_invites
    set email = clean_email, full_name = nullif(display_name, ''), code = new_code, expires_at = now() + interval '14 days', created_by = (select auth.uid())
    where id = existing_id;
  else
    insert into public.school_invites (school_id, email, full_name, role, code, created_by, parent_record_id)
    values (school_key, clean_email, nullif(display_name, ''), 'parent', new_code, (select auth.uid()), target_parent_id);
  end if;
  insert into public.school_history (school_id, actor_user_id, action, note)
  values (school_key, (select auth.uid()), 'Parent portal invitation sent', clean_email);
  return jsonb_build_object('code', new_code, 'email', clean_email, 'name', display_name);
end;
$$;

create or replace function public.list_parent_access()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  school_key uuid := public.require_parent_manager();
begin
  return coalesce((
    select jsonb_agg(row_data) from (
      select jsonb_build_object('parentId', m.parent_record_id, 'status', 'active', 'email', coalesce(m.email, '')) as row_data
      from public.school_memberships m
      where m.school_id = school_key and m.role = 'parent' and m.parent_record_id is not null
      union all
      select jsonb_build_object('parentId', i.parent_record_id, 'status', 'invited', 'email', i.email, 'code', i.code, 'expired', i.expires_at <= now())
      from public.school_invites i
      where i.school_id = school_key and i.role = 'parent' and i.accepted_at is null and i.parent_record_id is not null
    ) q
  ), '[]'::jsonb);
end;
$$;

create or replace function public.revoke_parent_access(target_parent_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid := public.require_parent_manager();
begin
  delete from public.school_memberships where school_id = school_key and role = 'parent' and parent_record_id = target_parent_id;
  delete from public.school_invites where school_id = school_key and role = 'parent' and parent_record_id = target_parent_id and accepted_at is null;
  insert into public.school_history (school_id, actor_user_id, action, note)
  values (school_key, (select auth.uid()), 'Parent portal access removed', target_parent_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a parent sees. Built from the children linked to THEIR parent record only.
-- ---------------------------------------------------------------------------
create or replace function public.parent_portal()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  school_key uuid;
  my_parent_id text;
  school_payload jsonb;
  parent_payload jsonb;
  children jsonb;
  child_class_ids text[];
  child_stream_ids text[];
begin
  select m.school_id, m.parent_record_id into school_key, my_parent_id
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and m.role = 'parent' and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null or my_parent_id is null then raise exception 'Parent portal access is required.'; end if;

  select payload into school_payload from public.school_records where school_id = school_key and collection = 'school' limit 1;
  select payload into parent_payload from public.school_records where school_id = school_key and collection = 'parents' and record_id = my_parent_id;

  select coalesce(jsonb_agg(child order by child ->> 'name'), '[]'::jsonb) into children
  from (
    select jsonb_build_object(
      'id', st.record_id,
      'name', trim(coalesce(st.payload ->> 'firstName', '') || ' ' || coalesce(st.payload ->> 'lastName', '')),
      'admissionNumber', st.payload ->> 'admissionNumber',
      'className', (select c.payload ->> 'name' from public.school_records c where c.school_id = school_key and c.collection = 'classes' and c.record_id = st.payload ->> 'classId'),
      'streamName', (select s2.payload ->> 'name' from public.school_records s2 where s2.school_id = school_key and s2.collection = 'streams' and s2.record_id = st.payload ->> 'streamId'),
      'reportCards', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.record_id, 'publishedAt', p.payload -> 'publishedAt', 'snapshot', p.payload -> 'snapshot') order by p.payload ->> 'publishedAt' desc)
        from public.school_records p
        where p.school_id = school_key and p.collection = 'publishedReportCards'
          and p.payload ->> 'studentId' = st.record_id and coalesce((p.payload ->> 'revoked')::boolean, false) = false
      ), '[]'::jsonb),
      'fees', (
        select jsonb_build_object(
          'billed', coalesce(sum(inv.total), 0),
          'paid', coalesce(sum(inv.paid), 0),
          'balance', coalesce(sum(inv.total - inv.paid), 0),
          'invoices', coalesce(jsonb_agg(jsonb_build_object('id', inv.id, 'title', inv.title, 'total', inv.total, 'paid', inv.paid, 'dueDate', inv.due) order by inv.created desc), '[]'::jsonb)
        )
        from (
          select i.record_id as id,
                 coalesce(i.payload ->> 'name', i.payload ->> 'title', i.payload -> 'items' -> 0 ->> 'name', 'Invoice') as title,
                 coalesce((i.payload ->> 'totalAmount')::numeric, 0) as total,
                 coalesce((select sum((pay.payload ->> 'amount')::numeric) from public.school_records pay
                           where pay.school_id = school_key and pay.collection = 'payments' and pay.payload ->> 'invoiceId' = i.record_id), 0) as paid,
                 i.payload ->> 'dueDate' as due,
                 i.payload ->> 'createdAt' as created
          from public.school_records i
          where i.school_id = school_key and i.collection = 'invoices' and i.payload ->> 'studentId' = st.record_id
        ) inv
      ),
      'timetable', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day', t.payload ->> 'day', 'startTime', t.payload ->> 'startTime', 'endTime', t.payload ->> 'endTime',
          'kind', coalesce(t.payload ->> 'kind', 'lesson'), 'label', t.payload ->> 'label', 'room', t.payload ->> 'room',
          'subject', (select sj.payload ->> 'name' from public.school_records sj where sj.school_id = school_key and sj.collection = 'subjects' and sj.record_id = t.payload ->> 'subjectId')
        ) order by t.payload ->> 'day', t.payload ->> 'startTime')
        from public.school_records t
        where t.school_id = school_key and t.collection = 'timetableEntries' and t.payload ->> 'classId' = st.payload ->> 'classId'
      ), '[]'::jsonb),
      'attendance', (
        select jsonb_build_object('total', count(*), 'present', count(*) filter (where a.payload ->> 'status' in ('present', 'late')))
        from public.school_records a
        where a.school_id = school_key and a.collection = 'attendance' and a.payload ->> 'studentId' = st.record_id
          and a.payload ->> 'date' >= to_char(current_date - 30, 'YYYY-MM-DD')
      )
    ) as child
    from public.school_records st
    where st.school_id = school_key and st.collection = 'students'
      and coalesce(st.payload ->> 'status', 'active') <> 'archived'
      and (st.payload -> 'parentIds') ? my_parent_id
  ) kids;

  select coalesce(array_agg(distinct (c ->> 'classId')), '{}'), coalesce(array_agg(distinct (c ->> 'streamId')), '{}')
  into child_class_ids, child_stream_ids
  from (select st.payload as c from public.school_records st
        where st.school_id = school_key and st.collection = 'students' and (st.payload -> 'parentIds') ? my_parent_id) q;

  return jsonb_build_object(
    'school', jsonb_build_object('name', coalesce(school_payload ->> 'name', ''), 'currency', coalesce(school_payload ->> 'currency', 'KES')),
    'parent', jsonb_build_object('name', trim(coalesce(parent_payload ->> 'firstName', '') || ' ' || coalesce(parent_payload ->> 'lastName', ''))),
    'children', children,
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.record_id, 'title', a.payload ->> 'title', 'body', a.payload ->> 'body', 'date', left(coalesce(a.payload ->> 'createdAt', ''), 10))
                       order by a.payload ->> 'createdAt' desc)
      from (
        select * from public.school_records an
        where an.school_id = school_key and an.collection = 'announcements'
          and (an.payload ->> 'audience' in ('school', 'parents')
               or (an.payload ->> 'audience' = 'class' and (an.payload -> 'audienceIds' ->> 0) = any(child_class_ids))
               or (an.payload ->> 'audience' = 'stream' and (an.payload -> 'audienceIds' ->> 0) = any(child_stream_ids)))
        order by an.payload ->> 'createdAt' desc
        limit 20
      ) a
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.require_parent_manager() from public, anon, authenticated;
revoke all on function public.invite_parent(text, text) from public, anon;
revoke all on function public.list_parent_access() from public, anon;
revoke all on function public.revoke_parent_access(text) from public, anon;
revoke all on function public.parent_portal() from public, anon;
grant execute on function public.invite_parent(text, text) to authenticated;
grant execute on function public.list_parent_access() to authenticated;
grant execute on function public.revoke_parent_access(text) to authenticated;
grant execute on function public.parent_portal() to authenticated;
