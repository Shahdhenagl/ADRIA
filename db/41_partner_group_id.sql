-- ADRIA — ربط معاملة الشريك بصف دفتر الخزنة الرئيسية (group_id) عشان الحذف/التعديل
-- يرجّع الفلوس للخزنة الرئيسية بدقّة. شغّله مرة واحدة في Supabase → SQL Editor.
-- آمن للتشغيل أكثر من مرة.
alter table partner_transactions add column if not exists group_id uuid;
create index if not exists idx_partner_tx_group on partner_transactions(group_id);
