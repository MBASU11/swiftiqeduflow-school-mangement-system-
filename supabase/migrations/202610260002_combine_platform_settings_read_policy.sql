drop policy if exists platform_settings_read_admin on public.platform_settings;
drop policy if exists platform_settings_read_school_payment_info on public.platform_settings;

create policy platform_settings_read_access on public.platform_settings
for select to authenticated
using (
  public.is_platform_admin()
  or (
    key = 'main'
    and exists (
      select 1 from public.school_memberships
      where user_id = (select auth.uid())
    )
  )
);
