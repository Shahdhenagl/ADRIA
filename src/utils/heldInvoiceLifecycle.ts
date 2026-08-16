import type { HeldInvoice } from '../store/useStore';

/**
 * الطلب الأونلاين الذي تم دفعه قبل التسليم لا يُنشئ فاتورة بيع جديدة عند
 * تغيير حالته إلى delivered. حالة money_pending هي الاستثناء: معناها أن
 * العميل دفع لشركة الشحن لكن التحصيل لم يدخل خزنة المحل بعد.
 */
export const isFullyPrepaidOnlineHeld = (
  held: Pick<HeldInvoice, 'kind' | 'status' | 'total' | 'deposit' | 'discount_amount'>,
): boolean => {
  if (held.kind !== 'online') return false;
  if (held.status === 'money_pending') return false;
  const total = Math.max(0, (Number(held.total) || 0) - (Number(held.discount_amount) || 0));
  const deposit = Number(held.deposit) || 0;
  return held.status === 'shipped' || deposit >= total - 0.01;
};
