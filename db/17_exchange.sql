-- ADRIA — بيانات الاستبدال على الفاتورة (الأصناف قبل/بعد + الفرق). شغّله مرة واحدة.
alter table orders add column if not exists exchange_data jsonb;
