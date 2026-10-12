-- ADRIA — قائمة المنتجات ذات فروقات مخزون غير مفسرة
-- للقراءة فقط: لا يعدّل أي جدول.
--
-- expected_stock يحسب من كل مصادر الحركة التي تغيّر stock_quantity:
-- شراء/مرتجع مورد، إدخال بدون شراء، بيع ومرتجع عميل، حجز نشط، تصنيع،
-- ديفو، تالف، وتسويات الجرد.
-- ملاحظة: purchase_items.quantity محفوظ بإشارته؛ مرتجع المورد يكون سالباً.
-- وتشمل المبيعات الفواتير غير المحذوفة فقط، حتى لا نعيد عدّ فاتورة أُلغيت.

with
purchase_flow as (
  select
    pi.product_id,
    sum(coalesce(pi.quantity, 0)) as qty
  from public.purchase_items pi
  join public.purchase_invoices inv on inv.id = pi.invoice_id
  group by pi.product_id
),
intake_flow as (
  select
    si.product_id,
    sum(case when coalesce(si.source, '') = 'stocktake' then 0 else coalesce(si.quantity, 0) end) as qty
  from public.stock_intakes si
  group by si.product_id
),
sale_flow as (
  select oi.product_id, sum(coalesce(oi.quantity, 0)) * -1 as qty
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where coalesce(o.is_deleted, false) = false
    and coalesce(o.type, 'sale') <> 'payment'
  group by oi.product_id
),
customer_return_flow as (
  select oi.product_id, sum(coalesce(oi.returned_quantity, 0)) as qty
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where coalesce(o.is_deleted, false) = false
    and coalesce(oi.returned_quantity, 0) <> 0
  group by oi.product_id
),
held_flow as (
  select
    (item->>'id')::uuid as product_id,
    sum(coalesce((item->>'quantity')::numeric, 0)) * -1 as qty
  from public.held_invoices h
  cross join lateral jsonb_array_elements(h.items) as item
  where coalesce(h.status, 'held') in ('held', 'shipped', 'money_pending')
    and item ? 'id'
  group by (item->>'id')::uuid
),
production_flow as (
  select product_id, sum(coalesce(quantity, 0)) as qty
  from public.production_orders
  group by product_id
),
devo_flow as (
  select product_id, sum(coalesce(quantity, 0)) * -1 as qty
  from public.devo_items
  where coalesce(status, 'pending') in ('pending', 'at_factory', 'closed')
  group by product_id
),
writeoff_flow as (
  select product_id, sum(coalesce(quantity, 0)) * -1 as qty
  from public.write_offs
  group by product_id
),
adjustment_flow as (
  select product_id, sum(coalesce(diff, 0)) as qty
  from public.stock_adjustments
  group by product_id
),
movement_totals as (
  select product_id, sum(qty) as expected_stock
  from (
    select product_id, qty from purchase_flow
    union all select product_id, qty from intake_flow
    union all select product_id, qty from sale_flow
    union all select product_id, qty from customer_return_flow
    union all select product_id, qty from held_flow
    union all select product_id, qty from production_flow
    union all select product_id, qty from devo_flow
    union all select product_id, qty from writeoff_flow
    union all select product_id, qty from adjustment_flow
  ) movements
  group by product_id
)
select
  p.id as product_id,
  p.barcode,
  p.name as product_name,
  coalesce(p.stock_quantity, 0) as current_stock,
  coalesce(m.expected_stock, 0) as expected_stock,
  coalesce(p.stock_quantity, 0) - coalesce(m.expected_stock, 0) as unexplained_difference,
  least(coalesce(p.display_quantity, 0), coalesce(p.stock_quantity, 0)) as display_stock,
  greatest(0, coalesce(p.stock_quantity, 0) - least(coalesce(p.display_quantity, 0), coalesce(p.stock_quantity, 0))) as warehouse_stock,
  p.created_at as product_created_at
from public.products p
left join movement_totals m on m.product_id = p.id
where abs(coalesce(p.stock_quantity, 0) - coalesce(m.expected_stock, 0)) > 0.001
order by abs(coalesce(p.stock_quantity, 0) - coalesce(m.expected_stock, 0)) desc,
         p.barcode
limit 500;

-- اختياري: تفاصيل حركة منتج واحد بعد معرفة product_id أو barcode.
-- يعتمد على العرض الموجود في db/71_product_stock_movement.sql:
-- select * from public.v_product_stock_movement_lines
-- where barcode = '671'
-- order by movement_at nulls first, source, ref_id;
