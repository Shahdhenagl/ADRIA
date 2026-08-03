/**
 * ربط الطرفين في الكتابة المزدوجة للرواتب/السلف.
 *
 * كل راتب/سلفة بيتكتب في مكانين: صف في `employee_transactions` (المستحق على
 * الموظف) + صف مصروف بفئة «رواتب» (الفلوس الخارجة من الخزنة). الحذف والتعديل
 * من أي ناحية لازم يلاقي الناحية التانية، وإلا الطرف الباقي بيفضل يتيم:
 * سلفة اتلغت من الخزنة وفضلت متخصومة من راتب الموظف.
 *
 * الدوال هنا **نقية** ومتحطّة في utils مش في الستور عن قصد — عشان تتغطّى
 * بالتستات من غير ما نشغّل الستور كله (اللي بيلمس sessionStorage وقت التحميل).
 */

const PAY_KEYS = ['cash', 'visa', 'wallet', 'instapay', 'method5', 'method6'] as const;

const sameDay = (a: any, b: any) =>
  new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

const sameSplit = (a: any, b: any) =>
  PAY_KEYS.every((k) => Math.abs(Number(a['paid_' + k]) || 0) === Math.abs(Number(b['paid_' + k]) || 0));

/** من صف الموظف → صف المصروف المقابل. */
export const findLinkedSalaryExpense = (expenses: any[], tx: any): any | undefined => {
  if (!tx) return undefined;
  // (أ) الربط الصريح (db/49) — الأدق، وبيشتغل حتى لو التاريخ أو المبلغ اتعدّل.
  const linked = expenses.find((e) => e.employee_transaction_id && e.employee_transaction_id === tx.id);
  if (linked) return linked;
  // (ب) صفوف قبل db/49: مطابقة بالتاريخ + المبلغ + التقسيمة.
  return expenses.find((e) => {
    // مصروف مربوط بمعاملة تانية ماينفعش يتاخد — وإلا الحذف بيمسح مصروف معاملة
    // سليمة ويسيب اليتيم مكانه.
    if (e.employee_transaction_id) return false;
    return e.category === 'رواتب'
      && sameDay(e.date || e.created_at, tx.created_at)
      && Math.abs(Number(e.amount) || 0) === Math.abs(Number(tx.amount) || 0)
      && sameSplit(e, tx);
  });
};

/** من صف المصروف → صف الموظف المقابل (الاتجاه اللي كان ناقص). */
export const findLinkedEmployeeTx = (txs: any[], expense: any): any | undefined => {
  if (!expense || expense.category !== 'رواتب') return undefined;
  if (expense.employee_transaction_id) {
    return txs.find((t) => t.id === expense.employee_transaction_id);
  }
  return txs.find((t) =>
    sameDay(t.created_at, expense.date || expense.created_at)
    && Math.abs(Number(t.amount) || 0) === Math.abs(Number(expense.amount) || 0)
    && sameSplit(t, expense));
};
