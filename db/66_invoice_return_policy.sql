-- سياسة الاستبدال والمرتجع التي تظهر في كل فاتورة مطبوعة.
-- ترحيل إضافي آمن: لا يغيّر أي بيانات موجودة.
alter table store_settings
  add column if not exists invoice_return_policy text default '';

comment on column store_settings.invoice_return_policy is
  'Customer-facing exchange and return policy printed on sales and exchange invoices';

