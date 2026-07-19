-- ADRIA — مرتجع المورد. شغّله مرة واحدة (آمن للتشغيل أكثر من مرة).
--
-- المرتجع بيتسجّل كصف عادي في purchase_invoices بإجمالي سالب وأصناف بكميات سالبة،
-- بدل جدول جديد. السبب: رصيد المورد محسوب في كل الصفحات كـ sum(total - paid_amount)
-- والخزنة بتقرا paid_* بنفس الطريقة — فبالإشارة السالبة الرصيد والخزنة والتقارير
-- (Analytics / Budget / Finance / DeferredAccounts) بتظبط لوحدها من غير أي تعديل.
-- نفس أسلوب collectSupplierCredit الموجود أصلاً.
--
-- العمود ده بيربط المرتجع بفاتورة الشراء الأصلية، عشان:
--   1. نمنع إرجاع كمية أكبر من المشتراة (المتاح = المشترى - المرتجع سابقاً).
--   2. نرجّع بسعر الشراء المسجّل في الفاتورة نفسها، مش بمتوسط التكلفة الحالي
--      (average_purchase_price) — وإلا المخزون بيتقيّم غلط.
alter table purchase_invoices
  add column if not exists source_invoice_id uuid references purchase_invoices(id) on delete set null;

create index if not exists purchase_invoices_source_invoice_id_idx
  on purchase_invoices (source_invoice_id);
