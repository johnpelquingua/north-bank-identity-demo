-- Calculate the balance after each transfer from the account's current balance.
-- The window runs over the full history before the display limit is applied.
-- Keep the previous history RPC available until the Edge Function is deployed.
create or replace function public.demo_account_history_with_balances(
  p_account_id uuid, p_limit integer default 100
)
returns table (
  id uuid, direction text, counterparty_name text, counterparty_account_number text,
  amount_cents bigint, created_at timestamptz, reference_id text,
  running_balance_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id,
         case when t.sender_id = p_account_id then 'OUTGOING' else 'INCOMING' end,
         counterparty.display_name, counterparty.account_number,
         t.amount_cents, t.created_at,
         'NB-' || to_char(t.created_at at time zone 'Asia/Manila', 'YYYYMMDD') || '-'
           || lpad(t.reference_number::text, greatest(8, length(t.reference_number::text)), '0'),
         owner.balance_cents - coalesce(
           sum(case when t.sender_id = p_account_id then -t.amount_cents else t.amount_cents end)
             over (order by t.created_at desc, t.reference_number desc
                   rows between unbounded preceding and 1 preceding),
           0
         )::bigint
  from public.demo_transfers t
  join public.demo_accounts owner on owner.id = p_account_id
  join public.demo_accounts counterparty
    on counterparty.id = case when t.sender_id = p_account_id then t.recipient_id else t.sender_id end
  where t.sender_id = p_account_id or t.recipient_id = p_account_id
  order by t.created_at desc, t.reference_number desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

revoke execute on function public.demo_account_history_with_balances(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.demo_account_history_with_balances(uuid,integer)
  to service_role;

