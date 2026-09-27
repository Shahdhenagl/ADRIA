-- تصحيح مرتجع الفاتورة 1351:
-- الفاتورة أصلها فيزا، لكن المرتجع اتسجل في الكاش.
-- شغّل هذا الملف في Supabase SQL Editor بعد مراجعة نتيجة الاستعلام الأول.

begin;

-- هذه الأعمدة موجودة ابتداءً من db/03 و db/67، والإضافة idempotent للتوافق.
alter table public.orders add column if not exists refund_method text;
alter table public.orders add column if not exists refunded_cash numeric default 0;
alter table public.orders add column if not exists refunded_visa numeric default 0;
alter table public.orders add column if not exists refunded_wallet numeric default 0;
alter table public.orders add column if not exists refunded_instapay numeric default 0;
alter table public.orders add column if not exists refunded_method5 numeric default 0;
alter table public.orders add column if not exists refunded_method6 numeric default 0;

-- معاينة إلزامية: يجب أن تظهر paid_visa > 0، وباقي paid_* = 0،
-- وأن يكون إجمالي refunded_amount هو قيمة المرتجع الفعلية.
select
  o.id,
  o.total,
  o.paid_amount,
  o.paid_cash,
  o.paid_visa,
  o.paid_wallet,
  o.paid_instapay,
  o.refund_method,
  o.refunded_cash,
  o.refunded_visa,
  coalesce(sum(oi.refunded_amount), 0) as returned_total
from public.orders o
left join public.order_items oi on oi.order_id = o.id
where o.id = '1351'
group by o.id, o.total, o.paid_amount, o.paid_cash, o.paid_visa,
         o.paid_wallet, o.paid_instapay, o.refund_method,
         o.refunded_cash, o.refunded_visa;

-- التصحيح مشروط حتى لا نغيّر فاتورة أخرى أو فاتورة دفع مختلطة بالخطأ.
with returned as (
  select
    o.id,
    coalesce(sum(oi.refunded_amount), 0)::numeric as amount
  from public.orders o
  left join public.order_items oi on oi.order_id = o.id
  where o.id = '1351'
  group by o.id
), eligible as (
  select r.id, r.amount
  from returned r
  join public.orders o on o.id = r.id
  where r.amount > 0
    and coalesce(o.paid_visa, 0) > 0
    and coalesce(o.paid_cash, 0) = 0
    and coalesce(o.paid_wallet, 0) = 0
    and coalesce(o.paid_instapay, 0) = 0
    and coalesce(o.paid_method5, 0) = 0
    and coalesce(o.paid_method6, 0) = 0
)
update public.orders o
set
  refund_method = 'visa',
  refunded_cash = 0,
  refunded_visa = e.amount,
  refunded_wallet = 0,
  refunded_instapay = 0,
  refunded_method5 = 0,
  refunded_method6 = 0
from eligible e
where o.id = e.id;

-- تحقق نهائي: يجب أن تكون قيمة المرتجع في refunded_visa فقط.
select
  id,
  refund_method,
  refunded_cash,
  refunded_visa,
  refunded_wallet,
  refunded_instapay,
  refunded_method5,
  refunded_method6
from public.orders
where id = '1351';

commit;
