import {
  authorizeCron,
  buildFinancialStats,
  currentMonthRange,
  fetchReportData,
  fetchStoreSettings,
  getSupabase,
  isLastCairoDayOfMonth,
  money,
  productSalesStats,
  sendTelegramText,
} from './_report-utils.js';

export function buildMonthlyMessage(settings, range, data) {
  const stats = buildFinancialStats(data);
  const currency = settings.currency;
  const netCash = stats.totalRevenue - stats.totalExpense;
  const topProducts = productSalesStats(stats.salesOrders)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 7);

  const lines = [
    `التقرير المالي الشهري - ${settings.name}`,
    `الشهر: ${range.label}`,
    '',
    'ملخص الشهر:',
    `إجمالي الإيرادات: ${money(stats.totalRevenue, currency)}`,
    `إجمالي المصروفات والمدفوعات: ${money(stats.totalExpense, currency)}`,
    `صافي حركة الشهر: ${money(netCash, currency)}`,
    `ربح الفواتير التقريبي: ${money(stats.invoiceProfit, currency)}`,
    '',
    'تفصيل الإيرادات:',
    `مبيعات مدفوعة: ${money(stats.salesRevenue, currency)}`,
    `تحصيلات عملاء: ${money(stats.customerPayments, currency)}`,
    `إيرادات أخرى: ${money(stats.manualRevenue, currency)}`,
    '',
    'تفصيل المصروفات:',
    `مصروفات مباشرة: ${money(stats.manualExpenses, currency)}`,
    `مشتريات وسداد موردين: ${money(stats.purchasePayments, currency)}`,
    `رواتب/سلف موظفين: ${money(stats.payroll, currency)}`,
    `مرتجعات عملاء: ${money(stats.customerRefunds, currency)}`,
    '',
    'عدادات الشهر:',
    `فواتير بيع: ${stats.salesOrders.length}`,
    `تحصيلات عملاء: ${stats.paymentOrders.length}`,
    `فواتير شراء/سداد مورد: ${data.purchases.length}`,
    `فواتير محذوفة: ${stats.deletedOrders.length}`,
  ];

  if (topProducts.length) {
    lines.push('', 'أعلى المنتجات من حيث قيمة المبيعات:');
    topProducts.forEach((product, index) => {
      lines.push(`${index + 1}. ${product.name} | كمية: ${product.qty} | قيمة: ${money(product.revenue, currency)}`);
    });
  }

  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!authorizeCron(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  if (req.query?.checkLastDay === '1' && !isLastCairoDayOfMonth(new Date())) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'Not last Cairo day of month' });
  }

  try {
    const supabase = getSupabase();
    const range = currentMonthRange(new Date());
    const [settings, data] = await Promise.all([
      fetchStoreSettings(supabase),
      fetchReportData(supabase, range.start, range.end),
    ]);
    const result = await sendTelegramText(buildMonthlyMessage(settings, range, data));
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
