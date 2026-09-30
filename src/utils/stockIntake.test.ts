import { describe, expect, it } from 'vitest';
import { canDeleteStockIntake, prepareStockIntakePayload } from './stockIntake';

describe('stock intake payload normalization', () => {
  it('keeps negative adjustments so manual decreases remain in the audit trail', () => {
    const rows = [
      {
        product_id: 'p1',
        product_name: 'Widget',
        quantity: -3,
        unit_cost: 20,
        source: 'manual_decrease',
        note: 'تعديل يدوي',
      },
      {
        product_id: 'p1',
        product_name: 'Widget',
        quantity: 0,
        unit_cost: 20,
        source: 'manual_edit',
      },
    ];

    expect(prepareStockIntakePayload(rows)).toEqual([
      {
        product_id: 'p1',
        product_name: 'Widget',
        quantity: -3,
        unit_cost: 20,
        source: 'manual_decrease',
        note: 'تعديل يدوي',
        total_value: -60,
      },
    ]);
  });

  it('does not allow deleting a negative manual stock decrease from the movement ledger', () => {
    expect(canDeleteStockIntake({ quantity: -1, source: 'manual_decrease' })).toBe(false);
    expect(canDeleteStockIntake({ quantity: -1, source: 'manual' })).toBe(false);
    expect(canDeleteStockIntake({ quantity: 1, source: 'manual_edit' })).toBe(true);
  });
});
