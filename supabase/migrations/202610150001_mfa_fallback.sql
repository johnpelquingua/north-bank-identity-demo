-- Add a separate server-verified PingOne MFA fallback for high-risk demo transfers.
-- Run this immediately before deploying the matching bank-demo Edge Function.
drop function if exists public.make_demo_transfer(text,text,text,bigint,uuid,boolean);

create or replace function public.demo_transfer_needs_face(
  p_issuer text, p_sender_subject text, p_amount_cents bigint
)
returns boolean
language sql volatile security invoker
set search_path = ''
as $$
  select case
    when p_amount_cents > 2000000 then true
    when p_amount_cents < 2000000 then false
    else exists (
      select 1 from public.demo_transfers t
      join public.demo_accounts a on a.id = t.sender_id
      where a.issuer = p_issuer
        and a.subject = p_sender_subject
        and t.amount_cents >= 2000000
        and t.created_at >= clock_timestamp() - interval '10 minutes'
    )
  end;
$$;

create or replace function public.make_demo_transfer(
  p_issuer text, p_sender_subject text, p_recipient_account_number text,
  p_amount_cents bigint, p_request_id uuid, p_face_verified boolean, p_mfa_verified boolean
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_sender uuid;
  v_recipient uuid;
  v_balance bigint;
  v_existing public.demo_transfers%rowtype;
  v_transfer public.demo_transfers%rowtype;
begin
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_request_id is null then raise exception 'INVALID_REQUEST_ID'; end if;
  select a.id into v_sender from public.demo_accounts a
    where a.issuer = p_issuer and a.subject = p_sender_subject;
  select a.id into v_recipient from public.demo_accounts a
    where a.account_number = p_recipient_account_number and a.issuer = p_issuer;
  if v_sender is null then raise exception 'SENDER_NOT_FOUND'; end if;
  if v_recipient is null then raise exception 'RECIPIENT_NOT_FOUND'; end if;
  if v_sender = v_recipient then raise exception 'SAME_ACCOUNT'; end if;

  -- Serialize all outgoing transfers from this sender before checking the window.
  -- A sender can hold both account locks in a fixed order, as in the original RPC.
  if v_sender < v_recipient then
    perform 1 from public.demo_accounts where demo_accounts.id = v_sender for update;
    perform 1 from public.demo_accounts where demo_accounts.id = v_recipient for update;
  else
    perform 1 from public.demo_accounts where demo_accounts.id = v_recipient for update;
    perform 1 from public.demo_accounts where demo_accounts.id = v_sender for update;
  end if;

  select * into v_existing from public.demo_transfers t
    where t.sender_id = v_sender and t.request_id = p_request_id;
  if found then
    if v_existing.recipient_id <> v_recipient or v_existing.amount_cents <> p_amount_cents then
      raise exception 'REQUEST_ID_REUSED';
    end if;
    return jsonb_build_object('id', v_existing.id, 'created_at', v_existing.created_at, 'replayed', true);
  end if;

  if public.demo_transfer_needs_face(p_issuer, p_sender_subject, p_amount_cents)
     and p_face_verified is distinct from true
     and p_mfa_verified is distinct from true then
    raise exception 'RECOGNIZE_REQUIRED';
  end if;
  select a.balance_cents into v_balance from public.demo_accounts a where a.id = v_sender;
  if v_balance < p_amount_cents then raise exception 'INSUFFICIENT_FUNDS'; end if;
  update public.demo_accounts a set balance_cents = a.balance_cents - p_amount_cents where a.id = v_sender;
  update public.demo_accounts a set balance_cents = a.balance_cents + p_amount_cents where a.id = v_recipient;
  insert into public.demo_transfers (request_id, sender_id, recipient_id, amount_cents)
    values (p_request_id, v_sender, v_recipient, p_amount_cents)
    returning * into v_transfer;
  return jsonb_build_object('id', v_transfer.id, 'created_at', v_transfer.created_at, 'replayed', false);
end;
$$;

revoke execute on function public.demo_transfer_needs_face(text,text,bigint) from public, anon, authenticated;
revoke execute on function public.make_demo_transfer(text,text,text,bigint,uuid,boolean,boolean) from public, anon, authenticated;
grant execute on function public.demo_transfer_needs_face(text,text,bigint) to service_role;
grant execute on function public.make_demo_transfer(text,text,text,bigint,uuid,boolean,boolean) to service_role;

