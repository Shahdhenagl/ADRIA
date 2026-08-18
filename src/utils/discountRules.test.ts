import { describe, expect, it } from 'vitest';
import { calculateDiscountAmount, isDiscountRuleActive, lineMatchesDiscountRule } from './discountRules';

const lines = [
  { id: 'p1', product_id: 'p1', category_id: 'c1', sale_price: 100, quantity: 2 },
  { id: 'p2', product_id: 'p2', category_id: 'c2', sale_price: 50, quantity: 1 },
];

describe('discountRules', () => {
  it('applies percentage to all eligible lines', () => {
    expect(calculateDiscountAmount(lines, { discount_type: 'percentage', discount_value: 10, scope: 'all' })).toBe(25);
  });

  it('applies fixed discount only to selected products', () => {
    expect(calculateDiscountAmount(lines, { discount_type: 'fixed', discount_value: 30, scope: 'products', product_ids: ['p2'] })).toBe(30);
  });

  it('applies category discounts only to matching category', () => {
    expect(calculateDiscountAmount(lines, { discount_type: 'percentage', discount_value: 50, scope: 'category', category_id: 'c1' })).toBe(100);
  });

  it('does not exceed remaining eligible subtotal after manual discount', () => {
    expect(calculateDiscountAmount(lines, { discount_type: 'fixed', discount_value: 500, scope: 'all' }, 180)).toBe(70);
  });

  it('honours promotion dates and inactive state', () => {
    const now = new Date('2026-08-18T10:00:00Z');
    expect(isDiscountRuleActive({ discount_type: 'fixed', discount_value: 10, start_date: '2026-08-18T09:00:00Z', end_date: '2026-08-18T11:00:00Z' }, now)).toBe(true);
    expect(isDiscountRuleActive({ discount_type: 'fixed', discount_value: 10, start_date: '2026-08-19T09:00:00Z' }, now)).toBe(false);
  });

  it('matches a product and rejects another product', () => {
    const rule = { discount_type: 'fixed' as const, discount_value: 10, scope: 'products' as const, product_ids: ['p1'] };
    expect(lineMatchesDiscountRule(lines[0], rule)).toBe(true);
    expect(lineMatchesDiscountRule(lines[1], rule)).toBe(false);
  });
});
