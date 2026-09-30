import { describe, expect, it } from 'vitest';
import { businessDayRange, timestampForBusinessDate } from './businessDay';
import { closingExpensesForDay, closingSavingsForDay } from './dayReopen';

describe('day reopen selection', () => {
  const settings = { dayStartHour: 3 };

  it('selects closing expenses only within the chosen business day', () => {
    const { start } = businessDayRange('2026-09-14', settings);
    const rows = [
      { id: 'close-14', category: 'تحويل للخزنة الرئيسية', note: '[SVG:g14]', created_at: timestampForBusinessDate('2026-09-14', settings) },
      { id: 'close-15', category: 'تحويل للخزنة الرئيسية', note: '[SVG:g15]', created_at: timestampForBusinessDate('2026-09-15', settings) },
      { id: 'before-start', category: 'تحويل للخزنة الرئيسية', note: '[SVG:g13]', created_at: new Date(start.getTime() - 1).toISOString() },
      { id: 'ordinary-expense', category: 'مصروف تشغيل', note: 'فاتورة', created_at: timestampForBusinessDate('2026-09-14', settings) },
    ];

    expect(closingExpensesForDay(rows, '2026-09-14', settings).map((row) => row.id)).toEqual(['close-14']);
  });

  it('does not include the following day treasury close or a non-close transfer', () => {
    const rows = [
      { id: 'day-14', source: 'day_closing', created_at: timestampForBusinessDate('2026-09-14', settings) },
      { id: 'day-15', source: 'day_closing', created_at: timestampForBusinessDate('2026-09-15', settings) },
      { id: 'shop-transfer', source: 'shop_transfer', created_at: timestampForBusinessDate('2026-09-14', settings) },
    ];

    expect(closingSavingsForDay(rows, '2026-09-14', settings).map((row) => row.id)).toEqual(['day-14', 'shop-transfer']);
  });
});
