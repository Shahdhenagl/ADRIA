-- =============================================================================
-- ADRIA — فحص سلامة قاعدة البيانات.  **قراءة فقط — مبيعدّلش أي حاجة إطلاقاً.**
-- شغّله في Supabase SQL Editor وقت ما تحب (كل أسبوع مثلاً، أو بعد أي حذف يدوي).
-- =============================================================================
-- الفكرة: النظام بيكتب المعاملة الواحدة في أكتر من مكان مربوطين ببعض
-- (حساب المورد + دفتر الخزنة + المصروفات + المخزون). لو حصل حذف ناقص أو
-- انقطاع في النص، بيفضل طرف معلّق والأرقام تبان غلط.
-- كل فحص هنا بيدوّر على «طرف من غير طرفه التاني».
--
-- الاستخدام:
--   1) شغّل القسم (0) — بيديك جدول ملخص: كل فحص وعدد المشاكل فيه.
--   2) أي سطر عدده > 0، شغّل استعلام التفاصيل بتاعه من القسم اللي تحت.
--   3) العدد كله أصفار = الدنيا مظبوطة.
-- =============================================================================


-- ═════════════════════════════════════════════════════════════════════════════
-- (0) الملخص — شغّل ده الأول
-- ═════════════════════════════════════════════════════════════════════════════
with
-- الوسم [SVG:<id>] في الملاحظات بيربط الصف بحركة الخزنة الرئيسية.
svg as (select '\[SVG:([0-9a-fA-F-]{6,})\]' as re),

-- 1) صف مورد (سداد/تحصيل/فاتورة) معلّم [SVG] لكن حركة الخزنة اتمسحت.
orphan_supplier as (
  select pi.id from purchase_invoices pi, svg
  where pi.notes like '%[SVG:%'
    and not exists (
      select 1 from savings_transactions st
      where st.group_id::text = substring(pi.notes from svg.re))
),

-- 2) العكس: حركة خزنة لمعاملة مورد لكن صف المورد اتمسح.
orphan_treasury as (
  select distinct st.group_id from savings_transactions st
  where st.group_id is not null
    and st.source in ('main_purchase','main_supplier_payment','main_supplier_collection','main_supplier_return')
    and not exists (
      select 1 from purchase_invoices pi
      where pi.notes like '%[SVG:' || st.group_id::text || ']%')
),

-- 3) مصروف معلّم [SVG] لكن حركة الخزنة المقابلة اتمسحت (مصروف معلّق).
orphan_expense as (
  select e.id from expenses e, svg
  where e.note like '%[SVG:%'
    and not exists (
      select 1 from savings_transactions st
      where st.group_id::text = substring(e.note from svg.re))
),

-- 4) فاتورة بيع: المحصّل ≠ مجموع تقسيمة وسائل الدفع.
--    مستبعد منها الحالتين اللي بيكسروا المساواة **بشكل مقصود**:
--      • الاستبدال (exchange_data) — شوف db/55.
--      • الفاتورة الآجل اللي اتسدّدت بعدين: السداد بيزوّد paid_amount على الفاتورة
--        الأصلية لكن التقسيمة بتفضل بتاعة أول تحصيل (السداد نفسه صف payment مستقل).
--        وكمان الخصم/الإكرامية وقت السداد بيتضاف على paid_amount وهو مش فلوس
--        دخلت. فبنطرح الاتنين (المبلغ + الخصم المكتوب في ملاحظة صف السداد).
--      • المرتجع: المبلغ المردود بينزل من paid_amount والتقسيمة بتفضل بتاعة
--        التحصيل الأصلي، فبنضيف المردود (order_items.refunded_amount) قبل المقارنة.
--    المعادلة الصح: تقسيمة الوسائل = المحصّل + المردود − سدادات الأجل − خصوماتها.
bad_order_split as (
  select o.id from orders o
  where coalesce(o.is_deleted, false) = false
    and o.exchange_data is null
    and (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)
        +coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
    and abs(
          coalesce(o.paid_amount,0)
          + coalesce((select sum(coalesce(it.refunded_amount,0)) from order_items it
                      where it.order_id = o.id), 0)
          - coalesce((
              select sum(
                coalesce(p.paid_amount,0)
                + coalesce(nullif(substring(p.notes from 'خصم/إكرامية: ([0-9.]+)'), '')::numeric, 0)
              )
              from orders p
              where coalesce(p.is_deleted,false) = false
                and p.type = 'payment'
                -- المسافة بعد الرقم مهمة: من غيرها '#2' بيطابق '#21' و'#266'.
                and p.notes like '%سداد أجل للفاتورة رقم #' || o.id || ' %'), 0)
          - (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)
            +coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0))
        ) > 0.01
),

-- 5) معاملة مورد: المدفوع ≠ مجموع تقسيمة وسائل الدفع.
bad_purchase_split as (
  select pi.id from purchase_invoices pi
  where (coalesce(pi.paid_cash,0)+coalesce(pi.paid_visa,0)+coalesce(pi.paid_wallet,0)
        +coalesce(pi.paid_instapay,0)+coalesce(pi.paid_method5,0)+coalesce(pi.paid_method6,0)) <> 0
    and abs(coalesce(pi.paid_amount,0)
        - (coalesce(pi.paid_cash,0)+coalesce(pi.paid_visa,0)+coalesce(pi.paid_wallet,0)
          +coalesce(pi.paid_instapay,0)+coalesce(pi.paid_method5,0)+coalesce(pi.paid_method6,0))) > 0.01
),

-- 6) مخزون بالسالب.
negative_stock as (select id from products where coalesce(stock_quantity,0) < 0),

-- 7) الكمية المعروضة في المحل أكبر من إجمالي المخزون.
display_gt_stock as (
  select id from products where coalesce(display_quantity,0) > coalesce(stock_quantity,0) + 0.0001
),

-- 8) مخزون موجود وتكلفته صفر ⇒ بيتباع بربح كامل من غير رأس مال (شوف db/59).
zero_cost_stock as (
  select id from products
  where coalesce(stock_quantity,0) > 0
    and coalesce(nullif(average_purchase_price,0), nullif(purchase_price,0), 0) = 0
),

-- 9) حركة موظف (راتب/سلفة/حافز) من غير صف مصروف مقابل ⇒ الخزنة مش شايفة الفلوس خرجت.
--    مهم: التلات أنواع كلها بتتكتب في expenses بـ category='رواتب' (مش الراتب بس).
salary_without_expense as (
  select t.id from employee_transactions t
  where not exists (select 1 from expenses e where e.employee_transaction_id = t.id)
    and not exists (
      select 1 from expenses e
      where e.category = 'رواتب'
        and e.employee_transaction_id is null
        and abs(coalesce(e.amount,0) - coalesce(t.amount,0)) < 0.01
        and date_trunc('day', e.created_at) = date_trunc('day', t.created_at))
),

-- 10) مصروف «رواتب» مش مربوط بأي حركة موظف ⇒ يا إما مزدوج يا إما يتيم.
--    الصفوف الأقدم من db/49 مالهاش employee_transaction_id، فبنطابقها بالمبلغ
--    واليوم على **أي** نوع حركة (راتب/سلفة/حافز).
expense_salary_orphan as (
  select e.id from expenses e
  where e.category = 'رواتب'
    and e.employee_transaction_id is null
    and not exists (
      select 1 from employee_transactions t
      where abs(coalesce(e.amount,0) - coalesce(t.amount,0)) < 0.01
        and date_trunc('day', e.created_at) = date_trunc('day', t.created_at))
),

-- 11) باركود مكرر على أكتر من منتج ⇒ المسح على الكاشير بيجيب المنتج الغلط.
dup_barcode as (
  select barcode from products
  where barcode is not null and barcode <> ''
  group by barcode having count(*) > 1
),

-- 12) حركة موظف مصروفة من الرئيسية ([SVG]) لكن صف الدفتر اتمسح ⇒ سلفة/راتب
--     هيتخصم من الموظف رغم إن الصرف اتلغى. (نفس عيلة فحص 1 بس ناحية الموظفين.)
orphan_employee_tx as (
  select t.id from employee_transactions t, svg
  where t.note like '%[SVG:%'
    and not exists (
      select 1 from savings_transactions st
      where st.group_id::text = substring(t.note from svg.re))
),

-- 13) العكس: صرف/إيراد في دفتر الرئيسية بلا مصروف ولا حركة موظف مقابلة
--     ⇒ الرصيد الرئيسي ناقص/زايد من غير سبب مسجّل.
orphan_main_movement as (
  select distinct st.group_id from savings_transactions st
  where st.group_id is not null
    and st.source in ('main_expense','main_income')
    and not exists (select 1 from expenses e where e.note like '%[SVG:' || st.group_id::text || ']%')
    and not exists (select 1 from employee_transactions t where t.note like '%[SVG:' || st.group_id::text || ']%')
    and not exists (select 1 from purchase_invoices pi where pi.notes like '%[SVG:' || st.group_id::text || ']%')
    and not exists (select 1 from orders o where o.notes like '%[SVG:' || st.group_id::text || ']%')
)

select * from (
  select 1 as "#", 'صفوف مورد يتيمة (اتمسحت من الخزنة وفضلت في المورد)' as "الفحص",
         (select count(*) from orphan_supplier) as "عدد", 'تفاصيل (1) — إصلاحها في db/58' as "الخطوة"
  union all select 2, 'حركة خزنة لمعاملة مورد بدون صف في حساب المورد',
         (select count(*) from orphan_treasury), 'تفاصيل (2)'
  union all select 3, 'مصروف معلّق: موسوم بالخزنة الرئيسية وحركتها اتمسحت',
         (select count(*) from orphan_expense), 'تفاصيل (3)'
  union all select 4, 'فاتورة بيع: المحصّل ≠ تقسيمة وسائل الدفع',
         (select count(*) from bad_order_split), 'تفاصيل (4)'
  union all select 5, 'معاملة مورد: المدفوع ≠ تقسيمة وسائل الدفع',
         (select count(*) from bad_purchase_split), 'تفاصيل (5)'
  union all select 6, 'مخزون بالسالب',
         (select count(*) from negative_stock), 'تفاصيل (6)'
  union all select 7, 'الكمية المعروضة أكبر من إجمالي المخزون',
         (select count(*) from display_gt_stock), 'تفاصيل (7)'
  union all select 8, 'مخزون موجود وتكلفته صفر (ربح بلا رأس مال)',
         (select count(*) from zero_cost_stock), 'تفاصيل (8)'
  union all select 9, 'راتب مصروف بدون صف مصروف مقابل',
         (select count(*) from salary_without_expense), 'تفاصيل (9)'
  union all select 10, 'مصروف «رواتب» مش مربوط بحركة موظف',
         (select count(*) from expense_salary_orphan), 'تفاصيل (10)'
  union all select 11, 'باركود مكرر على أكتر من منتج',
         (select count(*) from dup_barcode), 'تفاصيل (11)'
  union all select 12, 'حركة موظف مصروفة من الرئيسية وحركتها في الدفتر اتمسحت',
         (select count(*) from orphan_employee_tx), 'تفاصيل (12)'
  union all select 13, 'حركة في دفتر الرئيسية بلا مصروف/حركة موظف مقابلة',
         (select count(*) from orphan_main_movement), 'تفاصيل (13)'
) x
order by "عدد" desc, "#";


-- ═════════════════════════════════════════════════════════════════════════════
-- التفاصيل — شغّل بس اللي عدده طلع > 0 في الملخص
-- ═════════════════════════════════════════════════════════════════════════════

-- (1) صفوف مورد يتيمة — الأكثر شيوعاً: اتمسحت من صفحة الخزنة الرئيسية وفضلت هنا.
--     العلاج من الواجهة: الموردين ← المورد ← كشف الحساب ← زرار الحذف على الصف.
--     (لو الصف فاتورة مشتريات فيها أصناف، اتبع db/58 عشان المخزون يترجّع صح.)
-- select pi.id, pi.invoice_number, s.name as supplier, pi.total, pi.paid_amount,
--        (select count(*) from purchase_items it where it.invoice_id = pi.id) as items, pi.created_at, pi.notes
-- from purchase_invoices pi left join suppliers s on s.id = pi.supplier_id
-- where pi.notes like '%[SVG:%'
--   and not exists (select 1 from savings_transactions st
--                   where st.group_id::text = substring(pi.notes from '\[SVG:([0-9a-fA-F-]{6,})\]'))
-- order by pi.created_at desc;

-- (2) حركات خزنة لمعاملات مورد بدون صف مورد.
-- select st.group_id, st.source, st.direction, st.method, st.amount, st.note, st.created_at
-- from savings_transactions st
-- where st.group_id is not null
--   and st.source in ('main_purchase','main_supplier_payment','main_supplier_collection','main_supplier_return')
--   and not exists (select 1 from purchase_invoices pi where pi.notes like '%[SVG:' || st.group_id::text || ']%')
-- order by st.created_at desc;

-- (3) مصروفات معلّقة (حركة الخزنة المقابلة اتمسحت).
-- select e.id, e.category, e.amount, e.note, e.created_at from expenses e
-- where e.note like '%[SVG:%'
--   and not exists (select 1 from savings_transactions st
--                   where st.group_id::text = substring(e.note from '\[SVG:([0-9a-fA-F-]{6,})\]'))
-- order by e.created_at desc;

-- (4) فواتير بيع تقسيمتها مش مظبوطة — بيعرض مكوّنات الفرق عشان تشوف مصدره.
--     residual = المحصّل − سدادات الأجل − خصومات السداد − تقسيمة الوسائل.
--     موجب  ⇒ فلوس متسجّلة على الفاتورة من غير ما تتوزّع على وسيلة دفع.
--     سالب  ⇒ التقسيمة أكبر من المحصّل (غالباً مرتجع اتصرف من فاتورة قديمة).
-- with pay as (
--   select o.id as order_id,
--          coalesce(sum(coalesce(p.paid_amount,0)), 0) as debt_payments,
--          coalesce(sum(coalesce(nullif(substring(p.notes from 'خصم/إكرامية: ([0-9.]+)'), '')::numeric, 0)), 0) as debt_discounts
--   from orders o
--   left join orders p on coalesce(p.is_deleted,false) = false and p.type = 'payment'
--                     and p.notes like '%سداد أجل للفاتورة رقم #' || o.id || ' %'
--   group by o.id),
-- ref as (select order_id, coalesce(sum(coalesce(refunded_amount,0)),0) as refunded
--         from order_items group by order_id)
-- select o.id, o.type, o.total, o.paid_amount, coalesce(ref.refunded,0) as refunded,
--        pay.debt_payments, pay.debt_discounts,
--        (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)
--        +coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) as sum_splits,
--        round((coalesce(o.paid_amount,0) + coalesce(ref.refunded,0) - pay.debt_payments - pay.debt_discounts
--        - (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)
--          +coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)))::numeric, 2) as residual,
--        o.payment_method, o.notes, o.created_at
-- from orders o join pay on pay.order_id = o.id left join ref on ref.order_id = o.id
-- where coalesce(o.is_deleted,false) = false and o.exchange_data is null
--   and (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)
--       +coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0)) <> 0
--   and abs(coalesce(o.paid_amount,0) + coalesce(ref.refunded,0) - pay.debt_payments - pay.debt_discounts
--       - (coalesce(o.paid_cash,0)+coalesce(o.paid_visa,0)+coalesce(o.paid_wallet,0)
--         +coalesce(o.paid_instapay,0)+coalesce(o.paid_method5,0)+coalesce(o.paid_method6,0))) > 0.01
-- order by o.created_at desc;

-- (5) معاملات موردين تقسيمتها مش مظبوطة.
-- select pi.id, pi.invoice_number, pi.total, pi.paid_amount,
--        (coalesce(pi.paid_cash,0)+coalesce(pi.paid_visa,0)+coalesce(pi.paid_wallet,0)
--        +coalesce(pi.paid_instapay,0)+coalesce(pi.paid_method5,0)+coalesce(pi.paid_method6,0)) as sum_splits,
--        pi.created_at
-- from purchase_invoices pi
-- where (coalesce(pi.paid_cash,0)+coalesce(pi.paid_visa,0)+coalesce(pi.paid_wallet,0)
--       +coalesce(pi.paid_instapay,0)+coalesce(pi.paid_method5,0)+coalesce(pi.paid_method6,0)) <> 0
--   and abs(coalesce(pi.paid_amount,0)
--       - (coalesce(pi.paid_cash,0)+coalesce(pi.paid_visa,0)+coalesce(pi.paid_wallet,0)
--         +coalesce(pi.paid_instapay,0)+coalesce(pi.paid_method5,0)+coalesce(pi.paid_method6,0))) > 0.01
-- order by pi.created_at desc;

-- (6) مخزون بالسالب — يتصلّح من شاشة الجرد.
-- select id, name, barcode, stock_quantity, display_quantity from products where coalesce(stock_quantity,0) < 0;

-- (7) المعروض أكبر من الإجمالي.
-- select id, name, barcode, stock_quantity, display_quantity from products
-- where coalesce(display_quantity,0) > coalesce(stock_quantity,0) + 0.0001;

-- (8) مخزون بتكلفة صفر — كل بيعة منه بتطلع ربح كامل. حدّد سعر الشراء أو سجّله في stock_intakes.
-- select id, name, barcode, stock_quantity, purchase_price, average_purchase_price, sale_price
-- from products where coalesce(stock_quantity,0) > 0
--   and coalesce(nullif(average_purchase_price,0), nullif(purchase_price,0), 0) = 0
-- order by stock_quantity desc;

-- (9) حركات موظفين من غير مصروف مقابل — الخزنة مش شايفة الفلوس خرجت.
-- select t.id, t.type, t.employee_id, e.name as employee, t.amount, t.created_at
-- from employee_transactions t left join employees e on e.id = t.employee_id
-- where not exists (select 1 from expenses x where x.employee_transaction_id = t.id)
--   and not exists (select 1 from expenses x where x.category='رواتب' and x.employee_transaction_id is null
--                   and abs(coalesce(x.amount,0)-coalesce(t.amount,0)) < 0.01
--                   and date_trunc('day', x.created_at) = date_trunc('day', t.created_at))
-- order by t.created_at desc;

-- (10) مصروفات «رواتب» يتيمة — احتمال تكون اتسجّلت مرتين (خصم مضاعف من الخزنة).
--      الملاحظة بتقول النوع: «راتب - » / «سلفة - » / «حافز - ».
-- select e.id, e.amount, e.note, e.created_at from expenses e
-- where e.category='رواتب' and e.employee_transaction_id is null
--   and not exists (select 1 from employee_transactions t
--                   where abs(coalesce(e.amount,0)-coalesce(t.amount,0)) < 0.01
--                   and date_trunc('day', e.created_at) = date_trunc('day', t.created_at))
-- order by e.created_at desc;

-- (11) باركودات مكررة — لازم تتصلّح من شاشة المخزون (كود فريد لكل منتج).
-- select barcode, count(*) as products, string_agg(name, ' | ') as names
-- from products where barcode is not null and barcode <> ''
-- group by barcode having count(*) > 1;

-- (12) حركات موظفين يتيمة (الصرف من الرئيسية اتلغى والحركة فضلت في كشف الموظف).
--      القرار: لو الفلوس خرجت فعلاً سجّلها من جديد، ولو ملغية امسح الحركة من
--      صفحة الموظفين (أو delete from employee_transactions where id = '...').
-- select t.id, t.type, e.name as employee, t.amount, t.payment_method, t.note, t.created_at
-- from employee_transactions t left join employees e on e.id = t.employee_id
-- where t.note like '%[SVG:%'
--   and not exists (select 1 from savings_transactions st
--                   where st.group_id::text = substring(t.note from '\[SVG:([0-9a-fA-F-]{6,})\]'))
-- order by t.created_at desc;

-- (13) حركات دفتر الرئيسية اللي مالهاش سبب مسجّل في أي جدول تاني.
-- select st.group_id, st.source, st.direction, st.method, st.amount, st.note, st.created_at
-- from savings_transactions st
-- where st.group_id is not null and st.source in ('main_expense','main_income')
--   and not exists (select 1 from expenses e where e.note like '%[SVG:' || st.group_id::text || ']%')
--   and not exists (select 1 from employee_transactions t where t.note like '%[SVG:' || st.group_id::text || ']%')
--   and not exists (select 1 from purchase_invoices pi where pi.notes like '%[SVG:' || st.group_id::text || ']%')
--   and not exists (select 1 from orders o where o.notes like '%[SVG:' || st.group_id::text || ']%')
-- order by st.created_at desc;


-- ═════════════════════════════════════════════════════════════════════════════
-- مطابقات إضافية (أرقام للمراجعة — مش أخطاء بالضرورة)
-- ═════════════════════════════════════════════════════════════════════════════

-- (أ) رصيد كل مورد = مجموع (الإجمالي − المدفوع). موجب = علينا، سالب = لينا.
-- select s.name, round(sum(coalesce(pi.total,0) - coalesce(pi.paid_amount,0))::numeric, 2) as balance
-- from suppliers s left join purchase_invoices pi on pi.supplier_id = s.id
-- group by s.name having abs(sum(coalesce(pi.total,0) - coalesce(pi.paid_amount,0))) > 0.01
-- order by balance desc;

-- (ب) رصيد الخزنة الرئيسية لكل وسيلة = الداخل − الخارج (قبل الرصيد الافتتاحي).
-- select method,
--        round(sum(case when direction='in' then amount else -amount end)::numeric, 2) as net
-- from savings_transactions group by method order by method;

-- (ج) قيمة المخزون الحالي وقيمة اللي دخل بدون فاتورة شراء (لو db/59 متشغّل).
-- select round(sum(coalesce(stock_quantity,0) * coalesce(nullif(average_purchase_price,0), purchase_price, 0))::numeric, 2)
--        as stock_value from products;
-- select round(sum(total_value)::numeric, 2) as no_purchase_capital from stock_intakes;
