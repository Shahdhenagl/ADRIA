import {
  authorizeCron,
  buildFinancialStats,
  cairoDayRange,
  fetchReportData,
  fetchStoreSettings,
  getSupabase,
  money,
  productSalesStats,
  sendTelegramText,
  fetchOpeningBalance,
  verifyStaffToken,
} from './_report-utils.js';

export function buildDailyMessage(settings, range, data, openingBalance) {
  const stats = buildFinancialStats(data);
  const currency = settings.currency;
  
  const totalCashIn = stats.totalRevenue;
  const totalCashOut = stats.totalExpense;
  const netCash = totalCashIn - totalCashOut;
  const closingBalance = openingBalance + netCash;

  const topProducts = productSalesStats(stats.salesOrders)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const lines = [
    `تقرير نهاية اليوم - ${settings.name}`,
    `الفترة: ${range.label}`,
    '',
    'حركة الخزينة:',
    `الرصيد الافتتاحي: ${money(openingBalance, currency)}`,
    `إجمالي الداخل: ${money(totalCashIn, currency)}`,
    `إجمالي الخارج: ${money(totalCashOut, currency)}`,
    `رصيد الإغلاق: ${money(closingBalance, currency)}`,
    '',
    'تفاصيل الإيرادات:',
    `- مبيعات مدفوعة: ${money(stats.salesRevenue, currency)}`,
    `- تحصيلات عملاء: ${money(stats.customerPayments, currency)}`,
    `- المحصّل من الحجوزات (صافي): ${money(stats.reservationNet, currency)}`,
    `- إيرادات أخرى: ${money(stats.manualRevenue, currency)}`,
    '',
    'تفاصيل المصروفات والمدفوعات:',
    `- مصروفات مباشرة: ${money(stats.manualExpenses, currency)}`,
    `- مشتريات وسداد موردين: ${money(stats.purchasePayments, currency)}`,
    `- رواتب/سلف موظفين: ${money(stats.payroll, currency)}`,
    `- مرتجعات عملاء: ${money(stats.customerRefunds, currency)}`,
    '',
    `صافي حركة اليوم: ${money(netCash, currency)}`,
    `إجمالي الربح من الفواتير: ${money(stats.invoiceProfit, currency)}`,
    '',
    'حركة الفواتير:',
    `فواتير بيع: ${stats.salesOrders.length}`,
    `تحصيلات عملاء: ${stats.paymentOrders.length}`,
    `فواتير محذوفة: ${stats.deletedOrders.length}`,
    `فواتير شراء/سداد مورد: ${data.purchases.length}`,
    `مصروفات مسجلة: ${data.expenses.filter((expense) => Number(expense.amount || 0) > 0).length}`,
  ];

  // ── حركة الخزائن والعهد (تظهر فقط لو فيها حركات) ──
  const sum = (arr) => arr.reduce((s, x) => s + Math.abs(Number(x.amount) || 0), 0);
  const managerWithdrawals = sum(data.expenses.filter((e) => e.category === 'سحب مدير'));
  const savings = data.savings || [];
  const savingsIn = sum(savings.filter((t) => t.direction === 'in'));
  const savingsOut = sum(savings.filter((t) => t.direction === 'out'));
  const partnerTxns = data.partnerTxns || [];
  const partnerDeposits = sum(partnerTxns.filter((t) => t.type === 'deposit'));
  const partnerWithdrawals = sum(partnerTxns.filter((t) => t.type === 'withdraw'));

  const treasuryLines = [];
  if (managerWithdrawals > 0) treasuryLines.push(`- سحوبات المديرين: ${money(managerWithdrawals, currency)}`);
  if (savingsIn > 0) treasuryLines.push(`- تحويل لخزنة الادخار: ${money(savingsIn, currency)}`);
  if (savingsOut > 0) treasuryLines.push(`- تحويل من الادخار للمحل: ${money(savingsOut, currency)}`);
  if (partnerDeposits > 0) treasuryLines.push(`- إيداعات الشركاء: ${money(partnerDeposits, currency)}`);
  if (partnerWithdrawals > 0) treasuryLines.push(`- سحوبات الشركاء (عهدة): ${money(partnerWithdrawals, currency)}`);
  if (treasuryLines.length) {
    lines.push('', 'حركة الخزائن والعهد:', ...treasuryLines);
  }

  if (topProducts.length) {
    lines.push('', 'أكثر المنتجات مبيعًا اليوم:');
    topProducts.forEach((product, index) => {
      lines.push(`${index + 1}. ${product.name} | كمية: ${product.qty} | قيمة: ${money(product.revenue, currency)}`);
    });
  }

  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  // يُسمح للكرون (بالسر) أو لموظف مسجّل دخول (عشان يتبعت عند تقفيل اليوم من الـ POS).
  if (!authorizeCron(req) && !(await verifyStaffToken(req))) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    // date=YYYY-MM-DD (يوم القاهرة المحاسبي): يُستخدم عند التقفيل لإرسال تقرير اليوم
    // اللي اتقفل. بدونه = اليوم الحالي (ناقص 4 ساعات لتغطية بداية اليوم 3 ص).
    const dateParam = (req.query && (req.query.date || req.query.day)) || (req.body && req.body.date);
    const baseDate = dateParam ? new Date(`${dateParam}T12:00:00+03:00`) : new Date(Date.now() - 4 * 60 * 60 * 1000);
    const range = cairoDayRange(baseDate);

    const [settings, data, openingBalance] = await Promise.all([
      fetchStoreSettings(supabase),
      fetchReportData(supabase, range.start, range.end),
      fetchOpeningBalance(supabase, range.start)
    ]);

    const result = await sendTelegramText(buildDailyMessage(settings, range, data, openingBalance));
    return res.status(200).json({ ok: true, sent: 'daily', day: range.label, result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
