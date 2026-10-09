export interface EmployeePayrollTransaction {
  type?: 'salary' | 'advance' | 'incentive' | string;
  amount?: number | null;
  /** المبلغ المسدّد من السلفة داخل صرف الراتب؛ null في السجلات القديمة. */
  advance_repayment?: number | null;
  deductions?: number | null;
  note?: string | null;
  created_at?: string | null;
}

const amountOf = (t: EmployeePayrollTransaction): number => Math.max(0, Number(t.amount) || 0);

/** إجمالي السلف المصروفة. */
export const advanceTotalOf = (transactions: EmployeePayrollTransaction[]): number =>
  transactions.filter((t) => t.type === 'advance').reduce((sum, t) => sum + amountOf(t), 0);

/**
 * رصيد السلف المتبقي بطريقة FIFO. السجلات القديمة التي لا تحتوي
 * advance_repayment تحافظ على سلوكها السابق؛ أما السجلات الجديدة فتسدد فقط
 * المبلغ الذي اختاره المدير صراحةً من خانة «سداد سلفة من الراتب».
 */
export const advanceBalanceOf = (transactions: EmployeePayrollTransaction[]): number => {
  const ordered = [...transactions].sort((a, b) => {
    const at = new Date(a.created_at || 0).getTime();
    const bt = new Date(b.created_at || 0).getTime();
    return at - bt;
  });
  let balance = 0;
  for (const t of ordered) {
    if (t.type === 'advance') balance += amountOf(t);
    else if (t.type === 'salary') {
      const repayment = t.advance_repayment == null
        ? amountOf(t)
        : Math.max(0, Number(t.advance_repayment) || 0);
      balance = Math.max(0, balance - repayment);
    }
  }
  return Math.round(balance * 100) / 100;
};

/**
 * صافي الراتب المتاح للصرف بعد كل البنود، ومنها سداد السلفة المختار صراحةً.
 */
export const salaryRemainingOf = (args: {
  monthlySalary: number;
  bonuses?: number;
  paidSalary?: number;
  deductions?: number;
  advanceRepayments?: number;
}): number => Math.max(
  0,
  (Number(args.monthlySalary) || 0)
    + (Number(args.bonuses) || 0)
    - (Number(args.paidSalary) || 0)
    - (Number(args.deductions) || 0)
    - (Number(args.advanceRepayments) || 0),
);
