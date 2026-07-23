-- =============================================================================
-- ADRIA — إصلاح «معاملة مورد اتمسحت من الخزنة الرئيسية وفضلت في حساب المورد».
-- **الاستعلامات 1→3 قراءة فقط — مبتعدّلش حاجة.** الحذف في آخر الملف بعد المراجعة.
-- شغّلي كل استعلام لوحده في Supabase SQL editor.
-- =============================================================================
-- الخلفية:
--   أي معاملة مورد مدفوعة من الخزنة الرئيسية (فاتورة مشتريات / سداد / تحصيل)
--   بتتسجّل في مكانين مربوطين بـ group_id:
--     1) صف في purchase_invoices  (جهة المورد)  — ملاحظته فيها وسم [SVG:<group_id>]
--     2) صف/صفوف في savings_transactions (دفتر الخزنة الرئيسية) بنفس group_id
--
--   • الحذف من صفحة «الموردين»  → بيمسح الاتنين مع بعض (صح).
--   • الحذف من صفحة «الخزنة الرئيسية» → بيمسح صف الخزنة بس، وبيسيب صف المورد
--     عن قصد (وبيطلّع تنبيه إن الفاتورة لسه موجودة).  ← ده اللي حصل.
--
--   النتيجة: الخزنة رجعت صح، لكن صف المورد «يتيم» — الوسم [SVG:] بيشاور على
--   group_id مبقاش ليه أي صف في savings_transactions. ده توقيع اليُتم بالظبط،
--   وبنستخدمه عشان نلاقي الصف الغلط من غير ما نلمس أي فاتورة سليمة.
-- =============================================================================


-- ── (1) 🎯 المعاملات اليتيمة: صف مورد معلّم [SVG] بس مفيش ليه صف خزنة ──────────
--     كل صف هنا هو المعاملة اللي اتمسحت من الخزنة وفضلت في المورد.
--     item_count بيقولنا النوع:
--       total = 0        → «سداد / تحصيل» (فلوس بس، مفيش مخزون)  → إصلاح بسيط.
--       total > 0 و items → «فاتورة مشتريات» (دخّلت مخزون)       → لازم نرجّع المخزون كمان.
select
  pi.id,
  pi.invoice_number,
  s.name                                                   as supplier_name,
  pi.total,
  pi.paid_amount,
  (pi.total - pi.paid_amount)                              as debt_impact,   -- أثرها على رصيد المورد
  (select count(*) from purchase_items it where it.invoice_id = pi.id) as item_count,
  pi.created_at,
  substring(pi.notes from '\[SVG:([0-9a-fA-F-]{6,})\]')    as svg_group_id,
  pi.notes
from purchase_invoices pi
left join suppliers s on s.id = pi.supplier_id
where pi.notes like '%[SVG:%'
  and not exists (
    select 1 from savings_transactions st
    where st.group_id::text = substring(pi.notes from '\[SVG:([0-9a-fA-F-]{6,})\]')
  )
order by pi.created_at desc;


-- ── (2) أصناف المعاملات اليتيمة (لو فيه) — عشان نعرف أثرها على المخزون ──────────
--     لو الاستعلام ده رجّع صفوف يبقى المعاملة «فاتورة مشتريات» ولازم نرجّع المخزون
--     قبل حذف الفاتورة (خطوة B تحت). لو رجّع فاضي يبقى «سداد/تحصيل» (خطوة A).
select
  it.invoice_id,
  pi.invoice_number,
  it.product_id,
  p.name                                                   as product_name,
  it.quantity                                              as qty_added_to_stock,
  it.purchase_price,
  p.stock_quantity                                         as current_stock,
  p.average_purchase_price                                 as current_avg_cost,
  p.display_quantity                                       as current_display
from purchase_items it
join purchase_invoices pi on pi.id = it.invoice_id
left join products p on p.id = it.product_id
where pi.notes like '%[SVG:%'
  and not exists (
    select 1 from savings_transactions st
    where st.group_id::text = substring(pi.notes from '\[SVG:([0-9a-fA-F-]{6,})\]')
  )
order by it.invoice_id;


-- ── (3) كشف حساب المورد قبل الإصلاح (اختياري — للمقارنة قبل/بعد) ───────────────
--     غيّري '<SUPPLIER_ID>' بالـ supplier_id من استعلام (1).
-- select invoice_number, total, paid_amount, (total - paid_amount) as debt_impact, created_at
-- from purchase_invoices where supplier_id = '<SUPPLIER_ID>' order by created_at;


-- =============================================================================
-- ── الإصلاح (بعد ما تراجعي نتيجة 1 و 2) ──
-- خدي الـ id من استعلام (1). في المرة الواحدة صفّي معاملة واحدة بس وراجعي المورد.
-- =============================================================================

-- ── (A) لو «سداد / تحصيل» (item_count = 0، استعلام 2 رجع فاضي) ─────────────────
--     مفيش مخزون بيتأثر. مجرد امسحي صف المورد وخلاص — رصيد المورد بيتصلّح فوراً.
--
--   delete from purchase_invoices where id = '<الـ id من استعلام 1>';
--
--   (لو حابّة تتأكدي إنه سداد قبل الحذف: تأكدي total = 0 و item_count = 0.)


-- ── (B) لو «فاتورة مشتريات» (فيها أصناف من استعلام 2) ──────────────────────────
--     لازم نرجّع المخزون الأول (نفس حسبة الكود عند الحذف)، بعدين نمسح الفاتورة.
--     الأصناف (purchase_items) بتتمسح تلقائياً مع الفاتورة (on delete cascade).
--
--     كرّري بلوك الـ UPDATE ده لكل صف طلع في استعلام (2) — صنف واحد في المرة:
--       new_stock       = max(0, current_stock - qty)
--       remaining_value = max(0, current_stock*current_avg - qty*purchase_price)
--       new_avg         = new_stock > 0 ? remaining_value/new_stock : 0
--       new_display     = min(current_display, new_stock)
--
--   update products p set
--     stock_quantity         = greatest(0, p.stock_quantity - <qty>),
--     average_purchase_price = case
--       when greatest(0, p.stock_quantity - <qty>) > 0
--       then greatest(0, p.stock_quantity * p.average_purchase_price - <qty> * <purchase_price>)
--            / greatest(0, p.stock_quantity - <qty>)
--       else 0 end,
--     display_quantity       = least(coalesce(p.display_quantity,0), greatest(0, p.stock_quantity - <qty>))
--   where p.id = '<product_id>';
--
--     بعد ما ترجّعي المخزون لكل الأصناف، امسحي الفاتورة:
--
--   delete from purchase_invoices where id = '<الـ id من استعلام 1>';
--
--   ⚠️ لو الفاتورة كانت مدفوعة بالكامل من الرئيسية (total = paid_amount) فرصيد
--      المورد أصلاً متصفّي (أثرها على الرصيد = صفر) — المشكلة الوحيدة الباقية هي
--      المخزون الزائد. الـ UPDATE فوق بيصلّحه.
-- =============================================================================
