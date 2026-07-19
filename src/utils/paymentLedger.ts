/**
 * كشف حساب لكل وسيلة دفع: يحوّل كل الحركات المالية (فواتير بيع، سداد آجل،
 * مرتجعات، مصاريف، تحويلات بين الوسائل، فواتير شراء) إلى بنود موزّعة على
 * الوسائل — كل بند يوضّح نصيب الوسيلة (وارد/صادر) حتى في الفواتير المقسّمة.
 *
 * الإشارة: inAmount = دخل للوسيلة (مدين/زيادة رصيد)، outAmount = خرج منها.
 */
import { ALL_PAYMENT_KEYS, splitFromRow, primaryMethod, type PaymentKey } from './paymentMethods';
import { calculateCashRefunded } from './returns';
import { isMainTreasuryExpense, isMainTreasuryPurchase } from './treasury';

export type LedgerKind = 'sale' | 'payment' | 'return' | 'expense' | 'purchase' | 'purchase_return' | 'transfer';

export interface LedgerEntry {
  id: string;
  date: string;
  method: PaymentKey;
  desc: string;
  inAmount: number;   // وارد للوسيلة
  outAmount: number;  // صادر من الوسيلة
  kind: LedgerKind;
}

const shortId = (id: any) => String(id ?? '').slice(-6);

const splitsSumAbs = (row: any) =>
  ALL_PAYMENT_KEYS.reduce((s, k) => s + Math.abs(Number(row?.[`paid_${k}`]) || 0), 0);

/**
 * نصيب وسيلة معيّنة من مبلغ صف (بقيمة موجبة). لو الصف فيه تقسيم على الوسائل
 * نأخذ عمود الوسيلة (مع معايرته على إجمالي المدفوع عند الاختلاف). لو مفيش
 * تقسيم مسجّل (بيانات قديمة) نحمّل كامل المبلغ على الوسيلة الأساسية.
 */
function shareOf(row: any, method: PaymentKey, totalPaid: number): number {
  const sum = splitsSumAbs(row);
  if (sum > 0) {
    let v = Math.abs(Number(row[`paid_${method}`]) || 0);
    const tp = Math.abs(totalPaid);
    if (tp > 0 && Math.abs(sum - tp) > 0.01) v = v * (tp / sum);
    return v;
  }
  const pm = (ALL_PAYMENT_KEYS as readonly string[]).includes(row?.payment_method)
    ? (row.payment_method as PaymentKey)
    : 'cash';
  return pm === method ? Math.abs(totalPaid) : 0;
}

export function buildPaymentLedger(orders: any[], expenses: any[], purchases: any[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const active = (orders || []).filter((o) => !o.is_deleted);

  // مدفوعات الآجل لكل فاتورة — لصافي الفواتير القديمة اللي مالهاش تقسيم مسجّل.
  const debtByInvoice = new Map<string, number>();
  for (const o of active) {
    if (o.type === 'payment' && o.notes?.includes('سداد أجل للفاتورة رقم #')) {
      const m = o.notes.match(/سداد أجل للفاتورة رقم #([\w-]+)/);
      if (m?.[1]) debtByInvoice.set(m[1], (debtByInvoice.get(m[1]) || 0) + (o.paid_amount || 0));
    }
  }

  for (const o of active) {
    // المبلغ المحصّل فعلياً في هذا الصف وتوزيعه على الوسائل
    let paid: number;
    if (o.type === 'payment') {
      paid = o.paid_amount || 0;
    } else {
      const sum = splitsSumAbs(o);
      const refunded = calculateCashRefunded(o);
      // أعمدة التقسيم في البيع لا تتغيّر عند سداد الآجل، فنستخدمها مباشرة؛
      // وإلا نطرح مدفوعات الآجل (المسجّلة كأوردرات payment مستقلة) لتفادي العدّ مرتين.
      paid = sum > 0 ? sum : Math.max(0, (o.paid_amount || 0) - (debtByInvoice.get(o.id) || 0) + refunded);
    }

    if (paid > 0.001) {
      for (const k of ALL_PAYMENT_KEYS) {
        const amt = shareOf(o, k, paid);
        if (amt > 0.001) {
          const who = o.customer?.name ? ` — ${o.customer.name}` : '';
          entries.push({
            id: `${o.id}:${k}`,
            date: o.date,
            method: k,
            desc: o.type === 'payment' ? `سداد آجل${who}` : `فاتورة بيع #${shortId(o.id)}${who}`,
            inAmount: amt,
            outAmount: 0,
            kind: o.type === 'payment' ? 'payment' : 'sale',
          });
        }
      }
    }

    // مرتجع / استرداد نقدي (صادر) على وسيلة الاسترداد
    const refunded = calculateCashRefunded(o);
    if (refunded > 0.001) {
      const rm = (o.refund_method && (ALL_PAYMENT_KEYS as readonly string[]).includes(o.refund_method))
        ? (o.refund_method as PaymentKey)
        : primaryMethod(splitFromRow(o));
      entries.push({
        id: `${o.id}:refund`,
        date: o.date,
        method: rm,
        desc: `مرتجع فاتورة #${shortId(o.id)}`,
        inAmount: 0,
        outAmount: refunded,
        kind: 'return',
      });
    }
  }

  for (const e of expenses || []) {
    if (isMainTreasuryExpense(e)) continue;
    const sum = splitsSumAbs(e);
    const isTransfer = Math.abs(e.amount || 0) < 0.001 && sum > 0;
    if (isTransfer) {
      for (const k of ALL_PAYMENT_KEYS) {
        const raw = Number(e[`paid_${k}`]) || 0;
        if (Math.abs(raw) > 0.001) {
          entries.push({
            id: `${e.id}:${k}`,
            date: e.date,
            method: k,
            desc: e.note || 'تحويل رصيد',
            inAmount: raw > 0 ? raw : 0,
            outAmount: raw < 0 ? -raw : 0,
            kind: 'transfer',
          });
        }
      }
      continue;
    }
    const isIncome = (e.amount || 0) < 0; // مصروف بقيمة سالبة = دخل
    const total = Math.abs(e.amount || 0);
    if (total <= 0.001) continue;
    for (const k of ALL_PAYMENT_KEYS) {
      const amt = shareOf(e, k, total);
      if (amt > 0.001) {
        entries.push({
          id: `${e.id}:${k}`,
          date: e.date,
          method: k,
          desc: e.category ? `${e.category}${e.note ? ` — ${e.note}` : ''}` : (e.note || 'مصروف'),
          inAmount: isIncome ? amt : 0,
          outAmount: isIncome ? 0 : amt,
          kind: 'expense',
        });
      }
    }
  }

  for (const inv of purchases || []) {
    if (isMainTreasuryPurchase(inv)) continue;
    const raw = inv.paid_amount || 0;
    if (Math.abs(raw) <= 0.001) continue;
    // paid_amount سالب = فلوس داخلة (مرتجع مورد أو تحصيل من مورد)، مش صادر.
    // shareOf بترجّع قيمة مطلقة، فالإشارة بتتحدد من هنا.
    const isInflow = raw < 0;
    const total = Math.abs(raw);
    const isReturn = Boolean(inv.source_invoice_id);
    for (const k of ALL_PAYMENT_KEYS) {
      const amt = shareOf(inv, k, total);
      if (amt > 0.001) {
        entries.push({
          id: `${inv.id}:${k}`,
          date: inv.created_at,
          method: k,
          desc: isReturn
            ? `مرتجع مورد${inv.invoice_number ? ` #${inv.invoice_number}` : ''}`
            : isInflow
              ? `تحصيل من مورد${inv.invoice_number ? ` #${inv.invoice_number}` : ''}`
              : `فاتورة شراء${inv.invoice_number ? ` #${inv.invoice_number}` : ''}`,
          inAmount: isInflow ? amt : 0,
          outAmount: isInflow ? 0 : amt,
          kind: isReturn ? 'purchase_return' : 'purchase',
        });
      }
    }
  }

  return entries;
}
