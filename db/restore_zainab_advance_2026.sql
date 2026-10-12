-- ADRIA — استعادة معاملات زينب بعد حذف بياناتها
-- السيناريو المعتمد من المحادثة:
--   بداية 08/2026: سلفة 5,000
--   بداية 09/2026: صرف 3,000 من الراتب + سداد 3,000 من السلفة
--   بداية 10/2026: صرف 4,000 من الراتب + سداد آخر 2,000 من السلفة
-- يفترض أن الراتب الشهري = 6,000.
--
-- مصدر خزنة السلفة/الرواتب غير موجود في المحادثة بشكل مؤكد.
-- غيّر القيم الثلاث التالية إلى 'shop' إذا كانت الفلوس خرجت من خزنة المحل.
-- القيمة الافتراضية 'main' تعني الخزنة الرئيسية.

begin;

alter table public.employee_transactions
  add column if not exists advance_repayment numeric;
alter table public.expenses
  add column if not exists employee_transaction_id uuid
  references public.employee_transactions(id) on delete set null;
alter table public.savings_transactions
  add column if not exists group_id uuid;

-- معاينة قبل التنفيذ: يجب أن يظهر موظف واحد باسم زينب.
select id, name, monthly_salary, is_active
from public.employees
where name = 'زينب';

do $restore$
declare
  v_employee_id uuid;
  v_employee_name text := 'زينب';
  v_monthly_salary numeric := 6000;
  v_advance_source text := 'main';
  v_sep_salary_source text := 'main';
  v_oct_salary_source text := 'main';
  v_tx_id uuid;
  v_group_id uuid;
  v_note text;
  v_source text;
  v_amount numeric;
  v_repayment numeric;
  v_month text;
  v_date timestamptz;
  v_payment_method text := 'cash';
begin
  select e.id into strict v_employee_id
  from public.employees e
  where e.name = v_employee_name;

  update public.employees
  set monthly_salary = v_monthly_salary
  where id = v_employee_id;

  -- لا تضف نسخًا مكررة إذا تم تشغيل الملف مرة ثانية.
  if exists (
    select 1 from public.employee_transactions
    where employee_id = v_employee_id
      and note like '[RESTORE-ZAINAB-2026]%'
  ) then
    raise exception 'معاملات استعادة زينب موجودة بالفعل — لم يتم إدخال شيء جديد';
  end if;

  -- دالة محلية: تسجل employee_transactions + expenses، وتضيف قيد الخزنة
  -- الرئيسية فقط عندما يكون المصدر main.
  -- السداد المرحلي محفوظ في advance_repayment وليس deductions.
  -- سلفة أغسطس 2026: 5,000
  v_amount := 5000; v_repayment := 0; v_month := '2026-08';
  v_date := '2026-08-01 12:00:00+03'; v_source := v_advance_source;
  v_group_id := case when v_source = 'main' then gen_random_uuid() else null end;
  v_note := '[RESTORE-ZAINAB-2026] سلفة شهر 08/2026 — المصدر: ' || v_source || case when v_source = 'main' then ' [MAIN_TREASURY] [SVG:' || v_group_id::text || ']' else '' end;

  insert into public.employee_transactions
    (employee_id, amount, type, payment_method, paid_cash, paid_visa,
     paid_wallet, paid_instapay, paid_method5, paid_method6, deductions,
     advance_repayment, month, note, created_at)
  values
    (v_employee_id, v_amount, 'advance', v_payment_method, v_amount, 0,
     0, 0, 0, 0, 0, null, v_month, v_note, v_date)
  returning id into v_tx_id;

  insert into public.expenses
    (category, amount, note, payment_method, paid_cash, paid_visa,
     paid_wallet, paid_instapay, employee_transaction_id, created_at)
  values
    ('رواتب', v_amount, 'سلفة - زينب (استعادة) — ' || v_note, v_payment_method,
     v_amount, 0, 0, 0, v_tx_id, v_date);

  if v_source = 'main' then
    insert into public.savings_transactions
      (direction, amount, method, source, note, group_id, created_at)
    values
      ('out', v_amount, v_payment_method, 'main_expense', v_note, v_group_id, v_date);
  end if;

  -- راتب سبتمبر: إجمالي الراتب 6,000، المدفوع نقدًا 3,000،
  -- وسداد 3,000 فقط من السلفة.
  v_amount := 3000; v_repayment := 3000; v_month := '2026-09';
  v_date := '2026-09-01 12:00:00+03'; v_source := v_sep_salary_source;
  v_group_id := case when v_source = 'main' then gen_random_uuid() else null end;
  v_note := '[RESTORE-ZAINAB-2026] راتب شهر 09/2026 — سداد سلفة 3000 — المصدر: ' || v_source || case when v_source = 'main' then ' [MAIN_TREASURY] [SVG:' || v_group_id::text || ']' else '' end;

  insert into public.employee_transactions
    (employee_id, amount, type, payment_method, paid_cash, paid_visa,
     paid_wallet, paid_instapay, paid_method5, paid_method6, deductions,
     advance_repayment, month, note, created_at)
  values
    (v_employee_id, v_amount, 'salary', v_payment_method, v_amount, 0,
     0, 0, 0, 0, 0, v_repayment, v_month, v_note, v_date)
  returning id into v_tx_id;

  insert into public.expenses
    (category, amount, note, payment_method, paid_cash, paid_visa,
     paid_wallet, paid_instapay, employee_transaction_id, created_at)
  values
    ('رواتب', v_amount, 'راتب - زينب (استعادة) — ' || v_note, v_payment_method,
     v_amount, 0, 0, 0, v_tx_id, v_date);

  if v_source = 'main' then
    insert into public.savings_transactions
      (direction, amount, method, source, note, group_id, created_at)
    values
      ('out', v_amount, v_payment_method, 'main_expense', v_note, v_group_id, v_date);
  end if;

  -- راتب أكتوبر: المدفوع 4,000 بعد سداد آخر 2,000 من السلفة.
  v_amount := 4000; v_repayment := 2000; v_month := '2026-10';
  v_date := '2026-10-01 12:00:00+03'; v_source := v_oct_salary_source;
  v_group_id := case when v_source = 'main' then gen_random_uuid() else null end;
  v_note := '[RESTORE-ZAINAB-2026] راتب شهر 10/2026 — سداد سلفة 2000 — المصدر: ' || v_source || case when v_source = 'main' then ' [MAIN_TREASURY] [SVG:' || v_group_id::text || ']' else '' end;

  insert into public.employee_transactions
    (employee_id, amount, type, payment_method, paid_cash, paid_visa,
     paid_wallet, paid_instapay, paid_method5, paid_method6, deductions,
     advance_repayment, month, note, created_at)
  values
    (v_employee_id, v_amount, 'salary', v_payment_method, v_amount, 0,
     0, 0, 0, 0, 0, v_repayment, v_month, v_note, v_date)
  returning id into v_tx_id;

  insert into public.expenses
    (category, amount, note, payment_method, paid_cash, paid_visa,
     paid_wallet, paid_instapay, employee_transaction_id, created_at)
  values
    ('رواتب', v_amount, 'راتب - زينب (استعادة) — ' || v_note, v_payment_method,
     v_amount, 0, 0, 0, v_tx_id, v_date);

  if v_source = 'main' then
    insert into public.savings_transactions
      (direction, amount, method, source, note, group_id, created_at)
    values
      ('out', v_amount, v_payment_method, 'main_expense', v_note, v_group_id, v_date);
  end if;
end;
$restore$;

-- تحقق نهائي قبل الإنهاء.
select
  t.id,
  e.name,
  t.type,
  t.amount,
  t.advance_repayment,
  t.deductions,
  t.month,
  t.created_at,
  t.note
from public.employee_transactions t
join public.employees e on e.id = t.employee_id
where t.note like '[RESTORE-ZAINAB-2026]%'
order by t.created_at;

-- المتوقع: رصيد السلفة = 5000 - 3000 - 2000 = 0.
select
  e.name,
  coalesce(sum(case when t.type = 'advance' then t.amount else 0 end), 0) as advances_total,
  coalesce(sum(case when t.type = 'salary' then coalesce(t.advance_repayment, 0) else 0 end), 0) as repayments_total,
  coalesce(sum(case when t.type = 'advance' then t.amount else 0 end), 0)
    - coalesce(sum(case when t.type = 'salary' then coalesce(t.advance_repayment, 0) else 0 end), 0) as advance_balance
from public.employee_transactions t
join public.employees e on e.id = t.employee_id
where t.note like '[RESTORE-ZAINAB-2026]%'
group by e.name;

commit;
