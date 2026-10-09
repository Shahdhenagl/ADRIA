-- ADRIA — كشف حساب وتشخيص راتب زينب (قراءة فقط)
-- شغّل بعد 80_employee_advance_repayment.sql.
-- لو الاسم محفوظ بالعربي سيعمل البحث بـ زينب، ولو بالإنجليزي سيعمل بـ zeinab/zeinab.

with zeinab as (
  select id, name, monthly_salary
  from employees
  where lower(name) like '%zeinab%'
     or name like '%زينب%'
)
select *
from (
  select z.name as employee_name, z.monthly_salary, 'سلفة' as category,
         et.month, et.created_at::date as event_date,
         et.amount as amount, 0::numeric as deduction,
         coalesce(et.advance_repayment, 0)::numeric as advance_repayment,
         et.note
  from zeinab z join employee_transactions et on et.employee_id = z.id
  where et.type = 'advance'

  union all
  select z.name, z.monthly_salary, 'راتب', et.month, et.created_at::date,
         et.amount, coalesce(et.deductions, 0)::numeric,
         coalesce(et.advance_repayment, 0)::numeric, et.note
  from zeinab z join employee_transactions et on et.employee_id = z.id
  where et.type = 'salary'

  union all
  select z.name, z.monthly_salary, 'حافز مصروف', et.month, et.created_at::date,
         et.amount, 0::numeric, 0::numeric, et.note
  from zeinab z join employee_transactions et on et.employee_id = z.id
  where et.type = 'incentive'

  union all
  select z.name, z.monthly_salary, 'خصم يدوي', d.month, d.created_at::date,
         0::numeric, coalesce(d.amount, 0)::numeric, 0::numeric, d.reason
  from zeinab z join employee_deductions d on d.employee_id = z.id

  union all
  select z.name, z.monthly_salary, 'مكافأة مع الراتب', b.month, b.created_at::date,
         coalesce(b.amount, 0)::numeric, 0::numeric, 0::numeric, b.reason
  from zeinab z join employee_bonuses b on b.employee_id = z.id

  union all
  select z.name, z.monthly_salary, 'إجازة بخصم', l.month, l.created_at::date,
         0::numeric, coalesce(l.deduction_amount, 0)::numeric, 0::numeric, l.note
  from zeinab z join employee_leaves l on l.employee_id = z.id
  where l.leave_type = 'unpaid'

  union all
  select z.name, z.monthly_salary, 'خصم حضور/تأخير', a.month, a.created_at::date,
         0::numeric, coalesce(a.deduction_amount, 0)::numeric, 0::numeric, a.note
  from zeinab z join employee_attendance a on a.employee_id = z.id
  where coalesce(a.deduction_amount, 0) > 0
) ledger
order by month desc nulls last, event_date desc nulls last;

-- ملخص أكتوبر 2026: يوضح صراحةً إن كان 325 سلفة مصروفة أم سدادًا من الراتب.
with zeinab as (
  select id, name, monthly_salary from employees
  where lower(name) like '%zeinab%' or name like '%زينب%'
), tx as (
  select et.* from employee_transactions et join zeinab z on z.id = et.employee_id
  where et.month = '2026-10'
), deductions as (
  select coalesce(sum(amount), 0)::numeric as amount from employee_deductions d
  join zeinab z on z.id = d.employee_id where d.month = '2026-10'
), bonuses as (
  select coalesce(sum(amount), 0)::numeric as amount from employee_bonuses b
  join zeinab z on z.id = b.employee_id where b.month = '2026-10'
)
select
  z.name,
  z.monthly_salary,
  coalesce(sum(tx.amount) filter (where tx.type = 'advance'), 0)::numeric as advances_october,
  coalesce(sum(tx.amount) filter (where tx.type = 'salary'), 0)::numeric as salary_paid_october,
  coalesce(sum(tx.amount) filter (where tx.type = 'incentive'), 0)::numeric as incentives_october,
  coalesce(sum(tx.advance_repayment) filter (where tx.type = 'salary'), 0)::numeric as advance_repaid_from_salary_october,
  coalesce(sum(tx.deductions) filter (where tx.type = 'salary'), 0)::numeric as salary_transaction_deductions,
  (select amount from deductions) as manual_deductions_october,
  (select amount from bonuses) as bonuses_october,
  -- هذا هو صافي الراتب المتوقع قبل خصم أيام الإجازة/التأخير؛ أضفهما من الكشف التفصيلي أعلاه.
  z.monthly_salary
    + (select amount from bonuses)
    - coalesce(sum(tx.amount) filter (where tx.type = 'salary'), 0)
    - coalesce(sum(tx.deductions) filter (where tx.type = 'salary'), 0)
    - coalesce(sum(tx.advance_repayment) filter (where tx.type = 'salary'), 0)
    - (select amount from deductions) as salary_remaining_before_leave_attendance
from zeinab z
left join tx on true
group by z.name, z.monthly_salary;

-- كل القيود التي تساوي 325 أو 830 لزينب، مع مصدرها، لتحديد الرقمين فورًا.
with zeinab as (
  select id, name from employees
  where lower(name) like '%zeinab%' or name like '%زينب%'
)
select 'employee_transaction' as source, et.type as kind, et.month,
       et.amount, et.deductions, et.advance_repayment, et.note, et.created_at
from employee_transactions et join zeinab z on z.id = et.employee_id
where et.amount in (325, 830) or et.deductions in (325, 830) or et.advance_repayment in (325, 830)
union all
select 'employee_deduction', 'deduction', d.month, d.amount, d.amount, 0, d.reason, d.created_at
from employee_deductions d join zeinab z on z.id = d.employee_id
where d.amount in (325, 830)
union all
select 'employee_bonus', 'bonus', b.month, b.amount, 0, 0, b.reason, b.created_at
from employee_bonuses b join zeinab z on z.id = b.employee_id
where b.amount in (325, 830)
order by created_at desc;
