-- كشف تاريخ معاملات زينب بالكامل من أول حركة إلى آخر حركة
-- قراءة فقط — لا يعدّل أي بيانات.
-- شغّل الاستعلام كله في Supabase SQL Editor.

with zeinab as (
  select id, name, monthly_salary
  from employees
  where lower(name) like '%zeinab%'
     or name like '%زينب%'
), ledger as (
  -- السلف والرواتب والحوافز المصروفة
  select
    z.name as employee_name,
    z.monthly_salary,
    et.created_at as event_at,
    et.created_at::date as event_date,
    et.month,
    case et.type
      when 'advance' then 'سحب سلفة'
      when 'salary' then 'صرف راتب'
      when 'incentive' then 'حافز مصروف'
      else et.type
    end as transaction_type,
    et.type as transaction_kind,
    et.amount::numeric as amount_paid,
    coalesce(et.deductions, 0)::numeric as deductions,
    case
      when et.type = 'advance' then et.amount::numeric
      when et.type = 'salary' and et.advance_repayment is not null then -et.advance_repayment::numeric
      -- السجلات القديمة: الراتب كان يعتبر سدادًا تلقائيًا لرصيد السلفة
      when et.type = 'salary' then -et.amount::numeric
      else 0::numeric
    end as advance_balance_change,
    coalesce(et.advance_repayment, 0)::numeric as explicit_advance_repayment,
    et.note,
    et.id::text as record_id,
    'employee_transactions' as source
  from zeinab z
  join employee_transactions et on et.employee_id = z.id

  union all

  -- الخصومات اليدوية
  select
    z.name, z.monthly_salary,
    coalesce(d.created_at, d.date::timestamp) as event_at,
    coalesce(d.created_at, d.date::timestamp)::date as event_date,
    d.month,
    'خصم يدوي', 'deduction',
    0::numeric,
    coalesce(d.amount, 0)::numeric,
    0::numeric,
    0::numeric,
    d.reason,
    d.id::text,
    'employee_deductions'
  from zeinab z
  join employee_deductions d on d.employee_id = z.id

  union all

  -- المكافآت التي تضاف على الراتب
  select
    z.name, z.monthly_salary,
    coalesce(b.created_at, b.date::timestamp) as event_at,
    coalesce(b.created_at, b.date::timestamp)::date as event_date,
    b.month,
    'مكافأة', 'bonus',
    coalesce(b.amount, 0)::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    b.reason,
    b.id::text,
    'employee_bonuses'
  from zeinab z
  join employee_bonuses b on b.employee_id = z.id

  union all

  -- الإجازات التي عليها خصم
  select
    z.name, z.monthly_salary,
    coalesce(l.created_at, l.start_date::timestamp) as event_at,
    coalesce(l.created_at, l.start_date::timestamp)::date as event_date,
    l.month,
    'إجازة بخصم', 'unpaid_leave',
    0::numeric,
    coalesce(l.deduction_amount, 0)::numeric,
    0::numeric,
    0::numeric,
    l.note,
    l.id::text,
    'employee_leaves'
  from zeinab z
  join employee_leaves l on l.employee_id = z.id
  where l.leave_type = 'unpaid'

  union all

  -- خصومات التأخير والحضور
  select
    z.name, z.monthly_salary,
    coalesce(a.created_at, a.date::timestamp) as event_at,
    coalesce(a.created_at, a.date::timestamp)::date as event_date,
    a.month,
    'خصم تأخير/حضور', 'attendance',
    0::numeric,
    coalesce(a.deduction_amount, 0)::numeric,
    0::numeric,
    0::numeric,
    a.note,
    a.id::text,
    'employee_attendance'
  from zeinab z
  join employee_attendance a on a.employee_id = z.id
  where coalesce(a.deduction_amount, 0) > 0
), ordered as (
  select
    ledger.*,
    row_number() over (order by event_at nulls last, record_id) as sequence_no,
    sum(advance_balance_change) over (
      partition by employee_name
      order by event_at nulls last, record_id
      rows between unbounded preceding and current row
    )::numeric as advance_balance_after
  from ledger
)
select
  sequence_no as "رقم الحركة",
  event_date as "التاريخ",
  event_at as "وقت التسجيل",
  month as "الشهر المحاسبي",
  transaction_type as "نوع الحركة",
  amount_paid as "المبلغ المصروف/المضاف",
  deductions as "الخصومات",
  explicit_advance_repayment as "سداد سلفة صريح",
  advance_balance_change as "تغير رصيد السلفة",
  greatest(0, advance_balance_after)::numeric as "رصيد السلف بعد الحركة",
  note as "البيان",
  source as "الجدول المصدر",
  record_id as "معرف السجل"
from ordered
order by sequence_no;

-- ملخص سريع بعد آخر حركة
with zeinab as (
  select id, name from employees
  where lower(name) like '%zeinab%' or name like '%زينب%'
), all_tx as (
  select et.created_at as event_at,
         case
           when et.type = 'advance' then et.amount::numeric
           when et.type = 'salary' and et.advance_repayment is not null then -et.advance_repayment::numeric
           when et.type = 'salary' then -et.amount::numeric
           else 0::numeric
         end as balance_change
  from employee_transactions et join zeinab z on z.id = et.employee_id
), last_balance as (
  select coalesce(sum(balance_change), 0)::numeric as calculated_balance
  from all_tx
)
select z.name, lb.calculated_balance as "الرصيد التراكمي المحسوب"
from zeinab z cross join last_balance lb;
