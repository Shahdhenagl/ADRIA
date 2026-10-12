-- =============================================================================
-- ADRIA — تسجيل الغياب التلقائي وربطه برصيد الإجازة والخصم اليومي
-- شغّله مرة واحدة قبل نشر/استخدام إصدار الواجهة الذي يدعم الغياب التلقائي.
-- آمن لإعادة التشغيل.
-- =============================================================================
-- يبدأ التتبع من أول يوم محاسبي كامل بعد تشغيل هذا الترحيل، حتى لا يتحول
-- يوم جزئي أو أيام تاريخية بلا بصمات قبل تفعيل الميزة إلى خصومات بأثر رجعي.
-- بعد إغلاق اليوم المحاسبي، تقوم صفحة الموظفين بإنشاء سجل لكل يوم عمل مغلق
-- لا يحتوي حضورًا ولا إجازة معتمدة. الجمعة المستثناة من دوام الموظف تُتخطى.
-- =============================================================================

begin;

-- سجل الغياب لا يملك وقت حضور/انصراف؛ حقل absence_leave_type هو علامة الغياب
-- (paid/unpaid/mixed)، وabsence_paid_days يوضح الجزء المغطى من رصيد الشهر.
alter table public.employee_attendance
  alter column check_in drop not null;

alter table public.employee_attendance
  add column if not exists absence_leave_type text,
  add column if not exists absence_paid_days numeric not null default 0;

-- تأكد من سلامة شكل السجل: إما بصمة حضور فعلية، أو غياب بلا بصمات.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employee_attendance_absence_shape_check'
      and conrelid = 'public.employee_attendance'::regclass
  ) then
    alter table public.employee_attendance
      add constraint employee_attendance_absence_shape_check
      check (
        (
          absence_leave_type is null
          and absence_paid_days = 0
          and check_in is not null
        )
        or
        (
          absence_leave_type in ('paid', 'unpaid', 'mixed')
          and check_in is null
          and check_out is null
          and absence_paid_days between 0 and 1
          and (
            (absence_leave_type = 'paid' and absence_paid_days >= 0.999999)
            or (absence_leave_type = 'unpaid' and absence_paid_days <= 0.000001)
            or (absence_leave_type = 'mixed' and absence_paid_days > 0.000001 and absence_paid_days < 0.999999)
          )
        )
      );
  end if;
end $$;

-- إعداد واحد: بداية احتساب الغياب التلقائي. التاريخ آمن وغير حساس، ويُتاح
-- للواجهة قراءته فقط. لا تمنح هذه السياسة صلاحية تعديل الإعداد.
create table if not exists public.employee_attendance_settings (
  singleton boolean primary key default true check (singleton is true),
  absence_tracking_from date not null
);

insert into public.employee_attendance_settings (singleton, absence_tracking_from)
select
  true,
  (
    (
      (now() at time zone 'Africa/Cairo')
      - make_interval(hours => coalesce(
          (select s.day_start_hour from public.store_settings s order by s.id limit 1),
          3
        ))
    )::date + 1
  )
on conflict (singleton) do nothing;

alter table public.employee_attendance_settings enable row level security;
drop policy if exists "read employee attendance tracking start" on public.employee_attendance_settings;
create policy "read employee attendance tracking start"
  on public.employee_attendance_settings
  for select to anon, authenticated
  using (true);

revoke all on public.employee_attendance_settings from public;
revoke all on public.employee_attendance_settings from anon, authenticated;
grant select on public.employee_attendance_settings to anon, authenticated;

commit;

-- تحقق سريع من الأعمدة وتاريخ بدء التتبع.
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'employee_attendance'
  and column_name in ('check_in', 'absence_leave_type', 'absence_paid_days')
order by column_name;

select singleton, absence_tracking_from
from public.employee_attendance_settings;
