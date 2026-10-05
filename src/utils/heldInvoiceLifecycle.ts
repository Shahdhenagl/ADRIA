import type { HeldInvoice } from '../store/useStore';

/** صافي قيمة الحجز بعد الخصم، ولا يمكن أن يكون سالباً. */
export const heldNetTotal = (
  held: { total?: number | null; discount_amount?: number | null },
): number => Math.max(0, (Number(held.total) || 0) - (Number(held.discount_amount) || 0));

/** المبلغ المتبقي على العميل بعد العربون، بعد احتساب الخصم. */
export const heldRemaining = (
  held: { total?: number | null; discount_amount?: number | null; deposit?: number | null },
): number => Math.max(0, heldNetTotal(held) - (Number(held.deposit) || 0));

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
  const total = heldNetTotal(held);
  const deposit = Number(held.deposit) || 0;
  return held.status === 'shipped' || deposit >= total - 0.01;
};
