-- =============================================================================
-- ADRIA — صفوف رواتب/سلف يتيمة (الخزنة وكشف الموظف مش متطابقين)
-- شغّل كل استعلام لوحده. الاستعلامات 1 و 2 **قراءة فقط**.
-- =============================================================================
--  الراتب/السلفة/الحافز بيتكتب في مكانين:
--     • employee_transactions  → المستحق على الموظف (بيتخصم من راتبه)
--     • expenses (تصنيف «رواتب») → الفلوس الخارجة من الخزنة
--
--  الربط كان بيشتغل في اتجاه واحد بس: الحذف من صفحة الموظفين كان بيمسح
--  المصروف، لكن الحذف من صفحة الخزنة كان **بيسيب صف الموظف يتيم** — فالسلفة
--  تتلغي من الخزنة وتفضل متخصومة من راتب الموظف. ده سبب «صرفتها مرتين ومسحت
--  واحدة ولسه ظاهرة». اتصلح في الكود، بس الصفوف القديمة محتاجة مراجعة يدوية.
--
--  ملاحظة: صفوف الخزنة الرئيسية ([MAIN_TREASURY]) مستبعدة — ليها مسارها الخاص.
-- =============================================================================


-- =============================================================================
-- (1) 🎯 الأخطر: صف على الموظف من غير مصروف مقابل.
--     يعني الموظف متخصوم منه فلوس **ما خرجتش من الخزنة أصلاً**.
--     ده اللي بيدّي فرق زي «٥٠٠ ظاهرة مرتين».
-- =============================================================================
select
  t.id            as "id صف الموظف",
  emp.name        as "الموظف",
  t.created_at    as "التاريخ",
  t.type          as "النوع",
  t.amount        as "المبلغ",
  t.month         as "الشهر",
  t.note          as "الملاحظة"
from employee_transactions t
join employees emp on emp.id = t.employee_id
where coalesce(t.note, '') not like '%[MAIN_TREASURY]%'
  and not exists (
    select 1 from expenses x
    where x.employee_transaction_id = t.id
       or (
         x.category = 'رواتب'
         and date(x.created_at) = date(t.created_at)
         and abs(coalesce(x.amount, 0)) = abs(coalesce(t.amount, 0))
       )
  )
order by t.created_at desc;


-- =============================================================================
-- (1-ب) 🎯 الأهم — الاستعلام (1) عنده نقطة عمياء: المطابقة الاحتياطية بالتاريخ
--       + المبلغ، فلو نفس المبلغ اتسجّل مرتين في نفس اليوم، المصروف الواحد
--       الفاضل بيطابق الصفّين واليتيم بيتخفي. الحل: **نعدّ** مش نطابق.
--
--       الفرق موجب = صفوف على الموظفين أكتر من الخزنة (خصم من غير صرف).
--       الفرق سالب = الخزنة دفعت أكتر مما هو متسجّل على الموظفين.
-- =============================================================================
with tx as (
  select date(created_at) as d, abs(coalesce(amount, 0)) as amt, count(*) as n
  from employee_transactions
  where coalesce(note, '') not like '%[MAIN_TREASURY]%'
  group by 1, 2
),
ex as (
  select date(created_at) as d, abs(coalesce(amount, 0)) as amt, count(*) as n
  from expenses
  where category = 'رواتب' and coalesce(note, '') not like '%[MAIN_TREASURY]%'
  group by 1, 2
)
select
  coalesce(tx.d, ex.d)                     as "التاريخ",
  coalesce(tx.amt, ex.amt)                 as "المبلغ",
  coalesce(tx.n, 0)                        as "عدد صفوف الموظف",
  coalesce(ex.n, 0)                        as "عدد صفوف الخزنة",
  coalesce(tx.n, 0) - coalesce(ex.n, 0)    as "الفرق"
from tx
full outer join ex on tx.d = ex.d and tx.amt = ex.amt
where coalesce(tx.n, 0) <> coalesce(ex.n, 0)
order by 1 desc;


-- =============================================================================
-- (1-ج) بعد ما تحدد التاريخ والمبلغ من (1-ب)، اعرض الصفوف نفسها بالتفصيل.
--       غيّر المبلغ والتاريخ تحت. الصفوف بتظهر جنب بعض عشان تشوف الزيادة فين.
-- =============================================================================
select 'كشف الموظف' as "المصدر", t.id::text as "id", t.created_at as "التاريخ",
       t.type as "النوع", t.amount as "المبلغ", t.month as "الشهر", t.note as "الملاحظة"
from employee_transactions t
where abs(coalesce(t.amount, 0)) = 500
union all
select 'الخزنة (مصروف)', x.id::text, x.created_at,
       coalesce(x.employee_transaction_id::text, '— مش مربوط'), x.amount, null, x.note
from expenses x
where x.category = 'رواتب' and abs(coalesce(x.amount, 0)) = 500
order by 3 desc, 1;


-- =============================================================================
-- (2) العكس: مصروف «رواتب» من غير صف على الموظف.
--     الخزنة دفعت والموظف مش متسجّل عليه — يعني السلفة مش هتتخصم من راتبه.
-- =============================================================================
select
  x.id         as "id المصروف",
  x.created_at as "التاريخ",
  x.amount     as "المبلغ",
  x.note       as "الملاحظة"
from expenses x
where x.category = 'رواتب'
  and coalesce(x.note, '') not like '%[MAIN_TREASURY]%'
  and not exists (
    select 1 from employee_transactions t
    where t.id = x.employee_transaction_id
       or (
         date(t.created_at) = date(x.created_at)
         and abs(coalesce(t.amount, 0)) = abs(coalesce(x.amount, 0))
       )
  )
order by x.created_at desc;


-- =============================================================================
-- (3) ⚠️ الإصلاح — نفّذه بالـ id بالظبط بعد ما تتأكد من الاستعلام 1.
--     الصف اليتيم في كشف الموظف = خصم على موظف من غير صرف حقيقي، فبيتشال.
--     **متشغّلهوش على أعمى** — راجع كل صف الأول، ممكن يكون صرف حقيقي ومصروفه
--     هو اللي اتمسح بالغلط (وساعتها الصح تعيد تسجيل المصروف مش تمسح الصف).
-- =============================================================================
-- delete from employee_transactions where id in (
--   'حط-الـ-id-هنا',
--   'و-ده-كمان-لو-أكتر-من-واحد'
-- );
