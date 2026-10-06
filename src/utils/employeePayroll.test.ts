import { describe, expect, it } from 'vitest';
import { advanceBalanceOf, salaryRemainingOf } from './employeePayroll';

describe('employee payroll and advances', () => {
  it('keeps 2000 loan balance after a 5000 advance and 3000 salary payment', () => {
    const tx = [
      { type: 'advance' as const, amount: 5000, month: '2026-08', created_at: '2026-08-01T12:00:00Z' },
      { type: 'salary' as const, amount: 3000, month: '2026-08', created_at: '2026-09-01T12:00:00Z' },
    ];
    expect(advanceBalanceOf(tx)).toBe(2000);
  });

  it('does not block the next salary because of an outstanding advance', () => {
    expect(salaryRemainingOf({ monthlySalary: 6000, paidSalary: 3000, deductions: 0 })).toBe(3000);
  });
});
