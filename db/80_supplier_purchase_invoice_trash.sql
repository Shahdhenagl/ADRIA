-- ADRIA — supplier purchase invoice trash/archive (db/80)
-- Run once in Supabase SQL Editor before using the supplier delete button.

begin;

create table if not exists public.deleted_supplier_purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  original_invoice_id uuid not null unique,
  invoice_number text not null,
  supplier_id uuid,
  supplier_name text not null default 'مورد محذوف',
  invoice_snapshot jsonb not null,
  deleted_at timestamptz not null default now(),
  deleted_by text,
  deletion_reason text
);

create index if not exists idx_deleted_supplier_purchase_invoices_deleted_at
  on public.deleted_supplier_purchase_invoices (deleted_at desc);
create index if not exists idx_deleted_supplier_purchase_invoices_supplier_id
  on public.deleted_supplier_purchase_invoices (supplier_id);

alter table public.deleted_supplier_purchase_invoices enable row level security;
drop policy if exists "allow all" on public.deleted_supplier_purchase_invoices;
drop policy if exists "authenticated full access" on public.deleted_supplier_purchase_invoices;
create policy "authenticated full access"
  on public.deleted_supplier_purchase_invoices
  for all to authenticated
  using (true)
  with check (true);
revoke all on public.deleted_supplier_purchase_invoices from anon;
grant all on public.deleted_supplier_purchase_invoices to authenticated;

commit;
