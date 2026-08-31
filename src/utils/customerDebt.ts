import { calculateOrderReturnValue } from './returns';

const PAYMENT_KEYS = ['cash', 'visa', 'wallet', 'instapay', 'method5', 'method6'] as const;

const splitPaidOf = (row: any) => PAYMENT_KEYS.reduce((s, k) => s + Math.abs(Number(row?.[`paid_${k}`]) || 0), 0);

const paymentReferenceOf = (row: any) => {
  const text = String(row?.notes || '');
  const match = text.match(/سداد\s+[آأ]?جل\s+للفواتورة\s+#([\w-]+)/i);
  return match?.[1] || null;
};

/**
 * الرصيد الحالي الفعلي لآجل العملاء.
 * يبدأ من كل فاتورة بيع غير محذوفة، ثم يخصم الدفعات المرتبطة برقم فاتورة
 * أو يوزع الدفعات العامة على أقدم مديونية أولاً. دفعات الفاتورة نفسها لا تُضاف مرة ثانية.
 */
export function calculateCustomerDebt(orders: any[]) {
  const sales = (orders || [])
    .filter(o => !o.is_deleted && o.type === 'sale')
    .map(o => {
      const total = Math.max(0, Number(o.total) || 0) - calculateOrderReturnValue(o);
      const paid = Math.max(Number(o.paid_amount) || 0, splitPaidOf(o));
      return { id: String(o.id), due: Math.max(0, total - paid), date: new Date(o.date || o.created_at || 0).getTime() };
    })
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));

  const byId = new Map(sales.map(s => [s.id, s]));
  const generalPayments: number[] = [];
  for (const payment of (orders || []).filter(o => !o.is_deleted && o.type === 'payment')) {
    const amount = Math.max(0, Number(payment.paid_amount) || 0);
    if (!amount) continue;
    const ref = paymentReferenceOf(payment);
    const target = ref ? byId.get(ref) : null;
    if (target) {
      target.due = Math.max(0, target.due - amount);
    } else if (!ref) {
      generalPayments.push(amount);
    }
  }

  for (const amount of generalPayments) {
    let remaining = amount;
    for (const sale of sales) {
      if (remaining <= 0) break;
      const applied = Math.min(sale.due, remaining);
      sale.due -= applied;
      remaining -= applied;
    }
  }
  return sales.reduce((sum, sale) => sum + sale.due, 0);
}
