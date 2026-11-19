create or replace function public.convert_admission_to_student_v2(
  target_admission_id text,
  student_payload jsonb,
  guardians_payload jsonb,
  capacity_override_reason text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  role_name text;
  admission_row public.school_records%rowtype;
  class_row public.school_records%rowtype;
  existing_parent public.school_records%rowtype;
  parent_payload jsonb;
  guardian jsonb;
  guardian_name text;
  parent_id text;
  parent_ids jsonb := '[]'::jsonb;
  new_student_id text;
  final_student jsonb;
  admission_payload jsonb;
  capacity_limit integer;
  active_students integer;
  reserved_places integer;
  override_note text := nullif(trim(capacity_override_reason), '');
begin
  select m.school_id, m.role into school_key, role_name
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required.';
  end if;
  if role_name not in ('school_admin', 'registrar') then
    raise exception 'Your role cannot enroll admission applicants.';
  end if;
  if coalesce(jsonb_typeof(guardians_payload), '') <> 'array' then
    raise exception 'Guardian details must be an array.';
  end if;
  if jsonb_array_length(guardians_payload) > 10 then
    raise exception 'Guardian details must be an array containing no more than 10 guardians.';
  end if;
  if nullif(trim(student_payload ->> 'admissionNumber'), '') is null
    or nullif(trim(student_payload ->> 'classId'), '') is null
    or nullif(trim(student_payload ->> 'firstName'), '') is null
    or nullif(trim(student_payload ->> 'lastName'), '') is null
    or nullif(trim(student_payload ->> 'admissionDate'), '') is null then
    raise exception 'Student name, admission number, class, and enrollment date are required.';
  end if;

  select * into admission_row
  from public.school_records
  where school_id = school_key and collection = 'admissions' and record_id = target_admission_id
  for update;
  if not found then
    raise exception 'This application no longer exists.';
  end if;
  if nullif(admission_row.payload ->> 'admittedStudentId', '') is not null then
    select payload into final_student
    from public.school_records
    where school_id = school_key and collection = 'students'
      and record_id = admission_row.payload ->> 'admittedStudentId';
    if found then return final_student; end if;
  end if;
  if not coalesce(
    admission_row.payload ->> 'status' in ('offer_accepted', 'enrollment_pending')
    or (admission_row.payload ->> 'status' is null and admission_row.payload ->> 'stage' = 'approved'),
    false
  ) then
    raise exception 'Record offer acceptance before enrolling this applicant.';
  end if;

  select * into class_row
  from public.school_records
  where school_id = school_key
    and collection = 'classes'
    and record_id = student_payload ->> 'classId'
  for update;
  if not found then
    raise exception 'The selected class does not exist.';
  end if;
  capacity_limit := nullif(coalesce(class_row.payload ->> 'admissionCapacity', class_row.payload ->> 'capacity'), '')::integer;
  if capacity_limit > 0 then
    select count(*) into active_students
    from public.school_records s
    where s.school_id = school_key and s.collection = 'students'
      and s.payload ->> 'classId' = student_payload ->> 'classId'
      and coalesce(s.payload ->> 'status', 'active') not in ('archived', 'graduated', 'withdrawn', 'transferred');
    select count(distinct a.record_id) into reserved_places
    from public.school_records a
    where a.school_id = school_key and a.collection = 'admissions'
      and a.record_id <> target_admission_id
      and coalesce(a.payload ->> 'classInterested', a.payload ->> 'classId') = student_payload ->> 'classId'
      and a.payload ->> 'status' in ('offer_sent', 'offer_accepted', 'enrollment_pending')
      and a.payload ->> 'admittedStudentId' is null;
    if active_students + reserved_places + 1 > capacity_limit then
      if override_note is null then
        raise exception 'The selected class has no available places. An authorized capacity override reason is required.';
      end if;
      if role_name not in ('school_admin', 'registrar') then
        raise exception 'Your role cannot authorize a class capacity override.';
      end if;
    end if;
  end if;
  if exists (
    select 1 from public.school_records s
    where s.school_id = school_key and s.collection = 'students'
      and lower(trim(s.payload ->> 'admissionNumber')) = lower(trim(student_payload ->> 'admissionNumber'))
  ) then
    raise exception 'This admission number is already used by another student.';
  end if;
  if nullif(student_payload ->> 'dateOfBirth', '') is not null and exists (
    select 1 from public.school_records s
    where s.school_id = school_key and s.collection = 'students'
      and lower(trim(concat_ws(' ', s.payload ->> 'firstName', s.payload ->> 'middleName', s.payload ->> 'lastName')))
        = lower(trim(concat_ws(' ', student_payload ->> 'firstName', student_payload ->> 'middleName', student_payload ->> 'lastName')))
      and s.payload ->> 'dateOfBirth' = student_payload ->> 'dateOfBirth'
  ) then
    raise exception 'A student with the same name and date of birth already exists. Review the existing student before enrolling.';
  end if;

  new_student_id := coalesce(nullif(student_payload ->> 'id', ''), gen_random_uuid()::text);
  for guardian in select value from jsonb_array_elements(guardians_payload) loop
    guardian_name := nullif(trim(guardian ->> 'fullName'), '');
    if guardian_name is null then
      continue;
    end if;
    select * into existing_parent
    from public.school_records p
    where p.school_id = school_key and p.collection = 'parents'
      and nullif(trim(guardian ->> 'email'), '') is not null
      and lower(trim(p.payload ->> 'email')) = lower(trim(guardian ->> 'email'))
    limit 1
    for update;
    if found then
      parent_id := existing_parent.record_id;
      parent_payload := existing_parent.payload;
      if coalesce(jsonb_typeof(parent_payload -> 'studentIds'), '') <> 'array' then
        parent_payload := jsonb_set(parent_payload, '{studentIds}', '[]'::jsonb, true);
      end if;
      if not (parent_payload -> 'studentIds' @> jsonb_build_array(new_student_id)) then
        parent_payload := jsonb_set(parent_payload, '{studentIds}', (parent_payload -> 'studentIds') || jsonb_build_array(new_student_id), true);
        update public.school_records
        set payload = parent_payload, updated_at = now()
        where school_id = school_key and collection = 'parents' and record_id = parent_id;
      end if;
    else
      parent_id := gen_random_uuid()::text;
      parent_payload := jsonb_build_object(
        'id', parent_id,
        'firstName', split_part(guardian_name, ' ', 1),
        'lastName', nullif(regexp_replace(guardian_name, '^\S+\s*', ''), ''),
        'phone', nullif(trim(guardian ->> 'phone'), ''),
        'email', nullif(trim(guardian ->> 'email'), ''),
        'relationship', nullif(trim(guardian ->> 'relationship'), ''),
        'primary', coalesce((guardian ->> 'primary')::boolean, false),
        'studentIds', jsonb_build_array(new_student_id),
        'sourceAdmissionId', target_admission_id
      );
      insert into public.school_records (school_id, collection, record_id, payload)
      values (school_key, 'parents', parent_id, parent_payload);
    end if;
    if not (parent_ids @> jsonb_build_array(parent_id)) then
      parent_ids := parent_ids || jsonb_build_array(parent_id);
    end if;
  end loop;

  final_student := jsonb_set(
    jsonb_set(student_payload, '{id}', to_jsonb(new_student_id), true),
    '{parentIds}', parent_ids, true
  );
  final_student := jsonb_set(final_student, '{createdAt}', coalesce(student_payload -> 'createdAt', to_jsonb(now())), true);
  final_student := jsonb_set(final_student, '{updatedAt}', coalesce(student_payload -> 'updatedAt', to_jsonb(now())), true);
  insert into public.school_records (school_id, collection, record_id, payload)
  values (school_key, 'students', new_student_id, final_student);

  admission_payload := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(admission_row.payload, '{status}', '"admitted"'::jsonb, true),
        '{stage}', '"admitted"'::jsonb, true
      ),
      '{admittedStudentId}', to_jsonb(new_student_id), true
    ),
    '{activity}',
    case when jsonb_typeof(admission_row.payload -> 'activity') = 'array'
      then admission_row.payload -> 'activity'
      else '[]'::jsonb
    end
      || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'action', 'Student enrolled',
        'actor', (select auth.uid())::text,
        'at', now(),
        'details', jsonb_strip_nulls(jsonb_build_object('capacityOverrideReason', override_note))
      )),
    true
  );
  admission_payload := jsonb_set(admission_payload, '{enrollmentDate}', coalesce(student_payload -> 'admissionDate', 'null'::jsonb), true);
  admission_payload := jsonb_set(admission_payload, '{enrolledBy}', to_jsonb((select auth.uid())::text), true);
  admission_payload := jsonb_set(admission_payload, '{updatedAt}', to_jsonb(now()), true);
  update public.school_records
  set payload = admission_payload, updated_at = now()
  where school_id = school_key and collection = 'admissions' and record_id = target_admission_id;

  return final_student;
end;
$$;

revoke all on function public.convert_admission_to_student(text, jsonb) from public, anon, authenticated;
revoke all on function public.convert_admission_to_student_v2(text, jsonb, jsonb, text) from public, anon;
grant execute on function public.convert_admission_to_student_v2(text, jsonb, jsonb, text) to authenticated;
