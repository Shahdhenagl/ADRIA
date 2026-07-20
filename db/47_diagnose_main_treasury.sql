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


-- (4) فواتير متعلّمة [MAIN_TREASURY] من غير وسم الربط [SVG:].
--     ⚠️ ده بيقيس **الربط** بس، مش وجود صف الدفتر. الصفوف اللي هتظهر هنا
--     غالباً حساباتها سليمة دلوقتي — بس هي **معرّضة للخطر**: لو أي واحدة فيهم
--     اتحذفت، صف الدفتر المقابل هيتعلّق والرصيد الرئيسي هيبوظ بمقدار مبلغها.
--     دي كل الحركات اللي اتسجّلت قبل إصلاح الربط. للتأكد من الأرقام نفسها
--     استخدم استعلام (5).
select
  pi.id, pi.invoice_number, pi.created_at,
  pi.total, pi.paid_amount, pi.notes
from purchase_invoices pi
where pi.notes like '%[MAIN_TREASURY]%'
  and pi.notes !~ '\[SVG:'
order by pi.created_at desc;


-- (5) ✅ المصالحة — ده الاستعلام اللي بيقول هل الرصيد غلط فعلاً وبكام.
--     بيقارن مجموع دفتر الرئيسية بمجموع الفواتير المقابلة لكل نوع حركة.
--     diff = 0  → سليم.
--     diff > 0  → الدفتر فيه أكتر من الفواتير = صفوف دفتر يتيمة (فاتورتها
--                 اتحذفت). الرصيد الرئيسي غلط بالمقدار ده.
--     diff < 0  → فيه فواتير مالهاش صف دفتر (فشل التسجيل بعد حفظ الفاتورة).
with ledger as (
  select
    source,
    sum(case when direction = 'out' then amount else -amount end) as ledger_net
  from savings_transactions
  where source in ('main_supplier_payment', 'main_supplier_collection')
  group by source
),
invoices as (
  select 'main_supplier_payment' as source, coalesce(sum(paid_amount), 0) as inv_net
  from purchase_invoices
  where notes like '%[MAIN_TREASURY]%' and invoice_number like 'PAY-%'
  union all
  select 'main_supplier_collection', coalesce(sum(-paid_amount), 0)
  from purchase_invoices
  where notes like '%[MAIN_TREASURY]%' and invoice_number like 'SUP-COL-%'
)
select
  coalesce(l.source, i.source)                        as movement,
  coalesce(l.ledger_net, 0)                           as ledger_total,
  coalesce(i.inv_net, 0)                              as invoices_total,
  coalesce(l.ledger_net, 0) - coalesce(i.inv_net, 0)  as diff
from ledger l
full outer join invoices i on i.source = l.source;


-- ── بعد المراجعة ──
-- لو اتأكدت إن صف معيّن يتيم فعلاً (من الاستعلام 2 أو 3)، احذفه بالـ id بالظبط:
--   delete from savings_transactions where id = '<الـ id>';
-- امسح صف واحد في المرة وراجع رصيد الخزنة الرئيسية بعد كل حذف.
-- **متمسحش نتيجة استعلام كاملة دفعة واحدة** — استعلام (1) بيشمل صفوف سليمة.
