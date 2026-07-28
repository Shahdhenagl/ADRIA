-- =============================================================================
-- ADRIA — شفت الجمعة لكل موظف + إجازة إدارية بدون خصم + تعديل الحضور من الأدمن
-- شغّله مرة واحدة (آمن للتشغيل أكثر من مرة). بيبني فوق db/33 + db/40 + db/51.
-- =============================================================================
-- (1) شفت الجمعة: كل موظف ليه بداية/نهاية دوام مستقلة يوم الجمعة، أو الجمعة راحة
--     أصلاً. لو الحقول فاضية بيرجع للشفت العادي — فالموظفين القدام مايتأثروش.
-- (2) إجازة بدون خصم: نوع ثالث في employee_leaves اسمه 'granted' — الأدمن بيدي
--     الموظف يوم إجازة، مش بيتخصم من المرتب ولا بياكل من الرصيد الشهري (بعكس
--     'paid' اللي بياخد من الرصيد و'unpaid' اللي بيتخصم).
-- (3) أي يوم عليه إجازة (بأي نوع) أو يوم راحة أسبوعية = مفيش حساب تأخير، حتى لو
--     الموظف سجّل حضور — عشان مايتخصمش على يوم أصلاً مش مطلوب فيه دوام.
-- =============================================================================

-- 1) أعمدة شفت الجمعة على الموظفين
alter table employees add column if not exists friday_shift_start time;
alter table employees add column if not exists friday_shift_end   time;
alter table employees add column if not exists friday_is_off      boolean not null default false;

-- 2) نوع إجازة ثالث: 'granted' (إجازة إدارية بدون خصم وبدون استهلاك الرصيد)
alter table employee_leaves drop constraint if exists employee_leaves_leave_type_check;
alter table employee_leaves add  constraint employee_leaves_leave_type_check
  check (leave_type in ('paid', 'unpaid', 'granted'));

-- 3) تسجيل الحضور الذاتي — بشفت الجمعة وبتجاهل التأخير في أيام الراحة/الإجازة
create or replace function public.record_attendance(
  p_employee_id uuid,
  p_pin text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp    employees%rowtype;
  v_today  date := public.attendance_business_date();  -- اليوم المحاسبي مش التقويمي
  v_now    timestamptz := now();
  v_local  timestamp := (now() at time zone 'Africa/Cairo'); -- توقيت القاهرة (ساعة الحائط)
  v_row    employee_attendance%rowtype;
  v_dow          int := extract(dow from v_today);  -- 5 = الجمعة
  v_shift_start  time;
  v_shift_end    time;
  v_off          boolean := false;
  v_expected     timestamp;
  v_raw_late     numeric;
  v_grace        numeric;
  v_late         numeric := 0;
  v_workday      numeric := 480;
  v_daily        numeric;
  v_ded          numeric := 0;
begin
  select * into v_emp from employees where id = p_employee_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if coalesce(v_emp.is_active, true) = false then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;
  if coalesce(v_emp.attendance_pin, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'no_pin');
  end if;
  if v_emp.attendance_pin <> p_pin then
    return jsonb_build_object('ok', false, 'error', 'wrong_pin');
  end if;

  -- شفت اليوم: الجمعة ليها شفت مستقل لو محدد، وإلا الشفت العادي.
  if v_dow = 5 then
    v_shift_start := coalesce(v_emp.friday_shift_start, v_emp.shift_start);
    v_shift_end   := coalesce(v_emp.friday_shift_end,   v_emp.shift_end);
    v_off         := coalesce(v_emp.friday_is_off, false);
  else
    v_shift_start := v_emp.shift_start;
    v_shift_end   := v_emp.shift_end;
  end if;

  -- يوم عليه إجازة مسجّلة (بأي نوع) = يوم راحة، مفيش تأخير ولا خصم.
  if exists (
    select 1 from employee_leaves l
     where l.employee_id = p_employee_id
       and v_today between l.start_date and l.end_date
  ) then
    v_off := true;
  end if;

  select * into v_row from employee_attendance
   where employee_id = p_employee_id and date = v_today;

  if p_action = 'check_in' then
    if found then
      return jsonb_build_object('ok', false, 'error', 'already_checked_in',
        'name', v_emp.name, 'time', v_row.check_in);
    end if;

    -- حساب التأخير والخصم (لو محدد بداية دوام واليوم مش راحة)
    if v_shift_start is not null and not v_off then
      v_expected := v_today + v_shift_start;
      v_grace    := coalesce(v_emp.late_grace_minutes, 0);
      v_raw_late := round(extract(epoch from (v_local - v_expected)) / 60.0);
      v_late     := greatest(0, v_raw_late - v_grace);
      if v_late > 0 then
        if v_shift_end is not null then
          v_workday := extract(epoch from (v_shift_end - v_shift_start)) / 60.0;
          if v_workday <= 0 then v_workday := v_workday + 1440; end if;
          if v_workday = 0 then v_workday := 480; end if;
        end if;
        v_daily := coalesce(v_emp.monthly_salary, 0) / 30.0;
        v_ded   := round(least(v_daily, (v_late / v_workday) * v_daily)::numeric, 2);
      end if;
    end if;

    insert into employee_attendance
      (employee_id, date, check_in, shift_start, late_minutes, deduction_amount, month, note)
    values
      (p_employee_id, v_today, v_now, v_shift_start, v_late, v_ded,
       to_char(v_today, 'YYYY-MM'),
       case when v_off then 'تسجيل ذاتي — يوم راحة/إجازة' else 'تسجيل ذاتي' end);

    return jsonb_build_object('ok', true, 'action', 'check_in',
      'name', v_emp.name, 'time', v_now, 'late_minutes', v_late, 'deduction', v_ded,
      'day_off', v_off);

  elsif p_action = 'check_out' then
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_checked_in', 'name', v_emp.name);
    end if;
    if v_row.check_out is not null then
      return jsonb_build_object('ok', false, 'error', 'already_checked_out',
        'name', v_emp.name, 'time', v_row.check_out);
    end if;
    update employee_attendance set check_out = v_now where id = v_row.id;
    return jsonb_build_object('ok', true, 'action', 'check_out',
      'name', v_emp.name, 'time', v_now);

  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
end;
$$;

revoke all on function public.record_attendance(uuid, text, text) from public;
grant execute on function public.record_attendance(uuid, text, text) to anon, authenticated;
