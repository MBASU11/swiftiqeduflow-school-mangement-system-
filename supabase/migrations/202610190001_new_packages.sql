-- New size-based packages replace the old plan list.
-- The old "plan_modules" column (single / both modules) now holds the BILLING FREQUENCY
-- (monthly / termly / annual). The old values stay allowed so existing schools keep working until
-- the Super Admin assigns them a new package. Apply after 202610180001_teacher_pack.sql.

alter table public.schools drop constraint if exists schools_plan_modules_check;
alter table public.schools add constraint schools_plan_modules_check
  check (plan_modules in ('single', 'both', 'monthly', 'termly', 'annual'));

-- Registration trigger: accept the new billing values (everything else is unchanged).
create or replace function public.create_school_for_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  metadata jsonb := new.raw_user_meta_data;
  new_school_id uuid;
  declared_students integer;
begin
  if coalesce(metadata ->> 'account_type', '') <> 'school' then
    return new;
  end if;

  if nullif(trim(metadata ->> 'school_name'), '') is null
     or nullif(trim(metadata ->> 'contact_name'), '') is null
     or nullif(trim(metadata ->> 'plan_id'), '') is null
     or nullif(trim(metadata ->> 'plan_name'), '') is null
     or coalesce(metadata ->> 'plan_modules', '') not in ('single', 'both', 'monthly', 'termly', 'annual') then
    raise exception 'School registration details are incomplete.';
  end if;

  if nullif(trim(metadata ->> 'student_count'), '') is not null then
    declared_students := (metadata ->> 'student_count')::integer;
    if declared_students < 1 then
      raise exception 'Student count must be a positive whole number.';
    end if;
  end if;

  insert into public.schools (
    owner_user_id, name, contact_name, email, phone, plan_id, plan_name,
    plan_modules, student_count
  ) values (
    new.id,
    trim(metadata ->> 'school_name'),
    trim(metadata ->> 'contact_name'),
    lower(new.email),
    nullif(trim(metadata ->> 'phone'), ''),
    trim(metadata ->> 'plan_id'),
    trim(metadata ->> 'plan_name'),
    metadata ->> 'plan_modules',
    declared_students
  ) returning id into new_school_id;

  insert into public.school_memberships (school_id, user_id, role)
  values (new_school_id, new.id, 'school_admin');
  insert into public.school_history (school_id, actor_user_id, action)
  values (new_school_id, new.id, 'Registered');
  return new;
end;
$$;
