-- =============================================================================
-- ADRIA — منع تكرار الفاتورة لما النت يفصل أثناء الحفظ.
-- شغّله مرة واحدة (آمن للتشغيل أكثر من مرة).
-- =============================================================================
-- المشكلة: الكاشير بيأكّد الفاتورة، الطلب بيوصل للسيرفر ويتسجّل فعلاً، وبعدين
-- النت بيفصل قبل ما الرد يرجع للجهاز. الكود بيشوف «خطأ» فبيقع على الوضع الأوفلاين
-- ويحفظ نسخة محلية، وأول ما النت يرجع بيرفعها ⇒ **نفس البيعة برقمين** (٣١٧ و٣١٨).
--
-- ده سلوك كل نظام بيكتب على الشبكة: الطلب بيتنفّذ «مرة على الأقل» مش «مرة بالظبط».
-- الحل المعياري: بصمة فريدة (idempotency key) بيولّدها الجهاز قبل ما يبعت، وبتتكتب
-- مع الفاتورة. لو الفاتورة اتسجّلت خلاص بنفس البصمة، أي محاولة تانية بترجع من غير
-- ما تكتب صف جديد.
--
-- الفهرس الفريد تحت هو الضمان النهائي: حتى لو الكود غلط، قاعدة البيانات نفسها
-- بترفض الصف المكرر.
-- =============================================================================

alter table orders add column if not exists client_ref text;

-- فريد للصفوف اللي ليها بصمة بس — الفواتير القديمة (client_ref = null) مالهاش شرط.
create unique index if not exists orders_client_ref_uniq
  on orders (client_ref)
  where client_ref is not null;

-- للبحث السريع وقت المزامنة.
create index if not exists orders_client_ref_idx on orders (client_ref);

-- كشف أي تكرار قديم (قبل تشغيل الملف) — قراءة فقط.
-- بيدوّر على فواتير بنفس الإجمالي ونفس الكاشير في خلال ٥ دقايق من بعض.
-- راجعها بنفسك: اللي يطلع مكرر فعلاً امسحه من صفحة الفواتير (الحذف بيرجّع المخزون).
-- select a.id as invoice_1, b.id as invoice_2, a.total, a.cashier_name,
--        a.created_at as time_1, b.created_at as time_2,
--        round(extract(epoch from (b.created_at - a.created_at))::numeric) as seconds_apart
-- from orders a join orders b
--   on b.created_at > a.created_at
--   and b.created_at < a.created_at + interval '5 minutes'
--   and abs(coalesce(b.total,0) - coalesce(a.total,0)) < 0.01
--   and coalesce(b.cashier_name,'') = coalesce(a.cashier_name,'')
--   and coalesce(b.type,'') = coalesce(a.type,'')
-- where coalesce(a.is_deleted,false) = false and coalesce(b.is_deleted,false) = false
--   and coalesce(a.total,0) > 0
-- order by a.created_at desc;
