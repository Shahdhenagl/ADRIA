-- ADRIA — إجازات شهرية + تسجيل حضور/تأخير للموظفين. شغّله مرة واحدة في Supabase.
--
-- (1) الإجازات بقت شهرية بدل سنوية: كل موظف ليه رصيد أيام شهري يتجدد أول كل شهر.
--     اللي يزيد عن الرصيد يتخصم من الراتب حسب سعر اليوم (الراتب ÷ 30).
-- (2) الحضور: نسجّل وقت الحضور، والنظام يحسب دقائق التأخير عن بداية الدوام
--     (مع دقائق سماح) ويخصم من الراتب بالتناسب مع مدة التأخير.

-- أعمدة إضافية على جدول الموظفين.
alter table employees add column if not exists monthly_leave_days numeric not null default 4; -- رصيد الإجازة الشهري (أيام)
alter table employees add column if not exists shift_start time;                              -- بداية الدوام (مثال 10:00)
alter table employees add column if not exists shift_end time;                                -- نهاية الدوام (لحساب طول يوم العمل)
alter table employees add column if not exists late_grace_minutes numeric not null default 0; -- دقائق سماح قبل احتساب التأخير

-- سجل الحضور والتأخير.
create table if not exists employee_attendance (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references employees(id) on delete cascade,
  date date not null,
  check_in timestamptz not null,        -- وقت الحضور الفعلي
  shift_start time,                     -- بداية الدوام المتوقعة (لقطة وقت التسجيل)
  late_minutes numeric not null default 0,     -- دقائق التأخير (بعد خصم السماح)
  deduction_amount numeric not null default 0, -- خصم التأخير من الراتب
  month text,                           -- YYYY-MM
  note text,
  created_at timestamptz default now()
);

create index if not exists idx_employee_attendance_employee_id on employee_attendance(employee_id);
create index if not exists idx_employee_attendance_month on employee_attendance(month);
create index if not exists idx_employee_attendance_date on employee_attendance(date);
create unique index if not exists uq_employee_attendance_emp_date on employee_attendance(employee_id, date);

alter table employee_attendance enable row level security;
drop policy if exists "allow all" on employee_attendance;
create policy "allow all" on employee_attendance for all using (true) with check (true);
