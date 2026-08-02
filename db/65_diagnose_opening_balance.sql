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
