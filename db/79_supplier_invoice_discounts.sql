-- Supplier invoice discounts: durable invoice-level discount metadata.
-- Run once in Supabase SQL Editor.

alter table public.purchase_invoices
  add column if not exists gross_total numeric,
  add column if not exists discount_type text,
  add column if not exists discount_value numeric not null default 0,
  add column if not exists discount_amount numeric not null default 0;

update public.purchase_invoices
set gross_total = coalesce(gross_total, total),
    discount_value = coalesce(discount_value, 0),
    discount_amount = coalesce(discount_amount, 0)
where gross_total is null
   or discount_value is null
   or discount_amount is null;

comment on column public.purchase_invoices.gross_total is
  'Invoice total before supplier discount.';
comment on column public.purchase_invoices.discount_type is
  'Supplier invoice discount type: fixed or percentage.';
comment on column public.purchase_invoices.discount_value is
  'Entered supplier discount value, before allocation to lines.';
comment on column public.purchase_invoices.discount_amount is
  'Actual discount amount applied to the invoice.';
