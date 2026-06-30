-- =============================================================================
-- HELD / RESERVED INVOICES  (فواتير معلقة / محجوزة)
-- =============================================================================
--  A held invoice reserves stock without recording a sale. From the cashier the
--  staff can later either:
--    * تأكيد البيع  → load it back into the cart and complete a normal sale, or
--    * إرجاع للمخزون → cancel it and return the reserved quantities to stock.
--  Any held invoice not actioned within 7 days is automatically returned to
--  stock (client-side sweep on app load + a daily Vercel cron — see
--  /api/expire-held-invoices).
--
--  Stock is deducted from products.stock_quantity at the moment of holding and
--  added back on return/expiry, so the available quantity always reflects the
--  reservation.
--
--  This script is idempotent — safe to run more than once.
-- =============================================================================

create table if not exists public.held_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  customer_phone text,
  customer_custom_id text,
  items jsonb not null default '[]'::jsonb,
  total numeric not null default 0,
  invoice_type text not null default 'retail',
  salesperson_id uuid,
  salesperson_name text,
  cashier_name text,
  notes text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists idx_held_invoices_expires_at on public.held_invoices(expires_at);
create index if not exists idx_held_invoices_created_at on public.held_invoices(created_at);

-- RLS: authenticated staff only (matches secure_rls_migration.sql).
alter table public.held_invoices enable row level security;
drop policy if exists "allow all" on public.held_invoices;
drop policy if exists "authenticated full access" on public.held_invoices;
create policy "authenticated full access" on public.held_invoices
  for all to authenticated using (true) with check (true);
revoke all on public.held_invoices from anon;
grant all on public.held_invoices to authenticated;
