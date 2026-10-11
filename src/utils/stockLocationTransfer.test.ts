import { describe, expect, it } from 'vitest';
import { calculateStockLocationTransfer } from './stockLocationTransfer';

describe('calculateStockLocationTransfer', () => {
  it('moves stock from warehouse to display while preserving total stock', () => {
    expect(calculateStockLocationTransfer(12, 4, 3, 'warehouse_to_display')).toEqual({
      stockQuantity: 12,
      displayQuantity: 7,
      warehouseQuantity: 5,
      transferredQuantity: 3,
    });
  });

  it('moves stock from display to warehouse while preserving total stock', () => {
    expect(calculateStockLocationTransfer(12, 4, 2, 'display_to_warehouse')).toEqual({
      stockQuantity: 12,
      displayQuantity: 2,
      warehouseQuantity: 10,
      transferredQuantity: 2,
    });
  });

  it('rejects a transfer larger than the source location', () => {
    expect(() => calculateStockLocationTransfer(12, 4, 5, 'display_to_warehouse'))
      .toThrow('الكمية المطلوبة أكبر من المتاح في المحل');
    expect(() => calculateStockLocationTransfer(12, 4, 9, 'warehouse_to_display'))
      .toThrow('الكمية المطلوبة أكبر من المتاح في المستودع');
  });

  it('rejects invalid quantities and inconsistent location totals', () => {
    expect(() => calculateStockLocationTransfer(12, 4, 0, 'warehouse_to_display')).toThrow();
    expect(() => calculateStockLocationTransfer(12, 13, 1, 'warehouse_to_display')).toThrow();
  });

  it('supports fractional transfers for fractional-unit products', () => {
    expect(calculateStockLocationTransfer(4, 1.5, 0.25, 'warehouse_to_display').displayQuantity).toBe(1.75);
  });
});
