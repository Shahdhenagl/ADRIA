-- =============================================================================
-- ADRIA — «الادخار الشخصي» للمدير: خزائن ادخار منفصلة تماماً عن حسابات المحل.
-- شغّليه مرة واحدة في Supabase SQL editor.
-- =============================================================================
-- الفكرة:
--   المدير بيعمل خزائن ادخار بأسماء (مثلاً «ادخار البيت»)، وكل خزنة رصيدها لكل
--   وسيلة دفع. الحركات ٤ أنواع (عمود source):
--     from_main    → إيداع في الخزنة جاي من الخزنة الرئيسية (بيقلّل الرئيسية)
--     to_main      → سحب من الخزنة رايح للخزنة الرئيسية   (بيزوّد الرئيسية)
--     personal_in  → إيداع من فلوس المدير الشخصية من بره   (ملوش علاقة بالرئيسية)
--     personal_out → سحب لجيب المدير الشخصي               (ملوش علاقة بالرئيسية)
--   حركات from_main / to_main بتتكتب كمان صف مقابل في savings_transactions
--   (دفتر الخزنة الرئيسية) مربوط بنفس group_id عشان الحذف يعكس الطرفين مع بعض.
-- =============================================================================

create table if not exists savings_vaults (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists savings_vault_transactions (
  id uuid default gen_random_uuid() primary key,
  vault_id uuid not null references savings_vaults(id) on delete cascade,
  direction text not null,                 -- 'in' | 'out'
  amount numeric not null,
  method text default 'cash',              -- cash / visa / wallet / instapay / method5 / method6
  source text not null,                    -- from_main | to_main | personal_in | personal_out
  note text,
  group_id uuid,                           -- يربط صف الرئيسية المقابل (لـ from_main/to_main)
  created_at timestamptz default now()
);

create index if not exists idx_svt_vault on savings_vault_transactions(vault_id);
create index if not exists idx_svt_group on savings_vault_transactions(group_id);

-- RLS: نفس سياسة باقي الجداول — وصول كامل للمستخدم المسجّل فقط.
alter table savings_vaults enable row level security;
alter table savings_vault_transactions enable row level security;

drop policy if exists "authenticated full access" on savings_vaults;
create policy "authenticated full access" on savings_vaults for all to authenticated using (true) with check (true);
drop policy if exists "authenticated full access" on savings_vault_transactions;
create policy "authenticated full access" on savings_vault_transactions for all to authenticated using (true) with check (true);

revoke all on savings_vaults from anon;
revoke all on savings_vault_transactions from anon;
grant all on savings_vaults to authenticated;
grant all on savings_vault_transactions to authenticated;
