-- ADRIA — عنوان التوصيل للطلبات الأونلاين. شغّله مرة واحدة (آمن للتكرار).
--
-- الطلب الأونلاين بيتطبع وبيتسلّم لشركة الشحن، فمحتاج عنوان كامل + ملاحظات
-- للمندوب (علامة مميزة، دور، أقرب معلم...). حجز المحل مش محتاجه فبيفضل فاضي.
alter table public.held_invoices
  add column if not exists customer_address text,
  add column if not exists shipping_note    text;
