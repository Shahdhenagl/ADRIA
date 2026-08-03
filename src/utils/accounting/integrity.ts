import { ALL_PAYMENT_KEYS } from '../paymentMethods';
import { isMainTreasuryExpense, savingsGroupIdOf } from '../treasury';

/**
 * ── فحص سلامة القيود ─────────────────────────────────────────────────────────
 *
 * كل باج وقعنا فيه كان من نوع واحد: **حركة اتكتبت في مكانين واتمسحت من مكان
 * واحد**. مفيش حاجة كانت بتكشف ده — الفرق بيفضل مستخبّي لشهور.
 *
 * الفحوصات دي بتدوّر على الحالات دي مباشرةً وبتتشغّل على البيانات الحقيقية من
 * صفحة «شجرة الحسابات»، وكمان في التستات على بيانات تجريبية.
 *
 * القاعدة: كل فحص لازم يكون **حتمي** (deterministic) و**بيوصف الإصلاح**، مش بس
 * يقول «في مشكلة».
 */

export type IssueSeverity = 'error' | 'warning';

export interface IntegrityIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** إزاي تصلّحها. */
  fix: string;
  /** صفوف متأثرة (id + وصف) للعرض. */
  rows: { id: string; label: string; amount?: number }[];
}

export interface IntegrityInput {
  orders: any[];
  expenses: any[];
  purchaseInvoices: any[];
  employeeTransactions: any[];
  savingsTransactions: any[];
}

const money = (n: number) => Number(n || 0).toFixed(2);
const dayOf = (d: any) => String(d || '').slice(0, 10);

/**
 * (1) راتب/سلفة على الموظف من غير مصروف مقابل، أو العكس.
 *
 * المقارنة **بالعدّ** مش بالمطابقة: صفّين بنفس المبلغ في نفس اليوم كانوا
 * بيتطابقوا مع مصروف واحد فاليتيم يختفي (ده اللي خفى الـ 500 والـ 10).
 */
export function checkSalaryPairs(input: IntegrityInput): IntegrityIssue[] {
  const key = (d: any, amt: any) => `${dayOf(d)}|${Math.abs(Number(amt) || 0).toFixed(2)}`;
  const txCount = new Map<string, any[]>();
  const exCount = new Map<string, any[]>();

  input.employeeTransactions.filter((t) => !isMainTreasuryExpense(t)).forEach((t) => {
    const k = key(t.created_at, t.amount);
    txCount.set(k, [...(txCount.get(k) || []), t]);
  });
  input.expenses
    .filter((e) => e.category === 'رواتب' && !isMainTreasuryExpense(e))
    .forEach((e) => {
      const k = key(e.created_at || e.date, e.amount);
      exCount.set(k, [...(exCount.get(k) || []), e]);
    });

  const issues: IntegrityIssue[] = [];
  const keys = new Set([...txCount.keys(), ...exCount.keys()]);
  keys.forEach((k) => {
    const txs = txCount.get(k) || [];
    const exs = exCount.get(k) || [];
    if (txs.length === exs.length) return;
    const [day, amt] = k.split('|');
    const extraOnEmployee = txs.length > exs.length;
    issues.push({
      id: `salary-pair:${k}`,
      severity: 'error',
      title: extraOnEmployee
        ? 'خصم على موظف من غير صرف من الخزنة'
        : 'صرف من الخزنة من غير تسجيل على الموظف',
      detail: extraOnEmployee
        ? `يوم ${day} فيه ${txs.length} حركة موظف بمبلغ ${amt} مقابل ${exs.length} مصروف. الزيادة بتتخصم من راتب الموظف رغم إن الفلوس ماخرجتش.`
        : `يوم ${day} فيه ${exs.length} مصروف رواتب بمبلغ ${amt} مقابل ${txs.length} حركة موظف. الفلوس خرجت من غير ما تتسجّل على الموظف.`,
      fix: extraOnEmployee
        ? 'امسح الحركة الزيادة من صفحة الموظفين (سجل حركات الموظف).'
        : 'سجّل الحركة على الموظف من صفحة الموظفين، أو امسح المصروف لو اتسجّل بالغلط.',
      rows: [
        ...txs.map((t) => ({ id: String(t.id), label: `كشف الموظف — ${dayOf(t.created_at)}`, amount: Number(t.amount) })),
        ...exs.map((e) => ({ id: String(e.id), label: `الخزنة (مصروف) — ${dayOf(e.created_at || e.date)}`, amount: Number(e.amount) })),
      ],
    });
  });
  return issues;
}

/**
 * (2) صف موسوم [MAIN_TREASURY] بوسم ربط [SVG:] من غير صف مقابل في دفتر الرئيسية.
 * الصف ده مستبعد من درج المحل ومالوش مقابل في الرئيسية = فلوس في اللا مكان.
 */
export function checkMainTreasuryPairs(input: IntegrityInput): IntegrityIssue[] {
  const groupIds = new Set(
    input.savingsTransactions.map((s) => s.group_id).filter(Boolean).map(String),
  );
  const orphans: { id: string; label: string; amount?: number }[] = [];

  const scan = (rows: any[], noteKey: string, label: string, amountKey: string) => {
    rows.forEach((r) => {
      const note = r[noteKey];
      if (!isMainTreasuryExpense({ note })) return;
      const gid = savingsGroupIdOf(note);
      if (gid && !groupIds.has(String(gid))) {
        orphans.push({ id: String(r.id), label: `${label} — ${dayOf(r.created_at || r.date)}`, amount: Number(r[amountKey]) });
      }
    });
  };
  scan(input.expenses, 'note', 'مصروف', 'amount');
  scan(input.employeeTransactions, 'note', 'حركة موظف', 'amount');
  scan(input.purchaseInvoices, 'notes', 'فاتورة شراء', 'paid_amount');

  if (orphans.length === 0) return [];
  return [{
    id: 'main-treasury-orphans',
    severity: 'error',
    title: 'حركات رئيسية من غير صف في الدفتر',
    detail: `${orphans.length} صف موسوم بالخزنة الرئيسية ومالوش صف مقابل في دفترها. الصفوف دي مستبعدة من درج المحل ومش ظاهرة في الرئيسية — يعني فلوس مش محسوبة في أي خزنة.`,
    fix: 'راجع كل صف: إما تمسحه لو الحركة اتلغت، أو تعيد تسجيلها من الشاشة المختصة عشان الطرفين يتكتبوا مع بعض.',
    rows: orphans,
  }];
}

/**
 * (3) تقسيمة الدفع لازم تساوي المبلغ. لو اختلفت، كل شاشة بتقرا رقم مختلف
 * (واحدة بتاخد التقسيمة والتانية بتاخد الإجمالي).
 */
export function checkSplitConsistency(input: IntegrityInput): IntegrityIssue[] {
  const bad: { id: string; label: string; amount?: number }[] = [];
  input.orders.filter((o) => !o.is_deleted).forEach((o) => {
    const split = ALL_PAYMENT_KEYS.reduce((s, k) => s + (Number(o['paid_' + k]) || 0), 0);
    if (split === 0) return; // مفيش تقسيمة مسجّلة — مقبول للبيانات القديمة
    const refunded = (o.items || []).reduce((s: number, it: any) => s + (Number(it.refunded_amount) || 0), 0);
    // التقسيمة مابتتعدّلش مع المرتجع، فالمقارنة مع المدفوع + المرتجع.
    const expected = (Number(o.paid_amount) || 0) + refunded;
    if (Math.abs(split - expected) > 0.05) {
      bad.push({ id: String(o.id), label: `فاتورة #${o.id} — تقسيمة ${money(split)} مقابل ${money(expected)}`, amount: split - expected });
    }
  });
  if (bad.length === 0) return [];
  return [{
    id: 'split-mismatch',
    severity: 'warning',
    title: 'تقسيمة الدفع مش مطابقة للمبلغ',
    detail: `${bad.length} فاتورة مجموع تقسيمتها مختلف عن المدفوع + المرتجع. الشاشات اللي بتقرا التقسيمة هتدي رقم مختلف عن اللي بتقرا الإجمالي.`,
    fix: 'افتح الفاتورة وعدّل توزيع الدفع عشان المجموع يطابق المدفوع.',
    rows: bad.slice(0, 50),
  }];
}

/**
 * (4) المرتجع أكبر من قيمة الفاتورة، أو الكمية المرتجعة أكبر من المباعة.
 */
export function checkRefundSanity(input: IntegrityInput): IntegrityIssue[] {
  const bad: { id: string; label: string; amount?: number }[] = [];
  input.orders.filter((o) => !o.is_deleted).forEach((o) => {
    (o.items || []).forEach((it: any) => {
      const q = Number(it.quantity) || 0;
      const rq = Number(it.returned_quantity) || 0;
      if (rq > q + 0.001) {
        bad.push({ id: String(o.id), label: `فاتورة #${o.id} — «${it.name}» مرتجع ${rq} من ${q}`, amount: rq - q });
      }
    });
    const refunded = (o.items || []).reduce((s: number, it: any) => s + (Number(it.refunded_amount) || 0), 0);
    if (refunded > (Number(o.total) || 0) + 0.05) {
      bad.push({ id: String(o.id), label: `فاتورة #${o.id} — مرتجع ${money(refunded)} أكبر من الإجمالي ${money(o.total)}`, amount: refunded });
    }
  });
  if (bad.length === 0) return [];
  return [{
    id: 'refund-sanity',
    severity: 'error',
    title: 'مرتجع أكبر من الفاتورة',
    detail: `${bad.length} حالة المرتجع فيها أكبر من المباع. ده بيطلّع فلوس من الدرج أكتر من اللي دخل، وبيخلي رصيد الخزنة سالب من غير سبب ظاهر.`,
    fix: 'استخدم «إلغاء المرتجع» من صفحة الفواتير وأعد تسجيله بالكميات الصح.',
    rows: bad.slice(0, 50),
  }];
}

/** كل الفحوصات مع بعض، الأخطر الأول. */
export function runIntegrityChecks(input: IntegrityInput): IntegrityIssue[] {
  const all = [
    ...checkSalaryPairs(input),
    ...checkMainTreasuryPairs(input),
    ...checkRefundSanity(input),
    ...checkSplitConsistency(input),
  ];
  return all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
