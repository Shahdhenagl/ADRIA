-- =============================================================================
-- ADRIA — تفكيك «الفرق غير المفسّر» في شجرة الحسابات. **قراءة فقط.**
-- =============================================================================
--  شجرة الحسابات بتقرا المخزون كـ«لقطة» (كمية × تكلفة)، لكن المخزون بيتحرّك من
--  مصادر غير فواتير الشراء. الاستعلام ده بيقيس كل مصدر بالجنيه عشان نعرف
--  الفرق مفسّر بالكامل ولا فيه جزء حقيقي مجهول.
--
--  المعادلة المتوقّعة:
--    المخزون الحالي = المشتريات − تكلفة المباع + إدخال بدون فاتورة
--                     − الديڤو/التوالف ± تسويات الجرد
--
--  «الباقي غير المفسّر» في النتيجة هو الرقم اللي يستاهل تحقيق فعلاً.
-- =============================================================================

with
snapshot as (
  select coalesce(sum(coalesce(stock_quantity,0)
       * coalesce(average_purchase_price, purchase_price, 0)), 0) as v
  from products
),
purchases as (
  select coalesce(sum(coalesce(total,0)), 0) as v from purchase_invoices
),
cogs as (
  select coalesce(sum((coalesce(oi.quantity,0) - coalesce(oi.returned_quantity,0))
       * coalesce(oi.purchase_price, 0)), 0) as v
  from order_items oi
  join orders o on o.id = oi.order_id
  where coalesce(o.is_deleted, false) = false
),
intakes as (
  -- Stocktake surplus is already represented in stock_adjustments; counting it
  -- here as an intake too would explain the same quantity twice.
  select coalesce(sum(coalesce(total_value, 0)), 0) as v
  from stock_intakes
  where coalesce(source, '') <> 'stocktake'
),
devo as (
  select coalesce(sum(coalesce(quantity,0) * coalesce(unit_cost,0)), 0) as v from devo_items
),
adjust as (
  select coalesce(sum(coalesce(diff,0) * coalesce(cost,0)), 0) as v from stock_adjustments
)
select 'المخزون الحالي (لقطة)'            as "البند", round((select v from snapshot)::numeric, 2) as "القيمة"
union all select 'المشتريات (بفواتير)',      round((select v from purchases)::numeric, 2)
union all select 'تكلفة البضاعة المباعة (−)', round(-(select v from cogs)::numeric, 2)
union all select 'إدخال مخزون بدون فاتورة',  round((select v from intakes)::numeric, 2)
union all select 'الديڤو والتوالف (−)',      round(-(select v from devo)::numeric, 2)
union all select 'تسويات الجرد (±)',         round((select v from adjust)::numeric, 2)
union all select '══ المخزون المتوقّع من الحركة ══',
  round(((select v from purchases) - (select v from cogs) + (select v from intakes)
        - (select v from devo) + (select v from adjust))::numeric, 2)
union all select '🎯 الباقي غير المفسّر',
  round(((select v from snapshot)
        - ((select v from purchases) - (select v from cogs) + (select v from intakes)
          - (select v from devo) + (select v from adjust)))::numeric, 2);
