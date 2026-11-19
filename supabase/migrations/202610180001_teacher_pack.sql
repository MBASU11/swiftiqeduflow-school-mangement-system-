-- Teacher Pack: access to the new records, welfare notes restricted to the administrator and
-- teachers they name, and parent-portal homework / learning materials / live lessons.
-- Apply after 202610170001_bursar_pack.sql. Written without a Postgres instance to test against:
-- run it in a development project first.

-- ------------------------------------------------------------ who may touch the new records
create or replace function public.role_collection_access(member_role text, collection_name text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when member_role = 'school_admin' then 'write'
    when member_role = 'accountant' then case
      when collection_name = any(array['feeStructures', 'invoices', 'payments', 'expenses', 'receipts', 'refunds', 'optionalCharges', 'studentCharges', 'adjustments', 'feeReminders', 'bursarSettings']) then 'write'
      when collection_name = any(array['students', 'parents', 'routes', 'transportAssignments', 'classes', 'streams', 'subjects', 'curricula', 'terms', 'academicYears', 'school', 'settings']) then 'read'
      else 'none' end
    when member_role = 'registrar' then case
      when collection_name = any(array['students', 'parents', 'admissions', 'documents']) then 'write'
      when collection_name = any(array['classes', 'streams', 'subjects', 'curricula', 'terms', 'academicYears', 'school', 'settings']) then 'read'
      else 'none' end
    when member_role = 'teacher' then case
      when collection_name = any(array['attendance', 'examScores', 'reportCards', 'publishedReportCards', 'assessments', 'assessmentScores', 'messages', 'announcements', 'documents', 'lessonPlans', 'schemesOfWork', 'homework', 'homeworkSubmissions', 'learningMaterials', 'liveLessons', 'attendanceNotices']) then 'write'
      when collection_name = any(array['classes', 'streams', 'subjects', 'curricula', 'terms', 'academicYears', 'school', 'settings', 'students', 'parents', 'teachers', 'timetableEntries', 'examinations', 'gradingSystems', 'gradeBands', 'teachingAssignments', 'welfareGrants']) then 'read'
      else 'none' end
    when member_role = 'staff' then case
      when collection_name = any(array[]::text[]) then 'write'
      when collection_name = any(array['school', 'settings']) then 'read'
      else 'none' end
    else 'none'
  end;
$$;

-- ------------------------------------------------------------ welfare: administrator + named people only
create or replace function public.can_use_welfare(target_school uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select public.member_role()) = 'school_admin'
    or exists (select 1 from public.school_records g
      where g.school_id = target_school and g.collection = 'welfareGrants' and g.payload ->> 'accountId' = (select auth.uid())::text);
$$;

drop policy if exists school_records_select_approved on public.school_records;
create policy school_records_select_approved on public.school_records
for select to authenticated
using (
  public.has_approved_school_access(school_id)
  and case when collection = 'welfareNotes' then public.can_use_welfare(school_id)
           else public.role_collection_access((select public.member_role()), collection) <> 'none' end
);

create or replace function public.enforce_role_write()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  role_name text;
  coll text := case when tg_op = 'DELETE' then old.collection else new.collection end;
  sid uuid := case when tg_op = 'DELETE' then old.school_id else new.school_id end;
begin
  if caller is not null and not public.is_platform_admin() then
    role_name := public.member_role();
    if role_name is not null then
      if coll = 'welfareNotes' then
        if not public.can_use_welfare(sid) then
          raise exception 'Welfare records are restricted to the administrator and staff they have named.' using errcode = '42501';
        end if;
      elsif public.role_collection_access(role_name, coll) <> 'write' then
        raise exception 'Your role (%) cannot change % records. Ask a school administrator if you need access.', role_name, coll using errcode = '42501';
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ------------------------------------------------------------ parent portal: homework, materials, live lessons
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
          'invoices', coalesce(jsonb_agg(jsonb_build_object('id', inv.id, 'title', inv.title, 'total', inv.total, 'paid', inv.paid, 'dueDate', inv.due) order by inv.created desc), '[]'::jsonb),
          'receipts', coalesce((select jsonb_agg(jsonb_build_object('number', r.payload ->> 'number', 'amount', r.payload -> 'amount', 'date', r.payload ->> 'date') order by r.payload ->> 'date' desc) from public.school_records r where r.school_id = school_key and r.collection = 'receipts' and r.payload ->> 'studentId' = st.record_id), '[]'::jsonb)
        )
        from (
          select i.record_id as id,
                 coalesce(i.payload ->> 'number', i.payload ->> 'name', i.payload ->> 'title', i.payload -> 'items' -> 0 ->> 'name', 'Invoice') as title,
                 coalesce((i.payload ->> 'totalAmount')::numeric, 0) as total,
                 coalesce((select sum((pay.payload ->> 'amount')::numeric) from public.school_records pay
                           where pay.school_id = school_key and pay.collection = 'payments' and pay.payload ->> 'invoiceId' = i.record_id
                             and coalesce(pay.payload ->> 'status', 'confirmed') = 'confirmed'), 0) as paid,
                 i.payload ->> 'dueDate' as due,
                 i.payload ->> 'createdAt' as created
          from public.school_records i
          where i.school_id = school_key and i.collection = 'invoices' and i.payload ->> 'studentId' = st.record_id
            and coalesce(i.payload ->> 'status', '') <> 'void'
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
      'homework', coalesce((
        select jsonb_agg(jsonb_build_object('id', h.record_id, 'title', h.payload ->> 'title', 'instructions', h.payload ->> 'instructions', 'dueDate', h.payload ->> 'dueDate',
          'subject', (select s.payload ->> 'name' from public.school_records s where s.school_id = school_key and s.collection = 'subjects' and s.record_id = h.payload ->> 'subjectId'),
          'state', coalesce((select x.payload ->> 'status' from public.school_records x where x.school_id = school_key and x.collection = 'homeworkSubmissions' and x.payload ->> 'homeworkId' = h.record_id and x.payload ->> 'studentId' = st.record_id), 'pending'),
          'marks', (select x.payload -> 'marks' from public.school_records x where x.school_id = school_key and x.collection = 'homeworkSubmissions' and x.payload ->> 'homeworkId' = h.record_id and x.payload ->> 'studentId' = st.record_id and coalesce((x.payload ->> 'feedbackPublished')::boolean, false)),
          'feedback', (select x.payload ->> 'feedback' from public.school_records x where x.school_id = school_key and x.collection = 'homeworkSubmissions' and x.payload ->> 'homeworkId' = h.record_id and x.payload ->> 'studentId' = st.record_id and coalesce((x.payload ->> 'feedbackPublished')::boolean, false))
        ) order by h.payload ->> 'dueDate' desc)
        from public.school_records h
        where h.school_id = school_key and h.collection = 'homework' and h.payload ->> 'classId' = st.payload ->> 'classId' and coalesce(h.payload ->> 'status', 'published') = 'published'
      ), '[]'::jsonb),
      'materials', coalesce((
        select jsonb_agg(jsonb_build_object('id', m.record_id, 'title', m.payload ->> 'title', 'type', m.payload ->> 'type', 'url', m.payload ->> 'url', 'body', m.payload ->> 'body') order by m.payload ->> 'createdAt' desc)
        from public.school_records m
        where m.school_id = school_key and m.collection = 'learningMaterials' and m.payload ->> 'classId' = st.payload ->> 'classId' and coalesce((m.payload ->> 'published')::boolean, true)
      ), '[]'::jsonb),
      'liveLessons', coalesce((
        select jsonb_agg(jsonb_build_object('title', l.payload ->> 'title', 'date', l.payload ->> 'date', 'startTime', l.payload ->> 'startTime', 'endTime', l.payload ->> 'endTime', 'meetingLink', l.payload ->> 'meetingLink') order by l.payload ->> 'date', l.payload ->> 'startTime')
        from public.school_records l
        where l.school_id = school_key and l.collection = 'liveLessons' and l.payload ->> 'classId' = st.payload ->> 'classId' and l.payload ->> 'status' = 'scheduled' and l.payload ->> 'date' >= to_char(current_date, 'YYYY-MM-DD')
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
