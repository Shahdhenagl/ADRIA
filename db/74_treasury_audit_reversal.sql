-- ADRIA — حفظ سجل الخزنة والتنبيه والإلغاء بدل الحذف النهائي.
create table if not exists treasury_audit_events (
  id uuid default gen_random_uuid() primary key,
  event_kind text not null, -- notification | void | reversal | missing_report
  operation_id uuid,
  original_transaction_id uuid,
  reversal_transaction_id uuid,
  group_id uuid,
  direction text,
  amount numeric not null default 0,
  method text,
  source text,
  note text,
  occurred_at timestamptz,
  event_at timestamptz default now(),
  status text not null default 'posted', -- posted | voided | reversed | missing
  reason text,
  metadata jsonb default '{}'::jsonb
);

alter table treasury_audit_events enable row level security;
drop policy if exists "authenticated full access" on treasury_audit_events;
create policy "authenticated full access" on treasury_audit_events for all to authenticated using (true) with check (true);
revoke all on treasury_audit_events from anon;
grant all on treasury_audit_events to authenticated;

create index if not exists treasury_audit_events_occurred_at_idx on treasury_audit_events (occurred_at desc);
create index if not exists treasury_audit_events_kind_status_idx on treasury_audit_events (event_kind, status);
create index if not exists treasury_audit_events_group_id_idx on treasury_audit_events (group_id);
