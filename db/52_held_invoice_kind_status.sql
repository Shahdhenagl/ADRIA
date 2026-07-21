-- =============================================================================
-- ADRIA — نوع وحالة الفاتورة المعلقة (حجز محل / أونلاين)
-- شغّله مرة واحدة (آمن للتشغيل أكثر من مرة).
-- =============================================================================
--  kind:
--    'shop'   = حجز محل — العميل هييجي ياخده. مالوش حالات: يتباع أو يترجّع.
--    'online' = طلب أونلاين — بيمرّ بدورة: معلق → تم الشحن → تم التسليم/ملغي.
--
--  status:
--    'held'      = معلق (الافتراضي لكل حجز جديد)
--    'shipped'   = اتشحن (أونلاين بس)
--    'delivered' = اتسلّم واتحصّل → اتحوّل لفاتورة بيع (order_id فيه رقمها)
--    'cancelled' = اتلغى → البضاعة رجعت للمخزون والعربون اترد
--
--  الصفوف المنتهية (delivered/cancelled) **بتفضل موجودة** كسجل تاريخي عشان
--  موديول الداشبورد يعرض الحالات. شاشة الكاشير بتفلتر على (held, shipped) بس،
--  فمش هتشوف المنتهية — ومفيش أثر على المخزون لأن الحركة بتتعمل وقت تغيير
--  الحالة مش وقت العرض.
-- =============================================================================

alter table public.held_invoices
  add column if not exists kind     text not null default 'shop',
  add column if not exists status   text not null default 'held',
  add column if not exists order_id text,
  add column if not exists status_at timestamptz,
  add column if not exists status_note text;

-- قيود القيم (نضيفها بأمان لو مش موجودة)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'held_invoices_kind_chk') then
    alter table public.held_invoices
      add constraint held_invoices_kind_chk check (kind in ('shop', 'online'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'held_invoices_status_chk') then
    alter table public.held_invoices
      add constraint held_invoices_status_chk
      check (status in ('held', 'shipped', 'delivered', 'cancelled'));
  end if;
end $$;

create index if not exists idx_held_invoices_status on public.held_invoices(status);
create index if not exists idx_held_invoices_kind   on public.held_invoices(kind);

-- الصفوف القديمة: كلها حجز محل معلّق (وده الافتراضي أصلاً، السطر للتأكيد).
update public.held_invoices set kind = 'shop'  where kind   is null;
update public.held_invoices set status = 'held' where status is null;
