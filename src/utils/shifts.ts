import type { Employee } from '../store/useStore';

/**
 * شفت الموظف في يوم معيّن (db/60).
 * الجمعة ليها شفت مستقل لكل موظف؛ لو مش متحدد بيرجع للشفت العادي.
 * friday_is_off = الجمعة راحة أسبوعية (مفيش دوام، وبالتالي مفيش تأخير ولا خصم).
 */
export function shiftForDate(emp: Employee, dateStr: string): {
  start?: string;
  end?: string;
  isFriday: boolean;
  isWeeklyOff: boolean;
} {
  const isFriday = new Date(`${dateStr}T00:00:00`).getDay() === 5;
  if (!isFriday) {
    return { start: emp.shift_start || undefined, end: emp.shift_end || undefined, isFriday: false, isWeeklyOff: false };
  }
  return {
    start: (emp.friday_shift_start || emp.shift_start) || undefined,
    end: (emp.friday_shift_end || emp.shift_end) || undefined,
    isFriday: true,
    isWeeklyOff: !!emp.friday_is_off,
  };
}

/** 'HH:MM' → دقائق من بداية اليوم. */
const toMinutes = (t?: string) => {
  if (!t) return null;
  const [h, m] = t.slice(0, 5).split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
};

/**
 * حساب التأخير والخصم لحضور في يوم محدد.
 * التاريخ بيتبعت صراحةً (اليوم المحاسبي) عشان وردية بتعدّي منتصف الليل تفضل
 * محسوبة على يوم بدايتها — نفس منطق record_attendance في db/60.
 * dayOff: يوم راحة أو إجازة ⇒ صفر تأخير وصفر خصم.
 */
export function computeLatenessOn(
  emp: Employee,
  dateStr: string,
  checkIn: Date,
  dayOff = false,
): { lateMinutes: number; deduction: number } {
  const zero = { lateMinutes: 0, deduction: 0 };
  const { start, end, isWeeklyOff } = shiftForDate(emp, dateStr);
  if (dayOff || isWeeklyOff || !start) return zero;

  const startMin = toMinutes(start)!;
  const expected = new Date(`${dateStr}T00:00:00`);
  expected.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);

  const grace = Number(emp.late_grace_minutes ?? 0);
  const rawLate = Math.round((checkIn.getTime() - expected.getTime()) / 60000);
  const lateMinutes = Math.max(0, rawLate - grace);
  if (lateMinutes <= 0) return zero;

  // طول يوم العمل بالدقائق (لتحديد سعر الدقيقة). fallback 8 ساعات.
  let workdayMinutes = 480;
  const endMin = toMinutes(end);
  if (endMin !== null) {
    let mins = endMin - startMin;
    if (mins <= 0) mins += 24 * 60; // وردية تعدّي منتصف الليل
    workdayMinutes = mins || 480;
  }
  const dailyRate = (Number(emp.monthly_salary) || 0) / 30;
  const deduction = Math.min(dailyRate, (lateMinutes / workdayMinutes) * dailyRate);
  return { lateMinutes, deduction: Math.round(deduction * 100) / 100 };
}

/** وصف مختصر للشفت للعرض: «10:00 → 18:00» أو «راحة». */
export function shiftLabel(emp: Employee, dateStr: string): string {
  const { start, end, isWeeklyOff } = shiftForDate(emp, dateStr);
  if (isWeeklyOff) return 'راحة';
  if (!start) return '—';
  return end ? `${start.slice(0, 5)} → ${end.slice(0, 5)}` : start.slice(0, 5);
}
