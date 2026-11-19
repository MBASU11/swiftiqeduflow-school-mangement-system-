-- STAGING ONLY. Run with a superuser/owner connection against a STAGING Supabase database after all
-- migrations are applied (psql "$STAGING_DB_URL" -f supabase/tests/privileges_and_isolation.sql).
-- Part A reads catalogue tables only. Part B creates two throw-away schools inside a transaction and
-- ROLLS BACK, so nothing is left behind. NEVER run it against production.
-- STATUS: written but NOT yet executed against a live database. Treat a first failure as either a real
-- hole or a script assumption to fix — read the message.

-- ======================================================= Part A: privileges (read-only)
do $$
declare r record; n integer;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    raise exception 'FAIL A1: row level security is OFF on public.%', r.tablename;
  end loop;

  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in ('get_platform_catalogue', 'get_shared_report_card')
  loop raise exception 'FAIL A2: the anonymous role can execute %', r.sig; end loop;

  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('log_platform_event', 'school_limits', 'count_active_students',
      'assert_enrolment_room', 'capacity_excluded_statuses', 'require_platform_admin', 'my_school_id')
      and has_function_privilege('authenticated', p.oid, 'execute')
  loop raise exception 'FAIL A3: signed-in users can execute internal helper %', r.sig; end loop;

  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop raise exception 'FAIL A4: SECURITY DEFINER function % has no pinned search_path', r.sig; end loop;

  select count(*) into n from public.kenya_counties;
  if n <> 47 then raise exception 'FAIL A5: expected 47 Kenyan counties, found %', n; end if;
  select count(*) into n from public.kenya_grade_levels;
  if n <> 14 then raise exception 'FAIL A6: expected 14 Kenyan grade levels, found %', n; end if;
  if not has_table_privilege('anon', 'public.kenya_counties', 'select')
     or has_table_privilege('anon', 'public.kenya_counties', 'insert')
     or has_table_privilege('authenticated', 'public.kenya_grade_levels', 'update') then
    raise exception 'FAIL A7: Kenyan reference data must be readable but not writable by API roles';
  end if;

  raise notice 'PART A PASSED: RLS on, anon/authenticated privileges as designed, search_path pinned';
end $$;

-- ======================================================= Part B: School A cannot touch School B
begin;
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'iso-a@example.test', '{"account_type":"school","school_name":"Iso A","contact_name":"A","plan_id":"micro","plan_name":"Micro","plan_modules":"annual","student_count":"10"}', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'iso-b@example.test', '{"account_type":"school","school_name":"Iso B","contact_name":"B","plan_id":"micro","plan_name":"Micro","plan_modules":"annual","student_count":"10"}', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000003', 'iso-staff@example.test', '{}', 'authenticated', 'authenticated'),
  ('dddddddd-0000-0000-0000-000000000004', 'iso-teacher@example.test', '{}', 'authenticated', 'authenticated');
update public.schools set status = 'approved' where name in ('Iso A', 'Iso B');
insert into public.school_memberships (school_id, user_id, role, full_name, email)
  select id, 'cccccccc-0000-0000-0000-000000000003', 'staff', 'Fixture Staff', 'iso-staff@example.test'
  from public.schools where name = 'Iso A';
insert into public.school_memberships (school_id, user_id, role, full_name, email)
  select id, 'dddddddd-0000-0000-0000-000000000004', 'teacher', 'Fixture Teacher', 'iso-teacher@example.test'
  from public.schools where name = 'Iso A';

-- A record belonging to B, and a tight capacity for A (paid 2, overflow 0 => max 2).
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
insert into public.school_records (school_id, collection, record_id, payload)
  select id, 'classes', 'b-class-1', '{"id":"b-class-1","name":"B class"}' from public.schools where name = 'Iso B';
insert into storage.objects (bucket_id, name, metadata)
  select 'school-documents', id::text || '/fixture/private.pdf', '{"mimetype":"application/pdf","size":1}'::jsonb
  from public.schools where name in ('Iso A', 'Iso B');
insert into public.school_subscriptions (school_id, data)
  select id, '{"status":"active","packageId":"micro","billing":"annual","limits":{"paidLimit":2,"overflow":0}}'::jsonb from public.schools where name = 'Iso A';

-- ---- act as School A's administrator
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

do $$
declare
  a uuid; b uuid; n integer; denied boolean;
begin
  select id into a from public.schools where name = 'Iso A';
  select id into b from public.schools where name = 'Iso B';

  select count(*) into n from public.school_records where school_id = b;
  if n <> 0 then raise exception 'FAIL B1: School A can READ % of School B''s records', n; end if;

  update public.school_records set payload = payload || '{"hacked":true}' where school_id = b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B2: School A UPDATED % of School B''s records', n; end if;

  delete from public.school_records where school_id = b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL B3: School A DELETED % of School B''s records', n; end if;

  denied := false;
  begin
    insert into public.school_records (school_id, collection, record_id, payload) values (b, 'classes', 'planted', '{"id":"planted","name":"X"}');
  exception when others then denied := true; end;
  if not denied and exists (select 1 from public.school_records where school_id = b and record_id = 'planted') then
    raise exception 'FAIL B4: School A WROTE a record into School B';
  end if;

  denied := false;
  begin perform public.log_platform_event(b, 'forged', 'x', null); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL B5: a signed-in user can forge audit-log entries'; end if;

  denied := false;
  begin perform public.count_active_students(b); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL B6: a signed-in user can read another school''s student count'; end if;

  denied := false;
  begin perform public.list_school_subscriptions(); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL B7: a school user can list every school''s subscription'; end if;

  if (public.get_my_subscription() ->> 'schoolId')::uuid <> a then raise exception 'FAIL B8: get_my_subscription returned another school'; end if;

  -- capacity: paid 2 + overflow 0 => the third active student must be refused with the standard message
  insert into public.school_records (school_id, collection, record_id, payload) values (a, 'students', 'a1', '{"id":"a1","admissionNumber":"A1","status":"active"}');
  insert into public.school_records (school_id, collection, record_id, payload) values (a, 'students', 'a2', '{"id":"a2","admissionNumber":"A2","status":"active"}');
  denied := false;
  begin
    insert into public.school_records (school_id, collection, record_id, payload) values (a, 'students', 'a3', '{"id":"a3","admissionNumber":"A3","status":"active"}');
  exception when sqlstate 'P0402' then denied := true; end;
  if not denied then raise exception 'FAIL B9: a third active student was accepted past the maximum'; end if;
  -- withdrawing frees a place; the same admission number never counts twice
  update public.school_records set payload = payload || '{"status":"withdrawn"}' where school_id = a and record_id = 'a1';
  insert into public.school_records (school_id, collection, record_id, payload) values (a, 'students', 'a3', '{"id":"a3","admissionNumber":"A3","status":"active"}');

  raise notice 'PART B (as School A) PASSED';
end $$;

-- ---- document storage: staff cannot read/write files, teachers can read/write only their school
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $$
declare a uuid; n integer; denied boolean := false;
begin
  select id into a from public.schools where name = 'Iso A';
  select count(*) into n from storage.objects where bucket_id = 'school-documents' and name = a::text || '/fixture/private.pdf';
  if n <> 0 then raise exception 'FAIL B12: staff can read school documents'; end if;
  begin
    insert into storage.objects (bucket_id, name, metadata) values ('school-documents', a::text || '/fixture/staff.pdf', '{"mimetype":"application/pdf","size":1}'::jsonb);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL B13: staff can upload school documents'; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $$
declare a uuid; b uuid; n integer; denied boolean := false;
begin
  select id into a from public.schools where name = 'Iso A';
  select id into b from public.schools where name = 'Iso B';
  select count(*) into n from storage.objects where bucket_id = 'school-documents' and name = a::text || '/fixture/private.pdf';
  if n <> 1 then raise exception 'FAIL B14: teacher cannot read their school document'; end if;
  select count(*) into n from storage.objects where bucket_id = 'school-documents' and name = b::text || '/fixture/private.pdf';
  if n <> 0 then raise exception 'FAIL B15: teacher can read another school''s document'; end if;
  insert into storage.objects (bucket_id, name, metadata) values ('school-documents', a::text || '/fixture/teacher.pdf', '{"mimetype":"application/pdf","size":1}'::jsonb);
  begin
    update storage.objects set name = b::text || '/fixture/moved.pdf'
    where bucket_id = 'school-documents' and name = a::text || '/fixture/private.pdf';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL B16: teacher can move a document into another school''s storage path'; end if;
end $$;

-- ---- act as an anonymous visitor
reset role;
set local role anon;
do $$
declare denied boolean := false; n integer;
begin
  begin select count(*) into n from public.school_records; if n <> 0 then raise exception 'FAIL B10: anonymous visitor can read school records'; end if;
  exception when insufficient_privilege then denied := true; end;
  denied := false;
  begin perform public.get_my_subscription(); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL B11: anonymous visitor can call get_my_subscription'; end if;
  raise notice 'PART B (as anonymous) PASSED';
end $$;

reset role;
rollback;  -- leaves nothing behind
