-- ADRIA: تشخيص مشكلة الفاتورة 977# والمرتجع بتاريخ 7/9 وقفل اليوم
-- READ-ONLY بالكامل: لا يحتوي INSERT/UPDATE/DELETE.
-- شغّله في Supabase SQL Editor ثم أرسل لي النتائج.

-- 0) إعدادات المتجر والزمن
select id, name, day_start_hour, initial_balance,
       current_setting('TIMEZONE') as database_timezone,
       now() as database_now
from public.store_settings order by id limit 5;

-- 1) الفاتورة 977 (رقم الفاتورة هو orders.id في هذا المشروع)
select o.id, o.created_at, o.total, o.paid_amount, o.payment_method,
       o.paid_cash, o.paid_visa, o.paid_wallet, o.paid_instapay,
       o.paid_method5, o.paid_method6, o.refunded_at, o.is_deleted,
       o.deletion_reason, o.exchange_data, o.customer_id, o.cashier_name, o.notes
from public.orders o
where o.id::text in ('977', '977#') or o.id::text ilike '%977%'
order by o.created_at desc;

-- 2) أصناف الفاتورة
select oi.order_id, oi.product_id, oi.product_name, oi.quantity,
       oi.returned_quantity, oi.refunded_amount, oi.sale_price, oi.purchase_price
from public.order_items oi
where oi.order_id::text in ('977', '977#') or oi.order_id::text ilike '%977%'
order by oi.order_id, oi.product_name;

-- 3) حركات تقفيل/تحويل الخزنة
select e.id, e.created_at, e.category, e.amount, e.payment_method,
       e.paid_cash, e.paid_visa, e.paid_wallet, e.paid_instapay,
       e.paid_method5, e.paid_method6, e.note
from public.expenses e
where e.category ilike '%خزنة%' or e.category ilike '%تقفيل%'
   or e.note ilike '%تقفيل%'
   or e.note ilike '%تحويل من المحل للخزنة الرئيسية%'
order by e.created_at desc;

-- 4) ما يعتبره التطبيق «قفلًا» لكل يوم من 4/9 إلى 9/9
with cfg as (
  select coalesce(day_start_hour, 3)::int as day_start_hour
  from public.store_settings order by id limit 1
), days as (
  select d::date as business_day
  from generate_series(date '2026-09-04', date '2026-09-09', interval '1 day') d
), ranges as (
  select business_day,
         (business_day + make_interval(hours => cfg.day_start_hour))::timestamptz as day_start,
         (business_day + interval '1 day' + make_interval(hours => cfg.day_start_hour))::timestamptz as day_end
  from days cross join cfg
)
select r.business_day, r.day_start, r.day_end,
       e.id as closing_expense_id, e.created_at as closing_created_at,
       e.category, e.amount, e.note,
       case when e.id is null then 'OPEN' else 'CLOSED_BY_EXPENSE' end as app_status
from ranges r
left join public.expenses e
  on e.category = 'تحويل للخزنة الرئيسية'
 and e.created_at >= r.day_start and e.created_at < r.day_end
order by r.business_day, e.created_at;

-- 5) مكان المرتجع بالنسبة لليوم المحاسبي
with cfg as (
  select coalesce(day_start_hour, 3)::int as day_start_hour
  from public.store_settings order by id limit 1
)
select o.id, o.created_at as invoice_created_at, o.refunded_at,
       o.refunded_at at time zone current_setting('TIMEZONE') as refunded_local_time,
       (o.refunded_at at time zone current_setting('TIMEZONE'))::date as refunded_local_date,
       ((o.refunded_at at time zone current_setting('TIMEZONE'))::date
         - case when extract(hour from (o.refunded_at at time zone current_setting('TIMEZONE'))) < cfg.day_start_hour
                then 1 else 0 end) as calculated_business_day,
       cfg.day_start_hour
from public.orders o cross join cfg
where o.id::text in ('977', '977#') or o.id::text ilike '%977%';

-- 6) قفل محتمل سببه category فقط بدون دلالة تقفيل في الملاحظة
select e.id, e.created_at, e.category, e.amount, e.note
from public.expenses e
where e.category = 'تحويل للخزنة الرئيسية'
  and coalesce(e.note, '') not ilike '%تقفيل%'
  and coalesce(e.note, '') not ilike '%day_closing%'
  and coalesce(e.note, '') not ilike '%تحويل من المحل للخزنة الرئيسية%'
order by e.created_at desc;

-- 7) فحص الأعمدة المطلوبة
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'orders' and column_name in ('refunded_at','exchange_data','paid_method5','paid_method6'))
    or (table_name = 'expenses' and column_name in ('paid_method5','paid_method6'))
    or (table_name = 'store_settings' and column_name in ('day_start_hour')))
order by table_name, column_name;
