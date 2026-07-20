// ── منطق توزيع مبالغ المعاملات على وسائل الدفع (الخزنة) ──────────────────
// مشترك بين: تقفيل اليوم (POS)، الخزنة الرئيسية (Savings)، التقارير (Reports).
// كان متكرّر في 3 أماكن، فأي خطأ كان بيظهر 3 مرات — التوحيد هنا يمنع ذلك.
import { ALL_PAYMENT_KEYS, openingBalanceOf } from './paymentMethods';

type Bucket = Record<string, number>;

/**
 * يضيف مبلغ معاملة إلى «سلة» وسائل الدفع.
 * - لو فيه أي تقسيمة (paid_*) ≠ صفر → نستخدمها بإشارتها (السالب = عكس الاتجاه،
 *   مثال: تحصيل رصيد لينا عند المورد paid سالب → يقلّل الخارج = يزيد الرصيد).
 * - غير كده → نستخدم المبلغ المفرد (field) على الوسيلة الأساسية.
 * @param sign 1 = كما هي، -1 = عكس (للسلال اللي بتُطرح زي الخارج في Savings).
 */
export function applySplit(
  target: Bucket,
  rec: any,
  field: string,
  opts: { sign?: number; methodOverride?: string } = {},
): void {
  const { sign = 1, methodOverride } = opts;
  const keys = ALL_PAYMENT_KEYS as readonly string[];
  const splits = keys.map((k) => +rec['paid_' + k] || 0);
  if (splits.some((v) => v !== 0)) {
    keys.forEach((k, i) => { target[k] += sign * splits[i]; });
    return;
  }
  const amt = Math.abs(+rec[field] || 0);
  const m = methodOverride || (keys.includes(rec.payment_method) ? rec.payment_method : 'cash');
  target[m] += sign * amt;
}

/**
 * تحويل داخلي بين وسائل الدفع (كاش↔فيزا…): مالوش أثر على الإجمالي، بس بيحرّك
 * الرصيد بين الوسائل. القيمة السالبة = خارج من وسيلتها، الموجبة = داخل لوسيلتها.
 * @param inTarget سلة الداخل، outTarget سلة الخارج (كقيم موجبة).
 */
export function routeInternalTransfer(inTarget: Bucket, outTarget: Bucket, rec: any): void {
  (ALL_PAYMENT_KEYS as readonly string[]).forEach((k) => {
    const v = +rec['paid_' + k] || 0;
    if (v > 0) inTarget[k] += v;
    else if (v < 0) outTarget[k] += -v;
  });
}

/** خزنة واحدة net (داخل − خارج) للتحويل الداخلي: يُطبَّق مباشرةً بالإشارة. */
export function applyInternalTransferNet(net: Bucket, rec: any): void {
  (ALL_PAYMENT_KEYS as readonly string[]).forEach((k) => { net[k] += +rec['paid_' + k] || 0; });
}

export const isInternalTransfer = (category: any): boolean => category === 'تحويل داخلي';
export const isSavingsTransfer = (category: any): boolean =>
  category === 'تحويل للخزنة الرئيسية' || category === 'تحويل من الخزنة الرئيسية';

export const MAIN_TREASURY_MARKER = '[MAIN_TREASURY]';

export function markMainTreasuryNote(note?: string): string {
  const clean = String(note || '').trim();
  return clean.includes(MAIN_TREASURY_MARKER)
    ? clean
    : `${MAIN_TREASURY_MARKER}${clean ? ` ${clean}` : ''}`;
}

export function isMainTreasuryExpense(row: any): boolean {
  return String(row?.note || '').includes(MAIN_TREASURY_MARKER);
}

// ── ربط صف المصروف بمعاملة الخزنة الرئيسية (لعكس الأثر عند الحذف) ──────────
// نخزّن معرّف المجموعة داخل نص الملاحظة كوسم مخفي: [SVG:<uuid>]
// (نفس أسلوب MAIN_TREASURY_MARKER — بدون تعديل سكيمة جدول expenses).
const SAVINGS_GROUP_RE = /\[SVG:([0-9a-fA-F-]{6,})\]/;

export function markSavingsGroupNote(note: string | undefined, groupId?: string | null): string {
  const clean = String(note || '').trim();
  if (!groupId) return clean;
  return SAVINGS_GROUP_RE.test(clean) ? clean : `${clean}${clean ? ' ' : ''}[SVG:${groupId}]`;
}

export function savingsGroupIdOf(note: any): string | null {
  const m = String(note || '').match(SAVINGS_GROUP_RE);
  return m ? m[1] : null;
}

/**
 * معرّف مجموعة جديد يربط صف المصروف بصف/صفوف الخزنة الرئيسية.
 * أي شاشة بتسجّل حركة على الخزنة الرئيسية لازم تولّد واحد وتمرّره للاتنين،
 * وإلا الحذف مش هيلاقي الصف المقابل وهيسيب نص العملية ورا (شوف
 * deleteSavingsOperation).
 */
export function newSavingsGroupId(): string {
  try { return crypto.randomUUID(); }
  catch { return 'svg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
}

/**
 * يشيل الوسوم المخفية ([MAIN_TREASURY] / [SVG:…]) من نص الملاحظة للعرض في
 * حقول التعديل. الوسوم دي تصنيف محاسبي مش نص كتبه المستخدم — لو ظهرت في
 * الفورم بيمسحها من غير ما يقصد وبيفكّ ربط المصروف بالخزنة الرئيسية.
 */
export function stripTreasuryMarkers(note: any): string {
  return String(note || '')
    .replace(MAIN_TREASURY_MARKER, '')
    .replace(SAVINGS_GROUP_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function isMainTreasuryPurchase(row: any): boolean {
  return String(row?.notes || '').includes(MAIN_TREASURY_MARKER);
}

// ── رصيد خزنة المحل المتاح لكل وسيلة ────────────────────────────────────────
// كان متكرّر في Savings (بالفلاتر الصح) وفي Managers (من غيرها)، فالصفحتين كانوا
// بيدّوا أرقام مختلفة لنفس الخزنة. أي صفحة بتعرض «المتاح بالخزنة» لازم تنادي دي.
//
// المستبعَد عن قصد:
// - مصاريف/مشتريات الخزنة الرئيسية: اتدفعت من الرئيسية مش من درج المحل، فطرحها
//   من المحل بيوقّع رصيده بالسالب من غير سبب.
// - التحويل الداخلي (كاش↔فيزا): مجموعه صفر، بيحرّك بين الوسائل بس. تقسيمة
//   paid_* بتحمل الإشارة، فبتتطبّق زي ما هي بدل ما تتطرح كمصروف.

export interface ShopTreasuryRows {
  /** الفواتير — كل واحدة معاها items (order_items) عشان المرتجعات. */
  orders: any[];
  expenses: any[];
  purchases: any[];
  salaries: any[];
}

export function computeShopAvailable(rows: ShopTreasuryRows, settings: any): Bucket {
  const net: Bucket = {};
  ALL_PAYMENT_KEYS.forEach((k) => { net[k] = 0; });
  const add = (sign: number, rec: any, field: string) => applySplit(net, rec, field, { sign });

  (rows.orders || []).filter((o: any) => !o.is_deleted).forEach((o: any) => {
    if (o.type === 'sale' || o.type === 'payment') add(1, o, 'paid_amount');
    const refunded = (o.items || []).reduce((t: number, it: any) => t + (+it.refunded_amount || 0), 0);
    if (refunded > 0) add(-1, { paid_amount: refunded, payment_method: o.refund_method || o.payment_method }, 'paid_amount');
  });

  (rows.expenses || []).forEach((e: any) => {
    const amount = Number(e.amount) || 0;
    if (isMainTreasuryExpense(e)) return;
    if (isInternalTransfer(e.category)) { applyInternalTransferNet(net, e); return; }
    if (amount < 0) {
      // مصروف بمبلغ سالب = إيراد مسجّل يدوياً (داخل للخزنة) مش خارج منها
      const absRec: any = { ...e, amount: Math.abs(amount) };
      ALL_PAYMENT_KEYS.forEach((k) => { absRec['paid_' + k] = Math.abs(+e['paid_' + k] || 0); });
      add(1, absRec, 'amount');
    } else {
      add(-1, e, 'amount');
    }
  });

  // paid_amount سالب = فلوس داخلة (مرتجع مورد / تحصيل من مورد) مش خارجة.
  // الصف اللي فيه تقسيم مسجّل بيتظبط لوحده (تقسيم سالب × -1 = موجب)، لكن صف من
  // غير تقسيم (بيانات قديمة) applySplit بتاخد له Math.abs فكان بيتحسب صادر
  // بالغلط. بنطبّع الصف لقيم موجبة وندخّله بإشارة +1 — زي ما بيتعمل مع المصاريف
  // السالبة فوق — فالحالتين بيدّوا وارد.
  (rows.purchases || []).filter((p: any) => !isMainTreasuryPurchase(p)).forEach((p: any) => {
    const paid = +p.paid_amount || 0;
    if (paid < 0) {
      const absRec: any = { ...p, paid_amount: Math.abs(paid) };
      ALL_PAYMENT_KEYS.forEach((k) => { absRec['paid_' + k] = Math.abs(+p['paid_' + k] || 0); });
      add(1, absRec, 'paid_amount');
    } else {
      add(-1, p, 'paid_amount');
    }
  });
  (rows.salaries || []).forEach((s: any) => add(-1, s, 'amount'));
  ALL_PAYMENT_KEYS.forEach((k) => { net[k] += openingBalanceOf(settings, k); });
  return net;
}
