-- ADRIA: promotions, scoped discounts, and immutable invoice discount snapshots
-- Safe to run more than once.

alter table public.coupons
  add column if not exists scope text not null default 'all',
  add column if not exists product_ids jsonb not null default '[]'::jsonb,
  add column if not exists category_id uuid references public.categories(id) on delete set null,
  add column if not exists display_name text,
  add column if not exists print_label text,
  add column if not exists print_barcode text,
  add column if not exists show_item_code boolean not null default false;

alter table public.coupons
  drop constraint if exists coupons_scope_check;
alter table public.coupons
  add constraint coupons_scope_check check (scope in ('all', 'products', 'category'));

alter table public.orders
  add column if not exists promotion_id uuid references public.coupons(id) on delete set null,
  add column if not exists subtotal_before_discount numeric not null default 0,
  add column if not exists discount_type text,
  add column if not exists discount_value numeric not null default 0;

alter table public.order_items
  add column if not exists discount_type text,
  add column if not exists discount_value numeric not null default 0,
  add column if not exists original_sale_price numeric;

create index if not exists idx_coupons_active_dates on public.coupons(is_active, start_date, end_date);
create index if not exists idx_orders_promotion_id on public.orders(promotion_id);

comment on column public.orders.discount_amount is 'Immutable total discount snapshot at checkout';
comment on column public.orders.subtotal_before_discount is 'Subtotal before manual and promotion discounts';
comment on column public.coupons.product_ids is 'JSON array of product UUIDs when scope=products';
comment on column public.coupons.print_barcode is 'Optional barcode value for printable promotion card';
