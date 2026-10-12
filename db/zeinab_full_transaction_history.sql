-- كشف تاريخ معاملات زينب بالكامل من أول حركة إلى آخر حركة.
-- قراءة فقط — لا يعدّل أي بيانات.
-- يميّز تاريخ الحركة المحاسبي عن وقت إدخال الصف فعلياً.
-- شغّل db/81_employee_transaction_recorded_at.sql أولاً لتسجيل ترتيب الحركات الجديدة.

with recursive
zeinab as (
  select id, name, monthly_salary
  from public.employees
  where lower(name) like '%zeinab%'
     or name like '%زينب%'
), ledger as (
  -- السلف والرواتب والحوافز المصروفة
  select
    z.id as employee_id,
    z.name as employee_name,
    z.monthly_salary,
    et.created_at as event_at,
    (et.created_at at time zone 'Africa/Cairo')::date as event_date,
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
    'employee_transactions'::text as source,
    nullif(to_jsonb(et)->>'recorded_at', '')::timestamptz as recorded_at
  from zeinab z
  join public.employee_transactions et on et.employee_id = z.id

  union all

  -- الخصومات اليدوية: date هو تاريخ الخصم، وcreated_at وقت تسجيله.
  select
    z.id, z.name, z.monthly_salary,
    d.date::timestamp at time zone 'Africa/Cairo',
    d.date,
    d.month,
    'خصم يدوي', 'deduction',
    0::numeric,
    coalesce(d.amount, 0)::numeric,
    0::numeric,
    0::numeric,
    d.reason,
    d.id::text,
    'employee_deductions'::text,
    d.created_at
  from zeinab z
  join public.employee_deductions d on d.employee_id = z.id

  union all

  -- المكافآت التي تضاف على الراتب
  select
    z.id, z.name, z.monthly_salary,
    b.date::timestamp at time zone 'Africa/Cairo',
    b.date,
    b.month,
    'مكافأة', 'bonus',
    coalesce(b.amount, 0)::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    b.reason,
    b.id::text,
    'employee_bonuses'::text,
    b.created_at
  from zeinab z
  join public.employee_bonuses b on b.employee_id = z.id

  union all

  -- الإجازات التي عليها خصم
  select
    z.id, z.name, z.monthly_salary,
    l.start_date::timestamp at time zone 'Africa/Cairo',
    l.start_date,
    l.month,
    'إجازة بخصم', 'unpaid_leave',
    0::numeric,
    coalesce(l.deduction_amount, 0)::numeric,
    0::numeric,
    0::numeric,
    l.note,
    l.id::text,
    'employee_leaves'::text,
    l.created_at
  from zeinab z
  join public.employee_leaves l on l.employee_id = z.id
  where l.leave_type = 'unpaid'

  union all

  -- خصومات التأخير والحضور
  select
    z.id, z.name, z.monthly_salary,
    a.date::timestamp at time zone 'Africa/Cairo',
    a.date,
    a.month,
    'خصم تأخير/حضور', 'attendance',
    0::numeric,
    coalesce(a.deduction_amount, 0)::numeric,
    0::numeric,
    0::numeric,
    a.note,
    a.id::text,
    'employee_attendance'::text,
    a.created_at
  from zeinab z
  join public.employee_attendance a on a.employee_id = z.id
  where coalesce(a.deduction_amount, 0) > 0
), ordered as (
  select
    ledger.*,
    count(*) over (
      partition by employee_id, event_date, coalesce(recorded_at, event_at)
    ) as same_time_event_count,
    row_number() over (
      partition by employee_id
      order by event_date nulls last, coalesce(recorded_at, event_at) nulls last, record_id
    ) as sequence_no
  from ledger
), balance_walk(employee_id, sequence_no, balance_after) as (
  select
    o.employee_id,
    o.sequence_no,
    greatest(0, o.advance_balance_change)::numeric
  from ordered o
  where o.sequence_no = 1

  union all

  select
    o.employee_id,
    o.sequence_no,
    case
      when o.advance_balance_change < 0
        then greatest(0, b.balance_after + o.advance_balance_change)
      else b.balance_after + o.advance_balance_change
    end::numeric
  from balance_walk b
  join ordered o
    on o.employee_id = b.employee_id
   and o.sequence_no = b.sequence_no + 1
)
select
  o.sequence_no as "رقم الحركة",
  o.event_date as "تاريخ الحركة",
  o.event_at as "وقت القيد المحاسبي",
  o.recorded_at as "وقت التسجيل الفعلي",
  o.month as "الشهر المحاسبي",
  o.transaction_type as "نوع الحركة",
  o.amount_paid as "المبلغ المصروف/المضاف",
  o.deductions as "الخصومات",
  o.explicit_advance_repayment as "سداد سلفة صريح",
  o.advance_balance_change as "تغير رصيد السلفة",
  b.balance_after as "رصيد السلف بعد الحركة",
  (o.same_time_event_count > 1) as "ترتيب الوقت ملتبس؟",
  o.note as "البيان",
  o.source as "الجدول المصدر",
  o.record_id as "معرف السجل"
from ordered o
join balance_walk b
  on b.employee_id = o.employee_id
 and b.sequence_no = o.sequence_no
order by o.employee_id, o.sequence_no;

-- الرصيد الحالي يحسب خصم الراتب مع clamp بعد كل حركة، لا بمجرد جمع التغييرات.
-- has_ambiguous_order=true تعني أن حركات قديمة لها التوقيت نفسه ولا يمكن
-- استعادة ترتيبها الحقيقي من created_at وحده.
with recursive
zeinab as (
  select id, name
  from public.employees
  where lower(name) like '%zeinab%'
     or name like '%زينب%'
), tx as (
  select
    z.id as employee_id,
    z.name as employee_name,
    et.id,
    et.created_at,
    (et.created_at at time zone 'Africa/Cairo')::date as event_date,
    nullif(to_jsonb(et)->>'recorded_at', '')::timestamptz as recorded_at,
    case
      when et.type = 'advance' then et.amount::numeric
      when et.type = 'salary' and et.advance_repayment is not null then -et.advance_repayment::numeric
      when et.type = 'salary' then -et.amount::numeric
      else 0::numeric
    end as balance_change
  from zeinab z
  join public.employee_transactions et on et.employee_id = z.id
  where et.type in ('advance', 'salary')
), ordered_tx as (
  select
    tx.*,
    count(*) over (
      partition by employee_id, event_date, coalesce(recorded_at, created_at)
    ) as same_time_event_count,
    row_number() over (
      partition by employee_id
      order by event_date nulls last, coalesce(recorded_at, created_at) nulls last, id
    ) as sequence_no
  from tx
), balance_walk(employee_id, sequence_no, balance_after) as (
  select employee_id, sequence_no, greatest(0, balance_change)::numeric
  from ordered_tx
  where sequence_no = 1

  union all

  select
    o.employee_id,
    o.sequence_no,
    case
      when o.balance_change < 0 then greatest(0, b.balance_after + o.balance_change)
      else b.balance_after + o.balance_change
    end::numeric
  from balance_walk b
  join ordered_tx o
    on o.employee_id = b.employee_id
   and o.sequence_no = b.sequence_no + 1
), last_balance as (
  select distinct on (employee_id) employee_id, balance_after
  from balance_walk
  order by employee_id, sequence_no desc
), ambiguity as (
  select employee_id, bool_or(same_time_event_count > 1) as has_ambiguous_order
  from ordered_tx
  group by employee_id
)
select
  z.name,
  coalesce(lb.balance_after, 0)::numeric as "الرصيد التراكمي المحسوب",
  coalesce(a.has_ambiguous_order, false) as "يوجد ترتيب قديم ملتبس؟"
from zeinab z
left join last_balance lb on lb.employee_id = z.id
left join ambiguity a on a.employee_id = z.id
order by z.name;
