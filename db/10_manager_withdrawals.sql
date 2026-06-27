-- ADRIA — قائمة المدراء (سحوبات المدير تُسجّل كمصروف category='سحب مدير'). شغّله مرة واحدة.
create table if not exists managers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamptz default now()
);
alter table managers enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='managers' and policyname='allow all') then
    create policy "allow all" on managers for all using (true) with check (true);
  end if;
end $$;
