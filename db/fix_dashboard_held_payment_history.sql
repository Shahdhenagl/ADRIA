-- ADRIA: expose held-invoice deposit history to dashboard reports
-- Safe to run repeatedly. This changes metadata only; it does not alter orders, expenses, or stock.

begin;

alter table public.held_invoices
  add column if not exists deposit_date timestamptz;

alter table public.orders
  add column if not exists held_invoice_id uuid,
  add column if not exists held_deposit_amount numeric not null default 0,
  add column if not exists held_deposit_split jsonb,
  add column if not exists held_deposit_date timestamptz;

create unique index if not exists orders_held_invoice_id_uniq
  on public.orders (held_invoice_id)
  where held_invoice_id is not null;

-- A held deposit is either absent or fully described by its original date.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_held_deposit_consistency_chk'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_held_deposit_consistency_chk
      check (
        held_deposit_amount >= 0
        and (
          held_deposit_amount = 0
          or held_deposit_date is not null
        )
        and held_deposit_amount <= coalesce(paid_amount, 0) + 0.01
      );
  end if;
end $$;

-- Preserve the original booking date for the recovered invoice, without
-- embedding customer identifiers in the migration.
update public.held_invoices h
set deposit_date = '2026-08-10 12:00:00+00'
where h.order_id = '589'
  and h.total = 1340
  and h.deposit = 400
  and h.deposit_date is null;
update public.orders o
set held_invoice_id = (
      select h.id
      from public.held_invoices h
      where h.order_id = '589'
        and h.total = 1340
        and h.deposit = 400
      order by h.created_at desc
      limit 1
    ),
    held_deposit_amount = 400,
    held_deposit_split = '{"cash":400,"visa":0,"wallet":0,"instapay":0,"method5":0,"method6":0}'::jsonb,
    held_deposit_date = '2026-08-10 12:00:00+00'
where o.id = '589'
  and o.total = 1340
  and o.paid_amount = 1340
  and exists (
    select 1 from public.held_invoices h
    where h.order_id = '589' and h.total = 1340 and h.deposit = 400
  )
  and not exists (
    select 1
    from public.orders prior
    where prior.id = '589'
      and prior.held_deposit_amount > 0
      and prior.held_invoice_id is not null
  );

-- Optional historical repair for the independent online invoice 543.
-- It makes the dashboard show the 900 InstaPay deposit on 2026-08-04
-- and zero new collection on delivery day, without changing its accounting rows.
update public.orders o
set held_deposit_amount = 900,
    held_deposit_split = '{"cash":0,"visa":0,"wallet":0,"instapay":900,"method5":0,"method6":0}'::jsonb,
    held_deposit_date = '2026-08-04 12:00:00+00'
where o.id = '543'
  and o.total = 900
  and o.paid_amount = 900
  and o.paid_instapay = 900
  and not exists (
    select 1
    from public.orders prior
    where prior.id = '543'
      and prior.held_deposit_amount > 0
  );

commit;

-- Verification
select id, held_invoice_id, held_deposit_amount,
       held_deposit_split, held_deposit_date
from public.orders
where id in ('543', '589')
order by id;

select id, deposit, deposit_date, status, order_id
from public.held_invoices
where order_id = '589' and total = 1340 and deposit = 400;

select current_value
from public.invoice_counter
where id = 1;

-- Expected metadata:
-- 543: 900 InstaPay deposit date 2026-08-04.
-- 589: 400 cash deposit date 2026-08-10.
-- No financial amount, expense, invoice number, or stock quantity is changed.
