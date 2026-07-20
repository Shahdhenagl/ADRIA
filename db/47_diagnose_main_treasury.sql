-- ADRIA — تشخيص فروقات الخزنة الرئيسية. **للقراءة فقط، مش بيعدّل أي حاجة.**
-- شغّل كل استعلام لوحده في Supabase SQL editor وشوف النتيجة.
--
-- الخلفية: أي عملية على الخزنة الرئيسية بتتكتب في مكانين — صف في
-- savings_transactions (دفتر الرئيسية) + صف مقابل في expenses أو
-- purchase_invoices. الاتنين لازم يكونوا مربوطين بـ group_id (وسم [SVG:...]
-- في الـ notes)، عشان لو الصف المقابل اتحذف، صف الدفتر يتحذف معاه.
--
-- سداد/تحصيل الموردين من الرئيسية كانوا بيتسجّلوا **من غير group_id**. يعني لو
-- حد حذف فاتورة سداد مورد، صف الدفتر فضل معلّق والرصيد الرئيسي بقى أعلى/أقل
-- من الحقيقة بمقدار المبلغ ده. اتصلح في الكود، بس الصفوف القديمة لسه موجودة.


-- (1) حجم المشكلة: كام صف في دفتر الرئيسية من غير group_id، وبكام؟
--     ده مش معناه إنهم كلهم غلط — دي بس الصفوف المعرّضة للخطر.
select
  source,
  direction,
  count(*)                                    as rows_count,
  sum(amount)                                 as total_amount
from savings_transactions
where group_id is null
group by source, direction
order by total_amount desc;


-- (2) الأخطر: صفوف سداد مورد اتحذفت فاتورتها المقابلة → دي **يتيمة مؤكدة**.
--     الملاحظة بتحتوي رقم الفاتورة (PAY-...)، فبنقدر نتأكد إذا كانت لسه موجودة.
--     كل صف بيظهر هنا = مبلغ متخصوم من الرئيسية من غير سبب قائم.
select
  st.id,
  st.created_at,
  st.direction,
  st.amount,
  st.method,
  st.note,
  substring(st.note from 'PAY-[0-9]+')        as invoice_number
from savings_transactions st
where st.source = 'main_supplier_payment'
  and st.group_id is null
  and substring(st.note from 'PAY-[0-9]+') is not null
  and not exists (
    select 1 from purchase_invoices pi
    where pi.invoice_number = substring(st.note from 'PAY-[0-9]+')
  )
order by st.created_at desc;


-- (3) التحصيلات القديمة (main_supplier_collection): ملاحظتها القديمة **مافيهاش**
--     رقم الفاتورة، فمش ممكن نطابقها آلياً. لازم مراجعة يدوية: قارن كل صف هنا
--     بصفوف SUP-COL في purchase_invoices لنفس المورد ونفس التاريخ والمبلغ.
select
  st.id,
  st.created_at,
  st.amount,
  st.method,
  st.note
from savings_transactions st
where st.source = 'main_supplier_collection'
  and st.group_id is null
order by st.created_at desc;

-- الصفوف المقابلة المفروض تكون هنا (للمقارنة اليدوية مع نتيجة الاستعلام 3):
select
  pi.id, pi.invoice_number, pi.created_at, pi.supplier_id,
  abs(pi.paid_amount) as amount, pi.notes
from purchase_invoices pi
where pi.invoice_number like 'SUP-COL-%'
  and pi.notes like '%[MAIN_TREASURY]%'
order by pi.created_at desc;


-- (4) الاتجاه المعاكس: فواتير متعلّمة [MAIN_TREASURY] من غير صف مقابل في الدفتر.
--     دي معناها فلوس اتصرفت/اتحصّلت على الرئيسية بس الدفتر مايعرفش عنها حاجة
--     (بيحصل لو تسجيل صف الدفتر فشل بعد ما الفاتورة اتحفظت).
select
  pi.id, pi.invoice_number, pi.created_at,
  pi.total, pi.paid_amount, pi.notes
from purchase_invoices pi
where pi.notes like '%[MAIN_TREASURY]%'
  and pi.notes !~ '\[SVG:'
order by pi.created_at desc;


-- ── بعد المراجعة ──
-- لو اتأكدت إن صف معيّن يتيم فعلاً (من الاستعلام 2 أو 3)، احذفه بالـ id بالظبط:
--   delete from savings_transactions where id = '<الـ id>';
-- امسح صف واحد في المرة وراجع رصيد الخزنة الرئيسية بعد كل حذف.
-- **متمسحش نتيجة استعلام كاملة دفعة واحدة** — استعلام (1) بيشمل صفوف سليمة.
