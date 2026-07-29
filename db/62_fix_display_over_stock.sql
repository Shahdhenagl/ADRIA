-- =============================================================================
-- ADRIA — تصحيح «الكمية المعروضة أكبر من إجمالي المخزون».
-- شغّله مرة واحدة (آمن للتشغيل أكثر من مرة).
-- =============================================================================
-- السبب: البيع كان بينقص stock_quantity بس ومابيلمسش display_quantity، فبعد ما
-- تبيع من اللي معروض في المحل يفضل الرقم المعروض زي ما هو ويبقى أكبر من الإجمالي.
-- الواجهة كانت بتتعامل معاه بـ min(display, stock) فالأرقام الظاهرة كانت سليمة،
-- لكن حساب «المستودع» (الإجمالي − المعروض) كان بيطلع صفر بالغلط.
--
-- الإصلاح في الكود: البيع/الحجز بقى ينزّل المعروض مع الإجمالي (نفس منطق min).
-- والاستعلام ده بيصلّح الصفوف القديمة مرة واحدة.
-- =============================================================================

-- (1) شوف الأول عدد المنتجات المتأثرة (قراءة فقط).
select count(*) as "منتجات معروضها أكبر من مخزونها"
from products
where coalesce(display_quantity, 0) > coalesce(stock_quantity, 0) + 0.0001;

-- (2) التفاصيل قبل التعديل (قراءة فقط).
-- select id, name, barcode, stock_quantity, display_quantity
-- from products
-- where coalesce(display_quantity,0) > coalesce(stock_quantity,0) + 0.0001
-- order by display_quantity - stock_quantity desc;

-- (3) التصحيح: المعروض ما يزيدش عن الإجمالي.
--     المخزون نفسه مابيتغيرش — الرقم الإجمالي هو الصح، والمعروض هو اللي بايت.
update products
set display_quantity = greatest(0, coalesce(stock_quantity, 0))
where coalesce(display_quantity, 0) > coalesce(stock_quantity, 0) + 0.0001;

-- (4) تأكيد: لازم يرجّع صفر.
select count(*) as "متبقي بعد التصحيح"
from products
where coalesce(display_quantity, 0) > coalesce(stock_quantity, 0) + 0.0001;
