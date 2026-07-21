-- =============================================================================
-- ADRIA — الحضور والانصراف على «اليوم المحاسبي» بدل منتصف الليل
-- شغّله مرة واحدة (آمن للتشغيل أكثر من مرة). بيحدّث دوال db/40.
-- =============================================================================
-- المشكلة: دوال الحضور كانت بتستخدم (now() at time zone 'Africa/Cairo')::date،
-- يعني اليوم بينط عند ١٢ بالليل بالظبط. الموظف اللي بيمشي ١ ص كان النظام
-- بيدوّر له على صف حضور بتاريخ اليوم الجديد، ومايلاقيش، فزرار الانصراف
-- بيتقفل ويقول «لم تسجّل حضور اليوم بعد» — والوردية بتفضل مفتوحة للأبد.
--
-- الحل: نفس أساس اليوم المحاسبي المستخدم في كل النظام (store_settings.day_start_hour،
-- افتراضي ٣ ص). الحيلة: نطرح ساعات بداية اليوم من التوقيت المحلي قبل ما ناخد
-- التاريخ — فالساعة ١ ص بتبقى ١٠ م من اليوم اللي فات، والساعة ٥ ص بتبقى
-- ٢ ص من نفس اليوم.
--
-- النتيجة: وردية بدأت ١٢ ظهر التلات وخلصت ١ ص الأربع = صف واحد على التلات.
-- وبعد ٣ ص اليوم بيتقفل فعلاً، واللي نسي ينصرف لازم الأدمن يعدّله يدوياً.
-- =============================================================================

-- 1) اليوم المحاسبي الحالي — مصدر واحد تستخدمه كل دوال الحضور.
create or replace function public.attendance_business_date()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (
    (now() at time zone 'Africa/Cairo')
    - make_interval(hours => coalesce(
        (select s.day_start_hour from store_settings s order by s.id limit 1), 3))
  )::date;
$$;

revoke all on function public.attendance_business_date() from public;
grant execute on function public.attendance_business_date() to anon, authenticated;


-- 2) حالة اليوم لموظف (بتتحكم في تفعيل زر الانصراف)
create or replace function public.get_attendance_status(p_employee_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('check_in', a.check_in, 'check_out', a.check_out)
       from employee_attendance a
      where a.employee_id = p_employee_id
        and a.date = public.attendance_business_date()),
    jsonb_build_object('check_in', null, 'check_out', null)
  );
$$;

revoke all on function public.get_attendance_status(uuid) from public;
grant execute on function public.get_attendance_status(uuid) to anon, authenticated;


-- 3) تسجيل حضور/انصراف — نفس منطق db/40 لكن باليوم المحاسبي
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

  select * into v_row from employee_attendance
   where employee_id = p_employee_id and date = v_today;

  if p_action = 'check_in' then
    if found then
      return jsonb_build_object('ok', false, 'error', 'already_checked_in',
        'name', v_emp.name, 'time', v_row.check_in);
    end if;

    -- حساب التأخير والخصم (لو محدد بداية دوام)
    if v_emp.shift_start is not null then
      v_expected := v_today + v_emp.shift_start;
      v_grace    := coalesce(v_emp.late_grace_minutes, 0);
      v_raw_late := round(extract(epoch from (v_local - v_expected)) / 60.0);
      v_late     := greatest(0, v_raw_late - v_grace);
      if v_late > 0 then
        if v_emp.shift_end is not null then
          v_workday := extract(epoch from (v_emp.shift_end - v_emp.shift_start)) / 60.0;
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
      (p_employee_id, v_today, v_now, v_emp.shift_start, v_late, v_ded,
       to_char(v_today, 'YYYY-MM'), 'تسجيل ذاتي');

    return jsonb_build_object('ok', true, 'action', 'check_in',
      'name', v_emp.name, 'time', v_now, 'late_minutes', v_late, 'deduction', v_ded);

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
