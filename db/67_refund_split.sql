-- =============================================================================
-- ADRIA — استرداد المرتجع على أكتر من وسيلة دفع
-- شغّله مرة واحدة (آمن للتشغيل أكتر من مرة).
-- =============================================================================
--  قبل كده: عمود `refund_method` واحد (كاش أو فيزا أو محفظة أو انستا) — يعني
--  المرتجع كله لازم يرجع على وسيلة واحدة. لكن العميل ممكن يكون دفع بأكتر من
--  وسيلة، أو الدرج مافيهوش كاش كفاية فيترد جزء كاش وجزء انستا.
--
--  الأعمدة دي **تراكمية**: الفاتورة ممكن يترجّع منها أكتر من مرة، فكل مرة
--  بتتضاف على اللي قبلها. المجموع لازم يساوي مجموع order_items.refunded_amount.
--
--  التوافق مع القديم: `refund_method` بيفضل موجود ومتسجّل (بالوسيلة الأكبر).
--  الحسابات بتقرا التقسيمة لو فيها أي رقم، وإلا بترجع للعمود القديم — فالفواتير
--  القديمة بتتحسب زي ما هي بالظبط. نفس قاعدة applySplit في باقي النظام.
-- =============================================================================

alter table orders
  add column if not exists refunded_cash     numeric not null default 0,
  add column if not exists refunded_visa     numeric not null default 0,
  add column if not exists refunded_wallet   numeric not null default 0,
  add column if not exists refunded_instapay numeric not null default 0,
  add column if not exists refunded_method5  numeric not null default 0,
  add column if not exists refunded_method6  numeric not null default 0;

-- تحقّق: لازم تطلع ٦ صفوف.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name in ('refunded_cash', 'refunded_visa', 'refunded_wallet',
                      'refunded_instapay', 'refunded_method5', 'refunded_method6')
order by column_name;
