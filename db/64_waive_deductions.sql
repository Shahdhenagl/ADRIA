-- =============================================================================
-- مسامحة الخصومات (waive) — المدير يعفي الموظف من خصم قبل صرف الراتب
-- شغّله مرة واحدة (آمن للتشغيل أكتر من مرة).
-- =============================================================================
--  الخصم بيتحسب تلقائياً (تأخير) أو بيتسجّل يدوياً (خصم/إجازة بدون أجر)، لكن
--  المدير ساعات بيسامح: الموظف اتأخر لظرف، أو الخصم اتسجّل بالغلط.
--
--  ليه مش بنمسح الصف أو نصفّر المبلغ وخلاص؟
--    لأن الموظف بيسأل «اتخصم مني كام وليه؟» بعد كده. مسح الصف بيضيّع إن التأخير
--    حصل أصلاً، وتصفير المبلغ لوحده بيضيّع إن المدير سامح (مش إن الغرامة كانت صفر).
--
--  الموديل: الحقل الحيّ (deduction_amount / amount) بيتصفّر — وده اللي كل
--  الحسابات بتقراه، فمفيش سطر حساب واحد محتاج يتغيّر — والمبلغ الأصلي بيتنقل
--  لـ waived_amount مع وقت المسامحة وسببها.
--
--  المسامحة الجزئية شغّالة كمان: waived_amount = الجزء المعفى، والباقي بيفضل
--  في الحقل الحيّ.
-- =============================================================================

-- خصم التأخير (الحقل الحيّ: deduction_amount)
alter table public.employee_attendance
  add column if not exists waived_amount numeric not null default 0,
  add column if not exists waived_at     timestamptz,
  add column if not exists waive_note    text;

-- خصم الإجازة بدون أجر (الحقل الحيّ: deduction_amount)
alter table public.employee_leaves
  add column if not exists waived_amount numeric not null default 0,
  add column if not exists waived_at     timestamptz,
  add column if not exists waive_note    text;

-- الخصم اليدوي (الحقل الحيّ: amount)
alter table public.employee_deductions
  add column if not exists waived_amount numeric not null default 0,
  add column if not exists waived_at     timestamptz,
  add column if not exists waive_note    text;

-- تحقّق: كل الأعمدة لازم تطلع في النتيجة (٩ صفوف).
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('employee_attendance', 'employee_leaves', 'employee_deductions')
  and column_name in ('waived_amount', 'waived_at', 'waive_note')
order by table_name, column_name;
