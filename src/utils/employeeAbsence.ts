import type { Employee, EmployeeAttendance, EmployeeLeave } from '../store/useStore';
import { shiftForDate } from './shifts';

export type AutoAbsenceRecord = Omit<EmployeeAttendance, 'id' | 'created_at'>;

export function previousCalendarDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`;
}

const addCalendarDay = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};

const leaveCoversDate = (leave: EmployeeLeave, date: string): boolean =>
  date >= leave.start_date && date <= leave.end_date;

/**
 * Builds absence rows for completed business dates with no attendance/leave.
 * The caller supplies `throughDate` as the last closed business date, so today's
 * unfinished shift can never be charged. Each date consumes the remaining
 * monthly allowance first; only the uncovered fraction becomes a daily salary
 * deduction. Existing attendance rows make the operation idempotent.
 */
export function buildAutomaticAbsenceRecords(args: {
  employees: Employee[];
  attendance: EmployeeAttendance[];
  leaves: EmployeeLeave[];
  trackingFrom: string;
  throughDate: string;
}): AutoAbsenceRecord[] {
  const { employees, attendance, leaves, trackingFrom, throughDate } = args;
  if (!trackingFrom || throughDate < trackingFrom) return [];

  const records: AutoAbsenceRecord[] = [];
  for (const employee of employees) {
    if (employee.is_active === false) continue;
    const hiredOn = employee.hire_date || employee.created_at?.slice(0, 10) || trackingFrom;
    const firstDate = hiredOn > trackingFrom ? hiredOn : trackingFrom;
    if (firstDate > throughDate) continue;

    const employeeLeaves = leaves.filter((leave) => leave.employee_id === employee.id);
    const employeeAttendance = attendance
      .filter((row) => row.employee_id === employee.id)
      .map((row) => ({ ...row }));
    let date = firstDate;

    while (date <= throughDate) {
      const shift = shiftForDate(employee, date);
      const month = date.slice(0, 7);
      const alreadyLogged = employeeAttendance.some((row) => row.date === date);
      const approvedLeave = employeeLeaves.some((leave) => leaveCoversDate(leave, date));
      if (!alreadyLogged && !approvedLeave && !(shift.isFriday && shift.isWeeklyOff)) {
        const usedPaidLeave = employeeLeaves
          .filter((leave) => leave.leave_type === 'paid' && leave.month === month)
          .reduce((sum, leave) => sum + Math.max(0, Number(leave.days_count) || 0), 0);
        const usedPaidAbsences = employeeAttendance
          .filter((row) =>
            row.month === month
            && row.absence_leave_type != null
            && !employeeLeaves.some((leave) => leaveCoversDate(leave, row.date)),
          )
          .reduce((sum, row) => sum + Math.max(
            0,
            Number(row.absence_paid_days ?? (row.absence_leave_type === 'paid' ? 1 : 0)) || 0,
          ), 0);
        const monthlyQuota = Math.max(0, Number(employee.monthly_leave_days ?? 4) || 0);
        const paidDays = Math.round(Math.min(1, Math.max(0, monthlyQuota - usedPaidLeave - usedPaidAbsences)) * 100) / 100;
        const unpaidDays = Math.max(0, 1 - paidDays);
        const dailyRate = Math.max(0, Number(employee.monthly_salary) || 0) / 30;
        const absenceLeaveType: NonNullable<EmployeeAttendance['absence_leave_type']> =
          paidDays >= 1 ? 'paid' : paidDays <= 0 ? 'unpaid' : 'mixed';

        const record: AutoAbsenceRecord = {
          employee_id: employee.id,
          date,
          check_in: null,
          check_out: null,
          shift_start: shift.start || null,
          late_minutes: 0,
          deduction_amount: Math.round(dailyRate * unpaidDays * 100) / 100,
          month,
          note: 'غياب تلقائي — لا يوجد تسجيل حضور بعد إغلاق اليوم المحاسبي',
          absence_leave_type: absenceLeaveType,
          absence_paid_days: paidDays,
        };
        records.push(record);
        employeeAttendance.push({
          ...record,
          id: `pending-${employee.id}-${date}`,
          created_at: '',
        } as EmployeeAttendance);
      }
      date = addCalendarDay(date);
    }
  }

  return records;
}
