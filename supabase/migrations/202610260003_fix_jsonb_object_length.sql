create or replace function public.jsonb_object_length(value jsonb)
returns integer
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(value) = 'object'
      then (select count(*)::integer from pg_catalog.jsonb_object_keys(value))
    else 0
  end;
$$;

revoke all on function public.jsonb_object_length(jsonb) from public, anon, authenticated;

alter function public.save_class_attendance(text, text, date, jsonb, text)
  set search_path = pg_catalog, public;
alter function public.save_assessment_scores(text, jsonb)
  set search_path = pg_catalog, public;
alter function public.save_examination_scores(text, text, jsonb)
  set search_path = pg_catalog, public;
