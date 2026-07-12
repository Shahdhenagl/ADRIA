-- ADRIA — صلاحية كاملة للكاشير: تجاوز الـ OTP في العمليات الحسّاسة
-- (صرف/تحويل من الخزنة الرئيسية، حذف فاتورة، فتح أسعار الجملة).
-- الكاشير اللي عليه full_access = true يقدر ينفّذ العمليات دي مباشرة بدون رمز تأكيد.
-- شغّله مرة واحدة.
alter table cashiers add column if not exists full_access boolean default false;
