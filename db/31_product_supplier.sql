-- ADRIA — ربط المنتج باسم المورد + استيراد المخزون من Excel. شغّله مرة واحدة.
alter table products add column if not exists supplier_name text; -- اسم المورد الذي يُورّد هذا المنتج (نصّي)
create index if not exists idx_products_supplier_name on products (supplier_name);
