/**
 * Central definition of the expense/income categories used when recording a
 * financial transaction.
 *
 * The base lists are hardcoded so they always exist — even on a store whose
 * settings row is empty, or before db/43 added the custom-category columns.
 * Anything the user adds themselves is appended on top and stored in settings
 * (`expense_categories` / `income_categories`), so a category typed once in the
 * cashier's drawer also shows up in the main treasury and vice versa.
 */

export type FinanceCategoryType = 'expense' | 'income';

/** value = ما بيتخزّن في expenses.category، label = اللي بيتعرض. */
export interface FinanceCategory {
  value: string;
  label: string;
}

export const BASE_EXPENSE_CATEGORIES: FinanceCategory[] = [
  { value: 'عام', label: 'عام' },
  { value: 'إيجار', label: 'إيجار' },
  { value: 'كهرباء/مياه', label: 'كهرباء / مياه' },
  { value: 'رواتب', label: 'رواتب' },
  { value: 'نقل/توصيل', label: 'نقل / توصيل' },
  { value: 'صيانة', label: 'صيانة' },
];

export const BASE_INCOME_CATEGORIES: FinanceCategory[] = [
  { value: 'عام', label: 'إيراد عام' },
  { value: 'خدمات', label: 'خدمات إضافية' },
  { value: 'استثمار', label: 'عائد استثمار' },
  { value: 'أخرى', label: 'أخرى' },
];

type SettingsLike = {
  expenseCategories?: string[];
  incomeCategories?: string[];
};

export function customCategoriesOf(settings: SettingsLike, type: FinanceCategoryType): string[] {
  const raw = type === 'expense' ? settings.expenseCategories : settings.incomeCategories;
  return Array.isArray(raw) ? raw.filter((c) => typeof c === 'string' && c.trim() !== '') : [];
}

/** القائمة الكاملة المعروضة: الأساسية + اللي المستخدم ضافه، من غير تكرار. */
export function categoriesFor(settings: SettingsLike, type: FinanceCategoryType): FinanceCategory[] {
  const base = type === 'expense' ? BASE_EXPENSE_CATEGORIES : BASE_INCOME_CATEGORIES;
  const taken = new Set(base.map((c) => c.value));
  const extra = customCategoriesOf(settings, type)
    .filter((c) => !taken.has(c))
    .map((c) => ({ value: c, label: c }));
  return [...base, ...extra];
}

/**
 * بيرجّع مصفوفة الفئات المخصّصة بعد إضافة `name`، أو null لو الاسم فاضي أو
 * موجود أصلاً (في الأساسية أو المخصّصة) — عشان مانخزّنش تكرار.
 */
export function withAddedCategory(
  settings: SettingsLike,
  type: FinanceCategoryType,
  name: string,
): string[] | null {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  const exists = categoriesFor(settings, type).some((c) => c.value === clean);
  if (exists) return null;
  return [...customCategoriesOf(settings, type), clean];
}
