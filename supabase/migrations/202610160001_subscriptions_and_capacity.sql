-- Subscriptions, the Super Admin package catalogue, payment verification, platform audit log,
-- and STRICT student-population control enforced inside the database.
-- Apply after 202610150001_parent_portal.sql. Review in a development project first.

-- ---------------------------------------------------------------- tables
create table if not exists public.platform_catalogue (
  id integer primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- One subscription per school. `data` mirrors js/services/packageService.js:
-- { packageId, billing, addons[], status, startDate, expiryDate, trialUntil,
--   limits{paidLimit,overflow,max,exceptionUntil}, overrides{modules,features}, quote }
create table if not exists public.school_subscriptions (
  school_id uuid primary key references public.schools(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  method text not null,
  reference text not null,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  status text not null default 'awaiting_verification' check (status in ('awaiting_verification', 'verified', 'rejected')),
  quote jsonb,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  verify_note text
);
create index if not exists subscription_payments_school_idx on public.subscription_payments (school_id, submitted_at desc);

create table if not exists public.platform_audit_log (
  id bigint generated always as identity primary key,
  school_id uuid references public.schools(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  reason text,
  detail jsonb,
  happened_at timestamptz not null default now()
);
create index if not exists platform_audit_log_idx on public.platform_audit_log (happened_at desc);

alter table public.platform_catalogue enable row level security;
alter table public.school_subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.platform_audit_log enable row level security;

-- Everything is read and written through the functions below; no direct table access.
revoke all on public.platform_catalogue, public.school_subscriptions, public.subscription_payments, public.platform_audit_log from anon, authenticated;

-- ---------------------------------------------------------------- capacity
-- Statuses that do NOT count towards the active population (mirrors the catalogue's
-- capacity.excludeStatuses; falls back to the standard list).
create or replace function public.capacity_excluded_statuses()
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(data #> '{capacity,excludeStatuses}')) from public.platform_catalogue where id = 1 and data #> '{capacity,excludeStatuses}' is not null),
    array['archived', 'graduated', 'withdrawn', 'transferred']
  );
$$;

-- Unique actively-enrolled students (same admission number never counts twice).
create or replace function public.count_active_students(target_school uuid, ignore_record text default null)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(distinct coalesce(nullif(lower(trim(payload ->> 'admissionNumber')), ''), 'id:' || record_id))::integer
  from public.school_records
  where school_id = target_school
    and collection = 'students'
    and (ignore_record is null or record_id <> ignore_record)
    and not (coalesce(payload ->> 'status', 'active') = any (public.capacity_excluded_statuses()));
$$;

-- { unlimited, paidLimit, overflow, max, exceptionUntil }. No subscription row = legacy school = unlimited.
create or replace function public.school_limits(target_school uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  sub jsonb;
  cat jsonb;
  pkg jsonb;
  lim jsonb;
  paid integer;
  extra integer;
  max_allowed integer;
  default_overflow integer;
begin
  select data into sub from public.school_subscriptions where school_id = target_school;
  if sub is null or sub = '{}'::jsonb then
    return jsonb_build_object('unlimited', true);
  end if;
  select data into cat from public.platform_catalogue where id = 1;
  default_overflow := coalesce((cat ->> 'defaultOverflow')::integer, 20);
  select p into pkg from jsonb_array_elements(coalesce(cat -> 'packages', '[]'::jsonb)) p where p ->> 'id' = sub ->> 'packageId' limit 1;
  lim := coalesce(sub -> 'limits', '{}'::jsonb);
  paid := coalesce((lim ->> 'paidLimit')::integer, (pkg ->> 'paidLimit')::integer);
  extra := coalesce((lim ->> 'overflow')::integer, (pkg ->> 'overflow')::integer, default_overflow);
  if paid is not null then max_allowed := paid + extra; end if;
  if (lim ->> 'max') is not null
     and (nullif(lim ->> 'exceptionUntil', '') is null or (lim ->> 'exceptionUntil')::date >= current_date) then
    max_allowed := (lim ->> 'max')::integer;
  end if;
  if max_allowed is null then
    return jsonb_build_object('unlimited', true);
  end if;
  return jsonb_build_object('unlimited', false, 'paidLimit', paid, 'overflow', extra, 'max', max_allowed,
                            'exceptionUntil', case when (lim ->> 'max') is not null then lim ->> 'exceptionUntil' end);
end;
$$;

-- Raises the standard message when `adding` more active students would pass the maximum.
create or replace function public.assert_enrolment_room(target_school uuid, adding integer, ignore_record text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  lim jsonb;
  active integer;
begin
  lim := public.school_limits(target_school);
  if coalesce((lim ->> 'unlimited')::boolean, false) then return; end if;
  -- Serialise concurrent enrolments for the same school so two requests can't both take the last seat.
  perform pg_advisory_xact_lock(hashtextextended(target_school::text, 0));
  active := public.count_active_students(target_school, ignore_record);
  if active + adding > (lim ->> 'max')::integer then
    raise exception 'Your school has reached its maximum permitted population of % students. Please upgrade your subscription or contact SwiftIQ EduFlow support to request additional capacity.', lim ->> 'max'
      using errcode = 'P0402';
  end if;
end;
$$;

-- Fires for every way a student can be created or re-activated: forms, admission
-- conversion, bulk import, transfers. Withdrawing/graduating/archiving is never blocked.
create or replace function public.enforce_student_capacity()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  excluded text[] := public.capacity_excluded_statuses();
  new_counts boolean;
  old_counts boolean := false;
  adm text;
begin
  if new.collection <> 'students' then return new; end if;
  new_counts := not (coalesce(new.payload ->> 'status', 'active') = any (excluded));
  if tg_op = 'UPDATE' then
    old_counts := not (coalesce(old.payload ->> 'status', 'active') = any (excluded));
  end if;
  if new_counts and not old_counts then
    adm := nullif(lower(trim(new.payload ->> 'admissionNumber')), '');
    -- A record that merely repeats an already-counted admission number adds nobody.
    if adm is null or not exists (
      select 1 from public.school_records r
      where r.school_id = new.school_id and r.collection = 'students' and r.record_id <> new.record_id
        and lower(trim(r.payload ->> 'admissionNumber')) = adm
        and not (coalesce(r.payload ->> 'status', 'active') = any (excluded))
    ) then
      perform public.assert_enrolment_room(new.school_id, 1, new.record_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists school_records_capacity on public.school_records;
-- Named so it runs after school_records_assign_tenant (alphabetical order) has set school_id.
create trigger school_records_capacity
  before insert or update on public.school_records
  for each row when (new.collection = 'students')
  execute function public.enforce_student_capacity();

-- Lets the app refuse a WHOLE bulk import up front instead of failing half-way.
create or replace function public.check_enrolment(adding integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  sid uuid;
  lim jsonb;
  active integer;
begin
  select m.school_id into sid from public.school_memberships m
    join public.schools s on s.id = m.school_id
    where m.user_id = (select auth.uid()) and s.status = 'approved' order by m.created_at limit 1;
  if sid is null then raise exception 'An approved school membership is required.'; end if;
  lim := public.school_limits(sid);
  active := public.count_active_students(sid);
  return jsonb_build_object('active', active, 'limits', lim,
    'allowed', coalesce((lim ->> 'unlimited')::boolean, false) or active + greatest(adding, 0) <= (lim ->> 'max')::integer);
end;
$$;
grant execute on function public.check_enrolment(integer) to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public.require_platform_admin()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform administrator can do this.'; end if;
end;
$$;

create or replace function public.log_platform_event(target_school uuid, action_text text, reason_text text, detail_json jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.platform_audit_log (school_id, actor_user_id, action, reason, detail)
  values (target_school, (select auth.uid()), action_text, nullif(trim(coalesce(reason_text, '')), ''), detail_json);
$$;

create or replace function public.my_school_id(require_admin boolean default false)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  sid uuid;
  r text;
begin
  select m.school_id, m.role into sid, r from public.school_memberships m
    join public.schools s on s.id = m.school_id
    where m.user_id = (select auth.uid()) and s.status = 'approved' order by m.created_at limit 1;
  if sid is null then raise exception 'An approved school membership is required.'; end if;
  if require_admin and r <> 'school_admin' then raise exception 'Only the school administrator can do this.'; end if;
  return sid;
end;
$$;

-- ---------------------------------------------------------------- catalogue
create or replace function public.get_platform_catalogue()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when data = '{}'::jsonb then null else data end from public.platform_catalogue where id = 1;
$$;
grant execute on function public.get_platform_catalogue() to anon, authenticated;

create or replace function public.save_platform_catalogue(new_catalogue jsonb, reason_text text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  if jsonb_typeof(new_catalogue) <> 'object' or jsonb_typeof(new_catalogue -> 'packages') <> 'array' then
    raise exception 'The catalogue must be an object with a list of packages.';
  end if;
  insert into public.platform_catalogue (id, data, updated_by) values (1, new_catalogue, (select auth.uid()))
  on conflict (id) do update set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;
  perform public.log_platform_event(null, 'Catalogue updated', reason_text, null);
end;
$$;
grant execute on function public.save_platform_catalogue(jsonb, text) to authenticated;

-- ---------------------------------------------------------------- subscriptions
create or replace function public.get_my_subscription()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  sid uuid := public.my_school_id(false);
  sub jsonb;
begin
  select data into sub from public.school_subscriptions where school_id = sid;
  return jsonb_build_object('schoolId', sid, 'subscription', case when sub = '{}'::jsonb then null else sub end,
                            'activeStudents', public.count_active_students(sid));
end;
$$;
grant execute on function public.get_my_subscription() to authenticated;

create or replace function public.list_school_subscriptions()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'schoolId', s.id, 'schoolName', s.name, 'status', s.status, 'declaredStudents', s.student_count,
      'activeStudents', public.count_active_students(s.id),
      'subscription', nullif(ss.data, '{}'::jsonb),
      'pendingPayments', (select count(*) from public.subscription_payments p where p.school_id = s.id and p.status = 'awaiting_verification')
    ) order by s.name)
    from public.schools s left join public.school_subscriptions ss on ss.school_id = s.id
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.list_school_subscriptions() to authenticated;

-- Super Admin sets any part of a school's subscription (package, billing, overrides, limits, trial, suspension).
create or replace function public.admin_set_subscription(target_school uuid, patch jsonb, reason_text text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  before_data jsonb;
  after_data jsonb;
begin
  perform public.require_platform_admin();
  if nullif(trim(coalesce(reason_text, '')), '') is null then raise exception 'Record a reason for this change.'; end if;
  select data into before_data from public.school_subscriptions where school_id = target_school;
  after_data := coalesce(before_data, '{}'::jsonb) || coalesce(patch, '{}'::jsonb);
  insert into public.school_subscriptions (school_id, data) values (target_school, after_data)
  on conflict (school_id) do update set data = excluded.data, updated_at = now();
  perform public.log_platform_event(target_school, 'Subscription changed', reason_text,
    jsonb_build_object('before', before_data, 'after', after_data));
  return after_data;
end;
$$;
grant execute on function public.admin_set_subscription(uuid, jsonb, text) to authenticated;

-- A school administrator asks for a package. Nothing becomes active from this call.
create or replace function public.request_subscription(selection jsonb, quote_json jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  sid uuid := public.my_school_id(true);
  current_data jsonb;
  merged jsonb;
begin
  select data into current_data from public.school_subscriptions where school_id = sid;
  merged := coalesce(current_data, '{}'::jsonb)
    || jsonb_build_object('requested', jsonb_build_object('packageId', selection ->> 'packageId', 'billing', selection ->> 'billing',
         'addons', coalesce(selection -> 'addons', '[]'::jsonb), 'charges', coalesce(selection -> 'charges', '[]'::jsonb),
         'quote', quote_json, 'requestedAt', now()));
  if coalesce(current_data ->> 'status', '') = '' then
    merged := merged || jsonb_build_object('status', 'requested', 'packageId', selection ->> 'packageId',
      'billing', selection ->> 'billing', 'addons', coalesce(selection -> 'addons', '[]'::jsonb));
  end if;
  insert into public.school_subscriptions (school_id, data) values (sid, merged)
  on conflict (school_id) do update set data = excluded.data, updated_at = now();
  perform public.log_platform_event(sid, 'Subscription requested', null, selection);
  return merged;
end;
$$;
grant execute on function public.request_subscription(jsonb, jsonb) to authenticated;

-- Records what the school says it paid. This NEVER activates anything: a person on the
-- platform team must verify it (verify_subscription_payment) first.
create or replace function public.submit_subscription_payment(pay_method text, pay_reference text, pay_amount numeric, pay_note text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  sid uuid := public.my_school_id(true);
  req jsonb;
  new_id uuid;
begin
  if nullif(trim(coalesce(pay_reference, '')), '') is null then raise exception 'Enter the payment reference.'; end if;
  if exists (select 1 from public.subscription_payments where lower(reference) = lower(trim(pay_reference)) and status <> 'rejected') then
    raise exception 'This payment reference has already been submitted.';
  end if;
  select data -> 'requested' into req from public.school_subscriptions where school_id = sid;
  if req is null then raise exception 'Choose a package and submit a subscription request first.'; end if;
  insert into public.subscription_payments (school_id, method, reference, amount, note, quote, submitted_by)
  values (sid, pay_method, trim(pay_reference), pay_amount, pay_note, req -> 'quote', (select auth.uid()))
  returning id into new_id;
  perform public.log_platform_event(sid, 'Payment submitted for verification', null,
    jsonb_build_object('reference', trim(pay_reference), 'amount', pay_amount, 'method', pay_method));
  return new_id;
end;
$$;
grant execute on function public.submit_subscription_payment(text, text, numeric, text) to authenticated;

create or replace function public.list_subscription_payments(target_school uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  if public.is_platform_admin() then
    sid := target_school;
  else
    sid := public.my_school_id(false);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'schoolId', p.school_id, 'schoolName', s.name, 'method', p.method, 'reference', p.reference,
      'amount', p.amount, 'status', p.status, 'note', p.note, 'quote', p.quote, 'submittedAt', p.submitted_at,
      'verifiedAt', p.verified_at, 'verifyNote', p.verify_note) order by p.submitted_at desc)
    from public.subscription_payments p join public.schools s on s.id = p.school_id
    where sid is null or p.school_id = sid
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.list_subscription_payments(uuid) to authenticated;

-- The ONLY way a requested subscription becomes active. Platform administrator only.
create or replace function public.verify_subscription_payment(payment_id uuid, approve boolean, verify_text text, start_on date default current_date)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  pay public.subscription_payments%rowtype;
  data_now jsonb;
  req jsonb;
  billing_key text;
  months integer;
  cat jsonb;
  expiry date;
  activated jsonb;
begin
  perform public.require_platform_admin();
  select * into pay from public.subscription_payments where id = payment_id for update;
  if not found then raise exception 'Payment not found.'; end if;
  if pay.status <> 'awaiting_verification' then raise exception 'This payment has already been %.', pay.status; end if;
  if not approve then
    update public.subscription_payments set status = 'rejected', verified_by = (select auth.uid()), verified_at = now(), verify_note = verify_text where id = payment_id;
    perform public.log_platform_event(pay.school_id, 'Payment rejected', verify_text, jsonb_build_object('reference', pay.reference));
    return null;
  end if;
  select data into data_now from public.school_subscriptions where school_id = pay.school_id;
  req := data_now -> 'requested';
  if req is null then raise exception 'There is no subscription request to activate.'; end if;
  select data into cat from public.platform_catalogue where id = 1;
  billing_key := coalesce(req ->> 'billing', 'annual');
  months := case billing_key when 'monthly' then 1 when 'termly' then coalesce((cat ->> 'termMonths')::integer, 4) else 12 end;
  expiry := (start_on + (months || ' months')::interval)::date - 1;
  activated := (data_now - 'requested') || jsonb_build_object(
    'status', 'active', 'packageId', req ->> 'packageId', 'billing', billing_key, 'addons', coalesce(req -> 'addons', '[]'::jsonb),
    'startDate', start_on, 'expiryDate', expiry, 'quote', req -> 'quote', 'paymentReference', pay.reference, 'activatedAt', now());
  update public.subscription_payments set status = 'verified', verified_by = (select auth.uid()), verified_at = now(), verify_note = verify_text where id = payment_id;
  insert into public.school_subscriptions (school_id, data) values (pay.school_id, activated)
  on conflict (school_id) do update set data = excluded.data, updated_at = now();
  perform public.log_platform_event(pay.school_id, 'Payment verified and subscription activated', verify_text,
    jsonb_build_object('reference', pay.reference, 'startDate', start_on, 'expiryDate', expiry, 'packageId', req ->> 'packageId'));
  return activated;
end;
$$;
grant execute on function public.verify_subscription_payment(uuid, boolean, text, date) to authenticated;

create or replace function public.list_platform_audit(limit_rows integer default 200)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.happened_at, 'schoolId', a.school_id, 'schoolName', s.name,
      'action', a.action, 'reason', a.reason, 'detail', a.detail) order by a.happened_at desc)
    from (select * from public.platform_audit_log order by happened_at desc limit greatest(limit_rows, 1)) a
    left join public.schools s on s.id = a.school_id
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.list_platform_audit(integer) to authenticated;
