-- ADRIA — compatibility migration for older held_invoices installations.
-- Run this file once in Supabase SQL Editor. It is safe to run repeatedly.

alter table public.held_invoices
  add column if not exists deposit numeric not null default 0,
  add column if not exists deposit_split jsonb,
  add column if not exists deposit_date timestamptz,
  add column if not exists discount_amount numeric not null default 0,
  add column if not exists updated_at timestamptz,
  add column if not exists kind text not null default 'shop',
  add column if not exists status text not null default 'held',
  add column if not exists order_id text,
  add column if not exists status_at timestamptz,
  add column if not exists status_note text,
  add column if not exists customer_address text,
  add column if not exists shipping_note text,
  add column if not exists return_data jsonb,
  add column if not exists returned_at timestamptz,
  add column if not exists shipping_return_cost numeric default 0;

update public.held_invoices
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

update public.held_invoices
set kind = 'shop'
where kind is null;

update public.held_invoices
set status = 'held'
where status is null;

alter table public.held_invoices
  alter column updated_at set default now();

create index if not exists idx_held_invoices_updated_at
  on public.held_invoices(updated_at);

comment on column public.held_invoices.discount_amount is
  'Total invoice discount captured when the reservation was created.';
