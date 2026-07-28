-- ADRIA — سجل «مخزون دخل بدون شراء». شغّله مرة واحدة (آمن للتشغيل أكثر من مرة).
--
-- المشكلة: أي كمية بتدخل المخزون من غير فاتورة شراء — إضافة منتج بكمية ابتدائية،
-- تعديل الكمية يدوياً، استيراد Excel، زيادة في الجرد — مالهاش أي أثر مالي في النظام:
-- مفيش فاتورة مورد، ولا مصروف، ولا حركة خزنة. ومع ذلك قيمتها بتظهر في «إجمالي قيمة
-- المخزون» وبتتخصم كتكلفة (COGS) وقت البيع من average_purchase_price — فالربح بيطلع
-- من غير رأس مال مقيّد في مقابله.
--
-- الحل: الجدول ده بيقيّد قيمة البضاعة دي (الكمية × تكلفة الوحدة وقت الدخول) عشان
-- تتحسب كـ«رأس مال بضاعة بادئين بيه». هو سجل رأس مال عيني — مش بيمسّ الخزنة ولا
-- الموردين، بالظبط زي ما «رصيد افتتاحي» للمورد مش بيمسّ الخزنة.
create table if not exists stock_intakes (
  id uuid default gen_random_uuid() primary key,
  product_id uuid,
  product_name text,
  quantity numeric not null default 0,    -- الكمية الداخلة (موجبة دائماً)
  unit_cost numeric not null default 0,   -- تكلفة الوحدة وقت الدخول
  total_value numeric not null default 0, -- quantity × unit_cost
  source text,                            -- product_created | manual_edit | excel_import | stocktake | opening
  note text,
  created_at timestamptz default now()
);

create index if not exists stock_intakes_product_id_idx on stock_intakes (product_id);
create index if not exists stock_intakes_created_at_idx on stock_intakes (created_at);

alter table stock_intakes enable row level security;
drop policy if exists "authenticated full access" on stock_intakes;
create policy "authenticated full access" on stock_intakes for all to authenticated using (true) with check (true);
revoke all on stock_intakes from anon;
grant all on stock_intakes to authenticated;

-- ترحيل الوضع الحالي مرة واحدة فقط (لو الجدول فاضي): لكل منتج، الجزء من المخزون
-- الحالي اللي مجاش من فاتورة شراء = المخزون الحالي − إجمالي الكميات المشتراة.
-- تقدير متحفّظ (لو اتباع جزء من البضاعة الافتتاحية بيطلع أقل من الحقيقي)، وتقدر
-- تعدّله من صفحة المخزون → «مخزون بدون شراء» (حذف قيد / إضافة قيد يدوي).
do $$
begin
  if not exists (select 1 from stock_intakes) then
    insert into stock_intakes (product_id, product_name, quantity, unit_cost, total_value, source, note)
    select
      p.id,
      p.name,
      greatest(coalesce(p.stock_quantity, 0) - coalesce(pi.qty, 0), 0) as qty,
      coalesce(nullif(p.average_purchase_price, 0), p.purchase_price, 0) as unit_cost,
      greatest(coalesce(p.stock_quantity, 0) - coalesce(pi.qty, 0), 0)
        * coalesce(nullif(p.average_purchase_price, 0), p.purchase_price, 0) as total_value,
      'opening',
      'رصيد افتتاحي — ترحيل تلقائي عند تفعيل السجل'
    from products p
    left join (
      select product_id, sum(quantity) as qty from purchase_items group by product_id
    ) pi on pi.product_id = p.id
    where greatest(coalesce(p.stock_quantity, 0) - coalesce(pi.qty, 0), 0) > 0;
  end if;
end $$;
