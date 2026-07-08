-- ADRIA — عربون/تحصيل للفواتير المعلّقة (حجز تحت الحساب). شغّله مرة واحدة.
--
-- الفاتورة المعلّقة تقدر تحصّل عربون يدخل الخزنة وقت الحجز. لما العميل ييجي
-- بيتم إتمام الفاتورة ويكمّل الباقي أو يتحطّ آجل. لو اتلغى الحجز (يدوي أو بعد
-- أسبوع تلقائي) العربون يترد للعميل (مرتجع من الدرج) والكمية ترجع للمخزون.
--
-- حركة الفلوس بتتسجّل في جدول expenses:
--   category='حجز'        amount<0  → تحصيل عربون (داخل الخزنة)
--   category='حجز'        amount>0  → رد عربون عند الإلغاء/الانتهاء (خارج)
--   category='تحويل حجز'  amount>0  → تحويل العربون لفاتورة عند الإتمام (يمنع الازدواج)

alter table held_invoices add column if not exists deposit numeric not null default 0;
alter table held_invoices add column if not exists deposit_split jsonb;
