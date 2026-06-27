-- ADRIA — سعر البيع بعد الخصم للمنتجات. شغّله مرة واحدة.
alter table products add column if not exists discount_price numeric default 0;
