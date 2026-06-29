-- =============================================================================
-- ADRIA — schema extras for a FRESH database.
-- Run this AFTER setup_new_database.sql. It adds every column/table the app
-- needs that the base file may be missing. Idempotent — safe to run again.
-- =============================================================================

-- Customers ------------------------------------------------------------------
alter table customers add column if not exists card_number text;

-- Products: units + fractional (weight) quantities -------------------------
alter table products add column if not exists unit text not null default 'قطعة';
alter table products alter column stock_quantity type numeric using stock_quantity::numeric;
alter table purchase_items alter column quantity type numeric using quantity::numeric;
alter table order_items alter column quantity type numeric using quantity::numeric;
alter table order_items alter column returned_quantity type numeric using returned_quantity::numeric;

-- Order items: refunded cash per item --------------------------------------
alter table order_items add column if not exists refunded_amount numeric default 0;
update order_items set refunded_amount = 0 where refunded_amount is null;

-- Orders: payment method, soft-delete, car link, refund method -------------
alter table orders add column if not exists payment_method text default 'cash';
alter table orders add column if not exists refund_method text;
alter table orders add column if not exists car_id uuid references car_subscriptions(id) on delete set null;
alter table orders add column if not exists is_deleted boolean not null default false;
alter table orders add column if not exists deleted_at timestamptz;
alter table orders add column if not exists deletion_reason text;
create index if not exists idx_orders_is_deleted on orders(is_deleted);
create index if not exists idx_orders_deleted_at on orders(deleted_at);

-- Store settings: opening balance ------------------------------------------
alter table store_settings add column if not exists initial_balance numeric default 0;
alter table store_settings add column if not exists allow_cashier_employee_advance boolean default false;

-- Purchase invoices: payment method ----------------------------------------
alter table purchase_invoices add column if not exists payment_method text default 'cash';

-- Expenses: payment split + car link ---------------------------------------
alter table expenses add column if not exists paid_cash      numeric default 0;
alter table expenses add column if not exists paid_visa      numeric default 0;
alter table expenses add column if not exists paid_wallet    numeric default 0;
alter table expenses add column if not exists paid_instapay  numeric default 0;
alter table expenses add column if not exists payment_method text default 'cash';
alter table expenses add column if not exists car_id uuid references car_subscriptions(id) on delete set null;

-- Car subscriptions: status + subscription terms ---------------------------
alter table car_subscriptions add column if not exists status text default 'active';
alter table car_subscriptions add column if not exists subscription_duration_months integer;
alter table car_subscriptions add column if not exists subscription_frequency_days integer;

-- Employees: phone, status, leave balance, hire date -----------------------
alter table employees add column if not exists phone text;
alter table employees add column if not exists is_active boolean not null default true;
alter table employees add column if not exists annual_leave_balance numeric not null default 0;
alter table employees add column if not exists hire_date date default current_date;
create index if not exists idx_employees_is_active on employees(is_active);

-- Employee transactions: deductions + incentive type -----------------------
alter table employee_transactions add column if not exists deductions numeric default 0;
alter table employee_transactions drop constraint if exists employee_transactions_type_check;
alter table employee_transactions
  add constraint employee_transactions_type_check
  check (type in ('salary', 'advance', 'incentive'));

-- Cashiers: login email (for Supabase Auth) --------------------------------
alter table cashiers add column if not exists email text;
