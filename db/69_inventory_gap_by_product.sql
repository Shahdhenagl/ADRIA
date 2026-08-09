-- =============================================================================
-- ADRIA — الفرق غير المفسّر في المخزون: **منتج بمنتج**. قراءة فقط.
-- =============================================================================
--  db/68 قال إن في ٩٦ ألف غير مفسّرة. الاستعلام ده بيوزّعها على الأصناف عشان
--  نعرف: هي مركّزة في كام صنف (خطأ بيانات نصلّحه)، ولا موزّعة على كل حاجة
--  (مخزون افتتاحي قديم قبل ما جدول stock_intakes يتعمل — وده طبيعي).
--
--  الكمية المتوقّعة للصنف =
--       المشترى بفواتير + الداخل بدون فاتورة + المصنّع
--     − المباع (صافي المرتجع) − الديڤو ± تسويات الجرد
-- =============================================================================

with
purchased as (
  select pi_item.product_id, sum(coalesce(pi_item.quantity,0)) as q
  from purchase_items pi_item group by 1
),
intaken as (
  -- Stocktake surplus is already represented in stock_adjustments; counting it
  -- here as an intake too would explain the same quantity twice.
  select product_id, sum(coalesce(quantity,0)) as q
  from stock_intakes
  where coalesce(source, '') <> 'stocktake'
  group by 1
),
produced as (
  select product_id, sum(coalesce(quantity,0)) as q from production_orders group by 1
),
sold as (
  select oi.product_id, sum(coalesce(oi.quantity,0) - coalesce(oi.returned_quantity,0)) as q
  from order_items oi join orders o on o.id = oi.order_id
  where coalesce(o.is_deleted,false) = false
  group by 1
),
devod as (
  select product_id, sum(coalesce(quantity,0)) as q from devo_items group by 1
),
adjusted as (
  select product_id, sum(coalesce(diff,0)) as q from stock_adjustments group by 1
),
calc as (
  select
    p.id, p.name,
    coalesce(p.stock_quantity,0) as actual_q,
    coalesce(pu.q,0) + coalesce(it.q,0) + coalesce(pr.q,0)
      - coalesce(so.q,0) - coalesce(dv.q,0) + coalesce(aj.q,0) as expected_q,
    coalesce(p.average_purchase_price, p.purchase_price, 0) as cost,
    coalesce(pu.q,0) as bought, coalesce(it.q,0) as intake,
    coalesce(pr.q,0) as made, coalesce(so.q,0) as soldq
  from products p
  left join purchased pu on pu.product_id = p.id
  left join intaken   it on it.product_id = p.id
  left join produced  pr on pr.product_id = p.id
  left join sold      so on so.product_id = p.id
  left join devod     dv on dv.product_id = p.id
  left join adjusted  aj on aj.product_id = p.id
)
select
  name                                        as "الصنف",
  actual_q                                    as "الكمية الفعلية",
  expected_q                                  as "المتوقّعة من الحركة",
  round((actual_q - expected_q)::numeric, 2)  as "فرق الكمية",
  round(cost::numeric, 2)                     as "التكلفة",
  round(((actual_q - expected_q) * cost)::numeric, 2) as "قيمة الفرق",
  bought as "مشترى", intake as "بدون فاتورة", made as "مصنّع", soldq as "مباع"
from calc
where abs(actual_q - expected_q) > 0.001
order by abs((actual_q - expected_q) * cost) desc
limit 40;
