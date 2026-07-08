-- ADRIA - Clear invoices, products, and categories only.
-- Run in Supabase SQL Editor after taking a backup.
--
-- Keeps:
--   store_settings, cashiers, employees, admin_users, customers, suppliers,
--   managers, partners, savings data, and other app settings/users.
--
-- Deletes:
--   sales invoices, purchase invoices, invoice items, deleted/held invoices,
--   products, categories, product suggestions, stock adjustments, and
--   production orders linked to products.

begin;

-- Invoices and invoice-like records.
truncate table
  order_items,
  orders,
  purchase_items,
  purchase_invoices
restart identity cascade;

-- Product catalog.
truncate table
  products,
  categories
restart identity cascade;

-- Optional tables that may exist depending on which ADRIA migrations were run.
do $$
begin
  if to_regclass('public.deleted_invoices') is not null then
    truncate table public.deleted_invoices restart identity cascade;
  end if;

  if to_regclass('public.held_invoices') is not null then
    truncate table public.held_invoices restart identity cascade;
  end if;

  if to_regclass('public.product_suggestions') is not null then
    truncate table public.product_suggestions restart identity cascade;
  end if;

  if to_regclass('public.stock_adjustments') is not null then
    truncate table public.stock_adjustments restart identity cascade;
  end if;

  if to_regclass('public.production_materials') is not null then
    truncate table public.production_materials restart identity cascade;
  end if;

  if to_regclass('public.production_orders') is not null then
    truncate table public.production_orders restart identity cascade;
  end if;
end $$;

-- Restart invoice numbers from 1.
update invoice_counter set current_value = 1 where id = 1;

commit;
