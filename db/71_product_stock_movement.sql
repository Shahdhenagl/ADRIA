-- =============================================================================
-- ADRIA - Product stock movement statement (read only)
-- =============================================================================
-- Use this when a product quantity differs between the old system and ADRIA.
-- It shows every quantity source that explains the current products.stock_quantity:
-- purchases, no-invoice intakes, sales, returns, active held reservations,
-- manufacturing output, devo/writeoff, and stocktake/manual adjustments.
--
-- Important:
--   stock_intakes.source = 'stocktake' is an accounting/capital entry created
--   beside stock_adjustments. It is shown with qty_delta = 0 here so the same
--   stocktake surplus is not counted twice.
--
-- Example for barcode 620:
--   select * from v_product_stock_movement_lines where barcode = '620' order by movement_at nulls first, source, ref_id;
--   select * from v_product_stock_movement_summary where barcode = '620';
-- =============================================================================

create or replace view public.v_product_stock_movement_lines as
with
products_base as (
  select
    p.id as product_id,
    p.barcode,
    p.name as product_name,
    coalesce(p.stock_quantity, 0) as current_stock,
    coalesce(p.display_quantity, 0) as display_stock
  from public.products p
),
purchase_lines as (
  select
    pi.product_id,
    inv.created_at as movement_at,
    'purchase_invoice'::text as source,
    inv.id::text as ref_id,
    coalesce(pi.quantity, 0) as qty_delta,
    coalesce(pi.purchase_price, 0) as unit_cost,
    concat('purchase invoice ', coalesce(inv.invoice_number::text, inv.id::text)) as note
  from public.purchase_items pi
  join public.purchase_invoices inv on inv.id = pi.invoice_id
),
intake_lines as (
  select
    si.product_id,
    si.created_at as movement_at,
    concat('stock_intake:', coalesce(si.source, 'manual')) as source,
    si.id::text as ref_id,
    case when coalesce(si.source, '') = 'stocktake' then 0 else coalesce(si.quantity, 0) end as qty_delta,
    coalesce(si.unit_cost, 0) as unit_cost,
    case
      when coalesce(si.source, '') = 'stocktake'
        then concat(coalesce(si.note, ''), ' (capital entry only; quantity counted via stock_adjustments)')
      else si.note
    end as note
  from public.stock_intakes si
),
sale_lines as (
  select
    oi.product_id,
    o.created_at as movement_at,
    'sale'::text as source,
    o.id::text as ref_id,
    -coalesce(oi.quantity, 0) as qty_delta,
    coalesce(oi.purchase_price, 0) as unit_cost,
    concat('order ', o.id) as note
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where coalesce(o.is_deleted, false) = false
    and coalesce(o.type, 'sale') <> 'payment'
),
return_lines as (
  select
    oi.product_id,
    coalesce(o.refunded_at, o.created_at) as movement_at,
    'customer_return'::text as source,
    o.id::text as ref_id,
    coalesce(oi.returned_quantity, 0) as qty_delta,
    coalesce(oi.purchase_price, 0) as unit_cost,
    concat('return on order ', o.id) as note
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where coalesce(o.is_deleted, false) = false
    and coalesce(oi.returned_quantity, 0) <> 0
),
active_held_lines as (
  select
    (item->>'id')::uuid as product_id,
    h.created_at as movement_at,
    concat('held_invoice:', coalesce(h.status, 'held')) as source,
    h.id::text as ref_id,
    -coalesce((item->>'quantity')::numeric, 0) as qty_delta,
    coalesce((item->>'purchase_price')::numeric, 0) as unit_cost,
    concat('active held/reserved invoice ', h.id) as note
  from public.held_invoices h
  cross join lateral jsonb_array_elements(h.items) as item
  where coalesce(h.status, 'held') in ('held', 'shipped', 'money_pending')
    and item ? 'id'
),
production_lines as (
  select
    po.product_id,
    po.created_at as movement_at,
    'production'::text as source,
    po.id::text as ref_id,
    coalesce(po.quantity, 0) as qty_delta,
    coalesce(po.cost_per_piece, 0) as unit_cost,
    coalesce(po.notes, 'manufacturing output') as note
  from public.production_orders po
),
devo_lines as (
  select
    d.product_id,
    d.created_at as movement_at,
    concat('devo:', coalesce(d.status, 'pending')) as source,
    d.id::text as ref_id,
    -coalesce(d.quantity, 0) as qty_delta,
    coalesce(d.unit_cost, 0) as unit_cost,
    coalesce(d.note, 'devo/writeoff') as note
  from public.devo_items d
  where coalesce(d.status, 'pending') in ('pending', 'at_factory', 'closed')
),
writeoff_lines as (
  select
    w.product_id,
    w.created_at as movement_at,
    'write_off'::text as source,
    w.id::text as ref_id,
    -coalesce(w.quantity, 0) as qty_delta,
    coalesce(w.unit_cost, 0) as unit_cost,
    coalesce(w.reason, 'write off') as note
  from public.write_offs w
),
adjustment_lines as (
  select
    sa.product_id,
    sa.created_at as movement_at,
    'stock_adjustment'::text as source,
    sa.id::text as ref_id,
    coalesce(sa.diff, 0) as qty_delta,
    coalesce(sa.cost, 0) as unit_cost,
    concat(
      'system=', coalesce(sa.system_qty, 0)::text,
      ', counted=', coalesce(sa.counted_qty, 0)::text,
      case when sa.note is null or sa.note = '' then '' else concat(', ', sa.note) end
    ) as note
  from public.stock_adjustments sa
)
select
  pb.product_id,
  pb.barcode,
  pb.product_name,
  l.movement_at,
  l.source,
  l.ref_id,
  l.qty_delta,
  l.unit_cost,
  l.qty_delta * l.unit_cost as value_delta,
  l.note
from products_base pb
join (
  select * from purchase_lines
  union all select * from intake_lines
  union all select * from sale_lines
  union all select * from return_lines
  union all select * from active_held_lines
  union all select * from production_lines
  union all select * from devo_lines
  union all select * from writeoff_lines
  union all select * from adjustment_lines
) l on l.product_id = pb.product_id;

create or replace view public.v_product_stock_movement_summary as
with movement as (
  select product_id, sum(qty_delta) as expected_stock
  from public.v_product_stock_movement_lines
  group by product_id
)
select
  p.id as product_id,
  p.barcode,
  p.name as product_name,
  coalesce(p.stock_quantity, 0) as current_stock,
  least(coalesce(p.display_quantity, 0), coalesce(p.stock_quantity, 0)) as display_stock,
  greatest(0, coalesce(p.stock_quantity, 0) - least(coalesce(p.display_quantity, 0), coalesce(p.stock_quantity, 0))) as warehouse_stock,
  coalesce(m.expected_stock, 0) as expected_from_movement,
  coalesce(p.stock_quantity, 0) - coalesce(m.expected_stock, 0) as unexplained_qty
from public.products p
left join movement m on m.product_id = p.id;

-- Quick checks:
-- select * from public.v_product_stock_movement_summary where abs(unexplained_qty) > 0.001 order by abs(unexplained_qty) desc;
-- select * from public.v_product_stock_movement_summary where barcode = '620';
-- select * from public.v_product_stock_movement_lines where barcode = '620' order by movement_at nulls first, source, ref_id;
