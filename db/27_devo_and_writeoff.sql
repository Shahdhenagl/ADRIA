-- ADRIA — الديڤو (قطع راجعة للمصنع/المورد) + الإهلاك (التوالف). شغّله مرة واحدة.
--
-- الديڤو: قطعة معيبة تُسجَّل وتُتابَع حالتها حتى لا تسقط:
--   pending    = مسجّلة (خرجت من المحل / متحجوزة كديڤو)
--   at_factory = اتسلمت المصنع
--   returned   = رجعت من المصنع (نفس القطعة سليمة) → ترجع للمخزون
--   replaced   = تم استبدالها ببديل → يرجع للمخزون
--   closed     = رجعت خالص / تسوية نهائية (رصيد أو استرداد) → تظل خارج المخزون
--
-- الإهلاك: قطعة تالفة تُشطب نهائياً وتُخصم من المخزون (خسارة).

create table if not exists devo_items (
  id uuid default gen_random_uuid() primary key,
  product_id    uuid,
  product_name  text not null,
  barcode       text,
  quantity      numeric default 1,
  unit_cost     numeric default 0,
  supplier_id   uuid,
  supplier_name text,
  reason        text,
  status        text default 'pending',   -- pending | at_factory | returned | replaced | closed
  note          text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table devo_items enable row level security;
drop policy if exists "authenticated full access" on devo_items;
create policy "authenticated full access" on devo_items for all to authenticated using (true) with check (true);
revoke all on devo_items from anon;
grant all on devo_items to authenticated;

create table if not exists write_offs (
  id uuid default gen_random_uuid() primary key,
  product_id   uuid,
  product_name text not null,
  barcode      text,
  quantity     numeric default 1,
  unit_cost    numeric default 0,
  total_cost   numeric default 0,
  reason       text,
  created_at   timestamptz default now()
);
alter table write_offs enable row level security;
drop policy if exists "authenticated full access" on write_offs;
create policy "authenticated full access" on write_offs for all to authenticated using (true) with check (true);
revoke all on write_offs from anon;
grant all on write_offs to authenticated;
