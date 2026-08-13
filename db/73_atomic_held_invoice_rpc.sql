-- ADRIA — atomic held invoice creation with idempotency.
-- Apply this migration before deploying the client changes.
-- The function is intentionally SECURITY INVOKER so existing authenticated RLS
-- policies remain the authority for production writes.

alter table public.held_invoices
  add column if not exists idempotency_key text;

create unique index if not exists uq_held_invoices_idempotency_key
  on public.held_invoices(idempotency_key)
  where idempotency_key is not null;

create or replace function public.create_held_invoice_atomic(
  p_idempotency_key text,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_custom_id text default null,
  p_items jsonb default '[]'::jsonb,
  p_total numeric default 0,
  p_invoice_type text default 'retail',
  p_salesperson_id uuid default null,
  p_salesperson_name text default null,
  p_cashier_name text default null,
  p_notes text default null,
  p_deposit numeric default 0,
  p_deposit_split jsonb default '{}'::jsonb,
  p_kind text default 'shop',
  p_customer_address text default null,
  p_shipping_note text default null,
  p_discount_amount numeric default 0
)
returns public.held_invoices
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing public.held_invoices%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_new_stock numeric;
  v_new_display numeric;
  v_deposit numeric := greatest(0, coalesce(p_deposit, 0));
  v_split jsonb := coalesce(p_deposit_split, '{}'::jsonb);
  v_paid_cash numeric := coalesce((v_split->>'cash')::numeric, 0);
  v_paid_visa numeric := coalesce((v_split->>'visa')::numeric, 0);
  v_paid_wallet numeric := coalesce((v_split->>'wallet')::numeric, 0);
  v_paid_instapay numeric := coalesce((v_split->>'instapay')::numeric, 0);
  v_paid_method5 numeric := coalesce((v_split->>'method5')::numeric, 0);
  v_paid_method6 numeric := coalesce((v_split->>'method6')::numeric, 0);
  v_row public.held_invoices%rowtype;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception 'idempotency_key is required';
  end if;

  -- A retry after a client/network timeout returns the original row and does
  -- not touch stock or the treasury a second time.
  select * into v_existing
  from public.held_invoices
  where idempotency_key = trim(p_idempotency_key)
  for update;
  if found then
    return v_existing;
  end if;

  if coalesce(jsonb_typeof(p_items), '') <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty JSON array';
  end if;
  if coalesce(p_total, 0) < 0 or v_deposit > coalesce(p_total, 0) + 0.01 then
    raise exception 'invalid total or deposit';
  end if;

  -- Lock every product row before checking and decrementing it. If any item
  -- fails, the whole transaction rolls back: no partial reservation exists.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(0, coalesce((v_item->>'quantity')::numeric, 0));
    if v_qty <= 0 then
      raise exception 'item quantity must be positive';
    end if;
    select * into v_product
    from public.products
    where id = (v_item->>'id')::uuid
    for update;
    if not found then
      raise exception 'product % not found', v_item->>'id';
    end if;
    if coalesce(v_product.stock_quantity, 0) < v_qty then
      raise exception 'insufficient stock for product %', v_item->>'id';
    end if;
  end loop;

  insert into public.held_invoices (
    idempotency_key, customer_name, customer_phone, customer_custom_id,
    items, total, invoice_type, salesperson_id, salesperson_name,
    cashier_name, notes, deposit, deposit_split, deposit_date,
    discount_amount, updated_at, kind, status, customer_address, shipping_note
  ) values (
    trim(p_idempotency_key), nullif(trim(p_customer_name), ''),
    nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_custom_id), ''),
    p_items, coalesce(p_total, 0), coalesce(p_invoice_type, 'retail'),
    p_salesperson_id, p_salesperson_name, p_cashier_name, p_notes,
    v_deposit, case when v_deposit > 0 then v_split else null end,
    case when v_deposit > 0 then now() else null end,
    greatest(0, coalesce(p_discount_amount, 0)), now(), coalesce(p_kind, 'shop'),
    'held', p_customer_address, p_shipping_note
  ) returning * into v_row;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(0, coalesce((v_item->>'quantity')::numeric, 0));
    select stock_quantity, display_quantity into v_new_stock, v_new_display
    from public.products
    where id = (v_item->>'id')::uuid
    for update;
    v_new_stock := greatest(0, coalesce(v_new_stock, 0) - v_qty);
    v_new_display := greatest(0, least(v_new_stock, coalesce(v_new_display, 0) - v_qty));
    update public.products
    set stock_quantity = v_new_stock,
        display_quantity = v_new_display
    where id = (v_item->>'id')::uuid;
  end loop;

  if v_deposit > 0 then
    insert into public.expenses (
      category, amount, paid_cash, paid_visa, paid_wallet, paid_instapay,
      paid_method5, paid_method6, note, created_at
    ) values (
      'حجز', -v_deposit, v_paid_cash, v_paid_visa, v_paid_wallet,
      v_paid_instapay, v_paid_method5, v_paid_method6,
      'عربون حجز - ' || coalesce(nullif(trim(p_customer_name), ''), 'عميل')
        || ' [idempotency:' || trim(p_idempotency_key) || ']', now()
    );
  end if;

  return v_row;
exception
  when unique_violation then
    select * into v_existing
    from public.held_invoices
    where idempotency_key = trim(p_idempotency_key);
    if found then return v_existing; end if;
    raise;
end;
$$;

grant execute on function public.create_held_invoice_atomic(
  text, text, text, text, jsonb, numeric, text, uuid, text, text, text,
  numeric, jsonb, text, text, text, numeric
) to authenticated;
