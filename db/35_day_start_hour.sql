-- ADRIA — ساعة بداية اليوم لتقفيل اليومية (مثلاً 3 = اليوم يبدأ 3 صباحاً).
-- الفواتير المسجّلة قبل هذه الساعة تُحسب ضمن تقفيل اليوم السابق. شغّله مرة واحدة.
alter table store_settings add column if not exists day_start_hour integer default 3;
