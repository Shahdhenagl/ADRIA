-- ADRIA — تصنيف موسمي + أسعار الجملة. شغّله مرة واحدة.
alter table products add column if not exists season text;                       -- 'summer' / 'winter'
alter table products add column if not exists wholesale_price numeric default 0;      -- سعر الجملة
alter table products add column if not exists half_wholesale_price numeric default 0; -- سعر نص الجملة
