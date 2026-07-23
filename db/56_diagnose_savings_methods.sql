-- =============================================================================
-- ADRIA — تشخيص «زيادة في وسائل الدفع» بالخزنة الرئيسية. **قراءة فقط — مبيعدّلش حاجة.**
-- شغّلي كل استعلام لوحده في Supabase SQL editor وشوفي النتيجة.
-- =============================================================================
-- الخلفية:
--   رصيد أي وسيلة في الخزنة الرئيسية = الرصيد الافتتاحي (من الإعدادات، مش في الجدول)
--                                    + مجموع الإيداع (direction='in')
--                                    − مجموع السحب  (direction='out')
--   الحذف بيمسح الصفوف فعلياً (مفيش is_deleted)، والمفروض يمسح صفوف العملية كلها
--   بالـ group_id مع بعض.
--
--   حركة «تحويل بين وسائل الرئيسية» (source='convert') بتتكتب صفّين بنفس group_id:
--     out (سحب) من وسيلة  +  in (إيداع) لوسيلة تانية  →  مجموعهم لازم = صفر.
--   لو اتحذف طرف واحد بس (السحب مثلاً) وفضل الإيداع → رصيد الرئيسية بيزيد بالغلط
--   بمقدار المبلغ ده. ده أشيع سبب للزيادة اللي بتوصفيها.
-- =============================================================================


-- ── (1) الأرصدة الحالية لكل وسيلة (نفس اللي بتشوفيه في الصفحة، من غير الافتتاحي) ──
--     net_ledger = إيداع − سحب = مساهمة الجدول في الرصيد المعروض.
select
  method,
  sum(case when direction = 'in'  then amount else 0 end)        as deposits_in,
  sum(case when direction = 'out' then amount else 0 end)        as withdrawals_out,
  sum(case when direction = 'in' then amount else -amount end)   as net_ledger
from savings_transactions
group by method
order by method;


-- ── (2) 🎯 المشتبه الأول: تحويلات (convert) مش متزنة → طرف اتحذف والتاني فضل ──────
--     المفروض net = 0 لكل مجموعة. لو ظهرت هنا يبقى فيها خلل:
--       net > 0  →  الإيداع (in) فاضل والسحب (out) اتشال  →  الرصيد زاد بالغلط.
--       net < 0  →  العكس.
--     rows_detail بيوريكي الصفوف الفاضلة في المجموعة.
select
  group_id,
  min(created_at)                                               as when_ts,
  count(*)                                                      as rows_count,
  string_agg(direction || ' ' || method || ' ' || amount::text, ' | ' order by direction) as rows_detail,
  sum(case when direction = 'in' then amount else -amount end)  as net_should_be_zero
from savings_transactions
where source = 'convert' and group_id is not null
group by group_id
having abs(sum(case when direction = 'in' then amount else -amount end)) > 0.01
order by abs(sum(case when direction = 'in' then amount else -amount end)) desc;


-- ── (3) الصفوف اليتيمة بالتفصيل (بالـ id) — دي اللي تتحذف لإصلاح التوازن ──────────
--     كل صف هنا هو طرف باقٍ من تحويل اتكسر. حذفه بيرجّع المجموعة لصفر (الحالة قبل
--     التحويل، وهي حالة سليمة لأن التحويل حركة داخلية مجموعها صفر أصلاً).
with broken as (
  select group_id
  from savings_transactions
  where source = 'convert' and group_id is not null
  group by group_id
  having abs(sum(case when direction = 'in' then amount else -amount end)) > 0.01
)
select st.id, st.created_at, st.direction, st.method, st.amount, st.note, st.group_id
from savings_transactions st
join broken b on b.group_id = st.group_id
order by st.created_at desc, st.group_id;


-- ── (4) إجمالي الزيادة الناتجة عن التحويلات المكسورة ────────────────────────────
--     الرقم ده = مقدار ما رصيد الخزنة الرئيسية أعلى من الحقيقة بسبب تحويلات convert.
select
  coalesce(sum(case when direction = 'in' then amount else -amount end), 0) as total_inflation_from_converts
from savings_transactions
where source = 'convert'
  and group_id in (
    select group_id
    from savings_transactions
    where source = 'convert' and group_id is not null
    group by group_id
    having abs(sum(case when direction = 'in' then amount else -amount end)) > 0.01
  );


-- ── (5) تحويلات convert قديمة من غير group_id (قبل db/39) — مراجعة يدوية ─────────
--     مش ممكن نجمّعها بالـ group_id، فبنجمّعها بالوقت + الملاحظة. اللي net فيها ≠ 0
--     يبقى نصّ التحويل. راجعيها يدوياً قبل أي حذف.
select
  created_at,
  note,
  count(*)                                                      as rows_count,
  string_agg(direction || ' ' || method || ' ' || amount::text, ' | ') as rows_detail,
  sum(case when direction = 'in' then amount else -amount end)  as net
from savings_transactions
where source = 'convert' and group_id is null
group by created_at, note
having abs(sum(case when direction = 'in' then amount else -amount end)) > 0.01
order by created_at desc;


-- ── (6) صفوف مكرّرة (نفس العملية اتسجّلت مرتين — مثلاً retry شبكة) ────────────────
--     كل مجموعة count>1 يبقى فيها تكرار محتمل بيزوّد الرصيد. راجعيها قبل الحذف.
select
  created_at, direction, method, amount, source, note, count(*) as dup_count
from savings_transactions
group by created_at, direction, method, amount, source, note
having count(*) > 1
order by dup_count desc, created_at desc;


-- ── (7) ملخّص عام لكل مصدر واتجاه (لرؤية الصورة الكاملة ورصد أي شذوذ) ─────────────
select
  source,
  direction,
  count(*)      as rows_count,
  sum(amount)   as total_amount
from savings_transactions
group by source, direction
order by source, direction;


-- ── (8) 🎯 مصالحة التحويلات محل↔رئيسية مع صف المصروف المقابل في «الميزانية» ───────
--     كل تحويل بيكتب: صف/صفوف في الدفتر (هنا) + صف مصروف في expenses مربوط بيه.
--     لو حد مسح صف المصروف من صفحة الميزانية، صف الدفتر بيفضل (deleteExpense
--     مبيمسحش الدفتر) → الرصيد الرئيسي يزيد/يقل بالغلط.
--       ledger_transfer_in  = إيداعات التقفيل/التحويل للرئيسية (بتزوّد الرئيسية)
--       mirror_out_expenses = صفوف المصروف «تحويل للخزنة الرئيسية» في الميزانية
--     لو ledger_transfer_in > mirror_out_expenses يبقى فيه إيداعات يتيمة اتمسح
--     مصروفها = **مقدار الزيادة في الخزنة الرئيسية**.
select 'ledger: تحويل داخل للرئيسية (day_closing+shop_transfer)' as item,
       coalesce(sum(amount), 0) as total
from savings_transactions where source in ('day_closing', 'shop_transfer')
union all
select 'mirror: مصروف «تحويل للخزنة الرئيسية»',
       coalesce(sum(abs(amount)), 0)
from expenses where category = 'تحويل للخزنة الرئيسية'
union all
select 'ledger: تحويل خارج للمحل (to_shop)',
       coalesce(sum(amount), 0)
from savings_transactions where source = 'to_shop'
union all
select 'mirror: «تحويل من الخزنة الرئيسية»',
       coalesce(sum(abs(amount)), 0)
from expenses where category = 'تحويل من الخزنة الرئيسية';


-- ── (9) 🎯 الإيداعات/السحوبات اليتيمة بالتفصيل: صفوف دفتر تحويل اتمسح مصروفها ──────
--     كل مجموعة هنا = عملية تحويل صف المصروف المقابل ليها اتمسح من الميزانية،
--     فصفوف الدفتر فضلت وبتأثر على رصيد الرئيسية بالغلط. راجعي كل واحدة:
--     لو التحويل المفروض اتلغى بالكامل → امسحي صفوف الدفتر دي (بالـ group_id).
select
  st.group_id,
  st.source,
  min(st.created_at)                                           as when_ts,
  sum(case when st.direction = 'in' then st.amount else -st.amount end) as net_effect_on_savings,
  string_agg(st.direction || ' ' || st.method || ' ' || st.amount::text, ' | ') as rows_detail
from savings_transactions st
where st.source in ('day_closing', 'shop_transfer', 'to_shop')
  and st.group_id is not null
  and not exists (
    select 1 from expenses e
    where e.note like '%[SVG:' || st.group_id || ']%'
  )
group by st.group_id, st.source
order by when_ts desc;


-- =============================================================================
-- ── الإصلاح (بعد المراجعة فقط) ──
-- من نتيجة استعلام (3): كل صف يتيم من تحويل مكسور، احذفيه بالـ id بالظبط:
--
--   delete from savings_transactions where id = '<الـ id>';
--
-- احذفي صف واحد في المرة وراجعي رصيد الوسيلة بعد كل حذف.
-- ⚠️ متمسحيش نتيجة استعلام كاملة دفعة واحدة من غير مراجعة.
-- التكرارات (استعلام 6): احذفي **نسخة واحدة بس** من كل مجموعة (بالـ id)، مش الكل.
-- =============================================================================
