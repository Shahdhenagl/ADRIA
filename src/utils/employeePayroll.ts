export interface EmployeePayrollTransaction {
  type?: 'salary' | 'advance' | 'incentive' | string;
  amount?: number | null;
  deductions?: number | null;
  note?: string | null;
  created_at?: string | null;
}

const amountOf = (t: EmployeePayrollTransaction): number => Math.max(0, Number(t.amount) || 0);

/** إجمالي السلف المصروفة. */
export const advanceTotalOf = (transactions: EmployeePayrollTransaction[]): number =>
  transactions.filter((t) => t.type === 'advance').reduce((sum, t) => sum + amountOf(t), 0);

/**
 * رصيد السلف المتبقي بطريقة FIFO: كل راتب مصروف بعد السلفة يسدد أقدم
 * سلفة قائمة، ولا يُخصم من راتب الشهر نفسه مرة ثانية. مثال: سلفة 5000
 * ثم راتب مصروف 3000 = رصيد سلفة 2000، والراتب التالي يظل قابلاً للصرف.
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
    else if (t.type === 'salary') balance = Math.max(0, balance - amountOf(t));
  }
  return Math.round(balance * 100) / 100;
};

/**
 * صافي الراتب المتاح للصرف في الشهر: الراتب + المكافآت − الرواتب المصروفة
 * − خصومات الراتب. السلفة تظهر كرصد مستقل، ولا تُطرح مرة ثانية من الراتب.
 */
export const salaryRemainingOf = (args: {
  monthlySalary: number;
  bonuses?: number;
  paidSalary?: number;
  deductions?: number;
}): number => Math.max(
  0,
  (Number(args.monthlySalary) || 0)
    + (Number(args.bonuses) || 0)
    - (Number(args.paidSalary) || 0)
    - (Number(args.deductions) || 0),
);
