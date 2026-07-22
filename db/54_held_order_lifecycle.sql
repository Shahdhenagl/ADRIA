-- =============================================================================
-- ADRIA — دورة حياة الطلب الأونلاين الكاملة + المرتجع. شغّله مرة واحدة (آمن للتكرار).
-- =============================================================================
--  الحالات بعد التعديل:
--    'held'          = تم التجهيز — البضاعة متحجوزة من المخزون
--    'shipped'       = تم الشحن — راح لشركة الشحن
--    'money_pending' = الفلوس في الطريق — العميل استلم ودفع لشركة الشحن،
--                      بس الفلوس لسه ما وصلتش خزنة المحل (شركة الشحن مدينة لينا)
--    'delivered'     = تم التحصيل — الفلوس دخلت الخزنة واتسجّلت فاتورة بيع
--                      (order_id فيه رقمها)
--    'returned'      = مرتجع — العميل ما استلمش، البضاعة رجعت المخزون
--    'cancelled'     = ملغي — اتلغى قبل ما يوصل العميل
--
--  ليه money_pending حالة تتبّع بس ومش بتسجّل فاتورة؟ لأن الفلوس لسه مش في
--  الخزنة. الفاتورة والقيد المالي بيتعملوا وقت «تم التحصيل» بالظبط، فالخزنة
--  بتفضل مطابقة للفلوس الحقيقية. الإحصائيات في الموديول بتقرا من الجدول ده
--  مباشرةً (تقارير، مش قيود محاسبية).
--
--  المرتجع:
--    جزئي  → أصناف بترجع للمخزون والإجمالي بيقلّ، والطلب بيكمّل دورته عادي.
--    كلي   → كل الأصناف بترجع، الحالة 'returned'، والعربون بيترد للعميل.
--  في الحالتين ممكن يتسجّل «مصاريف شحن مرتجع» كمصروف من الخزنة بتاريخ لحظة
--  تسجيل المرتجع (وده بيتخزّن في shipping_return_cost للتقارير).
-- =============================================================================

alter table public.held_invoices
  add column if not exists return_data           jsonb,
  add column if not exists returned_at           timestamptz,
  add column if not exists shipping_return_cost  numeric default 0;

-- توسيع قيد الحالة ليشمل money_pending و returned.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'held_invoices_status_chk') then
    alter table public.held_invoices drop constraint held_invoices_status_chk;
  end if;
  alter table public.held_invoices
    add constraint held_invoices_status_chk
    check (status in ('held', 'shipped', 'money_pending', 'delivered', 'returned', 'cancelled'));
end $$;
