// ── منطق توزيع مبالغ المعاملات على وسائل الدفع (الخزنة) ──────────────────
// مشترك بين: تقفيل اليوم (POS)، الخزنة الرئيسية (Savings)، التقارير (Reports).
// كان متكرّر في 3 أماكن، فأي خطأ كان بيظهر 3 مرات — التوحيد هنا يمنع ذلك.
import { ALL_PAYMENT_KEYS } from './paymentMethods';

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

export function isMainTreasuryPurchase(row: any): boolean {
  return String(row?.notes || '').includes(MAIN_TREASURY_MARKER);
}
