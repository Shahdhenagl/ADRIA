-- ADRIA — quantity scope for product discounts.
alter table public.product_discounts
  add column if not exists quantity_limit numeric;

comment on column public.product_discounts.quantity_limit is
  'Maximum stock quantity covered by this discount; null means all available quantity.';
