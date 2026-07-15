-- ADRIA — ربط صفوف معاملة الخزنة الرئيسية الواحدة بمعرّف مجموعة (group_id)
-- عشان الحذف يشيل كل صفوف العملية (لكل طريقة دفع) دفعة واحدة بدقّة،
-- ويلاقي صف المصروف المرتبط بيها. شغّله مرة واحدة في Supabase → SQL Editor.
alter table savings_transactions add column if not exists group_id uuid;
create index if not exists idx_savings_tx_group on savings_transactions(group_id);
