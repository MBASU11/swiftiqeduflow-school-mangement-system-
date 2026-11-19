-- Security hardening (found in the Phase One audit).
-- PostgreSQL lets PUBLIC (which includes the anonymous web role) run any function unless EXECUTE is
-- revoked. The subscriptions, Bursar and Teacher migrations granted EXECUTE to signed-in users but
-- never revoked it from PUBLIC, and left several internal helpers callable from the API. Worst case:
-- any signed-in user could call log_platform_event() and forge audit-log entries for any school, or
-- call count_active_students()/school_limits() with another school's id.
--
-- Apply after 202610190001_new_packages.sql, in STAGING first. It only changes who may run functions;
-- it deletes and rewrites no data. Rollback: re-grant EXECUTE on the functions listed below.

-- ---- 1. Internal helpers: not callable through the API by anyone. They are only used inside other
--         SECURITY DEFINER functions and triggers, which keep running as their owner.
revoke all on function public.log_platform_event(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.school_limits(uuid) from public, anon, authenticated;
revoke all on function public.count_active_students(uuid, text) from public, anon, authenticated;
revoke all on function public.assert_enrolment_room(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.capacity_excluded_statuses() from public, anon, authenticated;
revoke all on function public.require_platform_admin() from public, anon, authenticated;
revoke all on function public.my_school_id(boolean) from public, anon, authenticated;
revoke all on function public.enforce_student_capacity() from public, anon, authenticated;

-- ---- 2. Client-facing functions: signed-in users only (never the anonymous role).
--         Each one still checks the caller's school and role inside the function.
do $$
declare
  fn text;
  client_fns text[] := array[
    'public.admin_set_subscription(uuid, jsonb, text)',
    'public.bursar_confirm_payment(text, text)',
    'public.bursar_submit_payment(text, text, numeric, text, text, date, text)',
    'public.check_enrolment(integer)',
    'public.get_my_subscription()',
    'public.list_platform_audit(integer)',
    'public.list_school_subscriptions()',
    'public.list_subscription_payments(uuid)',
    'public.next_document_number(text)',
    'public.request_subscription(jsonb, jsonb)',
    'public.save_platform_catalogue(jsonb, text)',
    'public.submit_subscription_payment(text, text, numeric, text)',
    'public.verify_subscription_payment(uuid, boolean, text, date)',
    'public.can_use_welfare(uuid)'   -- used by a row-level-security policy, so signed-in users need it
  ];
begin
  foreach fn in array client_fns loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ---- 2b. Pure lookup used inside row-level-security policies: signed-in users only.
revoke all on function public.role_collection_access(text, text) from public, anon;
grant execute on function public.role_collection_access(text, text) to authenticated;

-- ---- 3. Intentionally public: the landing page reads prices before anyone signs in, and report-card
--         share links work without an account. Both are read-only and return no school-private data.
grant execute on function public.get_platform_catalogue() to anon, authenticated;
