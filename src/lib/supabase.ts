import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── جلب كل الصفوف بتخطّي حد الـ1000 الافتراضي في Supabase ──────────────
// السبب: `select('*')` بيرجّع 1000 صف كحد أقصى، فحسابات الأرصدة (المصروفات/
// المشتريات/الرواتب/الطلبات) كانت بتنقص بمجرد ما يعدّي عدد الحركات 1000.
// بنجيب على دفعات (range) لحد ما ترجع دفعة أصغر من الحجم = النهاية.
export async function fetchAllRows<T = any>(
  table: string,
  select = '*',
  orderBy: { column: string; ascending?: boolean } = { column: 'created_at', ascending: false },
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderBy.column, { ascending: orderBy.ascending ?? false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data as T[]) || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}
