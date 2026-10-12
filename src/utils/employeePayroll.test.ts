import { describe, expect, it } from 'vitest';
import {
  advanceHistoryThroughMonthOf,
  advanceBalanceOf,
  hasAmbiguousAdvanceTransactionOrder,
  salaryRemainingOf,
} from './employeePayroll';

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

  it('subtracts only an explicit advance repayment from a new salary', () => {
    const tx = [
      { type: 'advance' as const, amount: 1155, created_at: '2026-09-01T12:00:00Z' },
      { type: 'salary' as const, amount: 4821, advance_repayment: 1155, created_at: '2026-10-01T12:00:00Z' },
    ];
    expect(advanceBalanceOf(tx)).toBe(0);
    expect(salaryRemainingOf({ monthlySalary: 6000, paidSalary: 4821, advanceRepayments: 1155 })).toBe(24);
  });

  it('validates an edited salary repayment against the balance before that salary was saved', () => {
    const transactions = [
      { id: 'advance-sep', type: 'advance' as const, amount: 5000, month: '2026-09' },
      { id: 'salary-sep', type: 'salary' as const, amount: 3000, advance_repayment: 3000, month: '2026-09' },
    ];

    expect(advanceBalanceOf(transactions)).toBe(2000);
    const balanceBeforeEdit = advanceBalanceOf(advanceHistoryThroughMonthOf(transactions, '2026-09', 'salary-sep'));
    expect(balanceBeforeEdit).toBe(5000);
    expect(3000).toBeLessThanOrEqual(balanceBeforeEdit);
  });

  it('uses actual recorded order when a salary and an advance share the same accounting timestamp', () => {
    const priorAdvance = {
      id: 'prior', type: 'advance' as const, amount: 3130,
      created_at: '2026-07-31T12:00:00Z', recorded_at: '2026-07-31T12:01:00Z',
    };
    const salaryFirst = {
      id: 'salary', type: 'salary' as const, amount: 4300,
      created_at: '2026-08-01T12:00:00Z', recorded_at: '2026-08-01T12:00:01Z',
    };
    const advanceSecond = {
      id: 'advance', type: 'advance' as const, amount: 5000,
      created_at: '2026-08-01T12:00:00Z', recorded_at: '2026-08-01T12:00:02Z',
    };

    expect(advanceBalanceOf([advanceSecond, salaryFirst, priorAdvance])).toBe(5000);
    expect(advanceBalanceOf([priorAdvance, salaryFirst, advanceSecond])).toBe(5000);
    expect(hasAmbiguousAdvanceTransactionOrder([salaryFirst, advanceSecond])).toBe(false);
  });

  it('marks legacy same-time rows ambiguous but keeps their display order deterministic', () => {
    const priorAdvance = {
      id: 'prior', type: 'advance' as const, amount: 3130,
      created_at: '2026-07-31T12:00:00Z',
    };
    const salary = {
      id: 'c03a2ed9', type: 'salary' as const, amount: 4300,
      created_at: '2026-08-01T12:00:00Z',
    };
    const advance = {
      id: '00cef974', type: 'advance' as const, amount: 5000,
      created_at: '2026-08-01T12:00:00Z',
    };

    expect(advanceBalanceOf([salary, advance, priorAdvance])).toBe(3830);
    expect(advanceBalanceOf([priorAdvance, advance, salary])).toBe(3830);
    expect(hasAmbiguousAdvanceTransactionOrder([salary, advance])).toBe(true);
  });
});
