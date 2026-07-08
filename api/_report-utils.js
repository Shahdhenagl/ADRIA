import { createClient } from '@supabase/supabase-js';

export const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 3);
const TIME_ZONE = 'Africa/Cairo';

export function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key);
}

/**
 * Guards a cron/report endpoint with a shared secret.
 *
 * Backward-compatible: if CRON_SECRET is not configured the request is allowed
 * (no behavior change). When CRON_SECRET is set, the caller must send
 * `Authorization: Bearer <CRON_SECRET>` — Vercel Cron sends this header
 * automatically when the env var is present.
 */
export function authorizeCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  return header === `Bearer ${secret}`;
}

export function money(value, currency = 'ج.م') {
  return `${Number(value || 0).toFixed(2)} ${currency}`;
}

export function cairoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

export function cairoDayRange(date = new Date()) {
  const { year, month, day } = cairoDateParts(date);
  const start = new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, -3, 0, 0, 0));
  return { start, end, label: `${day}/${month}/${year}` };
}

export function previousMonthRange(date = new Date()) {
  const { year, month } = cairoDateParts(date);
  const startMonth = month === 1 ? 12 : month - 1;
  const startYear = month === 1 ? year - 1 : year;
  const start = new Date(Date.UTC(startYear, startMonth - 1, 1, -3, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, 1, -3, 0, 0, 0));
  return { start, end, label: `${startMonth}/${startYear}` };
}

export function currentMonthRange(date = new Date()) {
  const { year, month } = cairoDateParts(date);
  const start = new Date(Date.UTC(year, month - 1, 1, -3, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, -3, 0, 0, 0));
  return { start, end, label: `${month}/${year}` };
}

export function isLastCairoDayOfMonth(date = new Date()) {
  const { year, month, day } = cairoDateParts(date);
  const tomorrow = cairoDateParts(new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0)));
  return tomorrow.day === 1;
}

export async function sendTelegramText(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Missing Telegram environment variables');

  // TELEGRAM_CHAT_ID may be a comma-separated list to notify several people.
  const chatIds = String(chatId).split(',').map((s) => s.trim()).filter(Boolean);
  let lastResult = null;
  for (const cid of chatIds) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cid,
        text: text.slice(0, 3900),
        disable_web_page_preview: false,
      }),
    });
    lastResult = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(lastResult));
  }
  return lastResult;
}

export async function fetchStoreSettings(supabase) {
  const { data } = await supabase.from('store_settings').select('*').limit(1).maybeSingle();
  return {
    name: data?.name || 'نظام الكاشير',
    currency: data?.currency || 'ج.م',
  };
}

export async function fetchReportData(supabase, start, end) {
  const [ordersRes, expensesRes, purchasesRes, employeeTransactionsRes, productsRes] = await Promise.all([
    supabase
      .from('orders')
      .select('*, customers(*), order_items(*, products(*))')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false }),
    supabase
      .from('expenses')
      .select('*')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString()),
    supabase
      .from('purchase_invoices')
      .select('*, suppliers(*), purchase_items(*, products(*))')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString()),
    supabase
      .from('employee_transactions')
      .select('*')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString()),
    supabase.from('products').select('*').order('name'),
  ]);

  // الخزائن والعهد (جداول قد لا تكون موجودة في قواعد قديمة → نتجاهل الخطأ)
  const safe = async (q) => { try { const r = await q; return r.data || []; } catch { return []; } };
  const [savings, partnerTxns] = await Promise.all([
    safe(supabase.from('savings_transactions').select('*').gte('created_at', start.toISOString()).lt('created_at', end.toISOString())),
    safe(supabase.from('partner_transactions').select('*').gte('created_at', start.toISOString()).lt('created_at', end.toISOString())),
  ]);

  return {
    orders: ordersRes.data || [],
    expenses: expensesRes.data || [],
    purchases: purchasesRes.data || [],
    employeeTransactions: employeeTransactionsRes.data || [],
    products: productsRes.data || [],
    savings,
    partnerTxns,
  };
}

export async function fetchOpeningBalance(supabase, start) {
  const [ordersRes, expensesRes, purchasesRes, payrollRes] = await Promise.all([
    supabase.from('orders').select('paid_amount, is_deleted, order_items(refunded_amount)').lt('created_at', start.toISOString()),
    supabase.from('expenses').select('amount').lt('created_at', start.toISOString()),
    supabase.from('purchase_invoices').select('paid_amount').lt('created_at', start.toISOString()),
    supabase.from('employee_transactions').select('amount').lt('created_at', start.toISOString())
  ]);

  const pastOrders = ordersRes.data || [];
  const pastExpenses = expensesRes.data || [];
  const pastPurchases = purchasesRes.data || [];
  const pastPayroll = payrollRes.data || [];

  const totalSalesRevenue = pastOrders.filter(o => !o.is_deleted).reduce((sum, o) => sum + Number(o.paid_amount || 0), 0);
  
  const totalRefunds = pastOrders.reduce((sum, o) => {
    return sum + (o.order_items || []).reduce((itemSum, item) => itemSum + Number(item.refunded_amount || 0), 0);
  }, 0);

  // Expenses < 0 are revenues, Expenses > 0 are expenses
  // When we sum all expenses, revenues reduce the total expense
  const totalExpenseEntries = pastExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalPurchases = pastPurchases.reduce((sum, p) => sum + Number(p.paid_amount || 0), 0);
  const totalPayroll = pastPayroll.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalRevenue = totalSalesRevenue;
  const totalExpense = totalExpenseEntries + totalPurchases + totalPayroll + totalRefunds;

  return totalRevenue - totalExpense;
}

export function calculateInvoiceProfit(order) {
  if (!order || order.type === 'payment' || order.is_deleted) return 0;
  return (order.order_items || []).reduce((sum, item) => {
    const qty = Number(item.quantity || 0) - Number(item.returned_quantity || 0);
    const salePrice = Number(item.sale_price || 0);
    const cost = Number(item.purchase_price ?? item.products?.average_purchase_price ?? item.products?.purchase_price ?? 0);
    return sum + ((salePrice - cost) * qty);
  }, 0);
}

export function buildFinancialStats(data) {
  const activeOrders = data.orders.filter((order) => !order.is_deleted);
  const salesOrders = activeOrders.filter((order) => order.type !== 'payment');
  const paymentOrders = activeOrders.filter((order) => order.type === 'payment');
  const deletedOrders = data.orders.filter((order) => order.is_deleted);

  // فئات الحجز: 'حجز' (تحصيل عربون سالب / رد عربون موجب) و'تحويل حجز' (تحويل العربون لفاتورة، موجب).
  const isReservation = (c) => c === 'حجز' || c === 'تحويل حجز';

  const salesRevenue = salesOrders.reduce((sum, order) => sum + Number(order.paid_amount || 0), 0);
  const customerPayments = paymentOrders.reduce((sum, order) => sum + Number(order.paid_amount || 0), 0);
  const manualRevenue = data.expenses
    .filter((expense) => Number(expense.amount || 0) < 0 && !isReservation(expense.category))
    .reduce((sum, expense) => sum + Math.abs(Number(expense.amount || 0)), 0);

  // عرابين الحجز: محصّلة (داخل) − مرتجعة (خارج) = صافي؛ وتحويل العربون لفاتورة (خارج) لمنع الازدواج.
  const reservationDeposits = data.expenses
    .filter((e) => e.category === 'حجز' && Number(e.amount || 0) < 0)
    .reduce((sum, e) => sum + Math.abs(Number(e.amount || 0)), 0);
  const reservationRefunds = data.expenses
    .filter((e) => e.category === 'حجز' && Number(e.amount || 0) > 0)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const reservationConversions = data.expenses
    .filter((e) => e.category === 'تحويل حجز')
    .reduce((sum, e) => sum + Math.abs(Number(e.amount || 0)), 0);
  const reservationNet = reservationDeposits - reservationRefunds;

  const customerRefunds = activeOrders.reduce((sum, order) => {
    return sum + (order.order_items || []).reduce((itemSum, item) => itemSum + Number(item.refunded_amount || 0), 0);
  }, 0);
  const manualExpenses = data.expenses
    .filter((expense) => Number(expense.amount || 0) > 0 && !isReservation(expense.category))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const purchasePayments = data.purchases.reduce((sum, invoice) => sum + Number(invoice.paid_amount || 0), 0);
  const hasMatchingPayrollExpense = (tx) => {
    const txDate = new Date(tx.created_at).toISOString().slice(0, 10);
    return data.expenses.some((expense) => {
      const expenseDate = new Date(expense.date || expense.created_at).toISOString().slice(0, 10);
      return expense.category === 'رواتب'
        && expenseDate === txDate
        && Math.abs(Number(expense.amount || 0)) === Math.abs(Number(tx.amount || 0))
        && Math.abs(Number(expense.paid_cash || 0)) === Math.abs(Number(tx.paid_cash || 0))
        && Math.abs(Number(expense.paid_visa || 0)) === Math.abs(Number(tx.paid_visa || 0))
        && Math.abs(Number(expense.paid_wallet || 0)) === Math.abs(Number(tx.paid_wallet || 0))
        && Math.abs(Number(expense.paid_instapay || 0)) === Math.abs(Number(tx.paid_instapay || 0));
    });
  };
  const payroll = data.employeeTransactions
    .filter((tx) => !hasMatchingPayrollExpense(tx))
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const invoiceProfit = salesOrders.reduce((sum, order) => sum + calculateInvoiceProfit(order), 0);

  return {
    activeOrders,
    salesOrders,
    paymentOrders,
    deletedOrders,
    salesRevenue,
    customerPayments,
    manualRevenue,
    reservationDeposits,
    reservationRefunds,
    reservationConversions,
    reservationNet,
    totalRevenue: salesRevenue + customerPayments + manualRevenue + reservationDeposits,
    customerRefunds,
    manualExpenses,
    purchasePayments,
    payroll,
    totalExpense: customerRefunds + manualExpenses + purchasePayments + payroll + reservationRefunds + reservationConversions,
    invoiceProfit,
  };
}

export function topCategories(transactions, type, limit = 5) {
  const map = new Map();
  transactions
    .filter((tx) => tx.type === type)
    .forEach((tx) => map.set(tx.category, (map.get(tx.category) || 0) + tx.amount));
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function productSalesStats(orders) {
  const map = new Map();
  orders.filter((order) => !order.is_deleted && order.type !== 'payment').forEach((order) => {
    (order.order_items || []).forEach((item) => {
      const productId = item.product_id || item.id;
      const qty = Number(item.quantity || 0) - Number(item.returned_quantity || 0);
      const revenue = qty * Number(item.sale_price || 0);
      const current = map.get(productId) || {
        id: productId,
        name: item.product_name || item.products?.name || 'منتج غير محدد',
        qty: 0,
        revenue: 0,
      };
      current.qty += qty;
      current.revenue += revenue;
      map.set(productId, current);
    });
  });
  return [...map.values()];
}

export function lowStockProducts(products) {
  return products
    .filter((product) => Number(product.stock_quantity || 0) <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => Number(a.stock_quantity || 0) - Number(b.stock_quantity || 0));
}

export function noStockProducts(products) {
  return products
    .filter((product) => Number(product.stock_quantity || 0) <= 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
