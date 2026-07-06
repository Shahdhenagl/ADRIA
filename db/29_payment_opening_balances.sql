-- ADRIA — رصيد افتتاحي مستقل لكل وسيلة دفع (كاش/فيزا/محفظة/انستا/طريقة5/طريقة6).
-- يُستخدم في «كشوف حسابات وسائل الدفع». شغّله مرة واحدة.
-- الشكل: { "cash": 1000, "visa": 0, "wallet": 500, ... }

alter table store_settings add column if not exists payment_opening_balances jsonb;
