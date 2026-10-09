-- ADRIA — ربط سداد السلفة بصرف الراتب
-- شغّل الملف مرة واحدة على Supabase SQL Editor. آمن لإعادة التشغيل.
-- NULL = معاملة راتب قديمة، وتحافظ الواجهة على تفسيرها التاريخي.

alter table employee_transactions
  add column if not exists advance_repayment numeric;

comment on column employee_transactions.advance_repayment is
  'مبلغ من السلفة تم سداده داخل صرف الراتب؛ NULL للسجلات القديمة، و0 للراتب الجديد بدون سداد';

create index if not exists employee_transactions_advance_repayment_idx
  on employee_transactions (employee_id, type, month);

-- فحص سريع بعد التشغيل: لا يفترض وجود سداد سلفة سالب أو أكبر من الراتب.
select
  et.id,
  e.name as employee_name,
  et.type,
  et.amount,
  et.advance_repayment,
  et.month,
  et.created_at
from employee_transactions et
join employees e on e.id = et.employee_id
where coalesce(et.advance_repayment, 0) < 0
   or coalesce(et.advance_repayment, 0) > coalesce(et.amount, 0)
order by et.created_at desc;
