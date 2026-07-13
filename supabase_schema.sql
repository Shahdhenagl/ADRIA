-- ============================================================
-- Cashier System - Supabase Schema
-- Run this entire script in Supabase SQL Editor once
-- ============================================================

-- جدول الإعدادات
create table if not exists store_settings (
  id uuid default gen_random_uuid() primary key,
  name text not null default 'محلي',
  currency text default 'ج.م',
  logo text default 'https://cdn-icons-png.flaticon.com/512/3143/3143641.png',
  tax_rate numeric default 0,
  theme_color text default '#4f46e5',
  address text default '',
  phone text default '',
  phone2 text default '',
  whatsapp_country_code text default '2'
);

-- إدخال صف الإعدادات الافتراضي
insert into store_settings (name, currency, tax_rate, theme_color)
values ('محل اللحوم الطازجة', 'ج.م', 0, '#4f46e5')
on conflict do nothing;

-- جدول الفئات
create table if not exists categories (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamptz default now()
);

-- إدخال بيانات افتراضية للفئات
insert into categories (name) values ('لحوم حمراء'), ('دواجن'), ('أسماك')
on conflict do nothing;

-- جدول المنتجات
create table if not exists products (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  barcode text unique,
  purchase_price numeric default 0,
  average_purchase_price numeric default 0,
  sale_price numeric default 0,
  stock_quantity integer default 0,
  category_id uuid references categories(id) on delete set null,
  created_at timestamptz default now()
);

-- جدول العملاء
create table if not exists customers (
  id uuid default gen_random_uuid() primary key,
  custom_id text unique,
  name text not null default 'بدون اسم',
  phone text unique not null,
  card_number text,
  created_at timestamptz default now()
);

-- جدول الموردين
create table if not exists suppliers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  phone text,
  address text,
  created_at timestamptz default now()
);

-- جدول فواتير المشتريات
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
  notes text,
  created_at timestamptz default now()
);

-- جدول عناصر فواتير المشتريات
create table if not exists purchase_items (
  id uuid default gen_random_uuid() primary key,
  invoice_id uuid references purchase_invoices(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  quantity integer not null default 1,
  purchase_price numeric not null default 0
);

-- جدول الفواتير
create table if not exists orders (
  id text primary key,
  total numeric not null default 0,
  paid_amount numeric default 0,
  paid_cash numeric default 0,
  paid_visa numeric default 0,
  paid_wallet numeric default 0,
  paid_instapay numeric default 0,
  payment_method text default 'cash',
  type text default 'sale',
  customer_id uuid references customers(id) on delete set null,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deletion_reason text,
  notes text,
  created_at timestamptz default now()
);

-- Counter للفواتير
create table if not exists invoice_counter (
  id int primary key default 1,
  current_value integer default 1,
  check (id = 1)  -- صف واحد فقط
);
insert into invoice_counter (id, current_value) values (1, 1)
on conflict (id) do nothing;

-- جدول بنود الفاتورة
create table if not exists order_items (
  id uuid default gen_random_uuid() primary key,
  order_id text references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  barcode text,
  quantity integer default 1,
  returned_quantity integer default 0,
  refunded_amount numeric default 0,
  sale_price numeric default 0,
  purchase_price numeric default 0
);

-- جدول المصروفات
create table if not exists expenses (
  id uuid default gen_random_uuid() primary key,
  category text not null,
  amount numeric not null default 0,
  note text,
  created_at timestamptz default now()
);

-- جدول السلف والجمعيات
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

-- ============================================================
-- تفعيل RLS (Row Level Security)
-- ============================================================
alter table store_settings enable row level security;
alter table products enable row level security;
alter table categories enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table invoice_counter enable row level security;
alter table expenses enable row level security;
alter table financing_accounts enable row level security;
alter table financing_payments enable row level security;
alter table financing_transactions enable row level security;
alter table suppliers enable row level security;
alter table purchase_invoices enable row level security;
alter table purchase_items enable row level security;

-- سياسة مفتوحة مؤقتاً (عدّلها لاحقاً عند إضافة Auth)
create policy "allow all" on store_settings for all using (true) with check (true);
create policy "allow all" on products for all using (true) with check (true);
create policy "allow all" on categories for all using (true) with check (true);
create policy "allow all" on customers for all using (true) with check (true);
create policy "allow all" on orders for all using (true) with check (true);
create policy "allow all" on order_items for all using (true) with check (true);
create policy "allow all" on invoice_counter for all using (true) with check (true);
create policy "allow all" on expenses for all using (true) with check (true);
create policy "allow all" on financing_accounts for all using (true) with check (true);
create policy "allow all" on financing_payments for all using (true) with check (true);
create policy "allow all" on financing_transactions for all using (true) with check (true);
create policy "allow all" on suppliers for all using (true) with check (true);
create policy "allow all" on purchase_invoices for all using (true) with check (true);
create policy "allow all" on purchase_items for all using (true) with check (true);

-- Create product_suggestions table
CREATE TABLE public.product_suggestions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  is_purchased BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_suggestions ENABLE ROW LEVEL SECURITY;

-- Create policy for product_suggestions
CREATE POLICY "Allow all operations on product_suggestions" ON public.product_suggestions FOR ALL USING (true) WITH CHECK (true);

-- Create cashier_notes table
CREATE TABLE public.cashier_notes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  cashier_name TEXT NOT NULL,
  note TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cashier_notes ENABLE ROW LEVEL SECURITY;

-- Create policy for cashier_notes
CREATE POLICY "Allow all operations on cashier_notes" ON public.cashier_notes FOR ALL USING (true) WITH CHECK (true);
