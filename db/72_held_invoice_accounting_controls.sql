-- ADRIA — held invoice accounting controls and historical deposit separation.
-- Safe to run repeatedly.

alter table public.held_invoices
  add column if not exists discount_amount numeric not null default 0,
  add column if not exists deposit_date timestamptz,
  add column if not exists updated_at timestamptz;

alter table public.orders
  add column if not exists held_invoice_id uuid,
  add column if not exists held_deposit_amount numeric not null default 0,
  add column if not exists held_deposit_split jsonb,
  add column if not exists held_deposit_date timestamptz;

create index if not exists idx_orders_held_invoice_id on public.orders(held_invoice_id);
create index if not exists idx_held_invoices_deposit_date on public.held_invoices(deposit_date);

-- Existing rows keep their historical behavior. New deliveries will populate
-- these columns so reports can exclude the already-collected deposit from the
-- delivery-day inflow while the customer balance still uses paid_amount.
