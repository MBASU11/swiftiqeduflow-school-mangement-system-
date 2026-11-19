-- Bursar Pack: numbering, confirmed-only payments with receipts, refunds/charges/reminders access,
-- and parent-portal fee figures that ignore unconfirmed payments.
-- Apply after 202610160001_subscriptions_and_capacity.sql. Test in a development project first.

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

-- ------------------------------------------------------------ atomic document numbers
create table if not exists public.school_counters (
  school_id uuid not null references public.schools(id) on delete cascade,
  kind text not null,
  year integer not null,
  value integer not null default 0,
  primary key (school_id, kind, year)
);
alter table public.school_counters enable row level security;
revoke all on public.school_counters from anon, authenticated;

create or replace function public.next_document_number(doc_kind text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  sid uuid := public.my_school_id(false);
  prefix text := case doc_kind when 'invoice' then 'INV' when 'receipt' then 'RCT' when 'refund' then 'RFD' else null end;
  yr integer := extract(year from current_date)::integer;
  seq integer;
begin
  if prefix is null then raise exception 'Unknown document type.'; end if;
  if public.role_collection_access((select public.member_role()), 'invoices') <> 'write' and not public.is_platform_admin() then
    raise exception 'Your role cannot issue finance documents.' using errcode = '42501';
  end if;
  insert into public.school_counters (school_id, kind, year, value) values (sid, doc_kind, yr, 1)
  on conflict (school_id, kind, year) do update set value = public.school_counters.value + 1
  returning value into seq;
  return prefix || '-' || yr || '-' || lpad(seq::text, 4, '0');
end;
$$;
grant execute on function public.next_document_number(text) to authenticated;

-- ------------------------------------------------------------ payments: pending until confirmed
create or replace function public.bursar_issue_receipt(school_key uuid, pay_row public.school_records)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  existing jsonb;
  seq integer;
  yr integer := extract(year from current_date)::integer;
  rid text := gen_random_uuid()::text;
  new_payload jsonb;
begin
  select payload into existing from public.school_records
    where school_id = school_key and collection = 'receipts' and payload ->> 'paymentId' = pay_row.record_id;
  if existing is not null then return existing; end if;
  insert into public.school_counters (school_id, kind, year, value) values (school_key, 'receipt', yr, 1)
  on conflict (school_id, kind, year) do update set value = public.school_counters.value + 1
  returning value into seq;
  new_payload := jsonb_build_object('id', rid, 'number', 'RCT-' || yr || '-' || lpad(seq::text, 4, '0'), 'paymentId', pay_row.record_id,
    'studentId', pay_row.payload ->> 'studentId', 'invoiceId', pay_row.payload -> 'invoiceId', 'amount', pay_row.payload -> 'amount',
    'method', pay_row.payload ->> 'method', 'reference', pay_row.payload -> 'reference', 'date', pay_row.payload ->> 'date',
    'createdAt', now(), 'updatedAt', now());
  insert into public.school_records (school_id, collection, record_id, payload) values (school_key, 'receipts', rid, new_payload);
  return new_payload;
end;
$$;
revoke all on function public.bursar_issue_receipt(uuid, public.school_records) from public, anon, authenticated;

create or replace function public.bursar_refresh_invoice(school_key uuid, target_invoice text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  inv public.school_records%rowtype;
  total numeric; paid numeric; new_status text;
begin
  select * into inv from public.school_records where school_id = school_key and collection = 'invoices' and record_id = target_invoice for update;
  if not found or inv.payload ->> 'status' = 'void' then return; end if;
  total := coalesce((inv.payload ->> 'totalAmount')::numeric, 0);
  select coalesce(sum((payload ->> 'amount')::numeric), 0) into paid from public.school_records
    where school_id = school_key and collection = 'payments' and payload ->> 'invoiceId' = target_invoice
      and coalesce(payload ->> 'status', 'confirmed') = 'confirmed';
  new_status := case when total > 0 and paid >= total then 'paid' when paid > 0 then 'partial' else 'unpaid' end;
  update public.school_records
  set payload = jsonb_set(inv.payload, '{status}', to_jsonb(new_status), true), updated_at = now()
  where school_id = school_key and collection = 'invoices' and record_id = inv.record_id;
end;
$$;
revoke all on function public.bursar_refresh_invoice(uuid, text) from public, anon, authenticated;

create or replace function public.bursar_submit_payment(target_student text, target_invoice text, pay_amount numeric, pay_method text,
                                                       pay_reference text, pay_date date, initial_status text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  sid uuid := public.my_school_id(false);
  inv public.school_records%rowtype;
  confirmed numeric;
  pid text := gen_random_uuid()::text;
  status_value text;
  pay_row public.school_records%rowtype;
  pay_payload jsonb;
begin
  if public.role_collection_access((select public.member_role()), 'payments') <> 'write' and not public.is_platform_admin() then
    raise exception 'Your role cannot record payments.' using errcode = '42501';
  end if;
  if pay_amount is null or pay_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if pay_method not in ('mpesa', 'bank', 'cash', 'cheque', 'swiftiq_pay', 'other') then raise exception 'Choose a valid payment method.'; end if;
  -- The server decides the status: only cash can be confirmed on entry.
  status_value := case when pay_method = 'cash' then 'confirmed' else 'pending_verification' end;
  if pay_method <> 'cash' and nullif(trim(coalesce(pay_reference, '')), '') is null then raise exception 'Enter the transaction reference so the payment can be verified.'; end if;
  if pay_reference is not null and exists (select 1 from public.school_records where school_id = sid and collection = 'payments'
      and lower(payload ->> 'reference') = lower(trim(pay_reference)) and coalesce(payload ->> 'status', 'confirmed') <> 'rejected') then
    raise exception 'A payment with this reference has already been recorded.';
  end if;
  if target_invoice is not null then
    select * into inv from public.school_records where school_id = sid and collection = 'invoices' and record_id = target_invoice for update;
    if not found or inv.payload ->> 'studentId' <> target_student then raise exception 'The selected invoice does not belong to this student.'; end if;
    select coalesce(sum((payload ->> 'amount')::numeric), 0) into confirmed from public.school_records
      where school_id = sid and collection = 'payments' and payload ->> 'invoiceId' = target_invoice and coalesce(payload ->> 'status', 'confirmed') = 'confirmed';
    if status_value = 'confirmed' and pay_amount > coalesce((inv.payload ->> 'totalAmount')::numeric, 0) - confirmed then
      raise exception 'Payment exceeds the outstanding invoice balance of %.', coalesce((inv.payload ->> 'totalAmount')::numeric, 0) - confirmed;
    end if;
  end if;
  pay_payload := jsonb_build_object('id', pid, 'studentId', target_student, 'invoiceId', target_invoice, 'amount', pay_amount, 'method', pay_method,
    'reference', nullif(trim(coalesce(pay_reference, '')), ''), 'date', pay_date::text, 'status', status_value, 'createdAt', now(), 'updatedAt', now());
  if status_value = 'confirmed' then pay_payload := pay_payload || jsonb_build_object('confirmedAt', now()); end if;
  insert into public.school_records (school_id, collection, record_id, payload) values (sid, 'payments', pid, pay_payload) returning * into pay_row;
  if status_value = 'confirmed' then
    perform public.bursar_issue_receipt(sid, pay_row);
    if target_invoice is not null then perform public.bursar_refresh_invoice(sid, target_invoice); end if;
  end if;
  return pay_payload;
end;
$$;
grant execute on function public.bursar_submit_payment(text, text, numeric, text, text, date, text) to authenticated;

create or replace function public.bursar_confirm_payment(payment_id text, confirm_note text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  sid uuid := public.my_school_id(false);
  pay public.school_records%rowtype;
  inv public.school_records%rowtype;
  confirmed numeric;
begin
  if public.role_collection_access((select public.member_role()), 'payments') <> 'write' and not public.is_platform_admin() then
    raise exception 'Your role cannot confirm payments.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(confirm_note, '')), '') is null then raise exception 'Say how you confirmed the payment.'; end if;
  select * into pay from public.school_records where school_id = sid and collection = 'payments' and record_id = payment_id for update;
  if not found then raise exception 'Payment not found.'; end if;
  if pay.payload ->> 'status' is distinct from 'pending_verification' then raise exception 'Only a payment that is pending verification can be confirmed.'; end if;
  if pay.payload ->> 'invoiceId' is not null then
    select * into inv from public.school_records where school_id = sid and collection = 'invoices' and record_id = pay.payload ->> 'invoiceId' for update;
    select coalesce(sum((payload ->> 'amount')::numeric), 0) into confirmed from public.school_records
      where school_id = sid and collection = 'payments' and payload ->> 'invoiceId' = pay.payload ->> 'invoiceId' and coalesce(payload ->> 'status', 'confirmed') = 'confirmed';
    if (pay.payload ->> 'amount')::numeric > coalesce((inv.payload ->> 'totalAmount')::numeric, 0) - confirmed then
      raise exception 'Confirming this would exceed the invoice balance of %. Reject it or refund the difference.', coalesce((inv.payload ->> 'totalAmount')::numeric, 0) - confirmed;
    end if;
  end if;
  update public.school_records set payload = payload || jsonb_build_object('status', 'confirmed', 'confirmedAt', now(), 'confirmNote', confirm_note), updated_at = now()
    where school_id = sid and collection = 'payments' and record_id = pay.record_id returning * into pay;
  perform public.bursar_issue_receipt(sid, pay);
  if pay.payload ->> 'invoiceId' is not null then perform public.bursar_refresh_invoice(sid, pay.payload ->> 'invoiceId'); end if;
  return pay.payload;
end;
$$;
grant execute on function public.bursar_confirm_payment(text, text) to authenticated;

-- ------------------------------------------------------------ parent portal: only confirmed payments count; show receipts
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
