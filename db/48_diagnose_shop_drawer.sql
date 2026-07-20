-- ADRIA — تفكيك رصيد خزنة المحل. **للقراءة فقط، مش بيعدّل أي حاجة.**
--
-- ليه؟ صفحة الخزنة الرئيسية بتعرض «بالمحل: -3280» مثلاً. الرصيد السالب معناه
-- إن النظام شايف إن اتصرف/اتحوّل من الدرج أكتر من اللي دخله. الاستعلام ده
-- بيفكك الرقم لمكوناته عشان نعرف البند اللي بيسحبه تحت الصفر.
--
-- بيطابق دالة computeShopAvailable في src/utils/treasury.ts:
--   + الفواتير (بيع/سداد)      − المرتجعات
--   − المصاريف                  ± التحويلات الداخلية بين الوسائل
--   − المشتريات (+ لو سالبة)    − المرتبات
--   + الرصيد الافتتاحي (من الإعدادات — مش في الاستعلام ده)
-- والمعلّم بـ [MAIN_TREASURY] مستبعد لأنه بيخص الخزنة الرئيسية مش الدرج.
--
-- قاعدة التقسيم: لو أي عمود paid_* مش صفر، بناخد الأعمدة دي. لو كلهم أصفار،
-- بنحمّل المبلغ كله على payment_method.

with
-- (أ) الفواتير: بيع + سداد آجل = داخل للدرج
orders_in as (
  select m.key, sum(m.val) as amount
  from orders o
  cross join lateral (values
    ('cash',     case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
                      then coalesce(o.paid_cash,0)
                      else case when o.payment_method='cash' then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('visa',     case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
                      then coalesce(o.paid_visa,0)
                      else case when o.payment_method='visa' then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('wallet',   case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
                      then coalesce(o.paid_wallet,0)
                      else case when o.payment_method='wallet' then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('instapay', case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
                      then coalesce(o.paid_instapay,0)
                      else case when o.payment_method='instapay' then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('method5',  case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
                      then coalesce(o.paid_method5,0)
                      else case when o.payment_method='method5' then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('method6',  case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
                      then coalesce(o.paid_method6,0)
                      else case when o.payment_method='method6' then abs(coalesce(o.paid_amount,0)) else 0 end end)
  ) as m(key, val)
  where coalesce(o.is_deleted,false) = false
    and o.type in ('sale','payment')
  group by m.key
),
-- (ب) المرتجعات: بتخرج من الدرج على وسيلة الاسترداد
refunds_out as (
  select coalesce(o.refund_method, o.payment_method, 'cash') as key,
         sum(coalesce(oi.refunded_amount,0)) as amount
  from orders o
  join order_items oi on oi.order_id = o.id
  where coalesce(o.is_deleted,false) = false
  group by 1
),
-- (ج) المصاريف والتحويلات — المعلّم [MAIN_TREASURY] مستبعد
exp_rows as (
  select e.*,
    (coalesce(e.paid_cash,0)+coalesce(e.paid_visa,0)+coalesce(e.paid_wallet,0)+coalesce(e.paid_instapay,0)+coalesce(e.paid_method5,0)+coalesce(e.paid_method6,0)) as split_sum
  from expenses e
  where coalesce(e.note,'') not like '%[MAIN_TREASURY]%'
),
exp_out as (
  select
    case when r.category = 'تحويل داخلي' then 'internal_transfer'
         when r.category = 'تحويل للخزنة الرئيسية' then 'transfer_to_main'
         when r.category = 'تحويل من الخزنة الرئيسية' then 'transfer_from_main'
         else 'expense' end as component,
    m.key,
    sum(m.val) as amount
  from exp_rows r
  cross join lateral (values
    ('cash',     case when r.split_sum <> 0 then coalesce(r.paid_cash,0)     else case when r.payment_method='cash'     then abs(coalesce(r.amount,0)) else 0 end end),
    ('visa',     case when r.split_sum <> 0 then coalesce(r.paid_visa,0)     else case when r.payment_method='visa'     then abs(coalesce(r.amount,0)) else 0 end end),
    ('wallet',   case when r.split_sum <> 0 then coalesce(r.paid_wallet,0)   else case when r.payment_method='wallet'   then abs(coalesce(r.amount,0)) else 0 end end),
    ('instapay', case when r.split_sum <> 0 then coalesce(r.paid_instapay,0) else case when r.payment_method='instapay' then abs(coalesce(r.amount,0)) else 0 end end),
    ('method5',  case when r.split_sum <> 0 then coalesce(r.paid_method5,0)  else case when r.payment_method='method5'  then abs(coalesce(r.amount,0)) else 0 end end),
    ('method6',  case when r.split_sum <> 0 then coalesce(r.paid_method6,0)  else case when r.payment_method='method6'  then abs(coalesce(r.amount,0)) else 0 end end)
  ) as m(key, val)
  group by 1, 2
),
-- (د) المشتريات — المعلّم [MAIN_TREASURY] مستبعد
pur_rows as (
  select p.*,
    (coalesce(p.paid_cash,0)+coalesce(p.paid_visa,0)+coalesce(p.paid_wallet,0)+coalesce(p.paid_instapay,0)+coalesce(p.paid_method5,0)+coalesce(p.paid_method6,0)) as split_sum
  from purchase_invoices p
  where coalesce(p.notes,'') not like '%[MAIN_TREASURY]%'
),
pur_out as (
  select m.key, sum(m.val) as amount
  from pur_rows r
  cross join lateral (values
    ('cash',     case when r.split_sum <> 0 then coalesce(r.paid_cash,0)     else case when r.payment_method='cash'     then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('visa',     case when r.split_sum <> 0 then coalesce(r.paid_visa,0)     else case when r.payment_method='visa'     then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('wallet',   case when r.split_sum <> 0 then coalesce(r.paid_wallet,0)   else case when r.payment_method='wallet'   then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('instapay', case when r.split_sum <> 0 then coalesce(r.paid_instapay,0) else case when r.payment_method='instapay' then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('method5',  case when r.split_sum <> 0 then coalesce(r.paid_method5,0)  else case when r.payment_method='method5'  then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('method6',  case when r.split_sum <> 0 then coalesce(r.paid_method6,0)  else case when r.payment_method='method6'  then abs(coalesce(r.paid_amount,0)) else 0 end end)
  ) as m(key, val)
  group by m.key
)
select component, key, round(sum(amount)::numeric, 2) as amount from (
  select 'IN  فواتير (بيع/سداد)'      as component, key,  amount from orders_in
  union all
  select 'OUT مرتجعات',                     key, -amount from refunds_out
  union all
  select 'OUT مصاريف',                      key, -amount from exp_out where component='expense'
  union all
  select 'OUT تحويل للخزنة الرئيسية',        key, -amount from exp_out where component='transfer_to_main'
  union all
  select 'IN  تحويل من الخزنة الرئيسية',     key, -amount from exp_out where component='transfer_from_main'
  union all
  select '±   تحويل داخلي بين الوسائل',      key,  amount from exp_out where component='internal_transfer'
  union all
  select 'OUT مشتريات',                     key, -amount from pur_out
) x
group by component, key
having round(sum(amount)::numeric, 2) <> 0
order by key, component;

-- ملاحظات على القراءة:
-- • المرتبات (employee_transactions) مش مضمّنة هنا — لو الفرق لسه مش مفسَّر
--   بعد التفكيك ده، فالبند الناقص غالباً منها.
-- • الرصيد الافتتاحي مخزّن في store_settings.payment_opening_balances
--   (مش جدول)، فمش داخل في الجمع ده — راجعه من صفحة كشف وسائل الدفع.
-- • «تحويل للخزنة الرئيسية» المفروض يساوي اللي دخل الرئيسية فعلاً. لو مجموعه
--   أكبر من (الفواتير − المصاريف − المشتريات) فده معناه إن اتحوّل للرئيسية
--   أكتر من اللي كان في الدرج → الرصيد بيطلع سالب.
