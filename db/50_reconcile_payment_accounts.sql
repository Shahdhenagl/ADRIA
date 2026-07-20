-- ADRIA — مصالحة كشف حسابات وسائل الدفع. **للقراءة فقط.**
-- بيحسب الرصيد الصح لكل وسيلة من الداتا الخام عشان تقارنه باللي ظاهر في الصفحة.
--
-- طريقة الاستخدام: شغّل كل قسم، وقارن العمود `expected_balance` بالرقم المعروض
-- في /admin/payment-accounts للنطاق المقابل. لو اتساوا → الداتا مظبوطة.


-- ═══ (1) خزنة المحل — الرصيد المتوقع لكل وسيلة ═══
-- بيطابق computeShopAvailable بعد إصلاح عدّ الرواتب المزدوج.
-- ملاحظة: الرصيد الافتتاحي مخزّن في store_settings مش في جدول، فمش مضاف هنا.
-- شوف قسم (4) لقيمته وضيفه بنفسك لو مش صفر.
with mk as (
  select * from (values ('cash'),('visa'),('wallet'),('instapay'),('method5'),('method6')) as t(key)
),
-- الفواتير: بيع + سداد آجل
o_in as (
  select m.key, sum(m.val) as v from orders o
  cross join lateral (values
    ('cash',     case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0))<>0 then coalesce(o.paid_cash,0)     else case when o.payment_method='cash'     then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('visa',     case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0))<>0 then coalesce(o.paid_visa,0)     else case when o.payment_method='visa'     then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('wallet',   case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0))<>0 then coalesce(o.paid_wallet,0)   else case when o.payment_method='wallet'   then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('instapay', case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0))<>0 then coalesce(o.paid_instapay,0) else case when o.payment_method='instapay' then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('method5',  case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0))<>0 then coalesce(o.paid_method5,0)  else case when o.payment_method='method5'  then abs(coalesce(o.paid_amount,0)) else 0 end end),
    ('method6',  case when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)+coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0))<>0 then coalesce(o.paid_method6,0)  else case when o.payment_method='method6'  then abs(coalesce(o.paid_amount,0)) else 0 end end)
  ) as m(key,val)
  where coalesce(o.is_deleted,false)=false and o.type in ('sale','payment')
  group by m.key
),
o_ref as (
  select coalesce(o.refund_method,o.payment_method,'cash') as key, sum(coalesce(oi.refunded_amount,0)) as v
  from orders o join order_items oi on oi.order_id=o.id
  where coalesce(o.is_deleted,false)=false group by 1
),
-- المصاريف: مستبعد منها المعلّم بالرئيسية وفئة «رواتب» (بتتحسب من جدول الموظفين)
e_rows as (
  select e.*, (coalesce(e.paid_cash,0)+coalesce(e.paid_visa,0)+coalesce(e.paid_wallet,0)+coalesce(e.paid_instapay,0)+coalesce(e.paid_method5,0)+coalesce(e.paid_method6,0)) as ss
  from expenses e
  where coalesce(e.note,'') not like '%[MAIN_TREASURY]%' and e.category <> 'رواتب'
),
e_out as (
  select m.key, sum(case when r.category='تحويل داخلي' then m.val when coalesce(r.amount,0)<0 then abs(m.val) else -m.val end) as v
  from e_rows r
  cross join lateral (values
    ('cash',     case when r.ss<>0 then coalesce(r.paid_cash,0)     else case when r.payment_method='cash'     then abs(coalesce(r.amount,0)) else 0 end end),
    ('visa',     case when r.ss<>0 then coalesce(r.paid_visa,0)     else case when r.payment_method='visa'     then abs(coalesce(r.amount,0)) else 0 end end),
    ('wallet',   case when r.ss<>0 then coalesce(r.paid_wallet,0)   else case when r.payment_method='wallet'   then abs(coalesce(r.amount,0)) else 0 end end),
    ('instapay', case when r.ss<>0 then coalesce(r.paid_instapay,0) else case when r.payment_method='instapay' then abs(coalesce(r.amount,0)) else 0 end end),
    ('method5',  case when r.ss<>0 then coalesce(r.paid_method5,0)  else case when r.payment_method='method5'  then abs(coalesce(r.amount,0)) else 0 end end),
    ('method6',  case when r.ss<>0 then coalesce(r.paid_method6,0)  else case when r.payment_method='method6'  then abs(coalesce(r.amount,0)) else 0 end end)
  ) as m(key,val)
  group by m.key
),
p_rows as (
  select p.*, (coalesce(p.paid_cash,0)+coalesce(p.paid_visa,0)+coalesce(p.paid_wallet,0)+coalesce(p.paid_instapay,0)+coalesce(p.paid_method5,0)+coalesce(p.paid_method6,0)) as ss
  from purchase_invoices p where coalesce(p.notes,'') not like '%[MAIN_TREASURY]%'
),
p_out as (
  select m.key, sum(case when coalesce(r.paid_amount,0)<0 then abs(m.val) else -m.val end) as v
  from p_rows r
  cross join lateral (values
    ('cash',     case when r.ss<>0 then coalesce(r.paid_cash,0)     else case when r.payment_method='cash'     then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('visa',     case when r.ss<>0 then coalesce(r.paid_visa,0)     else case when r.payment_method='visa'     then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('wallet',   case when r.ss<>0 then coalesce(r.paid_wallet,0)   else case when r.payment_method='wallet'   then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('instapay', case when r.ss<>0 then coalesce(r.paid_instapay,0) else case when r.payment_method='instapay' then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('method5',  case when r.ss<>0 then coalesce(r.paid_method5,0)  else case when r.payment_method='method5'  then abs(coalesce(r.paid_amount,0)) else 0 end end),
    ('method6',  case when r.ss<>0 then coalesce(r.paid_method6,0)  else case when r.payment_method='method6'  then abs(coalesce(r.paid_amount,0)) else 0 end end)
  ) as m(key,val)
  group by m.key
),
-- الرواتب/السلف: المصروف من الرئيسية مستبعد
s_out as (
  select m.key, -sum(m.val) as v from employee_transactions s
  cross join lateral (values
    ('cash',coalesce(s.paid_cash,0)),('visa',coalesce(s.paid_visa,0)),('wallet',coalesce(s.paid_wallet,0)),
    ('instapay',coalesce(s.paid_instapay,0)),('method5',coalesce(s.paid_method5,0)),('method6',coalesce(s.paid_method6,0))
  ) as m(key,val)
  where coalesce(s.note,'') not like '%[MAIN_TREASURY]%'
  group by m.key
)
select
  mk.key                                                as method,
  round(coalesce(o_in.v,0)::numeric,2)                  as invoices_in,
  round(coalesce(o_ref.v,0)::numeric,2)                 as refunds_out,
  round(coalesce(e_out.v,0)::numeric,2)                 as expenses_net,
  round(coalesce(p_out.v,0)::numeric,2)                 as purchases_net,
  round(coalesce(s_out.v,0)::numeric,2)                 as salaries_out,
  round((coalesce(o_in.v,0)-coalesce(o_ref.v,0)+coalesce(e_out.v,0)+coalesce(p_out.v,0)+coalesce(s_out.v,0))::numeric,2) as expected_balance
from mk
left join o_in   on o_in.key   = mk.key
left join o_ref  on o_ref.key  = mk.key
left join e_out  on e_out.key  = mk.key
left join p_out  on p_out.key  = mk.key
left join s_out  on s_out.key  = mk.key
order by mk.key;


-- ═══ (2) الخزنة الرئيسية — الرصيد المتوقع لكل وسيلة ═══
-- قارنه بالنطاق «الخزنة الرئيسية» في نفس الصفحة (بعد إضافة الافتتاحي من قسم 4).
select
  method,
  round(sum(case when direction='in' then amount else -amount end)::numeric,2) as ledger_net
from savings_transactions
group by method
order by method;


-- ═══ (3) فحص سلامة: مصاريف «رواتب» من غير معاملة موظف ═══
-- المفروض تطلع فاضية. أي صف هنا = مصروف راتب مسجّل يدوياً من صفحة المالية،
-- وده بيتحسب في كشف وسائل الدفع لكنه مستبعد من حساب درج المحل → اختلاف
-- بين الصفحتين بمقدار المبلغ.
select e.id, e.created_at, e.amount, e.payment_method, e.note
from expenses e
where e.category = 'رواتب'
  and e.employee_transaction_id is null
  and coalesce(e.note,'') not like '%[MAIN_TREASURY]%'
  and not exists (
    select 1 from employee_transactions t
    where date(t.created_at) = date(e.created_at)
      and abs(t.amount) = abs(e.amount)
  )
order by e.created_at desc;


-- ═══ (4) الأرصدة الافتتاحية (تُضاف على نتائج 1 و 2) ═══
select payment_opening_balances as shop_opening,
       savings_opening_balances as main_opening,
       initial_balance          as legacy_cash_opening
from store_settings;
