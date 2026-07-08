-- ADRIA — رصيد افتتاحي مستقل لكل وسيلة دفع للخزنة الرئيسية (savings).
-- الفلوس اللي كانت موجودة في الخزنة الرئيسية قبل البدء على النظام.
-- مستقل تماماً عن payment_opening_balances (رصيد خزنة المحل).
-- الشكل: { "cash": 5000, "visa": 0, "wallet": 0, ... }. شغّله مرة واحدة.

alter table store_settings add column if not exists savings_opening_balances jsonb;
