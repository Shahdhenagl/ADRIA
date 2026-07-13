-- ADRIA — db/39: ترحيل المرتجعات القديمة كمصروفات فئة «مرتجعات»
-- آمن للتشغيل أكثر من مرة (فيه حماية ضد التكرار).
--
-- السبب: بقى المرتجع يُسجَّل كمصروف حقيقي «مرتجعات» (خرج فعلي من الخزنة) بتاريخ يوم
-- المرتجع. المرتجعات اللي حصلت قبل التحديث مالهاش مصروف، فبتظهر بصفر في التقفيل.
-- ده بينشئ لكل فاتورة اترجع منها كاش مصروفاً واحداً بتاريخ الاسترجاع (refunded_at)،
-- ولو مش متوفّر يرجع لتاريخ الفاتورة.

-- نضمن وجود عمود تاريخ الاسترجاع أولاً (لو db/36 ما اتشغّلش).
alter table orders add column if not exists refunded_at timestamptz;

insert into expenses (category, amount, paid_cash, paid_visa, paid_wallet, paid_instapay, payment_method, note, created_at)
select
  'مرتجعات',
  r.total_ref,
  case when coalesce(o.refund_method, 'cash') = 'cash'     then r.total_ref else 0 end,
  case when o.refund_method = 'visa'                        then r.total_ref else 0 end,
  case when o.refund_method = 'wallet'                      then r.total_ref else 0 end,
  case when o.refund_method = 'instapay'                    then r.total_ref else 0 end,
  coalesce(o.refund_method, 'cash'),
  'مرتجع فاتورة #' || o.id,
  coalesce(o.refunded_at, o.created_at)
from orders o
join (
  select order_id, sum(refunded_amount) as total_ref
  from order_items
  group by order_id
  having sum(refunded_amount) > 0
) r on r.order_id = o.id
where not exists (
  select 1 from expenses e
  where e.category = 'مرتجعات' and e.note = 'مرتجع فاتورة #' || o.id
);
