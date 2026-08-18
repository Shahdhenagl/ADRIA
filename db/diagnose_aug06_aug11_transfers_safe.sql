-- ADRIA: قراءة فقط لتشخيص رصيد الخزنة الرئيسية في 06 و11 أغسطس 2026.
-- لا يحتوي هذا الملف على UPDATE أو DELETE أو INSERT.

-- 1) كل الحركات الفعلية بتوقيت القاهرة في اليومين.
with target_rows as (
  select
    t.id,
    t.created_at,
    (t.created_at at time zone 'Africa/Cairo')::date as cairo_date,
    t.source,
    t.direction,
    t.amount,
    t.method,
    t.group_id,
    t.note
  from public.savings_transactions t
  where (t.created_at at time zone 'Africa/Cairo')::date in ('2026-08-06'::date, '2026-08-11'::date)
)
select *
from target_rows
order by cairo_date, created_at, source, direction, method, id;

-- 2) تدقيق كل group_id: هل له وارد وصادر؟ وهل صافي العملية صفر؟
select
  t.group_id,
  count(*) as row_count,
  min(t.created_at) as first_created_at,
  max(t.created_at) as last_created_at,
  array_agg(distinct t.source order by t.source) as sources,
  array_agg(distinct t.method order by t.method) as methods,
  count(*) filter (where t.direction = 'in') as in_rows,
  count(*) filter (where t.direction = 'out') as out_rows,
  coalesce(sum(t.amount) filter (where t.direction = 'in'), 0) as total_in,
  coalesce(sum(t.amount) filter (where t.direction = 'out'), 0) as total_out,
  coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0) as net_effect
from public.savings_transactions t
where t.group_id is not null
  and (t.created_at at time zone 'Africa/Cairo')::date in ('2026-08-06'::date, '2026-08-11'::date)
group by t.group_id
having count(*) <> 2
    or count(*) filter (where t.direction = 'in') = 0
    or count(*) filter (where t.direction = 'out') = 0
    or abs(coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0)) > 0.01
order by last_created_at;

-- 3) الحركات القديمة بلا group_id في اليومين، للمراجعة فقط.
select
  t.id,
  t.created_at,
  (t.created_at at time zone 'Africa/Cairo')::date as cairo_date,
  t.source,
  t.direction,
  t.amount,
  t.method,
  t.note
from public.savings_transactions t
where t.group_id is null
  and (t.created_at at time zone 'Africa/Cairo')::date in ('2026-08-06'::date, '2026-08-11'::date)
order by t.created_at, t.id;

-- 4) صافي الخزنة الرئيسية حسب اليوم والوسيلة.
select
  (t.created_at at time zone 'Africa/Cairo')::date as cairo_date,
  t.method,
  coalesce(sum(t.amount) filter (where t.direction = 'in'), 0) as total_in,
  coalesce(sum(t.amount) filter (where t.direction = 'out'), 0) as total_out,
  coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0) as net_effect
from public.savings_transactions t
where (t.created_at at time zone 'Africa/Cairo')::date in ('2026-08-06'::date, '2026-08-11'::date)
group by 1, 2
order by 1, 2;

-- 5) إجمالي الرصيد التاريخي للخزنة الرئيسية حسب الوسيلة.
select
  t.method,
  coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0) as historical_net
from public.savings_transactions t
group by t.method
order by t.method;

-- تفسير النتائج:
-- * group متزن: وارد وصادر وصافي 0.00، ولا يُحذف.
-- * group غير متزن أو بلا طرف مقابل: يحتاج مطابقة مع المصدر قبل أي تصحيح.
-- * الصف بلا group_id ليس دليلًا كافيًا على التكرار؛ يُراجع بالتاريخ والمبلغ والملاحظة والوسيلة.
-- * لا تعتمد على رقم التنبيه الموجود في الواجهة لاتخاذ قرار حذف.
