import { createClient } from '@supabase/supabase-js';

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 3);

// Verifies the Bearer token in the request against Supabase Auth.
// Returns true only for a valid, authenticated session.
async function verifySupabaseToken(req) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return false;

  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;

  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.getUser(token);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

const TYPE_LABELS = {
  sale: 'فاتورة بيع جديدة',
  payment: 'تحصيل من عميل',
  purchase: 'فاتورة شراء جديدة',
  supplier_payment: 'سداد لمورد',
  supplier_collection: 'تحصيل من مورد',
  supplier_return: 'مرتجع لمورد',
  return: 'مرتجع فاتورة',
  delete_invoice: 'حذف فاتورة بيع/عامة',
  delete_purchase_invoice: 'حذف فاتورة شراء',
  edit_invoice: 'تعديل فاتورة',
  stock_low: 'تنبيه مخزون منخفض',
  financing_collection: 'تحصيل تمويل / سلفة',
  financing_repayment: 'سداد تمويل / سلفة',
  custom_note: 'رسالة من الكاشير',
  transfer: 'تحويل داخلي بين وسائل الدفع',
  cashier_expense: 'مصروف من الكاشير',
  cashier_income: 'إيراد من الكاشير',
  manager_withdrawal: 'سحب باسم المدير',
  partner_withdraw: 'سحب شريك',
  partner_deposit: 'إيداع شريك',
  savings_in: 'تحويل لخزنة الادخار',
  savings_out: 'تحويل من خزنة الادخار',
  savings_convert: 'تحويل بين طرق الخزنة الرئيسية',
};

// ── توجيه الرسايل على جروبات مختلفة (نفس البوت، chat مختلف حسب نوع الحركة) ──────
// كل نوع رسالة بينتمي لمجموعة (قناة). أي نوع مش مذكور هنا بيروح للجروب الافتراضي.
const TYPE_CATEGORY = {
  // مبيعات وكاشير
  sale: 'sales', payment: 'sales', return: 'sales', transfer: 'sales',
  cashier_expense: 'sales', cashier_income: 'sales', custom_note: 'sales',
  // مالية حساسة (للمدير): حذف/تعديل، سحوبات، شركاء، حركات الخزنة الرئيسية والادخار
  delete_invoice: 'finance', delete_purchase_invoice: 'finance', edit_invoice: 'finance',
  manager_withdrawal: 'finance', partner_withdraw: 'finance', partner_deposit: 'finance',
  savings_in: 'finance', savings_out: 'finance', savings_convert: 'finance',
  // موردين ومشتريات
  purchase: 'suppliers', supplier_payment: 'suppliers', supplier_collection: 'suppliers', supplier_return: 'suppliers',
  // مخزون
  stock_low: 'stock',
  // تمويل وسلف
  financing_collection: 'financing', financing_repayment: 'financing',
};

// كل مجموعة ليها متغيّر بيئة بالـ chat id بتاعها (ممكن يكون أكتر من id مفصولين بفاصلة).
const CATEGORY_ENV = {
  sales: 'TELEGRAM_CHAT_SALES',
  finance: 'TELEGRAM_CHAT_FINANCE',
  suppliers: 'TELEGRAM_CHAT_SUPPLIERS',
  stock: 'TELEGRAM_CHAT_STOCK',
  financing: 'TELEGRAM_CHAT_FINANCING',
};

// يحدّد الـ chat id(s) المناسبة لنوع الرسالة. لو مجموعتها مش متظبطة يرجع للافتراضي
// (TELEGRAM_CHAT_ID) — فالسلوك القديم يفضل شغّال لو مفيش أي إعداد جديد.
function resolveChatIds(type) {
  const category = TYPE_CATEGORY[type];
  const envName = category && CATEGORY_ENV[category];
  const raw = (envName && process.env[envName]) || process.env.TELEGRAM_CHAT_ID || '';
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function line(label, value) {
  if (value === undefined || value === null || value === '') return null;
  return `${label}: ${value}`;
}

function money(value, currency) {
  return `${Number(value || 0).toFixed(2)} ${currency || 'ج.م'}`;
}

function formatDate(value) {
  return new Date(value || Date.now()).toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatItems(items, currency, priceKey = 'sale_price') {
  if (!Array.isArray(items) || items.length === 0) return [];

  return items.slice(0, 15).map((item, index) => {
    const quantity = Number(item.quantity || item.returnQty || 0);
    const unitPrice = Number(item[priceKey] ?? item.sale_price ?? item.purchase_price ?? 0);
    const total = Number(item.total ?? quantity * unitPrice);
    return [
      `${index + 1}. ${item.name || item.product_name || 'منتج غير محدد'}`,
      `   الكمية: ${quantity}`,
      `   سعر الوحدة: ${money(unitPrice, currency)}`,
      `   الإجمالي: ${money(total, currency)}`,
    ].join('\n');
  });
}

function normalizeStockProducts(products) {
  if (!Array.isArray(products)) return [];
  return products
    .map((product) => ({
      name: product.name || 'منتج غير محدد',
      previous_quantity: Number(product.previous_quantity ?? 0),
      moved_quantity: Number(product.moved_quantity ?? 0),
      stock_quantity: Number(product.stock_quantity ?? product.quantity ?? 0),
      threshold: Number(product.threshold ?? LOW_STOCK_THRESHOLD),
    }))
    .filter((product) => product.stock_quantity <= product.threshold);
}

function baseLines(payload) {
  return [
    'تنبيه من نظام الكاشير',
    line('نوع الحركة', TYPE_LABELS[payload.type] || 'حركة جديدة'),
    line('المسؤول', payload.actor || 'غير محدد'),
    line('التاريخ', formatDate(payload.date)),
  ].filter(Boolean);
}

function formatMessage(payload) {
  const currency = payload.currency || 'ج.م';
  const lines = baseLines(payload);

  if (payload.invoiceId) lines.push(line('رقم الفاتورة', `#${payload.invoiceId}`));
  if (payload.salesperson) lines.push(line('مسؤول المبيعات', payload.salesperson));
  if (payload.customer) lines.push(line('العميل', payload.customer));
  if (payload.supplier) lines.push(line('المورد', payload.supplier));
  if (payload.lender) lines.push(line('صاحب السلفة / الجمعية', payload.lender));
  if (payload.financingType) lines.push(line('نوع التمويل', payload.financingType));
  if (payload.phone) lines.push(line('رقم الهاتف', payload.phone));
  if (payload.paymentMethod) lines.push(line('طريقة الدفع', payload.paymentMethod));
  if (payload.total !== undefined) {
    const totalLabel = String(payload.type || '').startsWith('financing_') ? 'إجمالي الدفعة' : 'إجمالي الفاتورة';
    lines.push(line(totalLabel, money(payload.total, currency)));
  }
  if (payload.amount !== undefined) lines.push(line('قيمة العملية', money(payload.amount, currency)));
  if (payload.remaining !== undefined) lines.push(line('المتبقي', money(payload.remaining, currency)));
  if (payload.dueDate) lines.push(line('تاريخ الاستحقاق', payload.dueDate));
  if (payload.description) lines.push(line('الوصف', payload.description));
  if (payload.paid !== undefined) lines.push(line('المبلغ المدفوع', money(payload.paid, currency)));
  if (payload.refundTotal !== undefined) lines.push(line('قيمة المرتجع', money(payload.refundTotal, currency)));
  if (payload.reason) lines.push(line('سبب الحذف', payload.reason));
  if (payload.invoiceUrl) lines.push(line('رابط الفاتورة', payload.invoiceUrl));
  if (payload.noteText) lines.push(line('نص الرسالة', payload.noteText));

  if (payload.type === 'edit_invoice' && payload.editDetails) {
    lines.push('', 'تفاصيل التعديل:');
    if (payload.editDetails.oldTotal !== undefined && payload.editDetails.newTotal !== undefined) {
      lines.push(`الإجمالي قبل التعديل: ${money(payload.editDetails.oldTotal, currency)}`);
      lines.push(`الإجمالي بعد التعديل: ${money(payload.editDetails.newTotal, currency)}`);
    }
    if (payload.editDetails.oldPaid !== undefined && payload.editDetails.newPaid !== undefined) {
      lines.push(`المدفوع قبل التعديل: ${money(payload.editDetails.oldPaid, currency)}`);
      lines.push(`المدفوع بعد التعديل: ${money(payload.editDetails.newPaid, currency)}`);
    }
    if (payload.editDetails.notes) {
      lines.push(`سبب التعديل: ${payload.editDetails.notes}`);
    }
  }


  const itemLines = formatItems(
    payload.items,
    currency,
    payload.type === 'purchase' ? 'purchase_price' : 'sale_price'
  );
  if (itemLines.length) lines.push('', 'تفاصيل الأصناف:', ...itemLines);

  const stockProducts = normalizeStockProducts(payload.products);
  if (payload.type === 'stock_low') {
    if (stockProducts.length === 0) return null;

    lines.push('', `تفاصيل المخزون المنخفض (حد التنبيه: ${LOW_STOCK_THRESHOLD}):`);
    stockProducts.slice(0, 15).forEach((product, index) => {
      const status = product.stock_quantity <= 0 ? 'نفذ من المخزون' : 'قرب على النفاذ';
      lines.push([
        `${index + 1}. ${product.name}`,
        `   الحالة: ${status}`,
        `   الكمية قبل الحركة: ${product.previous_quantity}`,
        `   كمية الحركة: ${product.moved_quantity}`,
        `   الكمية الحالية: ${product.stock_quantity}`,
      ].join('\n'));
    });
  }

  return lines.join('\n').slice(0, 3900);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Optional auth: when REQUIRE_ALERT_AUTH is enabled, require a valid Supabase
  // session token so random anonymous callers can't spam the owner's Telegram.
  // Backward-compatible: disabled unless the env var is set (see SECURITY_SETUP.md).
  if (process.env.REQUIRE_ALERT_AUTH === 'true') {
    const ok = await verifySupabaseToken(req);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  // نفس البوت بيبعت لكل الجروبات؛ الوجهة بتتحدد حسب نوع الرسالة (resolveChatIds).
  if (!token) {
    return res.status(200).json({ ok: false, skipped: true, error: 'Telegram env vars are missing' });
  }

  try {
    const payload = req.body || {};
    const text = formatMessage(payload);
    if (!text) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'No alertable data' });
    }

    // الوجهة حسب نوع الحركة: جروب المجموعة المخصّص، وإلا الجروب الافتراضي.
    // كل قيمة ممكن تكون أكتر من chat id مفصولين بفاصلة.
    const chatIds = resolveChatIds(payload.type);
    if (chatIds.length === 0) {
      return res.status(200).json({ ok: false, skipped: true, error: 'No chat id configured' });
    }
    let ok = true;
    const results = [];
    for (const cid of chatIds) {
      const telegramRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cid,
          text,
          disable_web_page_preview: false,
        }),
      });
      if (!telegramRes.ok) ok = false;
      results.push(await telegramRes.json());
    }
    return res.status(ok ? 200 : 502).json({ ok, results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
