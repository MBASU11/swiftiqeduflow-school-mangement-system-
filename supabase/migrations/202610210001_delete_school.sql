create or replace function public.delete_school(target_school_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators can delete a school.';
  end if;

  if not exists (select 1 from public.schools where id = target_school_id) then
    raise exception 'School not found.';
  end if;

  insert into public.platform_audit_log (school_id, actor_user_id, action, reason)
  values (target_school_id, auth.uid(), 'School deleted', 'Deleted by platform administrator');

  delete from public.schools where id = target_school_id;
end;
$$;

revoke all on function public.delete_school(uuid) from public, anon;
grant execute on function public.delete_school(uuid) to authenticated;
