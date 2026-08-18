-- ADRIA: read-only diagnostics for suspicious savings/main-treasury transfers.
-- Run in Supabase SQL Editor. This script only SELECTs; it never updates/deletes.

with params as (
  select array[6, 11]::int[] as target_days
), rows_ as (
  select
    t.id,
    t.created_at,
    (t.created_at at time zone 'Africa/Cairo')::date as cairo_date,
    extract(day from (t.created_at at time zone 'Africa/Cairo'))::int as cairo_day,
    t.source,
    t.direction,
    t.amount,
    t.method,
    t.group_id,
    t.note,
    count(*) over (partition by t.group_id) as group_rows
  from public.savings_transactions t
  where extract(day from (t.created_at at time zone 'Africa/Cairo'))::int = any((select target_days from params))
     or t.group_id is null
)
select *
from rows_
order by created_at, source, direction, method;

-- Same-group audit: a normal shop/main transfer usually has one matching in/out pair.
select
  group_id,
  count(*) as row_count,
  min(created_at) as first_created_at,
  max(created_at) as last_created_at,
  sum(case when direction = 'in' then amount else 0 end) as total_in,
  sum(case when direction = 'out' then amount else 0 end) as total_out,
  sum(case when direction = 'in' then amount else -amount end) as net_effect
from public.savings_transactions
where group_id is not null
  and (source in ('day_closing','shop_transfer','to_shop','convert'))
group by group_id
having count(*) <> 2
    or abs(sum(case when direction = 'in' then amount else -amount end)) > 0.01
order by last_created_at desc;
