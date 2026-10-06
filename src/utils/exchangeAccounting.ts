/**
 * فرق الاستبدال المحاسبي يقارن إجمالي الفاتورة النهائي قبل/بعد الاستبدال.
 * لا نقارنه بإجمالي أسعار الأصناف الخام، لأن خصم الفاتورة إجمالي وليس خصم صنف.
 * موجب = تحصيل من العميل، سالب = رد للعميل.
 */
export const exchangeSettlementAmount = (oldInvoiceTotal: number, newInvoiceTotal: number): number =>
  Math.round(((Number(newInvoiceTotal) || 0) - (Number(oldInvoiceTotal) || 0)) * 100) / 100;
