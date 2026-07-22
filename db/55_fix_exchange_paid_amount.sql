-- =============================================================================
-- ADRIA — إصلاح «المدفوع» للفواتير اللي اتعملها استبدال قبل التصليح.
-- =============================================================================
-- المشكلة:
--   كود الاستبدال القديم كان بيكتب paid_amount = الإجمالي الجديد على طول، بدل
--   (المدفوع قبل الاستبدال + الفرق اللي اتحصّل). النتيجة: أي فاتورة **آجل**
--   اتعملها استبدال كانت بتبان «مسدّدة بالكامل» ومديونية العميل تختفي.
--   (الفواتير المدفوعة بالكامل مش متأثرة — الرقمين بيطلعوا واحد.)
--
--   الخزنة والمخزون **مش متأثرين**: فرق الاستبدال بيتسجّل صف مالي مستقل بتاريخه،
--   والمخزون بيتعدّل وقت الاستبدال (الراجع + والجديد -). المشكلة في عمود
--   paid_amount بس، اللي كل شاشات المديونية بتقرا منه.
--
-- الحساب الصح لكل فاتورة مستبدلة:
--   المدفوع = تقسيمة يوم البيع (paid_cash..paid_method6)
--           + مجموع فروق الاستبدال (موجب = اتحصّل، سالب = اترد)
--           + أي سداد آجل اتسجّل على الفاتورة (فواتير type='payment')
--   ومحصور بين صفر والإجمالي.
-- =============================================================================

-- ── (1) تشخيص: اعرض الفواتير اللي هتتغيّر قبل ما تعدّل حاجة ──────────────────
with x as (
  select
    o.id,
    o.total,
    o.paid_amount as paid_now,
    coalesce(o.paid_cash,0) + coalesce(o.paid_visa,0) + coalesce(o.paid_wallet,0)
      + coalesce(o.paid_instapay,0) + coalesce(o.paid_method5,0) + coalesce(o.paid_method6,0) as split_paid,
    coalesce((o.exchange_data->>'diff')::numeric, 0)
      + coalesce((select sum((h->>'diff')::numeric)
                  from jsonb_array_elements(coalesce(o.exchange_data->'history', '[]'::jsonb)) h), 0) as exchange_diff,
    coalesce((select sum(p.paid_amount) from orders p
              where p.type = 'payment'
                and coalesce(p.is_deleted, false) = false
                and p.notes like 'سداد أجل للفاتورة رقم #' || o.id || ' %'), 0) as debt_paid
  from orders o
  where o.exchange_data is not null
    and coalesce(o.is_deleted, false) = false
)
select
  id, total, paid_now,
  split_paid, exchange_diff, debt_paid,
  least(total, greatest(0, split_paid + exchange_diff + debt_paid)) as paid_fixed,
  least(total, greatest(0, split_paid + exchange_diff + debt_paid)) - paid_now as difference,
  greatest(0, total - least(total, greatest(0, split_paid + exchange_diff + debt_paid))) as debt_after_fix
from x
order by abs(least(total, greatest(0, split_paid + exchange_diff + debt_paid)) - paid_now) desc;

-- ── (2) الإصلاح: شغّله بعد ما تراجعي نتيجة التشخيص فوق ───────────────────────
-- (آمن للتكرار: تشغيله تاني مش هيغيّر حاجة لأن القيم بتبقى مظبوطة خلاص.)
--
-- update orders o
-- set paid_amount = least(o.total, greatest(0,
--       coalesce(o.paid_cash,0) + coalesce(o.paid_visa,0) + coalesce(o.paid_wallet,0)
--         + coalesce(o.paid_instapay,0) + coalesce(o.paid_method5,0) + coalesce(o.paid_method6,0)
--       + coalesce((o.exchange_data->>'diff')::numeric, 0)
--       + coalesce((select sum((h->>'diff')::numeric)
--                   from jsonb_array_elements(coalesce(o.exchange_data->'history','[]'::jsonb)) h), 0)
--       + coalesce((select sum(p.paid_amount) from orders p
--                   where p.type = 'payment'
--                     and coalesce(p.is_deleted, false) = false
--                     and p.notes like 'سداد أجل للفاتورة رقم #' || o.id || ' %'), 0)
--     ))
-- where o.exchange_data is not null
--   and coalesce(o.is_deleted, false) = false;
