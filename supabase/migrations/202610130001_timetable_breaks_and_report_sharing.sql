-- Timetable breaks + editable periods, and shareable (parent-facing) report cards.
-- Apply after 202610060001_initial_backend.sql.

-- ---------------------------------------------------------------------------
-- Timetable: lessons and breaks, create + update with the same clash checks.
-- A break is an entry with kind = 'break' and a label (e.g. "Tea break").
-- Breaks have no subject/teacher/room; they only clash with the class's own periods.
-- ---------------------------------------------------------------------------
create or replace function public.create_timetable_entry(entry_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  entry_id text := gen_random_uuid()::text;
  conflict_row record;
  is_break boolean := coalesce(entry_payload ->> 'kind', 'lesson') = 'break';
  normalized_room text := lower(nullif(trim(entry_payload ->> 'room'), ''));
  final_payload jsonb;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved' order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  if coalesce(entry_payload ->> 'day', '') not in ('MO', 'TU', 'WE', 'TH', 'FR', 'SA')
     or coalesce(entry_payload ->> 'startTime', '') >= coalesce(entry_payload ->> 'endTime', '') then
    raise exception 'Choose a valid day and a period end time after its start time.';
  end if;
  if coalesce(entry_payload ->> 'kind', 'lesson') not in ('lesson', 'break') then raise exception 'Unknown period type.'; end if;
  if not exists(select 1 from public.school_records where school_id = school_key and collection = 'classes' and record_id = entry_payload ->> 'classId') then raise exception 'The selected class does not exist.'; end if;
  if is_break then
    if nullif(trim(entry_payload ->> 'label'), '') is null then raise exception 'Give the break a name.'; end if;
    normalized_room := null;
  else
    if not exists(select 1 from public.school_records where school_id = school_key and collection = 'subjects' and record_id = entry_payload ->> 'subjectId') then raise exception 'The selected subject does not exist.'; end if;
    if nullif(entry_payload ->> 'teacherId', '') is not null and not exists(select 1 from public.school_records where school_id = school_key and collection = 'teachers' and record_id = entry_payload ->> 'teacherId' and payload ->> 'isActive' = 'true') then raise exception 'The selected teacher is not active.'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(school_key::text || ':timetable:' || (entry_payload ->> 'day'), 0));
  select t.payload ->> 'startTime' as start_time, t.payload ->> 'endTime' as end_time,
    t.payload ->> 'classId' as class_id, t.payload ->> 'teacherId' as teacher_id, t.payload ->> 'room' as room
  into conflict_row
  from public.school_records t
  where t.school_id = school_key and t.collection = 'timetableEntries'
    and t.payload ->> 'day' = entry_payload ->> 'day'
    and (entry_payload ->> 'startTime') < (t.payload ->> 'endTime')
    and (t.payload ->> 'startTime') < (entry_payload ->> 'endTime')
    and (
      t.payload ->> 'classId' = entry_payload ->> 'classId'
      or (not is_break and coalesce(t.payload ->> 'kind', 'lesson') = 'lesson' and nullif(entry_payload ->> 'teacherId', '') is not null and t.payload ->> 'teacherId' = entry_payload ->> 'teacherId')
      or (not is_break and coalesce(t.payload ->> 'kind', 'lesson') = 'lesson' and normalized_room is not null and lower(trim(coalesce(t.payload ->> 'room', ''))) = normalized_room)
    )
  limit 1;
  if found then
    if conflict_row.class_id = entry_payload ->> 'classId' then raise exception 'Class already has a period at this time (%-%).', conflict_row.start_time, conflict_row.end_time; end if;
    if nullif(entry_payload ->> 'teacherId', '') is not null and conflict_row.teacher_id = entry_payload ->> 'teacherId' then raise exception 'Teacher is already teaching another class at this time (%-%).', conflict_row.start_time, conflict_row.end_time; end if;
    if normalized_room is not null and lower(trim(coalesce(conflict_row.room, ''))) = normalized_room then raise exception 'Room is already booked at this time (%-%).', conflict_row.start_time, conflict_row.end_time; end if;
  end if;

  final_payload := entry_payload || jsonb_build_object('id', entry_id, 'createdAt', now(), 'updatedAt', now());
  insert into public.school_records (school_id, collection, record_id, payload)
  values (school_key, 'timetableEntries', entry_id, final_payload);
  return final_payload;
end;
$$;

create or replace function public.update_timetable_entry(target_entry_id text, entry_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  existing jsonb;
  conflict_row record;
  is_break boolean := coalesce(entry_payload ->> 'kind', 'lesson') = 'break';
  normalized_room text := lower(nullif(trim(entry_payload ->> 'room'), ''));
  final_payload jsonb;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved' order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  select payload into existing from public.school_records
  where school_id = school_key and collection = 'timetableEntries' and record_id = target_entry_id;
  if existing is null then raise exception 'That period no longer exists.'; end if;
  if coalesce(entry_payload ->> 'day', '') not in ('MO', 'TU', 'WE', 'TH', 'FR', 'SA')
     or coalesce(entry_payload ->> 'startTime', '') >= coalesce(entry_payload ->> 'endTime', '') then
    raise exception 'Choose a valid day and a period end time after its start time.';
  end if;
  if coalesce(entry_payload ->> 'kind', 'lesson') not in ('lesson', 'break') then raise exception 'Unknown period type.'; end if;
  if not exists(select 1 from public.school_records where school_id = school_key and collection = 'classes' and record_id = entry_payload ->> 'classId') then raise exception 'The selected class does not exist.'; end if;
  if is_break then
    if nullif(trim(entry_payload ->> 'label'), '') is null then raise exception 'Give the break a name.'; end if;
    normalized_room := null;
  else
    if not exists(select 1 from public.school_records where school_id = school_key and collection = 'subjects' and record_id = entry_payload ->> 'subjectId') then raise exception 'The selected subject does not exist.'; end if;
    if nullif(entry_payload ->> 'teacherId', '') is not null and not exists(select 1 from public.school_records where school_id = school_key and collection = 'teachers' and record_id = entry_payload ->> 'teacherId' and payload ->> 'isActive' = 'true') then raise exception 'The selected teacher is not active.'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(school_key::text || ':timetable:' || (entry_payload ->> 'day'), 0));
  select t.payload ->> 'startTime' as start_time, t.payload ->> 'endTime' as end_time,
    t.payload ->> 'classId' as class_id, t.payload ->> 'teacherId' as teacher_id, t.payload ->> 'room' as room
  into conflict_row
  from public.school_records t
  where t.school_id = school_key and t.collection = 'timetableEntries'
    and t.record_id <> target_entry_id
    and t.payload ->> 'day' = entry_payload ->> 'day'
    and (entry_payload ->> 'startTime') < (t.payload ->> 'endTime')
    and (t.payload ->> 'startTime') < (entry_payload ->> 'endTime')
    and (
      t.payload ->> 'classId' = entry_payload ->> 'classId'
      or (not is_break and coalesce(t.payload ->> 'kind', 'lesson') = 'lesson' and nullif(entry_payload ->> 'teacherId', '') is not null and t.payload ->> 'teacherId' = entry_payload ->> 'teacherId')
      or (not is_break and coalesce(t.payload ->> 'kind', 'lesson') = 'lesson' and normalized_room is not null and lower(trim(coalesce(t.payload ->> 'room', ''))) = normalized_room)
    )
  limit 1;
  if found then
    if conflict_row.class_id = entry_payload ->> 'classId' then raise exception 'Class already has a period at this time (%-%).', conflict_row.start_time, conflict_row.end_time; end if;
    if nullif(entry_payload ->> 'teacherId', '') is not null and conflict_row.teacher_id = entry_payload ->> 'teacherId' then raise exception 'Teacher is already teaching another class at this time (%-%).', conflict_row.start_time, conflict_row.end_time; end if;
    if normalized_room is not null and lower(trim(coalesce(conflict_row.room, ''))) = normalized_room then raise exception 'Room is already booked at this time (%-%).', conflict_row.start_time, conflict_row.end_time; end if;
  end if;

  -- Replace (not merge) so clearing a teacher/room on a period really clears it.
  final_payload := entry_payload || jsonb_build_object('id', target_entry_id, 'createdAt', existing -> 'createdAt', 'updatedAt', now());
  update public.school_records set payload = final_payload, updated_at = now()
  where school_id = school_key and collection = 'timetableEntries' and record_id = target_entry_id;
  return final_payload;
end;
$$;

revoke all on function public.update_timetable_entry(text, jsonb) from public, anon;
grant execute on function public.update_timetable_entry(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Shareable report cards. The school publishes a snapshot of one report card and
-- gets back an unguessable token. Anyone holding the link (a parent) can read that
-- one snapshot through get_shared_report_card; nothing else becomes readable.
-- ---------------------------------------------------------------------------
create index if not exists published_report_cards_token_idx
  on public.school_records ((payload ->> 'token'))
  where collection = 'publishedReportCards';

create or replace function public.publish_report_card(card_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  card_key text;
  existing jsonb;
  share_token text;
  final_payload jsonb;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved' order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  if coalesce(card_payload ->> 'examinationId', '') = '' or coalesce(card_payload ->> 'studentId', '') = '' then
    raise exception 'Choose an examination and a student.';
  end if;
  if jsonb_typeof(card_payload -> 'snapshot') is distinct from 'object' then raise exception 'The report card is missing.'; end if;
  if not exists(select 1 from public.school_records where school_id = school_key and collection = 'students' and record_id = card_payload ->> 'studentId') then raise exception 'The selected student does not exist.'; end if;

  card_key := 'rc-' || (card_payload ->> 'examinationId') || '-' || (card_payload ->> 'studentId');
  select payload into existing from public.school_records
  where school_id = school_key and collection = 'publishedReportCards' and record_id = card_key;

  if existing is not null and coalesce((existing ->> 'revoked')::boolean, false) = false then
    share_token := existing ->> 'token';
  else
    share_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;

  final_payload := jsonb_build_object(
    'id', card_key,
    'examinationId', card_payload ->> 'examinationId',
    'studentId', card_payload ->> 'studentId',
    'token', share_token,
    'snapshot', card_payload -> 'snapshot',
    'revoked', false,
    'publishedAt', now(),
    'createdAt', coalesce(existing -> 'createdAt', to_jsonb(now())),
    'updatedAt', now()
  );
  insert into public.school_records (school_id, collection, record_id, payload)
  values (school_key, 'publishedReportCards', card_key, final_payload)
  on conflict (school_id, collection, record_id)
  do update set payload = excluded.payload, updated_at = now();
  return jsonb_build_object('token', share_token);
end;
$$;

create or replace function public.revoke_published_report_card(target_examination_id text, target_student_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved' order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  update public.school_records
  set payload = payload || jsonb_build_object('revoked', true, 'updatedAt', now()), updated_at = now()
  where school_id = school_key and collection = 'publishedReportCards'
    and record_id = 'rc-' || target_examination_id || '-' || target_student_id;
end;
$$;

create or replace function public.get_shared_report_card(share_token text)
returns jsonb
language sql security definer stable
set search_path = ''
as $$
  select r.payload -> 'snapshot'
  from public.school_records r
  where length(coalesce(share_token, '')) >= 32
    and r.collection = 'publishedReportCards'
    and r.payload ->> 'token' = share_token
    and coalesce((r.payload ->> 'revoked')::boolean, false) = false
  limit 1;
$$;

revoke all on function public.publish_report_card(jsonb) from public, anon;
revoke all on function public.revoke_published_report_card(text, text) from public, anon;
revoke all on function public.get_shared_report_card(text) from public;
grant execute on function public.publish_report_card(jsonb) to authenticated;
grant execute on function public.revoke_published_report_card(text, text) to authenticated;
grant execute on function public.get_shared_report_card(text) to anon, authenticated;
