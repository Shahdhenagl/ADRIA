import type { PurchaseInvoice, StockIntake } from '../store/useStore';

/** تسمية عربية لمصدر قيد «مخزون بدون شراء». */
export const INTAKE_SOURCE_LABELS: Record<string, string> = {
  opening: 'رصيد افتتاحي',
  product_created: 'إضافة منتج بكمية',
  manual_edit: 'تعديل كمية يدوي',
  excel_import: 'استيراد Excel',
  stocktake: 'زيادة جرد',
  manual: 'قيد يدوي',
  // نقصان يدوي — بيتسجّل بكمية سالبة عشان المخزون ما يختفيش من غير أثر.
  manual_decrease: 'نقص كمية يدوي',
};

export const intakeSourceLabel = (s?: string) => INTAKE_SOURCE_LABELS[s || ''] || 'أخرى';

/** إجمالي قيمة ما دخل المخزون بدون فاتورة شراء (تراكمي). */
export function prepareStockIntakePayload(rows: Array<{ product_id: string; product_name?: string | null; quantity: number; unit_cost: number; source: string; note?: string | null }>) {
  return rows
    .map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name || '',
      quantity: Number(r.quantity) || 0,
      unit_cost: Number(r.unit_cost) || 0,
      source: r.source,
      note: r.note || null,
    }))
    .filter((r) => r.quantity !== 0)
    .map((r) => ({ ...r, total_value: r.quantity * r.unit_cost }));
}

export function totalIntakeValue(intakes: StockIntake[], productIds?: Set<string>): number {
  return intakes.reduce((s, i) => {
    if (productIds && !productIds.has(i.product_id)) return s;
    return s + (Number(i.total_value) || 0);
  }, 0);
}

/**
 * تقسيم قيمة المخزون الحالي بين «مشترى بفواتير» و«دخل بدون شراء».
 *
 * تكلفة المنتج في النظام متوسط مرجّح (average_purchase_price)، فالتقسيم بنفس المنطق:
 * نصيب كل مصدر من قيمة المخزون الحالي = نسبته من إجمالي الكميات اللي دخلت المنتج
 * (مشتريات + دخول بدون شراء). منتج مالوش أي قيد في السجل بتتحسب قيمته كلها «مشتراة».
 */
export function splitStockValueBySource(
  entries: Array<{ product_id: string; value: number }>,
  purchaseInvoices: PurchaseInvoice[],
  intakes: StockIntake[],
): { purchased: number; noPurchase: number } {
  const purchasedQty = new Map<string, number>();
  purchaseInvoices.forEach((inv) => {
    (inv.items || []).forEach((it) => {
      // مرتجعات الموردين بتتسجّل بكميات سالبة (db/46) فبتخصم لوحدها.
      purchasedQty.set(it.product_id, (purchasedQty.get(it.product_id) || 0) + (Number(it.quantity) || 0));
    });
  });

  // النقصان اليدوي بيتسجّل بكمية سالبة، فبيخصم من صافي الداخل بدون شراء — وده
  // المطلوب. الـ Math.max تحت بيمنع النسبة السالبة لو النقصان زاد عن الداخل.
  const intakeQty = new Map<string, number>();
  intakes.forEach((i) => {
    intakeQty.set(i.product_id, (intakeQty.get(i.product_id) || 0) + (Number(i.quantity) || 0));
  });

  let purchased = 0;
  let noPurchase = 0;
  entries.forEach(({ product_id, value }) => {
    const p = Math.max(0, purchasedQty.get(product_id) || 0);
    const n = Math.max(0, intakeQty.get(product_id) || 0);
    if (n <= 0) { purchased += value; return; }
    if (p <= 0) { noPurchase += value; return; }
    const share = n / (n + p);
    noPurchase += value * share;
    purchased += value * (1 - share);
  });

  return { purchased, noPurchase };
}
