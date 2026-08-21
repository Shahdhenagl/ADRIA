-- Preserve the invoice-level discount on held/reserved invoices.
-- Safe to run repeatedly on production.
alter table public.held_invoices
  add column if not exists discount_amount numeric not null default 0;

comment on column public.held_invoices.discount_amount is
  'Total invoice discount captured when the reservation was created.';
