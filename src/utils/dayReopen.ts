import { businessDayRange } from './businessDay';

type DaySettings = { dayStartHour?: number } | null | undefined;
type DatedEntry = { created_at?: string | null; date?: string | null; category?: string | null; note?: string | null; source?: string | null };

function isWithinBusinessDay(entry: DatedEntry, dayStr: string, settings?: DaySettings): boolean {
  const createdAt = entry.created_at || entry.date;
  if (!createdAt) return false;
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const { start, end } = businessDayRange(dayStr, settings);
  return timestamp >= start.getTime() && timestamp < end.getTime();
}

/** Select only closing-related shop expenses recorded during this exact accounting day. */
export function closingExpensesForDay<T extends DatedEntry>(entries: T[], dayStr: string, settings?: DaySettings): T[] {
  return entries.filter((entry) => {
    if (!isWithinBusinessDay(entry, dayStr, settings)) return false;
    const category = String(entry.category || '').trim();
    const note = String(entry.note || '').trim();
    return category === 'تحويل للخزنة الرئيسية' ||
      category === 'تقفيل يومية' ||
      category === 'تحويل للخزنة' ||
      category.includes('تحويل للخزنة') ||
      category.includes('تقفيل') ||
      note.includes('[SVG:') ||
      note.includes('تحويل من المحل للخزنة الرئيسية');
  });
}

/** Select closing-related main-treasury counterparts on the exact day. */
export function closingSavingsForDay<T extends DatedEntry>(entries: T[], dayStr: string, settings?: DaySettings): T[] {
  return entries.filter((entry) => {
    if (!isWithinBusinessDay(entry, dayStr, settings)) return false;
    const note = String(entry.note || '').trim();
    return entry.source === 'day_closing' ||
      entry.source === 'shop_transfer' ||
      note.includes('[SVG:') ||
      note.includes('تحويل من المحل للخزنة الرئيسية');
  });
}
