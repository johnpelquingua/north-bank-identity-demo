-- Stable customer-facing references for fictional North Bank transfers.
-- The sequence is global: incoming and outgoing views of one transfer share one reference.
create sequence if not exists public.demo_transfer_reference_numbers;

alter table public.demo_transfers
  add column if not exists reference_number bigint;

alter table public.demo_transfers
  alter column reference_number set default nextval('public.demo_transfer_reference_numbers'::regclass);

-- Keep a rerun from assigning a number that an earlier partial run already used.
select setval(
  'public.demo_transfer_reference_numbers'::regclass,
  greatest(coalesce((select max(reference_number) from public.demo_transfers), 0), 1),
  (select count(*) > 0 from public.demo_transfers where reference_number is not null)
);

update public.demo_transfers
set reference_number = nextval('public.demo_transfer_reference_numbers'::regclass)
where reference_number is null;

alter table public.demo_transfers
  alter column reference_number set not null;

create unique index if not exists demo_transfers_reference_number_key
  on public.demo_transfers (reference_number);

revoke all on sequence public.demo_transfer_reference_numbers from public, anon, authenticated;
grant usage on sequence public.demo_transfer_reference_numbers to service_role;

-- Additive RPC keeps the existing history function available during deployment.
create or replace function public.demo_account_history_with_references(
  p_account_id uuid, p_limit integer default 100
)
returns table (
  id uuid, direction text, counterparty_name text, counterparty_account_number text,
  amount_cents bigint, created_at timestamptz, reference_id text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id,
         case when t.sender_id = p_account_id then 'OUTGOING' else 'INCOMING' end,
         a.display_name, a.account_number, t.amount_cents, t.created_at,
         'NB-' || to_char(t.created_at at time zone 'Asia/Manila', 'YYYYMMDD') || '-'
           || lpad(t.reference_number::text, greatest(8, length(t.reference_number::text)), '0')
  from public.demo_transfers t
  join public.demo_accounts a
    on a.id = case when t.sender_id = p_account_id then t.recipient_id else t.sender_id end
  where t.sender_id = p_account_id or t.recipient_id = p_account_id
  order by t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

revoke execute on function public.demo_account_history_with_references(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.demo_account_history_with_references(uuid,integer)
  to service_role;

