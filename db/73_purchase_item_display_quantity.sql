-- حفظ توزيع كمية فاتورة المشتريات بين المحل والمستودع
-- الفواتير القديمة لا تحتوي على التوزيع، لذلك تبقى قيمتها 0 (كلها مستودع) إلى أن تُراجع يدويًا.
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS to_display numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.purchase_items.to_display IS
  'الكمية من صنف الشراء التي تدخل المحل/المعروض؛ الباقي يدخل المستودع';

ALTER TABLE public.purchase_items
  DROP CONSTRAINT IF EXISTS purchase_items_to_display_nonnegative;

ALTER TABLE public.purchase_items
  ADD CONSTRAINT purchase_items_to_display_nonnegative CHECK (to_display >= 0);

CREATE INDEX IF NOT EXISTS purchase_items_invoice_id_idx
  ON public.purchase_items (invoice_id);
