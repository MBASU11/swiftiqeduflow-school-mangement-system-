create or replace function public.assign_platform_invoice_number()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_invoice_year integer := extract(year from coalesce(new.created_at, now()))::integer;
  sequence_number integer;
begin
  if nullif(trim(new.number), '') is null then
    insert into public.platform_invoice_counters (invoice_year, last_number)
    values (v_invoice_year, 1)
    on conflict (invoice_year) do update
      set last_number = public.platform_invoice_counters.last_number + 1
    returning last_number into sequence_number;
    new.number := 'INV-' || v_invoice_year || '-' || lpad(sequence_number::text, 4, '0');
  end if;
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  return new;
end;
$$;
