import { describe, expect, it } from 'vitest';
import type { Employee, EmployeeAttendance, EmployeeLeave } from '../store/useStore';
import { buildAutomaticAbsenceRecords } from './employeeAbsence';

const employee = (patch: Partial<Employee> = {}) => ({
  id: 'emp-1',
  name: 'Test employee',
  monthly_salary: 3000,
  monthly_leave_days: 2,
  hire_date: '2026-01-01',
  created_at: '2026-01-01T00:00:00Z',
  is_active: true,
  friday_is_off: true,
  ...patch,
}) as Employee;

const leave = (patch: Partial<EmployeeLeave> = {}) => ({
  id: 'leave-1',
  employee_id: 'emp-1',
  start_date: '2026-01-05',
  end_date: '2026-01-05',
  days_count: 1,
  leave_type: 'paid' as const,
  deduction_amount: 0,
  month: '2026-01',
  note: '',
  created_at: '',
  ...patch,
}) as EmployeeLeave;

const attendance = (patch: Partial<EmployeeAttendance> = {}) => ({
  id: 'attendance-1',
  employee_id: 'emp-1',
  date: '2026-01-05',
  check_in: '2026-01-05T08:00:00Z',
  check_out: null,
  late_minutes: 0,
  deduction_amount: 0,
  month: '2026-01',
  created_at: '',
  ...patch,
}) as EmployeeAttendance;

describe('automatic employee absence allocation', () => {
  it('uses the remaining monthly leave balance before charging full absence days', () => {
    const rows = buildAutomaticAbsenceRecords({
      employees: [employee()],
      attendance: [],
      leaves: [leave()],
      trackingFrom: '2026-01-06',
      throughDate: '2026-01-08',
    });

    expect(rows.map((row) => [row.date, row.absence_leave_type, row.absence_paid_days, row.deduction_amount])).toEqual([
      ['2026-01-06', 'paid', 1, 0],
      ['2026-01-07', 'unpaid', 0, 100],
      ['2026-01-08', 'unpaid', 0, 100],
    ]);
  });

  it('splits a day when only a fractional leave balance remains', () => {
    const rows = buildAutomaticAbsenceRecords({
      employees: [employee({ monthly_leave_days: 1.5 })],
      attendance: [],
      leaves: [leave({ days_count: 1.0 })],
      trackingFrom: '2026-01-06',
      throughDate: '2026-01-06',
    });

    expect(rows[0]).toMatchObject({
      absence_leave_type: 'mixed',
      absence_paid_days: 0.5,
      deduction_amount: 50,
    });
  });

  it('does not create absence on an approved leave, existing attendance, Friday off, or before tracking starts', () => {
    const rows = buildAutomaticAbsenceRecords({
      employees: [employee()],
      attendance: [attendance({ date: '2026-01-07' })],
      leaves: [
        leave({ id: 'leave-6', start_date: '2026-01-06', end_date: '2026-01-06', month: '2026-01' }),
      ],
      trackingFrom: '2026-01-07',
      throughDate: '2026-01-09', // Friday is the employee's weekly off.
    });

    expect(rows.map((row) => row.date)).toEqual(['2026-01-08']);
  });

  it('resets the leave allowance at the new month and skips inactive employees', () => {
    const rows = buildAutomaticAbsenceRecords({
      employees: [employee(), employee({ id: 'inactive', is_active: false })],
      attendance: [],
      leaves: [leave({ start_date: '2025-12-31', end_date: '2025-12-31', month: '2025-12', days_count: 2 })],
      trackingFrom: '2026-01-01',
      throughDate: '2026-01-03',
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.absence_leave_type === 'paid')).toBe(true);
  });
});
