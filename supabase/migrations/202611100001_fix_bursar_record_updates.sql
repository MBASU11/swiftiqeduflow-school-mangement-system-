-- Fix bursar confirmation and invoice refresh logic to target school_records by (school_id, collection, record_id)
-- instead of the non-existent id column.

create or replace function public.bursar_refresh_invoice(school_key uuid, target_invoice text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  inv public.school_records%rowtype;
  total numeric;
  paid numeric;
  new_status text;
begin
  select * into inv from public.school_records
    where school_id = school_key and collection = 'invoices' and record_id = target_invoice
    for update;

  if not found or inv.payload ->> 'status' = 'void' then
    return;
  end if;

  total := coalesce((inv.payload ->> 'totalAmount')::numeric, 0);
  select coalesce(sum((payload ->> 'amount')::numeric), 0) into paid from public.school_records
    where school_id = school_key and collection = 'payments'
      and payload ->> 'invoiceId' = target_invoice
      and coalesce(payload ->> 'status', 'confirmed') = 'confirmed';

  new_status := case
    when total > 0 and paid >= total then 'paid'
    when paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.school_records
  set payload = jsonb_set(inv.payload, '{status}', to_jsonb(new_status), true), updated_at = now()
  where school_id = school_key and collection = 'invoices' and record_id = inv.record_id;
end;
$$;

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
  if nullif(trim(coalesce(confirm_note, '')), '') is null then
    raise exception 'Say how you confirmed the payment.';
  end if;

  select * into pay from public.school_records
    where school_id = sid and collection = 'payments' and record_id = payment_id
    for update;

  if not found then
    raise exception 'Payment not found.';
  end if;

  if pay.payload ->> 'status' is distinct from 'pending_verification' then
    raise exception 'Only a payment that is pending verification can be confirmed.';
  end if;

  if pay.payload ->> 'invoiceId' is not null then
    select * into inv from public.school_records
      where school_id = sid and collection = 'invoices' and record_id = pay.payload ->> 'invoiceId'
      for update;

    select coalesce(sum((payload ->> 'amount')::numeric), 0) into confirmed from public.school_records
      where school_id = sid and collection = 'payments'
        and payload ->> 'invoiceId' = pay.payload ->> 'invoiceId'
        and coalesce(payload ->> 'status', 'confirmed') = 'confirmed';

    if (pay.payload ->> 'amount')::numeric > coalesce((inv.payload ->> 'totalAmount')::numeric, 0) - confirmed then
      raise exception 'Confirming this would exceed the invoice balance of %. Reject it or refund the difference.', coalesce((inv.payload ->> 'totalAmount')::numeric, 0) - confirmed;
    end if;
  end if;

  update public.school_records
  set payload = payload || jsonb_build_object('status', 'confirmed', 'confirmedAt', now(), 'confirmNote', confirm_note), updated_at = now()
  where school_id = sid and collection = 'payments' and record_id = pay.record_id
  returning * into pay;

  perform public.bursar_issue_receipt(sid, pay);
  if pay.payload ->> 'invoiceId' is not null then
    perform public.bursar_refresh_invoice(sid, pay.payload ->> 'invoiceId');
  end if;

  return pay.payload;
end;
$$;

grant execute on function public.bursar_refresh_invoice(uuid, text) to authenticated;
grant execute on function public.bursar_confirm_payment(text, text) to authenticated;
