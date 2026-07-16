-- =============================================================================
-- EMPLOYEE DEDUCTIONS (خصومات يدوية على الموظف تتجمّع لحد صرف الراتب)
-- =============================================================================
--  ليه جدول منفصل ومش نوع جديد في employee_transactions؟
--  كل صف في employee_transactions بيتطرح من خزنة المحل (computeShopAvailable
--  في utils/treasury، وتقفيل اليوم، والتقارير، وحساب الرصيد الافتتاحي) لأنه
--  بيمثّل فلوس خارجة فعلاً. الخصم مش فلوس خارجة من الدرج — ده تقليل للي إحنا
--  مدينينه للموظف. لو اتحط هناك كان هيقلّل رصيد الخزنة غلط في 6 أماكن.
--
--  الجدول ده بيمشي على نفس نمط employee_leaves: خصم مربوط بشهر، بيتجمّع، وبيتخصم
--  من المتبقي وقت صرف الراتب.
--
--  آمن للتشغيل أكثر من مرة (idempotent).
-- =============================================================================

create table if not exists employee_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  -- المبلغ النهائي بالجنيه — لو الخصم اتسجّل بالأيام بيتحسب هنا وقت الحفظ
  -- (أيام × الراتب/30) عشان باقي الحسابات تقرا رقم واحد بس.
  amount numeric not null default 0,
  -- عدد الأيام لو الخصم اتسجّل بالأيام (بيقبل كسور: 0.5 = نص يوم).
  -- بيتخزّن للعرض في السجل بس — القيمة الفعلية دايماً في amount.
  days numeric not null default 0,
  -- سبب الخصم (اختياري) — بيتعرض في سجل حركات الموظف
  reason text,
  -- الشهر اللي الخصم بيتخصم منه: YYYY-MM
  month text not null,
  -- تاريخ الخصم (اليوم اللي حصل فيه)
  date date not null default (now() at time zone 'Africa/Cairo')::date,
  created_at timestamptz default now()
);

-- لو الجدول كان اتعمل قبل ما عمود days يتضاف، create table if not exists فوق
-- بيعدّي من غير ما يضيفه — فبنضيفه هنا صراحةً.
alter table employee_deductions add column if not exists days numeric not null default 0;

-- شاشة الموظف بتجيب خصومات موظف واحد لشهر واحد.
create index if not exists employee_deductions_emp_month_idx
  on employee_deductions (employee_id, month);

-- نفس سياسة باقي جداول الموظفين (secure_rls_migration): المصرّح لهم بس.
alter table employee_deductions enable row level security;
drop policy if exists "allow all" on employee_deductions;
drop policy if exists "authenticated full access" on employee_deductions;
create policy "authenticated full access" on employee_deductions
  for all to authenticated using (true) with check (true);
revoke all on employee_deductions from anon;
grant all on employee_deductions to authenticated;
