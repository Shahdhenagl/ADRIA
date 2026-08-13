/**
 * تقسيمة المدفوع على فاتورة بيع — للعرض والطباعة.
 *
 * المشكلة اللي بتحلّها: في الاستبدال، تقسيمة الفاتورة (paid_cash/visa/...) بتفضل
 * **زي ما هي** عن قصد، لأنها متسجّلة في يوم البيع وأي تعديل فيها بيغيّر تقفيل
 * يوم مقفول. وفرق الاستبدال (اللي اتحصّل أو اترد وقت الاستبدال) بيتسجّل كصف
 * مالي مستقل بتاريخ الاستبدال — مش على الفاتورة.
 *
 * نتيجة كده إن الفاتورة المطبوعة كانت بتقول «الإجمالي ٣٠٦٠» و«طرق الدفع: كاش
 * ١٩٠٠» — أرقام مش متوافقة والعميل بيستغرب. الدوال دي بتجمع الاتنين للعرض بس،
 * من غير ما تلمس الأرقام المحاسبية.
 */

export interface ExchangeSettlement {
  at: string | null;
  /** موجب = اتحصّل من العميل، سالب = اترد له. */
  amount: number;
  split: Record<string, number>;
  method: string | null;
}

/** كل تسويات الاستبدال على الفاتورة بالترتيب (الأقدم الأول). */
export function exchangeSettlementsOf(order: any): ExchangeSettlement[] {
  const xd = order?.exchange_data;
  if (!xd) return [];
  const past = Array.isArray(xd.history) ? xd.history : [];
  return [...past, xd]
    .map((x: any) => ({
      at: x?.date || null,
      amount: Number(x?.diff) || 0,
      split: (x?.split && typeof x.split === 'object') ? x.split : {},
      method: x?.method || null,
    }))
    .filter((s) => Math.abs(s.amount) > 0.009);
}

/** إجمالي فروق الاستبدال (موجب = صافي محصّل من العميل). */
export function exchangeSettledTotal(order: any): number {
  return exchangeSettlementsOf(order).reduce((s, x) => s + x.amount, 0);
}

/**
 * تقسيمة المدفوع للعرض = تقسيمة يوم البيع + فروق الاستبدال بإشارتها.
 * مجموعها بيساوي اللي العميل دفعه فعلاً على الفاتورة دي.
 */
export function paidSplitForDisplay(order: any, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  keys.forEach((k) => { out[k] = Number(order?.['paid_' + k]) || 0; });
  exchangeSettlementsOf(order).forEach((x) => {
    const used = keys.filter((k) => Math.abs(Number(x.split?.[k]) || 0) > 0.009);
    if (used.length) {
      // التقسيمة بتتخزّن بقيم موجبة؛ الاتجاه في amount نفسه.
      const sign = x.amount >= 0 ? 1 : -1;
      used.forEach((k) => { out[k] = (out[k] || 0) + sign * (Number(x.split[k]) || 0); });
    } else {
      const k = (x.method && keys.includes(x.method)) ? x.method : (keys[0] || 'cash');
      out[k] = (out[k] || 0) + x.amount;
    }
  });
  return out;
}

/**
 * المدفوع الفعلي على الفاتورة للعرض.
 *
 * للفواتير المستبدلة بنحسبه من (تقسيمة البيع + فروق الاستبدال) لأن العمود
 * paid_amount في الصفوف القديمة كان بيتكتب = الإجمالي الجديد (شوف db/55)،
 * وده بيخفي أي مديونية. لغير المستبدلة بنستخدم paid_amount زي ما هو لأنه
 * بيتحدّث مع سداد الآجل.
 */
export function paidForDisplay(order: any, keys: string[]): number {
  if (!order?.exchange_data) return Number(order?.paid_amount) || 0;
  const splitPaid = keys.reduce((s, k) => s + (Number(order?.['paid_' + k]) || 0), 0);
  const computed = splitPaid + exchangeSettledTotal(order);
  // لو الفاتورة اتسدّد منها آجل بعد كده، paid_amount بيبقى أكبر — ناخد الأكبر.
  return Math.max(computed, 0);
}

export interface HeldPaymentBreakdown {
  deposit: number;
  later: number;
  depositSplit: Record<string, number>;
  laterSplit: Record<string, number>;
  depositDate: string | null;
}

/**
 * تفصيل فاتورة اتعملت من held invoice إلى دفعتين مستقلتين للعرض والطباعة.
 * paid_* في الفاتورة النهائية قد يحتوي العربون والباقي معًا محاسبيًا، لذلك
 * نستخدم held_deposit_* لفصل العربون دون تغيير أي قيد مالي محفوظ.
 */
export function heldPaymentBreakdown(order: any, keys: string[]): HeldPaymentBreakdown | null {
  const rawDeposit = Number(order?.held_deposit_amount) || 0;
  if (rawDeposit <= 0.009) return null;
  const allSplit = paidSplitForDisplay(order, keys);
  const depositSource = order?.held_deposit_split && typeof order.held_deposit_split === 'object'
    ? order.held_deposit_split
    : { cash: rawDeposit };
  const depositSplit: Record<string, number> = {};
  const laterSplit: Record<string, number> = {};
  keys.forEach((k) => {
    const dep = Math.max(0, Number(depositSource[k]) || 0);
    depositSplit[k] = dep;
    laterSplit[k] = (Number(allSplit[k]) || 0) - dep;
  });
  const deposit = Math.min(rawDeposit, keys.reduce((s, k) => s + (depositSplit[k] || 0), 0) || rawDeposit);
  const totalPaid = Math.max(0, paidForDisplay(order, keys));
  return {
    deposit,
    later: Math.max(0, totalPaid - deposit),
    depositSplit,
    laterSplit,
    depositDate: order?.held_deposit_date || null,
  };
}
