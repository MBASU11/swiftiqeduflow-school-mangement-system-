create extension if not exists pgcrypto;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  contact_name text not null,
  email text not null,
  phone text,
  plan_id text not null,
  plan_name text not null,
  plan_modules text not null check (plan_modules in ('single', 'both')),
  student_count integer check (student_count is null or student_count > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  status_note text,
  registered_at timestamptz not null default now(),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_memberships (
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('school_admin', 'teacher', 'staff', 'parent')),
  created_at timestamptz not null default now(),
  primary key (school_id, user_id)
);

create table public.school_history (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  note text,
  happened_at timestamptz not null default now()
);
create index school_history_school_idx on public.school_history (school_id, happened_at desc);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Mirrors the app's current LocalStorageRepository collection + JSON record shape.
create table public.school_records (
  school_id uuid not null references public.schools(id) on delete cascade,
  collection text not null check (collection ~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}$'),
  record_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (school_id, collection, record_id)
);
create index school_records_collection_idx on public.school_records (school_id, collection);
create unique index students_admission_number_unique
  on public.school_records (school_id, lower(trim(payload ->> 'admissionNumber')))
  where collection = 'students' and nullif(trim(payload ->> 'admissionNumber'), '') is not null;

create table public.school_audit_logs (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  collection text not null,
  record_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  happened_at timestamptz not null default now()
);
create index school_audit_logs_school_idx on public.school_audit_logs (school_id, happened_at desc);

create table public.platform_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  number text not null unique,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  issue_date date not null default current_date,
  due_date date,
  note text,
  voided boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index platform_invoices_school_idx on public.platform_invoices (school_id, created_at desc);

create table public.platform_invoice_counters (
  invoice_year integer primary key,
  last_number integer not null check (last_number > 0)
);
alter table public.platform_invoice_counters enable row level security;
revoke all on table public.platform_invoice_counters from anon, authenticated;

create table public.platform_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.platform_invoices(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('mpesa', 'bank', 'cash', 'cheque', 'other')),
  reference text,
  received_on date not null default current_date,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.assign_platform_invoice_number()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  invoice_year integer := extract(year from coalesce(new.created_at, now()))::integer;
  sequence_number integer;
begin
  if nullif(trim(new.number), '') is null then
    insert into public.platform_invoice_counters (invoice_year, last_number)
    values (invoice_year, 1)
    on conflict (invoice_year) do update
      set last_number = public.platform_invoice_counters.last_number + 1
    returning last_number into sequence_number;
    new.number := 'INV-' || invoice_year || '-' || lpad(sequence_number::text, 4, '0');
  end if;
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  return new;
end;
$$;

create trigger platform_invoice_number_before_insert
before insert on public.platform_invoices
for each row execute function public.assign_platform_invoice_number();

create or replace function public.validate_platform_invoice_payment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  invoice_row public.platform_invoices%rowtype;
  invoice_total numeric(12, 2);
  paid_total numeric(12, 2);
begin
  select * into invoice_row
  from public.platform_invoices
  where id = new.invoice_id
  for update;
  if not found then
    raise exception 'This invoice could not be found.';
  end if;
  if invoice_row.voided then
    raise exception 'This invoice has been voided.';
  end if;

  select coalesce(sum((entry.value ->> 'amount')::numeric), 0)
  into invoice_total
  from jsonb_array_elements(invoice_row.items) as entry(value);
  select coalesce(sum(amount), 0)
  into paid_total
  from public.platform_invoice_payments
  where invoice_id = new.invoice_id;

  if new.amount > invoice_total - paid_total then
    raise exception 'Payment exceeds the outstanding invoice balance.';
  end if;
  new.recorded_by := coalesce(new.recorded_by, (select auth.uid()));
  return new;
end;
$$;

create trigger platform_invoice_payment_validate
before insert on public.platform_invoice_payments
for each row execute function public.validate_platform_invoice_payment();

create or replace function public.log_platform_invoice_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  action_text text;
begin
  if tg_op = 'INSERT' then
    action_text := 'Issued invoice ' || new.number;
    insert into public.school_history (school_id, actor_user_id, action)
    values (new.school_id, (select auth.uid()), action_text);
  elsif new.voided is distinct from old.voided and new.voided then
    action_text := 'Voided invoice ' || new.number;
    insert into public.school_history (school_id, actor_user_id, action)
    values (new.school_id, (select auth.uid()), action_text);
  end if;
  return new;
end;
$$;

create trigger platform_invoice_history
after insert or update of voided on public.platform_invoices
for each row execute function public.log_platform_invoice_change();

create or replace function public.log_platform_invoice_payment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  invoice_row public.platform_invoices%rowtype;
begin
  select * into invoice_row from public.platform_invoices where id = new.invoice_id;
  insert into public.school_history (school_id, actor_user_id, action, note)
  values (
    invoice_row.school_id,
    (select auth.uid()),
    'Payment confirmed on ' || invoice_row.number,
    'Amount: ' || new.amount::text || '; method: ' || new.method
  );
  return new;
end;
$$;

create trigger platform_invoice_payment_history
after insert on public.platform_invoice_payments
for each row execute function public.log_platform_invoice_payment();

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  );
$$;

create or replace function public.current_school_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select school_id from public.school_memberships where user_id = (select auth.uid());
$$;

create or replace function public.has_approved_school_access(target_school_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.school_memberships m
    join public.schools s on s.id = m.school_id
    where m.user_id = (select auth.uid())
      and m.school_id = target_school_id
      and s.status = 'approved'
  );
$$;

-- Never trust a school ID submitted by the browser. A signed-in owner is
-- assigned to their approved membership by the database on record creation.
create or replace function public.scope_school_record()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  assigned_school_id uuid;
begin
  if tg_op = 'INSERT' then
    select m.school_id into assigned_school_id
    from public.school_memberships m
    join public.schools s on s.id = m.school_id
    where m.user_id = (select auth.uid()) and s.status = 'approved'
    order by m.created_at
    limit 1;
    if assigned_school_id is null then
      raise exception 'An approved school membership is required.';
    end if;
    new.school_id := assigned_school_id;
  elsif new.school_id is distinct from old.school_id then
    raise exception 'A record cannot be moved between schools.';
  end if;
  return new;
end;
$$;

create or replace function public.complete_school_setup(records jsonb)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  entry jsonb;
  saved_count integer := 0;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required to complete setup.';
  end if;
  if jsonb_typeof(records) <> 'array' or jsonb_array_length(records) > 1000 then
    raise exception 'Setup records must be an array containing no more than 1,000 records.';
  end if;

  for entry in select value from jsonb_array_elements(records) loop
    if coalesce(entry ->> 'collection', '') !~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}$'
       or nullif(trim(entry ->> 'record_id'), '') is null
       or jsonb_typeof(entry -> 'payload') <> 'object'
       or entry -> 'payload' ->> 'id' is distinct from entry ->> 'record_id' then
      raise exception 'A setup record has an invalid collection, ID, or payload.';
    end if;

    insert into public.school_records (school_id, collection, record_id, payload)
    values (school_key, entry ->> 'collection', entry ->> 'record_id', entry -> 'payload')
    on conflict (school_id, collection, record_id) do update
      set payload = excluded.payload, updated_at = now();
    saved_count := saved_count + 1;
  end loop;
  return saved_count;
end;
$$;

create or replace function public.set_current_academic_record(target_collection text, target_record_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
begin
  if target_collection not in ('academicYears', 'terms') then
    raise exception 'Only academic years and terms can be marked current.';
  end if;
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required.';
  end if;
  if not exists (
    select 1 from public.school_records
    where school_id = school_key and collection = target_collection and record_id = target_record_id
  ) then
    raise exception 'The selected academic record does not exist.';
  end if;

  update public.school_records
  set payload = jsonb_set(payload, '{isCurrent}', to_jsonb(record_id = target_record_id), true),
      updated_at = now()
  where school_id = school_key and collection = target_collection;
end;
$$;

create or replace function public.remove_class_and_streams(target_class_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required.';
  end if;
  if not exists (
    select 1 from public.school_records
    where school_id = school_key and collection = 'classes' and record_id = target_class_id
  ) then
    raise exception 'The selected class does not exist.';
  end if;
  if exists (
    select 1 from public.school_records
    where school_id = school_key
      and collection = 'students'
      and payload ->> 'classId' = target_class_id
      and payload ->> 'status' = 'active'
  ) then
    raise exception 'This class has students enrolled. Move or archive them first.';
  end if;

  delete from public.school_records
  where school_id = school_key and collection = 'streams' and payload ->> 'classId' = target_class_id;
  delete from public.school_records
  where school_id = school_key and collection = 'classes' and record_id = target_class_id;
end;
$$;

create or replace function public.save_class_attendance(
  target_class_id text,
  target_stream_id text,
  attendance_date date,
  student_statuses jsonb,
  current_term_id text default null
)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  status_entry record;
  existing_record public.school_records%rowtype;
  next_payload jsonb;
  saved_count integer := 0;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required.';
  end if;
  if jsonb_typeof(student_statuses) <> 'object' or jsonb_object_length(student_statuses) > 1000 then
    raise exception 'Attendance statuses must be an object with no more than 1,000 students.';
  end if;
  if not exists (
    select 1 from public.school_records
    where school_id = school_key and collection = 'classes' and record_id = target_class_id
  ) then
    raise exception 'The selected class does not exist.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(school_key::text || ':' || target_class_id || ':' || attendance_date::text, 0));

  for status_entry in select key as student_id, value #>> '{}' as attendance_status from jsonb_each(student_statuses) loop
    if status_entry.attendance_status not in ('present', 'absent', 'late', 'excused') then
      raise exception 'Invalid attendance status.';
    end if;
    if not exists (
      select 1 from public.school_records s
      where s.school_id = school_key
        and s.collection = 'students'
        and s.record_id = status_entry.student_id
        and s.payload ->> 'classId' = target_class_id
        and s.payload ->> 'status' = 'active'
        and (target_stream_id is null or s.payload ->> 'streamId' = target_stream_id)
    ) then
      raise exception 'A submitted student is not active in the selected class and stream.';
    end if;

    select * into existing_record
    from public.school_records r
    where r.school_id = school_key
      and r.collection = 'attendance'
      and r.payload ->> 'studentId' = status_entry.student_id
      and r.payload ->> 'classId' = target_class_id
      and r.payload ->> 'date' = attendance_date::text
    limit 1;

    if found then
      next_payload := jsonb_set(existing_record.payload, '{status}', to_jsonb(status_entry.attendance_status), true);
      if target_stream_id is not null then
        next_payload := jsonb_set(next_payload, '{streamId}', to_jsonb(target_stream_id), true);
      end if;
      if current_term_id is not null then
        next_payload := jsonb_set(next_payload, '{termId}', to_jsonb(current_term_id), true);
      end if;
      update public.school_records
      set payload = next_payload, updated_at = now()
      where school_id = school_key and collection = 'attendance' and record_id = existing_record.record_id;
    else
      next_payload := jsonb_build_object(
        'id', gen_random_uuid()::text,
        'studentId', status_entry.student_id,
        'classId', target_class_id,
        'date', attendance_date::text,
        'status', status_entry.attendance_status,
        'createdAt', now(),
        'updatedAt', now()
      );
      if target_stream_id is not null then
        next_payload := jsonb_set(next_payload, '{streamId}', to_jsonb(target_stream_id), true);
      end if;
      if current_term_id is not null then
        next_payload := jsonb_set(next_payload, '{termId}', to_jsonb(current_term_id), true);
      end if;
      insert into public.school_records (school_id, collection, record_id, payload)
      values (school_key, 'attendance', next_payload ->> 'id', next_payload);
    end if;
    saved_count := saved_count + 1;
  end loop;
  return saved_count;
end;
$$;

create or replace function public.convert_admission_to_student(target_admission_id text, student_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  admission_row public.school_records%rowtype;
  new_student_id text;
  final_student jsonb;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required.';
  end if;
  select * into admission_row
  from public.school_records
  where school_id = school_key and collection = 'admissions' and record_id = target_admission_id
  for update;
  if not found or admission_row.payload ->> 'stage' <> 'approved' then
    raise exception 'Only approved applications can be admitted.';
  end if;
  if not exists (
    select 1 from public.school_records
    where school_id = school_key and collection = 'classes' and record_id = student_payload ->> 'classId'
  ) then
    raise exception 'The selected class does not exist.';
  end if;
  if exists (
    select 1 from public.school_records
    where school_id = school_key
      and collection = 'students'
      and lower(trim(payload ->> 'admissionNumber')) = lower(trim(student_payload ->> 'admissionNumber'))
  ) then
    raise exception 'This admission number is already used by another student.';
  end if;

  new_student_id := coalesce(nullif(student_payload ->> 'id', ''), gen_random_uuid()::text);
  final_student := jsonb_set(student_payload, '{id}', to_jsonb(new_student_id), true);
  insert into public.school_records (school_id, collection, record_id, payload)
  values (school_key, 'students', new_student_id, final_student);
  update public.school_records
  set payload = jsonb_set(jsonb_set(payload, '{stage}', '"admitted"'::jsonb, true), '{admittedStudentId}', to_jsonb(new_student_id), true),
      updated_at = now()
  where school_id = school_key and collection = 'admissions' and record_id = target_admission_id;
  return final_student;
end;
$$;

create or replace function public.save_assessment_scores(target_assessment_id text, student_scores jsonb)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  assessment_row public.school_records%rowtype;
  score_entry record;
  existing_score public.school_records%rowtype;
  next_payload jsonb;
  score_value numeric;
  saved_count integer := 0;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required.';
  end if;
  select * into assessment_row from public.school_records
  where school_id = school_key and collection = 'assessments' and record_id = target_assessment_id;
  if not found then
    raise exception 'The selected assessment does not exist.';
  end if;
  if jsonb_typeof(student_scores) <> 'object' or jsonb_object_length(student_scores) > 1000 then
    raise exception 'Scores must be an object with no more than 1,000 students.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(school_key::text || ':assessment:' || target_assessment_id, 0));
  for score_entry in select key as student_id, value as score_json from jsonb_each(student_scores) loop
    if score_entry.score_json <> 'null'::jsonb then
      begin
        score_value := (score_entry.score_json #>> '{}')::numeric;
      exception when others then
        raise exception 'A score is not numeric.';
      end;
      if score_value < 0 or score_value > (assessment_row.payload ->> 'maxScore')::numeric then
        raise exception 'A score is outside the allowed range.';
      end if;
    else
      score_value := null;
    end if;
    if not exists (
      select 1 from public.school_records s
      where s.school_id = school_key and s.collection = 'students'
        and s.record_id = score_entry.student_id
        and s.payload ->> 'classId' = assessment_row.payload ->> 'classId'
        and s.payload ->> 'status' = 'active'
    ) then
      raise exception 'A submitted student is not active in this assessment class.';
    end if;

    select * into existing_score from public.school_records r
    where r.school_id = school_key and r.collection = 'assessmentScores'
      and r.payload ->> 'assessmentId' = target_assessment_id
      and r.payload ->> 'studentId' = score_entry.student_id
    limit 1;
    if found then
      next_payload := jsonb_set(existing_score.payload, '{score}', coalesce(to_jsonb(score_value), 'null'::jsonb), true);
      update public.school_records set payload = next_payload, updated_at = now()
      where school_id = school_key and collection = 'assessmentScores' and record_id = existing_score.record_id;
    else
      next_payload := jsonb_build_object(
        'id', gen_random_uuid()::text,
        'assessmentId', target_assessment_id,
        'studentId', score_entry.student_id,
        'score', score_value,
        'createdAt', now(),
        'updatedAt', now()
      );
      insert into public.school_records (school_id, collection, record_id, payload)
      values (school_key, 'assessmentScores', next_payload ->> 'id', next_payload);
    end if;
    saved_count := saved_count + 1;
  end loop;
  return saved_count;
end;
$$;

create or replace function public.record_inventory_movement(
  target_item_id text,
  movement_type text,
  movement_quantity integer,
  movement_note text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  item_row public.school_records%rowtype;
  next_quantity integer;
  now_value timestamptz := now();
  movement_id text := gen_random_uuid()::text;
  movement_payload jsonb;
  item_payload jsonb;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required.';
  end if;
  if movement_type not in ('in', 'out') then
    raise exception 'Choose stock in or stock out.';
  end if;
  if movement_quantity is null or movement_quantity < 1 then
    raise exception 'Enter a quantity greater than zero.';
  end if;

  select * into item_row from public.school_records
  where school_id = school_key and collection = 'inventory' and record_id = target_item_id
  for update;
  if not found then
    raise exception 'The inventory item could not be found.';
  end if;
  next_quantity := (item_row.payload ->> 'quantity')::integer
    + case when movement_type = 'in' then movement_quantity else -movement_quantity end;
  if next_quantity < 0 then
    raise exception 'Only % in stock - cannot remove %.', item_row.payload ->> 'quantity', movement_quantity;
  end if;

  item_payload := jsonb_set(item_row.payload, '{quantity}', to_jsonb(next_quantity), true);
  update public.school_records set payload = item_payload, updated_at = now_value
  where school_id = school_key and collection = 'inventory' and record_id = target_item_id;

  movement_payload := jsonb_build_object(
    'id', movement_id,
    'itemId', target_item_id,
    'type', movement_type,
    'quantity', movement_quantity,
    'date', now_value::date::text,
    'note', nullif(trim(movement_note), ''),
    'createdAt', now_value,
    'updatedAt', now_value
  );
  insert into public.school_records (school_id, collection, record_id, payload)
  values (school_key, 'inventoryTransactions', movement_id, movement_payload);
  return jsonb_build_object('item', item_payload, 'transaction', movement_payload);
end;
$$;

create or replace function public.remove_inventory_item(target_item_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then
    raise exception 'An approved school membership is required.';
  end if;
  if not exists (
    select 1 from public.school_records
    where school_id = school_key and collection = 'inventory' and record_id = target_item_id
  ) then
    raise exception 'The inventory item could not be found.';
  end if;
  delete from public.school_records
  where school_id = school_key and collection = 'inventoryTransactions' and payload ->> 'itemId' = target_item_id;
  delete from public.school_records
  where school_id = school_key and collection = 'inventory' and record_id = target_item_id;
end;
$$;

create or replace function public.borrow_library_book(
  target_book_id text,
  borrower_type text,
  borrower_id text,
  borrower_name text,
  due_date date
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  book_row public.school_records%rowtype;
  active_count integer;
  loan_id text := gen_random_uuid()::text;
  now_value timestamptz := now();
  loan_payload jsonb;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  if borrower_type not in ('student', 'teacher') or nullif(trim(borrower_name), '') is null then
    raise exception 'A valid borrower is required.';
  end if;
  select * into book_row from public.school_records
  where school_id = school_key and collection = 'libraryBooks' and record_id = target_book_id
  for update;
  if not found then raise exception 'The selected book does not exist.'; end if;
  select count(*) into active_count from public.school_records
  where school_id = school_key and collection = 'libraryTransactions'
    and payload ->> 'bookId' = target_book_id and payload ->> 'status' <> 'returned';
  if active_count >= (book_row.payload ->> 'totalCopies')::integer then
    raise exception 'No copies of this book are currently available.';
  end if;
  if borrower_type = 'student' and not exists (
    select 1 from public.school_records where school_id = school_key and collection = 'students'
      and record_id = borrower_id and payload ->> 'status' = 'active'
  ) then raise exception 'The selected student is not active.'; end if;
  if borrower_type = 'teacher' and not exists (
    select 1 from public.school_records where school_id = school_key and collection = 'teachers'
      and record_id = borrower_id and payload ->> 'isActive' = 'true'
  ) then raise exception 'The selected staff member is not active.'; end if;

  loan_payload := jsonb_build_object(
    'id', loan_id, 'bookId', target_book_id, 'borrowerType', borrower_type,
    'borrowerId', borrower_id, 'borrowerName', trim(borrower_name),
    'borrowedDate', now_value::date::text, 'dueDate', due_date::text,
    'status', 'borrowed', 'createdAt', now_value, 'updatedAt', now_value
  );
  insert into public.school_records (school_id, collection, record_id, payload)
  values (school_key, 'libraryTransactions', loan_id, loan_payload);
  return loan_payload;
end;
$$;

create or replace function public.return_library_book(target_transaction_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  loan_row public.school_records%rowtype;
  updated_payload jsonb;
  now_value timestamptz := now();
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  select * into loan_row from public.school_records
  where school_id = school_key and collection = 'libraryTransactions' and record_id = target_transaction_id
  for update;
  if not found then raise exception 'The loan could not be found.'; end if;
  if loan_row.payload ->> 'status' = 'returned' then raise exception 'This book has already been returned.'; end if;
  updated_payload := jsonb_set(jsonb_set(loan_row.payload, '{status}', '"returned"'::jsonb, true), '{returnedDate}', to_jsonb(now_value::date::text), true);
  updated_payload := jsonb_set(updated_payload, '{updatedAt}', to_jsonb(now_value), true);
  update public.school_records set payload = updated_payload, updated_at = now_value
  where school_id = school_key and collection = 'libraryTransactions' and record_id = target_transaction_id;
  return updated_payload;
end;
$$;

create or replace function public.remove_library_book(target_book_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
begin
  select m.school_id into school_key
  from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at
  limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  if not exists (select 1 from public.school_records where school_id = school_key and collection = 'libraryBooks' and record_id = target_book_id) then
    raise exception 'The book could not be found.';
  end if;
  if exists (select 1 from public.school_records where school_id = school_key and collection = 'libraryTransactions' and payload ->> 'bookId' = target_book_id and payload ->> 'status' <> 'returned') then
    raise exception 'This book has copies currently borrowed. Return them before removing it.';
  end if;
  delete from public.school_records where school_id = school_key and collection = 'libraryTransactions' and payload ->> 'bookId' = target_book_id;
  delete from public.school_records where school_id = school_key and collection = 'libraryBooks' and record_id = target_book_id;
end;
$$;

create or replace function public.assign_student_transport(target_student_id text, target_route_id text, target_stop_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  route_row public.school_records%rowtype;
  student_row public.school_records%rowtype;
  vehicle_row public.school_records%rowtype;
  assignment_row public.school_records%rowtype;
  occupancy integer;
  assignment_id text;
  assignment_payload jsonb;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  select * into route_row from public.school_records where school_id = school_key and collection = 'routes' and record_id = target_route_id for update;
  if not found then raise exception 'The selected route does not exist.'; end if;
  select * into student_row from public.school_records where school_id = school_key and collection = 'students' and record_id = target_student_id for update;
  if not found or student_row.payload ->> 'status' <> 'active' then raise exception 'The selected student is not active.'; end if;
  if target_stop_id is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(route_row.payload -> 'stops', '[]'::jsonb)) stop
    where stop ->> 'id' = target_stop_id
  ) then raise exception 'The selected stop is not part of this route.'; end if;

  select * into assignment_row from public.school_records where school_id = school_key and collection = 'transportAssignments'
    and payload ->> 'studentId' = target_student_id limit 1 for update;
  if route_row.payload ->> 'vehicleId' is not null then
    select * into vehicle_row from public.school_records where school_id = school_key and collection = 'vehicles' and record_id = route_row.payload ->> 'vehicleId';
    if found then
      select count(*) into occupancy from public.school_records a
      where a.school_id = school_key and a.collection = 'transportAssignments'
        and a.payload ->> 'routeId' = target_route_id
        and (assignment_row.record_id is null or a.record_id <> assignment_row.record_id);
      if occupancy >= (vehicle_row.payload ->> 'capacity')::integer then raise exception 'This route has no available seats.'; end if;
    end if;
  end if;

  assignment_id := coalesce(assignment_row.record_id, gen_random_uuid()::text);
  assignment_payload := jsonb_build_object('id', assignment_id, 'studentId', target_student_id, 'routeId', target_route_id, 'stopId', target_stop_id, 'createdAt', coalesce(assignment_row.payload -> 'createdAt', to_jsonb(now())), 'updatedAt', now());
  insert into public.school_records (school_id, collection, record_id, payload)
  values (school_key, 'transportAssignments', assignment_id, assignment_payload)
  on conflict (school_id, collection, record_id) do update set payload = excluded.payload, updated_at = now();
  update public.school_records set payload = jsonb_set(payload, '{usesTransport}', 'true'::jsonb, true), updated_at = now()
  where school_id = school_key and collection = 'students' and record_id = target_student_id;
  return assignment_payload;
end;
$$;

create or replace function public.unassign_student_transport(target_student_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  delete from public.school_records where school_id = school_key and collection = 'transportAssignments' and payload ->> 'studentId' = target_student_id;
  update public.school_records set payload = jsonb_set(payload, '{usesTransport}', 'false'::jsonb, true), updated_at = now()
  where school_id = school_key and collection = 'students' and record_id = target_student_id;
end;
$$;

create or replace function public.remove_transport_stop(target_route_id text, target_stop_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  route_row public.school_records%rowtype;
  student_ids text[];
  next_stops jsonb;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  select * into route_row from public.school_records where school_id = school_key and collection = 'routes' and record_id = target_route_id for update;
  if not found then raise exception 'The route does not exist.'; end if;
  select coalesce(array_agg(payload ->> 'studentId'), array[]::text[]) into student_ids
  from public.school_records where school_id = school_key and collection = 'transportAssignments'
    and payload ->> 'routeId' = target_route_id and payload ->> 'stopId' = target_stop_id;
  delete from public.school_records where school_id = school_key and collection = 'transportAssignments'
    and payload ->> 'routeId' = target_route_id and payload ->> 'stopId' = target_stop_id;
  update public.school_records set payload = jsonb_set(payload, '{usesTransport}', 'false'::jsonb, true), updated_at = now()
  where school_id = school_key and collection = 'students' and record_id = any(student_ids);
  select coalesce(jsonb_agg(stop), '[]'::jsonb) into next_stops
  from jsonb_array_elements(coalesce(route_row.payload -> 'stops', '[]'::jsonb)) stop
  where stop ->> 'id' <> target_stop_id;
  update public.school_records set payload = jsonb_set(payload, '{stops}', next_stops, true), updated_at = now()
  where school_id = school_key and collection = 'routes' and record_id = target_route_id;
end;
$$;

create or replace function public.remove_transport_route(target_route_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  student_ids text[];
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  select coalesce(array_agg(payload ->> 'studentId'), array[]::text[]) into student_ids
  from public.school_records where school_id = school_key and collection = 'transportAssignments' and payload ->> 'routeId' = target_route_id;
  delete from public.school_records where school_id = school_key and collection = 'transportAssignments' and payload ->> 'routeId' = target_route_id;
  update public.school_records set payload = jsonb_set(payload, '{usesTransport}', 'false'::jsonb, true), updated_at = now()
  where school_id = school_key and collection = 'students' and record_id = any(student_ids);
  delete from public.school_records where school_id = school_key and collection = 'routes' and record_id = target_route_id;
end;
$$;

create or replace function public.record_student_invoice_payment(
  target_student_id text,
  target_invoice_id text,
  payment_amount numeric,
  payment_method text,
  payment_reference text,
  payment_date date
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  invoice_row public.school_records%rowtype;
  payment_id text := gen_random_uuid()::text;
  total_amount numeric(12,2);
  paid_amount numeric(12,2);
  new_status text;
  now_value timestamptz := now();
  payment_payload jsonb;
  invoice_payload jsonb;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved'
  order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  if payment_amount is null or payment_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if payment_method not in ('mpesa', 'bank', 'cash', 'cheque', 'other') then raise exception 'Choose a valid payment method.'; end if;
  if payment_date is null then raise exception 'Enter the payment date.'; end if;

  select * into invoice_row from public.school_records where school_id = school_key
    and collection = 'invoices' and record_id = target_invoice_id for update;
  if not found or invoice_row.payload ->> 'studentId' <> target_student_id then
    raise exception 'The selected invoice does not belong to this student.';
  end if;
  total_amount := coalesce((invoice_row.payload ->> 'totalAmount')::numeric, 0);
  select coalesce(sum((payload ->> 'amount')::numeric), 0) into paid_amount
  from public.school_records where school_id = school_key and collection = 'payments'
    and payload ->> 'invoiceId' = target_invoice_id;
  if payment_amount > total_amount - paid_amount then
    raise exception 'Payment exceeds the outstanding invoice balance of %.', total_amount - paid_amount;
  end if;
  new_status := case when paid_amount + payment_amount >= total_amount then 'paid' when paid_amount + payment_amount > 0 then 'partial' else 'unpaid' end;

  payment_payload := jsonb_build_object(
    'id', payment_id, 'studentId', target_student_id, 'invoiceId', target_invoice_id,
    'amount', payment_amount, 'method', payment_method,
    'reference', nullif(trim(payment_reference), ''), 'date', payment_date::text,
    'createdAt', now_value, 'updatedAt', now_value
  );
  insert into public.school_records (school_id, collection, record_id, payload)
  values (school_key, 'payments', payment_id, payment_payload);
  invoice_payload := jsonb_set(invoice_row.payload, '{status}', to_jsonb(new_status), true);
  update public.school_records set payload = invoice_payload, updated_at = now_value
  where school_id = school_key and collection = 'invoices' and record_id = target_invoice_id;
  return jsonb_build_object('payment', payment_payload, 'invoice', invoice_payload, 'paidAmount', paid_amount + payment_amount, 'balance', total_amount - paid_amount - payment_amount);
end;
$$;

create or replace function public.save_examination_scores(target_examination_id text, target_subject_id text, student_scores jsonb)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  examination_row public.school_records%rowtype;
  score_entry record;
  existing_score public.school_records%rowtype;
  next_payload jsonb;
  score_value numeric;
  saved_count integer := 0;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved' order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  select * into examination_row from public.school_records where school_id = school_key and collection = 'examinations' and record_id = target_examination_id;
  if not found then raise exception 'The selected examination does not exist.'; end if;
  if not (examination_row.payload -> 'classIds' ? target_subject_id) and not exists (
    select 1 from public.school_records c
    where c.school_id = school_key and c.collection = 'classes'
      and c.record_id = any(array(select jsonb_array_elements_text(examination_row.payload -> 'classIds')))
      and exists (
        select 1 from public.school_records s where s.school_id = school_key and s.collection = 'subjects'
          and s.record_id = target_subject_id and s.payload -> 'classIds' ? c.record_id
      )
  ) then raise exception 'The subject does not belong to a class sitting this examination.'; end if;
  if jsonb_typeof(student_scores) <> 'object' or jsonb_object_length(student_scores) > 1000 then raise exception 'Scores must contain no more than 1,000 students.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(school_key::text || ':exam:' || target_examination_id || ':' || target_subject_id, 0));
  for score_entry in select key as student_id, value as score_json from jsonb_each(student_scores) loop
    if score_entry.score_json <> 'null'::jsonb then
      begin score_value := (score_entry.score_json #>> '{}')::numeric;
      exception when others then raise exception 'A score is not numeric.'; end;
      if score_value < 0 or score_value > 100 then raise exception 'Exam scores must be between 0 and 100.'; end if;
    else score_value := null; end if;
    if not exists (
      select 1 from public.school_records s
      where s.school_id = school_key and s.collection = 'students' and s.record_id = score_entry.student_id
        and s.payload ->> 'status' = 'active'
        and s.payload ->> 'classId' = any(array(select jsonb_array_elements_text(examination_row.payload -> 'classIds')))
    ) then raise exception 'A submitted student is not active in a class sitting this examination.'; end if;
    select * into existing_score from public.school_records r
    where r.school_id = school_key and r.collection = 'examScores'
      and r.payload ->> 'examinationId' = target_examination_id
      and r.payload ->> 'subjectId' = target_subject_id
      and r.payload ->> 'studentId' = score_entry.student_id limit 1;
    if found then
      next_payload := jsonb_set(existing_score.payload, '{score}', coalesce(to_jsonb(score_value), 'null'::jsonb), true);
      update public.school_records set payload = next_payload, updated_at = now()
      where school_id = school_key and collection = 'examScores' and record_id = existing_score.record_id;
    else
      next_payload := jsonb_build_object('id', gen_random_uuid()::text, 'examinationId', target_examination_id, 'subjectId', target_subject_id, 'studentId', score_entry.student_id, 'score', score_value, 'createdAt', now(), 'updatedAt', now());
      insert into public.school_records (school_id, collection, record_id, payload) values (school_key, 'examScores', next_payload ->> 'id', next_payload);
    end if;
    saved_count := saved_count + 1;
  end loop;
  return saved_count;
end;
$$;

create or replace function public.set_default_grading_system(target_system_id text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare school_key uuid;
begin
  select m.school_id into school_key from public.school_memberships m
  join public.schools s on s.id = m.school_id
  where m.user_id = (select auth.uid()) and s.status = 'approved' order by m.created_at limit 1;
  if school_key is null then raise exception 'An approved school membership is required.'; end if;
  if not exists(select 1 from public.school_records where school_id = school_key and collection = 'gradingSystems' and record_id = target_system_id) then raise exception 'The grading system does not exist.'; end if;
  update public.school_records set payload = jsonb_set(payload, '{isDefault}', to_jsonb(record_id = target_system_id), true), updated_at = now()
  where school_id = school_key and collection = 'gradingSystems';
end;
$$;

create or replace function public.create_timetable_entry(entry_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  entry_id text := gen_random_uuid()::text;
  conflict_row record;
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
  if not exists(select 1 from public.school_records where school_id = school_key and collection = 'classes' and record_id = entry_payload ->> 'classId') then raise exception 'The selected class does not exist.'; end if;
  if not exists(select 1 from public.school_records where school_id = school_key and collection = 'subjects' and record_id = entry_payload ->> 'subjectId') then raise exception 'The selected subject does not exist.'; end if;
  if nullif(entry_payload ->> 'teacherId', '') is not null and not exists(select 1 from public.school_records where school_id = school_key and collection = 'teachers' and record_id = entry_payload ->> 'teacherId' and payload ->> 'isActive' = 'true') then raise exception 'The selected teacher is not active.'; end if;

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
      or (nullif(entry_payload ->> 'teacherId', '') is not null and t.payload ->> 'teacherId' = entry_payload ->> 'teacherId')
      or (normalized_room is not null and lower(trim(coalesce(t.payload ->> 'room', ''))) = normalized_room)
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

-- A school signup creates a pending school and its owner membership atomically.
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
     or coalesce(metadata ->> 'plan_modules', '') not in ('single', 'both') then
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

create or replace function public.log_school_status_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      new.approved_at := now();
    elsif old.status = 'approved' then
      new.approved_at := null;
    end if;
    insert into public.school_history (school_id, actor_user_id, action, note)
    values (new.id, (select auth.uid()), 'Status changed to ' || new.status, new.status_note);
  elsif new.plan_id is distinct from old.plan_id or new.plan_modules is distinct from old.plan_modules then
    insert into public.school_history (school_id, actor_user_id, action)
    values (new.id, (select auth.uid()), 'Package changed to ' || new.plan_name || ' (' || new.plan_modules || ')');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger schools_status_history
before update of status, plan_id, plan_modules on public.schools
for each row execute function public.log_school_status_change();

create trigger on_auth_user_created_school
after insert on auth.users
for each row execute function public.create_school_for_auth_user();

create or replace function public.log_school_record_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  school_key uuid;
  collection_name text;
  changed_record_id text;
begin
  if tg_op = 'DELETE' then
    school_key := old.school_id;
    collection_name := old.collection;
    changed_record_id := old.record_id;
  else
    school_key := new.school_id;
    collection_name := new.collection;
    changed_record_id := new.record_id;
  end if;
  insert into public.school_audit_logs (school_id, actor_user_id, collection, record_id, action)
  values (
    school_key,
    (select auth.uid()),
    collection_name,
    changed_record_id,
    lower(tg_op)
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger school_records_audit
after insert or update or delete on public.school_records
for each row execute function public.log_school_record_change();

create trigger school_records_assign_tenant
before insert or update on public.school_records
for each row execute function public.scope_school_record();

alter table public.schools enable row level security;
alter table public.school_memberships enable row level security;
alter table public.school_history enable row level security;
alter table public.platform_admins enable row level security;
alter table public.school_records enable row level security;
alter table public.school_audit_logs enable row level security;
alter table public.platform_invoices enable row level security;
alter table public.platform_invoice_payments enable row level security;
alter table public.platform_settings enable row level security;

create policy schools_read_own_or_admin on public.schools
for select to authenticated
using (id in (select public.current_school_ids()) or public.is_platform_admin());
create policy schools_admin_update on public.schools
for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy memberships_read_own_or_admin on public.school_memberships
for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_admin());

create policy school_history_read_own_or_admin on public.school_history
for select to authenticated
using (school_id in (select public.current_school_ids()) or public.is_platform_admin());

create policy platform_admins_read_self on public.platform_admins
for select to authenticated
using (user_id = (select auth.uid()));

create policy school_records_select_approved on public.school_records
for select to authenticated
using (public.has_approved_school_access(school_id));
create policy school_records_insert_approved on public.school_records
for insert to authenticated
with check (public.has_approved_school_access(school_id));
create policy school_records_update_approved on public.school_records
for update to authenticated
using (public.has_approved_school_access(school_id))
with check (public.has_approved_school_access(school_id));
create policy school_records_delete_approved on public.school_records
for delete to authenticated
using (public.has_approved_school_access(school_id));

create policy school_audit_read_own on public.school_audit_logs
for select to authenticated
using (public.has_approved_school_access(school_id));

create policy platform_invoices_read_school_or_admin on public.platform_invoices
for select to authenticated
using (school_id in (select public.current_school_ids()) or public.is_platform_admin());
create policy platform_invoices_admin_insert on public.platform_invoices
for insert to authenticated
with check (public.is_platform_admin());
create policy platform_invoices_admin_update on public.platform_invoices
for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());
create policy platform_invoices_admin_delete on public.platform_invoices
for delete to authenticated
using (public.is_platform_admin());

create policy invoice_payments_read_school_or_admin on public.platform_invoice_payments
for select to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.platform_invoices i
    where i.id = invoice_id and i.school_id in (select public.current_school_ids())
  )
);
create policy invoice_payments_admin_insert on public.platform_invoice_payments
for insert to authenticated
with check (public.is_platform_admin());
create policy invoice_payments_admin_update on public.platform_invoice_payments
for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());
create policy invoice_payments_admin_delete on public.platform_invoice_payments
for delete to authenticated
using (public.is_platform_admin());

create policy platform_settings_read_admin on public.platform_settings
for select to authenticated
using (public.is_platform_admin());
create policy platform_settings_read_school_payment_info on public.platform_settings
for select to authenticated
using (
  key = 'main'
  and exists (
    select 1 from public.school_memberships
    where user_id = (select auth.uid())
  )
);
create policy platform_settings_insert_admin on public.platform_settings
for insert to authenticated
with check (public.is_platform_admin());
create policy platform_settings_update_admin on public.platform_settings
for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());
create policy platform_settings_delete_admin on public.platform_settings
for delete to authenticated
using (public.is_platform_admin());

grant usage on schema public to authenticated;
grant select on public.schools, public.school_memberships, public.platform_admins,
  public.school_history, public.school_audit_logs, public.platform_invoices, public.platform_invoice_payments,
  public.platform_settings to authenticated;
grant update on public.schools to authenticated;
grant select, insert, update, delete on public.school_records to authenticated;
grant insert, update, delete on public.platform_invoices,
  public.platform_invoice_payments, public.platform_settings to authenticated;
grant usage, select on sequence public.school_audit_logs_id_seq to authenticated;

revoke all on function public.create_school_for_auth_user() from public, anon, authenticated;
revoke all on function public.log_school_status_change() from public, anon, authenticated;
revoke all on function public.log_school_record_change() from public, anon, authenticated;
revoke all on function public.scope_school_record() from public, anon, authenticated;
revoke all on function public.complete_school_setup(jsonb) from public, anon;
revoke all on function public.set_current_academic_record(text, text) from public, anon;
revoke all on function public.remove_class_and_streams(text) from public, anon;
revoke all on function public.save_class_attendance(text, text, date, jsonb, text) from public, anon;
revoke all on function public.convert_admission_to_student(text, jsonb) from public, anon;
revoke all on function public.save_assessment_scores(text, jsonb) from public, anon;
revoke all on function public.record_inventory_movement(text, text, integer, text) from public, anon;
revoke all on function public.remove_inventory_item(text) from public, anon;
revoke all on function public.borrow_library_book(text, text, text, text, date) from public, anon;
revoke all on function public.return_library_book(text) from public, anon;
revoke all on function public.remove_library_book(text) from public, anon;
revoke all on function public.assign_student_transport(text, text, text) from public, anon;
revoke all on function public.unassign_student_transport(text) from public, anon;
revoke all on function public.remove_transport_stop(text, text) from public, anon;
revoke all on function public.remove_transport_route(text) from public, anon;
revoke all on function public.record_student_invoice_payment(text, text, numeric, text, text, date) from public, anon;
revoke all on function public.save_examination_scores(text, text, jsonb) from public, anon;
revoke all on function public.set_default_grading_system(text) from public, anon;
revoke all on function public.create_timetable_entry(jsonb) from public, anon;
revoke all on function public.assign_platform_invoice_number() from public, anon, authenticated;
revoke all on function public.validate_platform_invoice_payment() from public, anon, authenticated;
revoke all on function public.log_platform_invoice_change() from public, anon, authenticated;
revoke all on function public.log_platform_invoice_payment() from public, anon, authenticated;
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.current_school_ids() from public, anon;
revoke all on function public.has_approved_school_access(uuid) from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.current_school_ids() to authenticated;
grant execute on function public.has_approved_school_access(uuid) to authenticated;
grant execute on function public.complete_school_setup(jsonb) to authenticated;
grant execute on function public.set_current_academic_record(text, text) to authenticated;
grant execute on function public.remove_class_and_streams(text) to authenticated;
grant execute on function public.save_class_attendance(text, text, date, jsonb, text) to authenticated;
grant execute on function public.convert_admission_to_student(text, jsonb) to authenticated;
grant execute on function public.save_assessment_scores(text, jsonb) to authenticated;
grant execute on function public.record_inventory_movement(text, text, integer, text) to authenticated;
grant execute on function public.remove_inventory_item(text) to authenticated;
grant execute on function public.borrow_library_book(text, text, text, text, date) to authenticated;
grant execute on function public.return_library_book(text) to authenticated;
grant execute on function public.remove_library_book(text) to authenticated;
grant execute on function public.assign_student_transport(text, text, text) to authenticated;
grant execute on function public.unassign_student_transport(text) to authenticated;
grant execute on function public.remove_transport_stop(text, text) to authenticated;
grant execute on function public.remove_transport_route(text) to authenticated;
grant execute on function public.record_student_invoice_payment(text, text, numeric, text, text, date) to authenticated;
grant execute on function public.save_examination_scores(text, text, jsonb) to authenticated;
grant execute on function public.set_default_grading_system(text) to authenticated;
grant execute on function public.create_timetable_entry(jsonb) to authenticated;

insert into storage.buckets (id, name, public)
values ('school-documents', 'school-documents', false)
on conflict (id) do nothing;

create policy school_documents_read_approved on storage.objects
for select to authenticated
using (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
);
create policy school_documents_insert_approved on storage.objects
for insert to authenticated
with check (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
);
create policy school_documents_update_approved on storage.objects
for update to authenticated
using (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
)
with check (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
);
create policy school_documents_delete_approved on storage.objects
for delete to authenticated
using (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
);