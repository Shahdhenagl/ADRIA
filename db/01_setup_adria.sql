-- ============================================================
-- ADRIA — متجر ملابس | إعداد قاعدة البيانات من الصفر (نسخة فاضية)
-- ينشئ كل الجداول + تصنيفات ملابس فقط، بدون أي منتجات أو بيانات.
-- شغّله بالكامل مرة واحدة: Supabase > SQL Editor > New query > Run
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1) الجداول
-- ============================================================

create table if not exists store_settings (
  id uuid default gen_random_uuid() primary key,
  name text not null default 'ADRIA',
  currency text default 'ج.م',
  logo text default 'https://cdn-icons-png.flaticon.com/512/3531/3531849.png',
  tax_rate numeric default 0,
  theme_color text default '#4f46e5',
  address text default '',
  phone text default '',
  phone2 text default '',
  whatsapp_country_code text default '2',
  initial_balance numeric default 0,
  location_url text default ''
);

create table if not exists categories (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  barcode text unique,
  purchase_price numeric default 0,
  average_purchase_price numeric default 0,
  sale_price numeric default 0,
  stock_quantity numeric default 0,
  unit text not null default 'قطعة',
  category_id uuid references categories(id) on delete set null,
  is_hidden boolean default false,
  created_at timestamptz default now()
);

create table if not exists customers (
  id uuid default gen_random_uuid() primary key,
  custom_id text unique,
  name text not null default 'بدون اسم',
  phone text unique not null,
  card_number text,
  created_at timestamptz default now()
);

create table if not exists suppliers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  phone text,
  address text,
  created_at timestamptz default now()
);

create table if not exists car_subscriptions (
  id uuid primary key default gen_random_uuid(),
  car_number text not null,
  car_details text,
  customer_name text,
  customer_phone text,
  status text default 'active',
  subscription_duration_months integer,
  subscription_frequency_days integer,
  created_at timestamptz default now()
);

create table if not exists maintenance_appointments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references car_subscriptions(id) on delete cascade,
  appointment_date date not null,
  description text,
  report text,
  cost numeric default 0,
  status text default 'pending',
  is_reminded boolean default false,
  created_at timestamptz default now()
);

create table if not exists purchase_invoices (
  id uuid default gen_random_uuid() primary key,
  invoice_number text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  total numeric not null default 0,
  paid_amount numeric default 0,
  paid_cash numeric default 0,
  paid_visa numeric default 0,
  paid_wallet numeric default 0,
  paid_instapay numeric default 0,
  payment_method text default 'cash',
  created_at timestamptz default now()
);

create table if not exists purchase_items (
  id uuid default gen_random_uuid() primary key,
  invoice_id uuid references purchase_invoices(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  quantity numeric not null default 1,
  purchase_price numeric not null default 0
);

create table if not exists orders (
  id text primary key,
  total numeric not null default 0,
  paid_amount numeric default 0,
  paid_cash numeric default 0,
  paid_visa numeric default 0,
  paid_wallet numeric default 0,
  paid_instapay numeric default 0,
  payment_method text default 'cash',
  refund_method text,
  type text default 'sale',
  customer_id uuid references customers(id) on delete set null,
  cashier_name text,
  car_id uuid references car_subscriptions(id) on delete set null,
  coupon_code text,
  discount_amount numeric default 0,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deletion_reason text,
  notes text,
  created_at timestamptz default now()
);
create index if not exists idx_orders_is_deleted on orders(is_deleted);
create index if not exists idx_orders_deleted_at on orders(deleted_at);

create table if not exists invoice_counter (
  id int primary key default 1,
  current_value integer default 1,
  check (id = 1)
);
insert into invoice_counter (id, current_value) values (1, 1)
on conflict (id) do nothing;

create table if not exists order_items (
  id uuid default gen_random_uuid() primary key,
  order_id text references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  barcode text,
  quantity numeric default 1,
  returned_quantity numeric default 0,
  refunded_amount numeric default 0,
  sale_price numeric default 0,
  purchase_price numeric default 0
);

create table if not exists expenses (
  id uuid default gen_random_uuid() primary key,
  category text not null,
  amount numeric not null default 0,
  note text,
  payment_method text default 'cash',
  paid_cash numeric default 0,
  paid_visa numeric default 0,
  paid_wallet numeric default 0,
  paid_instapay numeric default 0,
  car_id uuid references car_subscriptions(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists financing_accounts (
  id uuid default gen_random_uuid() primary key,
  type text not null default 'loan',
  lender_name text not null,
  lender_phone text default '',
  lender_details text default '',
  description text default '',
  principal_amount numeric not null default 0,
  collection_amount numeric not null default 0,
  collection_date date not null,
  installment_count integer not null default 1,
  status text not null default 'open',
  created_at timestamptz default now()
);

create table if not exists financing_payments (
  id uuid default gen_random_uuid() primary key,
  account_id uuid references financing_accounts(id) on delete cascade,
  payment_type text not null,
  due_date date not null,
  amount numeric not null default 0,
  paid_amount numeric not null default 0,
  remaining_amount numeric not null default 0,
  status text not null default 'pending',
  paid_at timestamptz,
  expense_id uuid references expenses(id) on delete set null,
  note text,
  created_at timestamptz default now()
);

create table if not exists financing_transactions (
  id uuid default gen_random_uuid() primary key,
  account_id uuid references financing_accounts(id) on delete cascade,
  payment_id uuid references financing_payments(id) on delete cascade,
  transaction_type text not null,
  amount numeric not null default 0,
  remaining_after numeric not null default 0,
  payment_method text not null default 'cash',
  expense_id uuid references expenses(id) on delete set null,
  note text,
  created_at timestamptz default now()
);

create table if not exists cashiers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  password text,
  phone text,
  photo_url text,
  email text,
  created_at timestamptz default now()
);

create table if not exists employees (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  job_title text,
  phone text,
  working_hours text,
  monthly_salary numeric default 0,
  annual_leave_balance numeric not null default 0,
  hire_date date default current_date,
  is_active boolean not null default true,
  created_at timestamptz default now()
);
create index if not exists idx_employees_is_active on employees(is_active);

create table if not exists employee_transactions (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references employees(id) on delete cascade,
  amount numeric not null,
  type text check (type in ('salary', 'advance', 'incentive')),
  payment_method text default 'cash',
  paid_cash numeric default 0,
  paid_visa numeric default 0,
  paid_wallet numeric default 0,
  paid_instapay numeric default 0,
  deductions numeric default 0,
  month text,
  note text,
  created_at timestamptz default now()
);

create table if not exists employee_leaves (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days_count numeric not null default 1,
  leave_type text not null check (leave_type in ('paid', 'unpaid')),
  deduction_amount numeric not null default 0,
  month text,
  note text,
  created_at timestamptz default now()
);
create index if not exists idx_employee_leaves_employee_id on employee_leaves(employee_id);
create index if not exists idx_employee_leaves_month on employee_leaves(month);
create index if not exists idx_employee_leaves_start_date on employee_leaves(start_date);

create table if not exists product_suggestions (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  notes text,
  is_purchased boolean default false,
  created_at timestamptz default now()
);

create table if not exists cashier_notes (
  id uuid default gen_random_uuid() primary key,
  cashier_name text not null,
  note text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);

create table if not exists coupons (
  id uuid default gen_random_uuid() primary key,
  code text not null unique,
  discount_type text not null default 'percentage' check (discount_type in ('percentage','fixed')),
  discount_value numeric not null default 0,
  start_date timestamptz,
  end_date timestamptz,
  max_uses_per_customer integer,
  max_uses_total integer,
  used_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- ============================================================
-- 2) تفعيل RLS + سياسات مفتوحة (تُقفل لاحقاً بـ secure_rls_migration.sql)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'store_settings','categories','products','customers','suppliers',
    'car_subscriptions','maintenance_appointments','purchase_invoices','purchase_items',
    'orders','invoice_counter','order_items','expenses',
    'financing_accounts','financing_payments','financing_transactions',
    'cashiers','employees','employee_transactions','employee_leaves',
    'product_suggestions','cashier_notes','coupons'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'allow all'
    ) then
      execute format('create policy "allow all" on %I for all using (true) with check (true);', t);
    end if;
  end loop;
end $$;

do $$
begin
  begin execute 'alter publication supabase_realtime add table car_subscriptions'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table maintenance_appointments'; exception when others then null; end;
end $$;

-- ============================================================
-- 3) بيانات أولية: إعدادات المتجر + تصنيفات ملابس فقط (بدون منتجات)
-- ============================================================

insert into store_settings (name, currency, tax_rate, theme_color, initial_balance)
select 'ADRIA', 'ج.م', 0, '#4f46e5', 0
where not exists (select 1 from store_settings);

insert into categories (name) values
  ('رجالي'),
  ('حريمي'),
  ('أطفالي'),
  ('أحذية'),
  ('شنط وإكسسوارات'),
  ('ملابس داخلية'),
  ('ملابس رياضية'),
  ('شتوي وجاكيتات')
on conflict do nothing;

-- ============================================================
-- تم. كل الجداول جاهزة + 8 تصنيفات ملابس، بدون أي منتجات.
-- ============================================================
