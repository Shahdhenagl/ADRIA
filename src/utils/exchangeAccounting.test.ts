import { describe, expect, it } from 'vitest';
import { exchangeSettlementAmount } from './exchangeAccounting';

describe('exchange settlement accounting', () => {
  it('does not turn an invoice discount into customer debt', () => {
    // إجمالي الأصناف الخام 3050، خصم إجمالي 90، صافي الفاتورة 2960.
    // استبدال بنفس القيمة الصافية يجب ألا ينتج فرق 90.
    expect(exchangeSettlementAmount(2960, 2960)).toBe(0);
  });

  it('returns only the real final-invoice difference', () => {
    expect(exchangeSettlementAmount(2960, 3050)).toBe(90);
    expect(exchangeSettlementAmount(2960, 2870)).toBe(-90);
  });
});
