-- Fictional balances only. Never use this schema to represent real funds.
create sequence if not exists public.demo_account_numbers start with 7000000001;

create table if not exists public.demo_accounts (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  subject text not null,
  account_number text not null unique default nextval('public.demo_account_numbers')::text,
  display_name text not null,
  balance_cents bigint not null default 10000000 check (balance_cents >= 0),
  created_at timestamptz not null default now(),
  unique (issuer, subject)
);

create table if not exists public.demo_transfers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  sender_id uuid not null references public.demo_accounts(id),
  recipient_id uuid not null references public.demo_accounts(id),
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id),
  unique (sender_id, request_id)
);

create index if not exists demo_transfers_sender_recent on public.demo_transfers (sender_id, created_at desc);
create index if not exists demo_transfers_recipient_recent on public.demo_transfers (recipient_id, created_at desc);

alter table public.demo_accounts enable row level security;
alter table public.demo_transfers enable row level security;
revoke all on public.demo_accounts, public.demo_transfers from public, anon, authenticated;
revoke all on sequence public.demo_account_numbers from public, anon, authenticated;
grant select, insert, update on public.demo_accounts to service_role;
grant select, insert on public.demo_transfers to service_role;
grant usage on sequence public.demo_account_numbers to service_role;

create or replace function public.ensure_demo_account(p_issuer text, p_subject text, p_display_name text)
returns table (id uuid, account_number text, display_name text, balance_cents bigint)
language sql
security invoker
set search_path = ''
as $$
  insert into public.demo_accounts (issuer, subject, display_name)
  values (p_issuer, p_subject, left(coalesce(nullif(trim(p_display_name), ''), 'Customer'), 100))
  on conflict (issuer, subject) do update
    set display_name = excluded.display_name
  returning demo_accounts.id, demo_accounts.account_number,
            demo_accounts.display_name, demo_accounts.balance_cents;
$$;

create or replace function public.make_demo_transfer(
  p_issuer text, p_sender_subject text, p_recipient_account_number text,
  p_amount_cents bigint, p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
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
  if p_request_id is null then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  select a.id into v_sender from public.demo_accounts a
    where a.issuer = p_issuer and a.subject = p_sender_subject;
  select a.id into v_recipient from public.demo_accounts a
    where a.account_number = p_recipient_account_number and a.issuer = p_issuer;
  if v_sender is null then raise exception 'SENDER_NOT_FOUND'; end if;
  if v_recipient is null then raise exception 'RECIPIENT_NOT_FOUND'; end if;
  if v_sender = v_recipient then raise exception 'SAME_ACCOUNT'; end if;

  -- Lock both accounts in the same order for every transfer.
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

create or replace function public.demo_account_history(p_account_id uuid, p_limit integer default 100)
returns table (
  id uuid, direction text, counterparty_name text, counterparty_account_number text,
  amount_cents bigint, created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id,
         case when t.sender_id = p_account_id then 'OUTGOING' else 'INCOMING' end,
         a.display_name, a.account_number, t.amount_cents, t.created_at
  from public.demo_transfers t
  join public.demo_accounts a
    on a.id = case when t.sender_id = p_account_id then t.recipient_id else t.sender_id end
  where t.sender_id = p_account_id or t.recipient_id = p_account_id
  order by t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

revoke execute on function public.ensure_demo_account(text,text,text) from public, anon, authenticated;
revoke execute on function public.make_demo_transfer(text,text,text,bigint,uuid) from public, anon, authenticated;
revoke execute on function public.demo_account_history(uuid,integer) from public, anon, authenticated;
grant execute on function public.ensure_demo_account(text,text,text) to service_role;
grant execute on function public.make_demo_transfer(text,text,text,bigint,uuid) to service_role;
grant execute on function public.demo_account_history(uuid,integer) to service_role;

