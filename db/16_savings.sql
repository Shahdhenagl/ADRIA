-- ADRIA — خزنة الادخار (منفصلة عن خزنة المحل). شغّله مرة واحدة.
create table if not exists savings_transactions (
  id uuid default gen_random_uuid() primary key,
  direction text not null,   -- 'in' (تحويل من المحل للادخار) | 'out' (تحويل من الادخار للمحل)
  amount numeric not null,
  method text default 'cash',-- cash / visa / wallet / instapay  (كل طريقة تنتقل بطريقتها)
  source text,               -- 'shop_transfer' | 'day_closing' | 'to_shop' | 'manual'
  note text,
  created_at timestamptz default now()
);
alter table savings_transactions enable row level security;
drop policy if exists "authenticated full access" on savings_transactions;
create policy "authenticated full access" on savings_transactions for all to authenticated using (true) with check (true);
revoke all on savings_transactions from anon;
grant all on savings_transactions to authenticated;
