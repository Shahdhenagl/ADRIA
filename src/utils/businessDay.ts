// ── منطق «اليوم المحاسبي» لتقفيل اليومية ──────────────────────────────
// اليوم لا يبدأ منتصف الليل بل عند ساعة يحددها المدير (افتراضي 3 صباحاً).
// أي فاتورة قبل هذه الساعة تُحسب على اليوم السابق (يفضل تقفيله مفتوحاً حتى 3 ص).

/** ساعة بداية اليوم (0-23). افتراضي 3. */
export function dayStartHour(settings?: { dayStartHour?: number } | null): number {
  const h = Number(settings?.dayStartHour);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? Math.floor(h) : 3;
}

/** تاريخ يوم بصيغة YYYY-MM-DD من كائن Date (بالتوقيت المحلي). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * التاريخ المحاسبي الحالي: لو الساعة الآن أقل من ساعة بداية اليوم فالتاريخ = أمس.
 * يُرجّع YYYY-MM-DD.
 */
export function businessDateStr(settings?: { dayStartHour?: number } | null, now: Date = new Date()): string {
  const hour = dayStartHour(settings);
  const d = new Date(now);
  if (d.getHours() < hour) d.setDate(d.getDate() - 1);
  return ymd(d);
}

/**
 * نطاق اليوم المحاسبي ليوم YYYY-MM-DD:
 * يبدأ من dayStr عند ساعة البداية وينتهي بعدها بـ 24 ساعة.
 */
export function businessDayRange(dayStr: string, settings?: { dayStartHour?: number } | null): { start: Date; end: Date } {
  const hour = dayStartHour(settings);
  const start = new Date(`${dayStr}T00:00:00`);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * وقت (ISO) لتسجيل حركة في حسابات يوم محاسبي مُحدَّد YYYY-MM-DD:
 * - يثبت الحركة في منتصف اليوم المحاسبي المطلوب، حتى لو تم تسجيلها بعد منتصف الليل.
 */
export function timestampForBusinessDate(dayStr: string, settings?: { dayStartHour?: number } | null): string {
  const { start } = businessDayRange(dayStr, settings);
  const mid = new Date(start);
  mid.setHours(mid.getHours() + 12); // منتصف اليوم المحاسبي
  return mid.toISOString();
}
