-- =============================================================================
-- SECURE RLS MIGRATION  (fixes S1: "allow all" RLS, and S4: public invoice leak)
-- =============================================================================
--
--  WHAT THIS DOES
--  --------------
--  1. Replaces every table's permissive `allow all` policy (which granted the
--     public `anon` role full read/write/delete) with policies that ONLY allow
--     the `authenticated` role. After this, the public anon key alone can no
--     longer read or modify ANY business data.
--  2. Adds a SECURITY DEFINER function `get_public_invoice(text)` so the public
--     invoice page (/view-invoice/:id) keeps working WITHOUT giving anon access
--     to the underlying tables. anon may only execute this one function, which
--     returns a single invoice (sale / maintenance / purchase) scoped by id.
--
--  ⚠️  RUN ORDER (see SECURITY_SETUP.md) — DO NOT run this first.
--      Run it ONLY AFTER:
--        (a) you have provisioned the admin + cashier Supabase Auth users
--            (scripts/provision_auth_users.cjs), and
--        (b) the new front-end build (which signs in via Supabase Auth and
--            reads the public page through get_public_invoice) is deployed and
--            you've confirmed admin + a cashier can log in.
--      Running this before the app can authenticate will lock the POS out of
--      its own database.
--
--  This script is idempotent — safe to run more than once.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Authenticated-only policies for every business table; remove anon access.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'store_settings','categories','products','customers','suppliers',
    'car_subscriptions','maintenance_appointments','purchase_invoices','purchase_items',
    'orders','invoice_counter','order_items','expenses',
    'financing_accounts','financing_payments','financing_transactions',
    'cashiers','employees','employee_transactions','employee_leaves',
    'product_suggestions','cashier_notes','coupons','deleted_invoices',
    'materials','production_orders','production_materials','managers',
    'partners','partner_transactions','savings_transactions','stock_adjustments','admin_users'
  ];
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      continue;  -- table not present in this database
    end if;

    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "allow all" on public.%I;', t);
    execute format('drop policy if exists "authenticated full access" on public.%I;', t);
    execute format(
      'create policy "authenticated full access" on public.%I for all to authenticated using (true) with check (true);',
      t
    );
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant all on public.%I to authenticated;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Public invoice access via a single SECURITY DEFINER function.
--    Covers the three things the public receipt page can show:
--    a sale order, a maintenance appointment, or a purchase invoice.
--    Returns only the data the receipt renders, scoped to one id.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_invoice(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_order jsonb;
  v_customer_id uuid;
  v_customer_orders jsonb := '[]'::jsonb;
  v_appointment jsonb;
  v_subscription_id uuid;
  v_appointment_orders jsonb := '[]'::jsonb;
  v_purchase jsonb;
begin
  -- Store settings (safe, non-sensitive fields used by the template).
  select jsonb_build_object(
           'name', s.name, 'currency', s.currency, 'logo', s.logo,
           'tax_rate', s.tax_rate, 'theme_color', s.theme_color,
           'address', s.address, 'phone', s.phone, 'phone2', s.phone2,
           'whatsapp_country_code', s.whatsapp_country_code,
           'initial_balance', s.initial_balance, 'location_url', s.location_url
         )
    into v_settings
  from store_settings s
  limit 1;

  -- (a) Sale order ---------------------------------------------------------
  select to_jsonb(o) || jsonb_build_object(
           'customers', (select to_jsonb(c) from customers c where c.id = o.customer_id),
           'order_items', (
             select coalesce(jsonb_agg(to_jsonb(oi) || jsonb_build_object(
                      'products', (select jsonb_build_object('name', p.name, 'sale_price', p.sale_price, 'discount_price', p.discount_price) from products p where p.id = oi.product_id)
                    )), '[]'::jsonb)
             from order_items oi where oi.order_id = o.id
           )
         ), o.customer_id
    into v_order, v_customer_id
  from orders o where o.id::text = p_id;

  if v_order is not null then
    if v_customer_id is not null then
      select coalesce(jsonb_agg(
               to_jsonb(o2) || jsonb_build_object(
                 'order_items', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'quantity', oi.quantity, 'sale_price', oi.sale_price,
                            'returned_quantity', oi.returned_quantity, 'refunded_amount', oi.refunded_amount
                          )), '[]'::jsonb)
                   from order_items oi where oi.order_id = o2.id
                 )
               )
             ), '[]'::jsonb)
        into v_customer_orders
      from orders o2
      where o2.customer_id = v_customer_id and o2.is_deleted = false;
    end if;

    return jsonb_build_object('kind', 'order', 'settings', v_settings,
                             'order', v_order, 'customer_orders', v_customer_orders);
  end if;

  -- (b) Maintenance appointment -------------------------------------------
  if to_regclass('public.maintenance_appointments') is not null then
    select to_jsonb(a) || jsonb_build_object(
             'car_subscriptions', (select to_jsonb(cs) from car_subscriptions cs where cs.id = a.subscription_id)
           ), a.subscription_id
      into v_appointment, v_subscription_id
    from maintenance_appointments a where a.id::text = p_id;

    if v_appointment is not null then
      select coalesce(jsonb_agg(
               to_jsonb(o) || jsonb_build_object(
                 'order_items', (
                   select coalesce(jsonb_agg(to_jsonb(oi) || jsonb_build_object(
                            'products', (select jsonb_build_object('name', p.name, 'sale_price', p.sale_price, 'discount_price', p.discount_price) from products p where p.id = oi.product_id)
                          )), '[]'::jsonb)
                   from order_items oi where oi.order_id = o.id
                 )
               )
             ), '[]'::jsonb)
        into v_appointment_orders
      from orders o
      where o.car_id = v_subscription_id and o.is_deleted = false;

      return jsonb_build_object('kind', 'maintenance', 'settings', v_settings,
                               'appointment', v_appointment, 'appointment_orders', v_appointment_orders);
    end if;
  end if;

  -- (c) Purchase invoice (by id or invoice_number) ------------------------
  select to_jsonb(pi) || jsonb_build_object(
           'suppliers', (select to_jsonb(su) from suppliers su where su.id = pi.supplier_id),
           'purchase_items', (
             select coalesce(jsonb_agg(to_jsonb(it) || jsonb_build_object(
                      'products', (select jsonb_build_object('name', p.name, 'sale_price', p.sale_price, 'discount_price', p.discount_price) from products p where p.id = it.product_id)
                    )), '[]'::jsonb)
             from purchase_items it where it.invoice_id = pi.id
           )
         )
    into v_purchase
  from purchase_invoices pi
  where pi.id::text = p_id or pi.invoice_number::text = p_id
  limit 1;

  if v_purchase is not null then
    return jsonb_build_object('kind', 'purchase', 'settings', v_settings, 'purchase', v_purchase);
  end if;

  return null;
end;
$$;

-- anon (and authenticated) may execute ONLY this function — no table access.
revoke all on function public.get_public_invoice(text) from public;
grant execute on function public.get_public_invoice(text) to anon, authenticated;

commit;
