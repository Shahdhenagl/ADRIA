-- =============================================================================
-- ADRIA — تسجيل المخزون الافتتاحي غير المسجّل (تسوية لمرة واحدة)
-- =============================================================================
--  الخلفية: db/68 و db/69 كشفوا إن في بضاعة موجودة (واتباعت) من غير أي سجل
--  لدخولها. السبب إن جدول `stock_intakes` (db/59) اتعمل بعد ما المحل كان
--  شغال، فكل اللي دخل قبله مالوش قيد.
--
--  التسوية دي **بتضيف قيود فقط** — مابتغيّرش ولا كمية منتج واحدة. بعدها:
--    • شجرة الحسابات بتوازن (الإدخال بدون فاتورة له طرف مقابل في حقوق الملكية).
--    • قيمة المخزون بتبقى مفسّرة بالكامل.
--
--  ⚠️ خُد Backup قبلها. وشغّل **الاستعلام الأول (معاينة)** وشوف الأرقام قبل
--     ما تنفّذ الإدخال.
-- =============================================================================

-- الكمية المتوقّعة لكل صنف من كل حركاته المسجّلة، والفرق عن الفعلي.
create or replace view v_stock_gap as
with
purchased as (select product_id, sum(coalesce(quantity,0)) q from purchase_items group by 1),
-- Stocktake surplus is already represented in stock_adjustments; counting it
-- here as an intake too would explain the same quantity twice.
intaken   as (
  select product_id, sum(coalesce(quantity,0)) q
  from stock_intakes
  where coalesce(source, '') <> 'stocktake'
  group by 1
),
produced  as (select product_id, sum(coalesce(quantity,0)) q from production_orders group by 1),
sold      as (select oi.product_id, sum(coalesce(oi.quantity,0) - coalesce(oi.returned_quantity,0)) q
              from order_items oi join orders o on o.id = oi.order_id
              where coalesce(o.is_deleted,false) = false group by 1),
devod     as (select product_id, sum(coalesce(quantity,0)) q from devo_items group by 1),
adjusted  as (select product_id, sum(coalesce(diff,0)) q from stock_adjustments group by 1)
select
  p.id as product_id, p.name as product_name,
  coalesce(p.stock_quantity,0) as actual_q,
  (coalesce(pu.q,0) + coalesce(it.q,0) + coalesce(pr.q,0)
   - coalesce(so.q,0) - coalesce(dv.q,0) + coalesce(aj.q,0)) as expected_q,
  coalesce(p.stock_quantity,0)
   - (coalesce(pu.q,0) + coalesce(it.q,0) + coalesce(pr.q,0)
      - coalesce(so.q,0) - coalesce(dv.q,0) + coalesce(aj.q,0)) as gap_q,
  coalesce(p.average_purchase_price, p.purchase_price, 0) as cost
from products p
left join purchased pu on pu.product_id = p.id
left join intaken   it on it.product_id = p.id
left join produced  pr on pr.product_id = p.id
left join sold      so on so.product_id = p.id
left join devod     dv on dv.product_id = p.id
left join adjusted  aj on aj.product_id = p.id;


-- =============================================================================
-- (1) 👁 معاينة — شغّل ده الأول وشوف الأرقام. مابيكتبش حاجة.
-- =============================================================================
select
  count(*) filter (where gap_q > 0)                    as "أصناف ناقصها قيد دخول",
  count(*) filter (where gap_q < 0)                    as "أصناف ناقصة فعلياً",
  round(sum(gap_q * cost) filter (where gap_q > 0), 2) as "قيمة الافتتاحي هتتسجّل",
  round(sum(gap_q * cost) filter (where gap_q < 0), 2) as "قيمة النقص هيتسجّل",
  round(sum(gap_q * cost), 2)                          as "الصافي"
from v_stock_gap
where abs(gap_q) > 0.001;


-- =============================================================================
-- (2) ✍ التنفيذ — بعد ما تراجع المعاينة.
--     الزيادة = رصيد افتتاحي (opening). النقص = نقص غير مفسّر (manual_decrease).
--     الملاحظة موحّدة عشان ينفع نتراجع عنها بسطر واحد (استعلام 3).
-- =============================================================================
insert into stock_intakes (product_id, product_name, quantity, unit_cost, total_value, source, note)
select
  product_id, product_name, gap_q, cost, gap_q * cost,
  case when gap_q > 0 then 'opening' else 'manual_decrease' end,
  '[RECONCILE-70] تسوية مخزون افتتاحي غير مسجّل'
from v_stock_gap
where abs(gap_q) > 0.001
  -- حماية من التكرار لو اتشغّل مرتين.
  and not exists (
    select 1 from stock_intakes si
    where si.product_id = v_stock_gap.product_id
      and si.note = '[RECONCILE-70] تسوية مخزون افتتاحي غير مسجّل'
  );


-- =============================================================================
-- (3) ↩ التراجع — لو حبيت تلغي التسوية بالكامل.
-- =============================================================================
-- delete from stock_intakes where note = '[RECONCILE-70] تسوية مخزون افتتاحي غير مسجّل';


-- =============================================================================
-- (4) ✅ التحقق — بعد التنفيذ لازم يطلع صفر صفوف.
-- =============================================================================
-- select count(*) as "أصناف لسه فيها فرق" from v_stock_gap where abs(gap_q) > 0.001;

-- تنضيف الـ view بعد ما تخلص (اختياري — سيبه لو هتراجع تاني).
-- drop view if exists v_stock_gap;
