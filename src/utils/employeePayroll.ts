export interface EmployeePayrollTransaction {
  id?: string | null;
  type?: 'salary' | 'advance' | 'incentive' | string;
  amount?: number | null;
  /** المبلغ المسدّد من السلفة داخل صرف الراتب؛ null في السجلات القديمة. */
  advance_repayment?: number | null;
  deductions?: number | null;
  note?: string | null;
  /** وقت القيد المحاسبي/تاريخ العمل. */
  created_at?: string | null;
  /** وقت إدخال الصف فعلياً؛ يميّز الحركات ذات created_at واحد. */
  recorded_at?: string | null;
}

const amountOf = (t: EmployeePayrollTransaction): number => Math.max(0, Number(t.amount) || 0);

const timestampOf = (value?: string | null): number => {
  if (!value) return Number.NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
};

/**
 * ترتيب ثابت لحركات الموظف: وقت القيد أولاً، ثم وقت الإدخال الحقيقي عند توفره.
 * السجلات القديمة لا تملك recorded_at؛ لذلك يُستخدم id كفاصل ثابت، مع العلم
 * أن ترتيب السجلات القديمة المتساوية في الوقت لا يمكن استنتاجه تاريخياً.
 */
export const compareEmployeeTransactionOrder = (
  a: EmployeePayrollTransaction,
  b: EmployeePayrollTransaction,
): number => {
  const createdA = timestampOf(a.created_at);
  const createdB = timestampOf(b.created_at);
  const normalizedCreatedA = Number.isFinite(createdA) ? createdA : 0;
  const normalizedCreatedB = Number.isFinite(createdB) ? createdB : 0;
  if (normalizedCreatedA !== normalizedCreatedB) return normalizedCreatedA - normalizedCreatedB;

  const recordedA = timestampOf(a.recorded_at);
  const recordedB = timestampOf(b.recorded_at);
  const hasRecordedA = Number.isFinite(recordedA);
  const hasRecordedB = Number.isFinite(recordedB);
  if (hasRecordedA && hasRecordedB && recordedA !== recordedB) return recordedA - recordedB;
  // السجلات القديمة ذات recorded_at الفارغ تسبق السجلات الجديدة الموثّقة
  // عندما يتساوى created_at؛ ترتيب أحداثها الداخلية يظل غير محسوم.
  if (hasRecordedA !== hasRecordedB) return hasRecordedA ? 1 : -1;

  return String(a.id || '').localeCompare(String(b.id || ''));
};

/** True when legacy salary/advance rows share a timestamp with no recoverable order. */
export const hasAmbiguousAdvanceTransactionOrder = (
  transactions: EmployeePayrollTransaction[],
): boolean => {
  const groups = new Map<number, EmployeePayrollTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.type !== 'advance' && transaction.type !== 'salary') continue;
    const createdAt = timestampOf(transaction.created_at);
    if (!Number.isFinite(createdAt)) continue;
    const group = groups.get(createdAt) || [];
    group.push(transaction);
    groups.set(createdAt, group);
  }

  return [...groups.values()].some((group) => {
    if (group.length < 2) return false;
    const recordedTimes = group.map((transaction) => timestampOf(transaction.recorded_at));
    return recordedTimes.some((time) => !Number.isFinite(time))
      || new Set(recordedTimes).size !== recordedTimes.length;
  });
};

/** إجمالي السلف المصروفة. */
export const advanceTotalOf = (transactions: EmployeePayrollTransaction[]): number =>
  transactions.filter((t) => t.type === 'advance').reduce((sum, t) => sum + amountOf(t), 0);

/**
 * رصيد السلف المتبقي بطريقة FIFO. السجلات القديمة التي لا تحتوي
 * advance_repayment تحافظ على سلوكها السابق؛ أما السجلات الجديدة فتسدد فقط
 * المبلغ الذي اختاره المدير صراحةً من خانة «سداد سلفة من الراتب».
 */
export const advanceBalanceOf = (transactions: EmployeePayrollTransaction[]): number => {
  const ordered = [...transactions].sort(compareEmployeeTransactionOrder);
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
