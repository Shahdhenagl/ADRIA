export type StockTransferDirection = 'warehouse_to_display' | 'display_to_warehouse';

export interface StockLocationTransferResult {
  stockQuantity: number;
  displayQuantity: number;
  warehouseQuantity: number;
  transferredQuantity: number;
}

/** Move existing stock between locations without changing total inventory. */
export function calculateStockLocationTransfer(
  stockQuantity: number,
  displayQuantity: number,
  quantity: number,
  direction: StockTransferDirection,
): StockLocationTransferResult {
  const stock = Number(stockQuantity);
  const display = Number(displayQuantity);
  const qty = Number(quantity);

  if (!Number.isFinite(stock) || stock < 0) throw new Error('إجمالي المخزون غير صالح');
  if (!Number.isFinite(display) || display < 0 || display > stock) throw new Error('كمية المحل غير متوافقة مع إجمالي المخزون');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('أدخل كمية أكبر من صفر');

  const warehouse = stock - display;
  const available = direction === 'warehouse_to_display' ? warehouse : display;
  if (qty - available > 1e-9) {
    throw new Error(direction === 'warehouse_to_display'
      ? `الكمية المطلوبة أكبر من المتاح في المستودع (${warehouse})`
      : `الكمية المطلوبة أكبر من المتاح في المحل (${display})`);
  }

  const nextDisplay = direction === 'warehouse_to_display' ? display + qty : display - qty;
  return {
    stockQuantity: stock,
    displayQuantity: Math.max(0, Math.min(stock, nextDisplay)),
    warehouseQuantity: Math.max(0, stock - nextDisplay),
    transferredQuantity: qty,
  };
}
