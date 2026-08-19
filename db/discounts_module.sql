-- ADRIA Discounts module
create table if not exists public.product_discounts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  discount_type text not null default 'fixed' check (discount_type in ('fixed','percentage')),
  original_price numeric not null check (original_price >= 0),
  discounted_price numeric not null check (discounted_price >= 0 and discounted_price < original_price),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  label_text text,
  barcode_format text not null default 'standard' check (barcode_format in ('standard','sale','clearance')),
  created_at timestamptz not null default now(),
  constraint product_discounts_dates check (ends_at is null or ends_at > starts_at)
);
create index if not exists product_discounts_product_idx on public.product_discounts(product_id);
create index if not exists product_discounts_active_dates_idx on public.product_discounts(is_active, starts_at, ends_at);
alter table public.product_discounts enable row level security;
drop policy if exists "product_discounts_authenticated_read" on public.product_discounts;
create policy "product_discounts_authenticated_read" on public.product_discounts for select to authenticated using (true);
drop policy if exists "product_discounts_authenticated_write" on public.product_discounts;
create policy "product_discounts_authenticated_write" on public.product_discounts for all to authenticated using (true) with check (true);

-- If the project uses anon access for the existing dashboard, mirror its current policy model here.
drop policy if exists "product_discounts_anon_read" on public.product_discounts;
create policy "product_discounts_anon_read" on public.product_discounts for select to anon using (true);
drop policy if exists "product_discounts_anon_write" on public.product_discounts;
create policy "product_discounts_anon_write" on public.product_discounts for all to anon using (true) with check (true);
