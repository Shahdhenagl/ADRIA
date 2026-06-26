import {
  authorizeCron,
  currentMonthRange,
  fetchReportData,
  fetchStoreSettings,
  getSupabase,
  isLastCairoDayOfMonth,
  LOW_STOCK_THRESHOLD,
  lowStockProducts,
  money,
  noStockProducts,
  productSalesStats,
  sendTelegramText,
} from './_report-utils.js';

function formatProductList(products, emptyText, renderLine) {
  if (!products.length) return [emptyText];
  return products.slice(0, 10).map(renderLine);
}

export function buildInventoryMessage(settings, range, data) {
  const currency = settings.currency;
  const sales = productSalesStats(data.orders);
  const topSelling = [...sales].sort((a, b) => b.qty - a.qty).slice(0, 10);
  const leastSelling = [...sales].filter((product) => product.qty > 0).sort((a, b) => a.qty - b.qty).slice(0, 10);
  const soldIds = new Set(sales.map((product) => product.id));
  const notSold = data.products.filter((product) => !soldIds.has(product.id)).slice(0, 10);
  const outOfStock = noStockProducts(data.products);
  const lowStock = lowStockProducts(data.products).filter((product) => Number(product.stock_quantity || 0) > 0);

  const lines = [
    `تقرير المخزون الشهري - ${settings.name}`,
    `الشهر: ${range.label}`,
    '',
    `إجمالي المنتجات: ${data.products.length}`,
    `منتجات نفدت: ${outOfStock.length}`,
    `منتجات قربت تنفد: ${lowStock.length} (من 1 إلى ${LOW_STOCK_THRESHOLD} قطع)`,
    '',
    'الأكثر مبيعًا:',
    ...formatProductList(topSelling, 'لا توجد مبيعات لهذا الشهر.', (product, index) =>
      `${index + 1}. ${product.name} | كمية: ${product.qty} | قيمة: ${money(product.revenue, currency)}`
    ),
    '',
    'الأقل مبيعًا:',
    ...formatProductList(leastSelling, 'لا توجد مبيعات كافية لحساب الأقل مبيعًا.', (product, index) =>
      `${index + 1}. ${product.name} | كمية: ${product.qty} | قيمة: ${money(product.revenue, currency)}`
    ),
    '',
    'منتجات لم تُبع هذا الشهر:',
    ...formatProductList(notSold, 'كل المنتجات المسجلة لها حركة بيع أو لا توجد منتجات.', (product, index) =>
      `${index + 1}. ${product.name} | المخزون الحالي: ${Number(product.stock_quantity || 0)}`
    ),
    '',
    'منتجات نفدت من المخزون:',
    ...formatProductList(outOfStock, 'لا توجد منتجات نافدة.', (product, index) =>
      `${index + 1}. ${product.name}`
    ),
    '',
    'منتجات قربت تنفد:',
    ...formatProductList(lowStock, 'لا توجد منتجات قربت تنفد.', (product, index) =>
      `${index + 1}. ${product.name} | المخزون الحالي: ${Number(product.stock_quantity || 0)}`
    ),
  ];

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
    const result = await sendTelegramText(buildInventoryMessage(settings, range, data));
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
