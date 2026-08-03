-- =============================================================================
-- ADRIA — ليه «رصيد بداية اليوم» فيه فرق؟   **للقراءة فقط، مش بيعدّل حاجة.**
-- شغّل كل استعلام لوحده في Supabase SQL editor (المحرر بيرجّع نتيجة آخر استعلام بس).
-- =============================================================================
--  الحالة: اتسجّل دخل بالغلط بتاريخ قديم على خزنة المحل، اتمسح واتعاد على
--  الخزنة الرئيسية — بس رصيد البداية لسه فيه -10.
--
--  رصيد بداية اليوم في الكود (POS → computeDayBudget):
--      totalOpeningBalance(settings)  +  (داخل قبل اليوم)  −  (خارج قبل اليوم)
--  يعني الفرق لازم يكون في واحد من التلاتة. الاستعلامات تحت بتفصلهم بالترتيب
--  من الأسرع للأشمل.
--
--  ⚠️ عدّل `day` و `day_start_hour` في الـ CTE بتاع كل استعلام لو محتاج
--     (day_start_hour من إعدادات المحل → ساعة بداية اليوم، الافتراضي 3).
-- =============================================================================


-- =============================================================================
-- (1) 🎯 الأسرع: كل صف قيمته 10 في أي جدول.
--     الصف اللي اتمسح المفروض ما يظهرش خالص — لو ظهر يبقى المسح ما تمّش.
--     الصف الموسوم [MAIN_TREASURY] ده الجديد على الرئيسية، وهو **مستبعد من
--     خزنة المحل أصلاً** فمش هو السبب.
-- =============================================================================
with p as (select date '2026-08-02' as day, 3 as hr)
select 'expenses' as "الجدول", e.id::text as "id", e.created_at as "التاريخ",
       e.category as "النوع", e.amount as "المبلغ", e.note as "الملاحظة",
       case when coalesce(e.note,'') like '%[MAIN_TREASURY]%' then 'الرئيسية' else 'المحل' end as "الخزنة"
from expenses e where abs(coalesce(e.amount,0)) = 10
union all
select 'employee_transactions', t.id::text, t.created_at, t.type, t.amount, t.note,
       case when coalesce(t.note,'') like '%[MAIN_TREASURY]%' then 'الرئيسية' else 'المحل' end
from employee_transactions t where abs(coalesce(t.amount,0)) = 10
union all
select 'purchase_invoices', pi.id::text, pi.created_at, 'شراء', pi.paid_amount, pi.notes,
       case when coalesce(pi.notes,'') like '%[MAIN_TREASURY]%' then 'الرئيسية' else 'المحل' end
from purchase_invoices pi where abs(coalesce(pi.paid_amount,0)) = 10
union all
select 'savings_transactions', s.id::text, s.created_at, s.source, s.amount, s.note, 'الرئيسية'
from savings_transactions s where abs(coalesce(s.amount,0)) = 10
order by 3 desc;


-- =============================================================================
-- (2) الأرصدة الافتتاحية من الإعدادات.
--     لو الـ -10 مكتوب هنا، مفيش أي صف حركة له علاقة بالموضوع — عدّله من
--     الإعدادات → الأرصدة الافتتاحية وخلاص.
-- =============================================================================
select
  initial_balance          as "افتتاحي الكاش (العمود القديم)",
  payment_opening_balances as "افتتاحي كل وسيلة (المستخدم حالياً)",
  savings_opening_balances as "افتتاحي الرئيسية (مالوش علاقة بالمحل)"
from store_settings limit 1;


-- =============================================================================
-- (3) صافي حركة «قبل اليوم» على خزنة المحل مفصولة بمصدرها.
--     مجموع عمود «الصافي» + الافتتاحي (استعلام 2) = رصيد بداية اليوم المعروض.
--     البند اللي فيه الفرق هو اللي تدوّر في صفوفه.
--     ملاحظة: المصروفات بالسالب = إيرادات يدوية (بتزوّد الدرج).
-- =============================================================================
with p as (
  select ((date '2026-08-02' + (3 || ' hours')::interval) at time zone 'Africa/Cairo') as start_ts
)
select 'فواتير بيع/سداد (داخل +)' as "البند", count(*) as "عدد الصفوف",
       round(sum(coalesce(o.paid_amount,0))::numeric, 2) as "الصافي"
from orders o, p
where o.created_at < p.start_ts and coalesce(o.is_deleted,false) = false
  and o.type in ('sale','payment') and coalesce(o.notes,'') not like '%[MAIN_TREASURY]%'
union all
select 'مصروفات (خارج +) / إيرادات (سالب)', count(*), round(sum(coalesce(e.amount,0))::numeric, 2)
from expenses e, p
where e.created_at < p.start_ts and coalesce(e.note,'') not like '%[MAIN_TREASURY]%'
union all
select 'مشتريات (خارج +)', count(*), round(sum(coalesce(pi.paid_amount,0))::numeric, 2)
from purchase_invoices pi, p
where pi.created_at < p.start_ts and coalesce(pi.notes,'') not like '%[MAIN_TREASURY]%'
union all
select 'رواتب/سلف/حوافز (خارج +)', count(*), round(sum(coalesce(t.amount,0))::numeric, 2)
from employee_transactions t, p
where t.created_at < p.start_ts and coalesce(t.note,'') not like '%[MAIN_TREASURY]%';


-- =============================================================================
-- (3-ب) 🎯 نفس فكرة (3) بس **بالإشارات مظبوطة ومعاها الافتتاحي والإجمالي**،
--       فالمجموع بيساوي «رصيد بداية اليوم» المعروض بالظبط.
--       البند اللي رقمه مش متوقّع = مكان المشكلة.
--
--       ملاحظة: تصنيف «رواتب» مستبعد من المصروفات عن قصد — الرواتب بتتعدّ من
--       employee_transactions (وإلا اتعدّت مرتين). نفس منطق الكود.
-- =============================================================================
with p as (
  select ((date '2026-08-03' + interval '3 hours') at time zone 'Africa/Cairo') as start_ts
),
rows_ as (
  select 0 as ord, 'الرصيد الافتتاحي (من الإعدادات)' as bnd,
    coalesce(
      (select sum(v::numeric) from store_settings s, jsonb_each_text(s.payment_opening_balances) as kv(k, v)),
      (select initial_balance from store_settings limit 1),
      0) as val
  union all
  select 1, 'فواتير بيع/سداد (داخل +)', sum(coalesce(o.paid_amount, 0))
  from orders o, p
  where o.created_at < p.start_ts and coalesce(o.is_deleted, false) = false
    and o.type in ('sale', 'payment') and coalesce(o.notes, '') not like '%[MAIN_TREASURY]%'
  union all
  select 2, 'مصروفات (خارج −) / إيرادات يدوية (+)', -sum(coalesce(e.amount, 0))
  from expenses e, p
  where e.created_at < p.start_ts and coalesce(e.note, '') not like '%[MAIN_TREASURY]%'
    and e.category <> 'رواتب'
  union all
  select 3, 'مشتريات (خارج −)', -sum(coalesce(pi.paid_amount, 0))
  from purchase_invoices pi, p
  where pi.created_at < p.start_ts and coalesce(pi.notes, '') not like '%[MAIN_TREASURY]%'
  union all
  select 4, 'رواتب/سلف/حوافز (خارج −)', -sum(coalesce(t.amount, 0))
  from employee_transactions t, p
  where t.created_at < p.start_ts and coalesce(t.note, '') not like '%[MAIN_TREASURY]%'
)
select bnd as "البند", round(coalesce(val, 0)::numeric, 2) as "القيمة"
from rows_
union all
select '══ الإجمالي = رصيد بداية اليوم ══', round(coalesce(sum(val), 0)::numeric, 2) from rows_;


-- =============================================================================
-- (3-ج) 🎯 رصيد بداية اليوم **لكل وسيلة دفع** في خزنة المحل.
--       الإجمالي ممكن يكون موجب بينما وسيلة واحدة سالبة — وده اللي بيظهر
--       كرقم سالب صغير في شاشة التقفيل وفي خانة «بالمحل».
--
--       تحقّق: مجموع عمود «الرصيد» لازم يساوي إجمالي استعلام (3-ب).
--
--       قاعدة التقسيم (زي applySplit في الكود): لو أي عمود paid_* مش صفر
--       بناخد الأعمدة دي، وإلا بنحمّل المبلغ كله على payment_method.
-- =============================================================================
with p as (
  select ((date '2026-08-03' + interval '3 hours') at time zone 'Africa/Cairo') as start_ts
),
k as (select unnest(array['cash','visa','wallet','instapay','method5','method6']) as m),
ob as (
  select kv.k as m, kv.v::numeric as v
  from store_settings st, jsonb_each_text(st.payment_opening_balances) as kv(k, v)
),
ords as (
  select k.m, sum(sp.val) as v
  from orders o cross join k cross join p cross join lateral (
    select case
      when (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)
           +coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
      then case k.m when 'cash' then coalesce(o.paid_cash,0) when 'visa' then coalesce(o.paid_visa,0)
                    when 'wallet' then coalesce(o.paid_wallet,0) when 'instapay' then coalesce(o.paid_instapay,0)
                    when 'method5' then coalesce(o.paid_method5,0) else coalesce(o.paid_method6,0) end
      else case when coalesce(o.payment_method,'cash') = k.m then coalesce(o.paid_amount,0) else 0 end
    end as val
  ) sp
  where o.created_at < p.start_ts and coalesce(o.is_deleted,false) = false
    and o.type in ('sale','payment') and coalesce(o.notes,'') not like '%[MAIN_TREASURY]%'
  group by k.m
),
exp_ as (
  select k.m, sum(
    case
      when e.category = 'تحويل داخلي' then sp.val    -- بالإشارة: موجب داخل / سالب خارج
      when coalesce(e.amount,0) < 0    then abs(sp.val) -- مبلغ سالب = إيراد يدوي (داخل)
      else -sp.val                                    -- مصروف عادي (خارج)
    end) as v
  from expenses e cross join k cross join p cross join lateral (
    select case
      when (coalesce(e.paid_cash,0)+coalesce(e.paid_visa,0)+coalesce(e.paid_wallet,0)
           +coalesce(e.paid_instapay,0)+coalesce(e.paid_method5,0)+coalesce(e.paid_method6,0)) <> 0
      then case k.m when 'cash' then coalesce(e.paid_cash,0) when 'visa' then coalesce(e.paid_visa,0)
                    when 'wallet' then coalesce(e.paid_wallet,0) when 'instapay' then coalesce(e.paid_instapay,0)
                    when 'method5' then coalesce(e.paid_method5,0) else coalesce(e.paid_method6,0) end
      else case when coalesce(e.payment_method,'cash') = k.m then coalesce(e.amount,0) else 0 end
    end as val
  ) sp
  where e.created_at < p.start_ts and coalesce(e.note,'') not like '%[MAIN_TREASURY]%'
    and e.category <> 'رواتب'
  group by k.m
),
sal as (
  select k.m, sum(-sp.val) as v
  from employee_transactions t cross join k cross join p cross join lateral (
    select case
      when (coalesce(t.paid_cash,0)+coalesce(t.paid_visa,0)+coalesce(t.paid_wallet,0)
           +coalesce(t.paid_instapay,0)+coalesce(t.paid_method5,0)+coalesce(t.paid_method6,0)) <> 0
      then case k.m when 'cash' then coalesce(t.paid_cash,0) when 'visa' then coalesce(t.paid_visa,0)
                    when 'wallet' then coalesce(t.paid_wallet,0) when 'instapay' then coalesce(t.paid_instapay,0)
                    when 'method5' then coalesce(t.paid_method5,0) else coalesce(t.paid_method6,0) end
      else case when coalesce(t.payment_method,'cash') = k.m then coalesce(t.amount,0) else 0 end
    end as val
  ) sp
  where t.created_at < p.start_ts and coalesce(t.note,'') not like '%[MAIN_TREASURY]%'
  group by k.m
),
pur as (
  select k.m, sum(-sp.val) as v
  from purchase_invoices pi cross join k cross join p cross join lateral (
    select case
      when (coalesce(pi.paid_cash,0)+coalesce(pi.paid_visa,0)+coalesce(pi.paid_wallet,0)
           +coalesce(pi.paid_instapay,0)+coalesce(pi.paid_method5,0)+coalesce(pi.paid_method6,0)) <> 0
      then case k.m when 'cash' then coalesce(pi.paid_cash,0) when 'visa' then coalesce(pi.paid_visa,0)
                    when 'wallet' then coalesce(pi.paid_wallet,0) when 'instapay' then coalesce(pi.paid_instapay,0)
                    when 'method5' then coalesce(pi.paid_method5,0) else coalesce(pi.paid_method6,0) end
      else case when coalesce(pi.payment_method,'cash') = k.m then coalesce(pi.paid_amount,0) else 0 end
    end as val
  ) sp
  where pi.created_at < p.start_ts and coalesce(pi.notes,'') not like '%[MAIN_TREASURY]%'
  group by k.m
)
select
  k.m                                                                as "الوسيلة",
  round(coalesce(ob.v, 0)::numeric, 2)                               as "الافتتاحي",
  round(coalesce(ords.v, 0)::numeric, 2)                             as "الفواتير",
  round(coalesce(exp_.v, 0)::numeric, 2)                             as "مصروفات/إيرادات",
  round(coalesce(sal.v, 0)::numeric, 2)                              as "رواتب/سلف",
  round(coalesce(pur.v, 0)::numeric, 2)                              as "مشتريات",
  round((coalesce(ob.v,0) + coalesce(ords.v,0) + coalesce(exp_.v,0)
       + coalesce(sal.v,0) + coalesce(pur.v,0))::numeric, 2)         as "الرصيد"
from k
left join ob    on ob.m    = k.m
left join ords  on ords.m  = k.m
left join exp_  on exp_.m  = k.m
left join sal   on sal.m   = k.m
left join pur   on pur.m   = k.m
order by 1;


-- =============================================================================
-- (4) آخر 40 حركة «قبل اليوم» على خزنة المحل — لو الاستعلام 1 ما طلّعش حاجة.
--     الصف المتسجّل بتاريخ قديم بيبان هنا: تاريخه قديم بس ساعته 3 العصر
--     بالظبط (كل الصفوف الملحوقة بتتختم بمنتصف اليوم المحاسبي).
-- =============================================================================
with p as (
  select ((date '2026-08-02' + (3 || ' hours')::interval) at time zone 'Africa/Cairo') as start_ts
)
select e.created_at as "التاريخ", 'مصروف/إيراد' as "النوع", e.category as "التصنيف",
       e.amount as "المبلغ", e.note as "الملاحظة"
from expenses e, p
where e.created_at < p.start_ts and coalesce(e.note,'') not like '%[MAIN_TREASURY]%'
order by e.created_at desc
limit 40;


-- =============================================================================
-- (5) صفوف يتيمة: دفتر الرئيسية فيه صف من غير group_id.
--     مش كلهم غلط — دي الصفوف المعرّضة للخطر لما الصف المقابل يتحذف.
-- =============================================================================
select source, direction, count(*) as "عدد الصفوف", sum(amount) as "الإجمالي"
from savings_transactions
where group_id is null
group by source, direction
order by 4 desc;
