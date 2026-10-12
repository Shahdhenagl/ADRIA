-- Record actual insertion time separately from the business/accounting timestamp.
-- Existing rows intentionally remain NULL: their original insertion order cannot
-- be reconstructed reliably from created_at when multiple rows share a timestamp.
alter table public.employee_transactions
  add column if not exists recorded_at timestamptz;

alter table public.employee_transactions
  alter column recorded_at set default clock_timestamp();

comment on column public.employee_transactions.recorded_at is
  'Actual database insertion timestamp; created_at remains the business/accounting timestamp.';
