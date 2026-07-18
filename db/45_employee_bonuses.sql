-- =============================================================================
-- EMPLOYEE BONUSES (مكافآت تتجمّع على الموظف لحد صرف الراتب)
-- =============================================================================
--  ده مرآة employee_deductions (db/42) بالظبط بس بإشارة موجبة: بيتجمّع خلال
--  الشهر وبيتضاف على المتبقي وقت صرف الراتب.
--
--  ليه جدول منفصل ومش نوع 'incentive' في employee_transactions؟
--  «الحافز» الموجود في employee_transactions بيطلّع فلوس من الدرج ساعتها —
--  بيتحسب في تقفيل اليوم والميزانية و recordMainTreasuryOut. المكافأة هنا مش
--  فلوس خارجة وقت تسجيلها؛ دي زيادة في اللي إحنا مدينينه للموظف، والفلوس
--  بتخرج مرة واحدة وقت صرف الراتب. لو اتحطت هناك كانت هتقلّل رصيد الخزنة
--  مرتين: مرة وقت التسجيل ومرة تانية جوه الراتب.
--
--  مفيش عمود days هنا (عكس الخصم) — مكافأة بالأيام مالهاش معنى واضح.
--
--  آمن للتشغيل أكثر من مرة (idempotent).
-- =============================================================================

create table if not exists employee_bonuses (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  -- قيمة المكافأة بالجنيه (موجبة دايماً)
  amount numeric not null default 0,
  -- سبب المكافأة (اختياري) — بيتعرض في سجل حركات الموظف
  reason text,
  -- الشهر اللي المكافأة بتتضاف عليه: YYYY-MM
  month text not null,
  -- تاريخ المكافأة (اليوم اللي استحقّت فيه)
  date date not null default (now() at time zone 'Africa/Cairo')::date,
  created_at timestamptz default now()
);

-- شاشة الموظف بتجيب مكافآت موظف واحد لشهر واحد.
create index if not exists employee_bonuses_emp_month_idx
  on employee_bonuses (employee_id, month);

-- نفس سياسة باقي جداول الموظفين (secure_rls_migration): المصرّح لهم بس.
alter table employee_bonuses enable row level security;
drop policy if exists "allow all" on employee_bonuses;
drop policy if exists "authenticated full access" on employee_bonuses;
create policy "authenticated full access" on employee_bonuses
  for all to authenticated using (true) with check (true);
revoke all on employee_bonuses from anon;
grant all on employee_bonuses to authenticated;
