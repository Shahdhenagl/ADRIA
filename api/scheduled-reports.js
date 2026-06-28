import {
  authorizeCron,
  cairoDayRange,
  currentMonthRange,
  fetchReportData,
  fetchOpeningBalance,
  fetchStoreSettings,
  getSupabase,
  isLastCairoDayOfMonth,
  sendTelegramText,
} from './_report-utils.js';
import { buildDailyMessage } from './daily-report.js';
import { buildMonthlyMessage } from './monthly-finance-report.js';
import { buildInventoryMessage } from './monthly-inventory-report.js';

function cairoDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function money(value, currency) {
  return `${Number(value || 0).toFixed(2)} ${currency || 'ج.م'}`;
}

function buildFinancingReminder(kind, payment, settings) {
  const account = payment.financing_accounts || {};
  const remaining = Number(payment.remaining_amount ?? payment.amount ?? 0);
  const action = payment.payment_type === 'collection' ? 'تحصيل' : 'سداد';
  const title = kind === 'tomorrow'
    ? `تذكير ${action} مستحق غداً`
    : `تنبيه ${action} متأخر`;

  return [
    title,
    `النوع: ${account.type === 'association' ? 'جمعية' : 'سلفة'}`,
    `الاسم: ${account.lender_name || 'غير محدد'}`,
    account.lender_phone ? `الهاتف: ${account.lender_phone}` : null,
    `تاريخ الاستحقاق: ${payment.due_date}`,
    `قيمة الدفعة: ${money(payment.amount, settings.currency)}`,
    `المتبقي: ${money(remaining, settings.currency)}`,
    payment.note ? `ملاحظة: ${payment.note}` : null,
  ].filter(Boolean).join('\n');
}

async function sendFinancingReminders(supabase, settings, now) {
  const tomorrow = cairoDateString(addDays(now, 1));
  const yesterday = cairoDateString(addDays(now, -1));
  const { data, error } = await supabase
    .from('financing_payments')
    .select('*, financing_accounts(*)')
    .eq('status', 'pending')
    .in('due_date', [tomorrow, yesterday]);

  if (error || !data?.length) return [];

  const sent = [];
  for (const payment of data) {
    const remaining = Number(payment.remaining_amount ?? payment.amount ?? 0);
    if (remaining <= 0) continue;
    if (payment.due_date === tomorrow) {
      await sendTelegramText(buildFinancingReminder('tomorrow', payment, settings));
      sent.push(`financing_reminder_${payment.id}`);
    }
    if (payment.due_date === yesterday) {
      await sendTelegramText(buildFinancingReminder('overdue', payment, settings));
      sent.push(`financing_overdue_${payment.id}`);
    }
  }
  return sent;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!authorizeCron(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const settings = await fetchStoreSettings(supabase);
    // Optional ?date=YYYY-MM-DD to (re)send the report for a specific Cairo day
    // (used for manual testing / catching up a missed day). Defaults to "now".
    const dateParam = (req.query && (req.query.date || req.query.day)) || (req.body && req.body.date);
    // بدون date: نطرح ساعتين من وقت التشغيل حتى لو اشتغل الكرون متأخراً (نافذة الـ
    // ساعة المرنة في Hobby) يظل التقرير على اليوم الصحيح الذي انتهى، لا اليوم الجديد الفارغ.
    const today = dateParam ? new Date(`${dateParam}T12:00:00+03:00`) : new Date(Date.now() - 2 * 60 * 60 * 1000);
    const sent = [];

    const dayRange = cairoDayRange(today);
    const [dayData, openingBalance] = await Promise.all([
      fetchReportData(supabase, dayRange.start, dayRange.end),
      fetchOpeningBalance(supabase, dayRange.start),
    ]);
    await sendTelegramText(buildDailyMessage(settings, dayRange, dayData, openingBalance));
    sent.push('daily');

    sent.push(...await sendFinancingReminders(supabase, settings, today));

    if (isLastCairoDayOfMonth(today)) {
      const monthRange = currentMonthRange(today);
      const monthData = await fetchReportData(supabase, monthRange.start, monthRange.end);

      await sendTelegramText(buildMonthlyMessage(settings, monthRange, monthData));
      sent.push('monthly_finance');

      await sendTelegramText(buildInventoryMessage(settings, monthRange, monthData));
      sent.push('monthly_inventory');
    }

    return res.status(200).json({ ok: true, sent });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
