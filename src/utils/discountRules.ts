export type DiscountScope = 'all' | 'products' | 'category';
export type DiscountType = 'percentage' | 'fixed';

export interface DiscountRule {
  discount_type: DiscountType;
  discount_value: number;
  start_date?: string | null;
  end_date?: string | null;
  scope?: DiscountScope | null;
  product_ids?: string[] | null;
  category_id?: string | null;
  is_active?: boolean;
}

export interface DiscountableLine {
  id: string;
  product_id?: string;
  category_id?: string | null;
  sale_price: number;
  quantity: number;
}

export function isDiscountRuleActive(rule: DiscountRule, at = new Date()): boolean {
  if (rule.is_active === false) return false;
  if (rule.start_date && new Date(rule.start_date).getTime() > at.getTime()) return false;
  if (rule.end_date && new Date(rule.end_date).getTime() < at.getTime()) return false;
  return true;
}

export function lineMatchesDiscountRule(line: DiscountableLine, rule: DiscountRule): boolean {
  const scope = rule.scope || 'all';
  if (scope === 'all') return true;
  if (scope === 'category') return !!rule.category_id && line.category_id === rule.category_id;
  const ids = new Set((rule.product_ids || []).map(String));
  return ids.has(String(line.product_id || line.id));
}

export function eligibleSubtotal(lines: DiscountableLine[], rule: DiscountRule): number {
  return lines
    .filter((line) => line.quantity > 0 && lineMatchesDiscountRule(line, rule))
    .reduce((sum, line) => sum + Math.max(0, Number(line.sale_price) || 0) * Math.max(0, Number(line.quantity) || 0), 0);
}

export function calculateDiscountAmount(
  lines: DiscountableLine[],
  rule: DiscountRule,
  baseDiscount = 0,
): number {
  const eligible = eligibleSubtotal(lines, rule);
  if (eligible <= 0 || !isDiscountRuleActive(rule)) return 0;
  const value = Math.max(0, Number(rule.discount_value) || 0);
  const remainingEligible = Math.max(0, eligible - Math.max(0, Number(baseDiscount) || 0));
  const amount = rule.discount_type === 'percentage' ? remainingEligible * Math.min(100, value) / 100 : value;
  return Math.min(remainingEligible, Math.max(0, amount));
}

export function calculateInvoiceDiscount(
  lines: DiscountableLine[],
  manualDiscount: number,
  rule?: DiscountRule | null,
): number {
  const subtotal = lines.reduce((sum, line) => sum + Math.max(0, Number(line.sale_price) || 0) * Math.max(0, Number(line.quantity) || 0), 0);
  const manual = Math.min(subtotal, Math.max(0, Number(manualDiscount) || 0));
  const remainingLines = lines.length ? lines : [];
  const coupon = rule ? calculateDiscountAmount(remainingLines, rule, manual) : 0;
  return Math.min(subtotal, manual + coupon);
}

export function discountLabel(rule: DiscountRule): string {
  return rule.discount_type === 'percentage'
    ? `${Number(rule.discount_value) || 0}%`
    : `${Number(rule.discount_value) || 0}`;
}
