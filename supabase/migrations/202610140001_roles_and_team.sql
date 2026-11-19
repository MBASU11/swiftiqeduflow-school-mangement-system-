-- Roles: Administrator, Accounts/Finance, Admissions & Students (registrar), Teacher/Trainer.
-- Who may read and change which records is enforced HERE, in the database, so it holds
-- no matter what the browser does. The same rules live in js/config/roles.js (used for
-- menus and buttons); a test compares the two.
-- Apply after 202610130001_timetable_breaks_and_report_sharing.sql.

-- ---------------------------------------------------------------------------
-- Members: more roles, plus a name and email so the team can be listed.
-- ---------------------------------------------------------------------------
alter table public.school_memberships drop constraint if exists school_memberships_role_check;
alter table public.school_memberships add constraint school_memberships_role_check
  check (role in ('school_admin', 'accountant', 'registrar', 'teacher', 'staff', 'parent'));
alter table public.school_memberships add column if not exists full_name text;
alter table public.school_memberships add column if not exists email text;

update public.school_memberships m
set full_name = coalesce(m.full_name, s.contact_name), email = coalesce(m.email, s.email)
from public.schools s
where s.id = m.school_id and s.owner_user_id = m.user_id;

create or replace function public.member_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select m.role
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
$$;

-- 'write' | 'read' | 'none' for one role and one kind of record.
create or replace function public.role_collection_access(member_role text, collection_name text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when member_role = 'school_admin' then 'write'
    when member_role = 'accountant' then case
      when collection_name = any(array['feeStructures', 'invoices', 'payments', 'expenses']) then 'write'
      when collection_name = any(array['students', 'parents', 'classes', 'streams', 'subjects', 'curricula', 'terms', 'academicYears', 'school', 'settings']) then 'read'
      else 'none' end
    when member_role = 'registrar' then case
      when collection_name = any(array['students', 'parents', 'admissions', 'documents']) then 'write'
      when collection_name = any(array['classes', 'streams', 'subjects', 'curricula', 'terms', 'academicYears', 'school', 'settings']) then 'read'
      else 'none' end
    when member_role = 'teacher' then case
      when collection_name = any(array['attendance', 'examScores', 'reportCards', 'publishedReportCards', 'assessments', 'assessmentScores', 'messages', 'announcements', 'documents']) then 'write'
      when collection_name = any(array['classes', 'streams', 'subjects', 'curricula', 'terms', 'academicYears', 'school', 'settings', 'students', 'parents', 'teachers', 'timetableEntries', 'examinations', 'gradingSystems', 'gradeBands']) then 'read'
      else 'none' end
    when member_role = 'staff' then case
      when collection_name = any(array[]::text[]) then 'write'
      when collection_name = any(array['school', 'settings']) then 'read'
      else 'none' end
    else 'none'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Reading: people only see the kinds of records their role allows.
-- ---------------------------------------------------------------------------
drop policy if exists school_records_select_approved on public.school_records;
create policy school_records_select_approved on public.school_records
for select to authenticated
using (
  public.has_approved_school_access(school_id)
  and public.role_collection_access((select public.member_role()), collection) <> 'none'
);

drop policy if exists school_audit_read_own on public.school_audit_logs;
create policy school_audit_read_own on public.school_audit_logs
for select to authenticated
using (public.has_approved_school_access(school_id) and (select public.member_role()) = 'school_admin');

-- ---------------------------------------------------------------------------
-- Writing: checked for direct changes AND for every function that saves records
-- (triggers still run inside security-definer functions).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_role_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  role_name text;
  coll text := case when tg_op = 'DELETE' then old.collection else new.collection end;
begin
  if caller is not null and not public.is_platform_admin() then
    role_name := public.member_role();
    -- No membership: the tenant trigger rejects the write with a clearer message.
    if role_name is not null and public.role_collection_access(role_name, coll) <> 'write' then
      raise exception 'Your role (%) cannot change % records. Ask a school administrator if you need access.', role_name, coll
        using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists a_school_records_enforce_role on public.school_records;
create trigger a_school_records_enforce_role
before insert or update or delete on public.school_records
for each row execute function public.enforce_role_write();

revoke all on function public.enforce_role_write() from public, anon, authenticated;
revoke all on function public.member_role() from public, anon;
grant execute on function public.member_role() to authenticated;
grant execute on function public.role_collection_access(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Team: invite colleagues, change roles, remove people. Administrators only.
-- A colleague signs up with the invited email, enters the invitation code once,
-- and is added to the school with the role chosen for them.
-- ---------------------------------------------------------------------------
create table if not exists public.school_invites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null check (role in ('school_admin', 'accountant', 'registrar', 'teacher')),
  code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create index if not exists school_invites_school_idx on public.school_invites (school_id, created_at desc);
alter table public.school_invites enable row level security;
revoke all on public.school_invites from anon, authenticated;

create or replace function public.require_school_admin()
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
  where m.user_id = (select auth.uid()) and m.role = 'school_admin' and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then raise exception 'Only a school administrator can manage the team.'; end if;
  return school_key;
end;
$$;

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
      where m.school_id = school_key
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'name', coalesce(i.full_name, ''), 'role', i.role,
        'code', i.code, 'expiresAt', i.expires_at, 'expired', i.expires_at <= now()
      ) order by i.created_at desc)
      from public.school_invites i
      where i.school_id = school_key and i.accepted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_school_invite(invite_email text, invite_name text, invite_role text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid := public.require_school_admin();
  clean_email text := lower(trim(coalesce(invite_email, '')));
  new_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  existing_id uuid;
begin
  if clean_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address.'; end if;
  if invite_role not in ('school_admin', 'accountant', 'registrar', 'teacher') then raise exception 'Choose a valid role.'; end if;
  if exists (select 1 from public.school_memberships where school_id = school_key and lower(email) = clean_email) then
    raise exception 'That person is already on your team.';
  end if;
  select id into existing_id from public.school_invites
  where school_id = school_key and lower(email) = clean_email and accepted_at is null;
  if existing_id is not null then
    update public.school_invites
    set role = invite_role, full_name = nullif(trim(invite_name), ''), code = new_code, expires_at = now() + interval '14 days', created_by = (select auth.uid())
    where id = existing_id;
  else
    insert into public.school_invites (school_id, email, full_name, role, code, created_by)
    values (school_key, clean_email, nullif(trim(invite_name), ''), invite_role, new_code, (select auth.uid()));
  end if;
  insert into public.school_history (school_id, actor_user_id, action, note)
  values (school_key, (select auth.uid()), 'Team invitation sent', clean_email || ' as ' || invite_role);
  return jsonb_build_object('code', new_code, 'email', clean_email, 'role', invite_role);
end;
$$;

create or replace function public.revoke_school_invite(target_invite_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid := public.require_school_admin();
begin
  delete from public.school_invites where id = target_invite_id and school_id = school_key and accepted_at is null;
end;
$$;

-- The invited person calls this after signing up with the invited email.
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
  insert into public.school_memberships (school_id, user_id, role, full_name, email)
  values (invite.school_id, caller, invite.role, coalesce(invite.full_name, ''), caller_email);
  update public.school_invites set accepted_at = now(), accepted_by = caller where id = invite.id;
  insert into public.school_history (school_id, actor_user_id, action, note)
  values (invite.school_id, caller, 'Team member joined', caller_email || ' as ' || invite.role);
  return jsonb_build_object('role', invite.role);
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

create or replace function public.remove_school_member(target_user_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid := public.require_school_admin();
  owner_id uuid;
begin
  select s.owner_user_id into owner_id from public.schools s where s.id = school_key;
  if target_user_id = owner_id then raise exception 'The school owner cannot be removed.'; end if;
  if target_user_id = (select auth.uid()) then raise exception 'You cannot remove yourself.'; end if;
  delete from public.school_memberships where school_id = school_key and user_id = target_user_id;
  if not found then raise exception 'That person is not on your team.'; end if;
  insert into public.school_history (school_id, actor_user_id, action, note)
  values (school_key, (select auth.uid()), 'Team member removed', target_user_id::text);
end;
$$;

revoke all on function public.require_school_admin() from public, anon, authenticated;
revoke all on function public.list_school_team() from public, anon;
revoke all on function public.create_school_invite(text, text, text) from public, anon;
revoke all on function public.revoke_school_invite(uuid) from public, anon;
revoke all on function public.accept_school_invite(text) from public, anon;
revoke all on function public.set_member_role(uuid, text) from public, anon;
revoke all on function public.remove_school_member(uuid) from public, anon;
grant execute on function public.list_school_team() to authenticated;
grant execute on function public.create_school_invite(text, text, text) to authenticated;
grant execute on function public.revoke_school_invite(uuid) to authenticated;
grant execute on function public.accept_school_invite(text) to authenticated;
grant execute on function public.set_member_role(uuid, text) to authenticated;
grant execute on function public.remove_school_member(uuid) to authenticated;
