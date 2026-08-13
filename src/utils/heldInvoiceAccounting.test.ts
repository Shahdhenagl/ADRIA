import { describe, expect, it } from 'vitest';
import { buildPaymentLedger } from './paymentLedger';
import { computeShopAvailable } from './treasury';
import { heldPaymentBreakdown } from './invoicePayments';

describe('held invoice accounting', () => {
  const sale = {
    id: '9001',
    type: 'sale',
    total: 500,
    paid_amount: 500,
    paid_cash: 500,
    date: '2026-08-13T12:00:00.000Z',
    held_invoice_id: 'held-1',
    held_deposit_amount: 100,
    held_deposit_date: '2026-08-12T12:00:00.000Z',
  };
  const deposit = {
    id: 'dep-1',
    category: 'حجز',
    amount: -100,
    paid_cash: 100,
    date: '2026-08-12T10:00:00.000Z',
    note: 'عربون حجز - عميل',
  };

  it('shows deposit on reservation day and only the remainder on delivery day', () => {
    const ledger = buildPaymentLedger([sale], [deposit], []);
    const rows = ledger.filter((x) => x.method === 'cash');
    expect(rows.filter((x) => x.date.startsWith('2026-08-12')).reduce((s, x) => s + x.inAmount - x.outAmount, 0)).toBe(100);
    expect(rows.filter((x) => x.date.startsWith('2026-08-13')).reduce((s, x) => s + x.inAmount - x.outAmount, 0)).toBe(400);
  });

  it('prints the deposit and later collection as two separate payments', () => {
    const breakdown = heldPaymentBreakdown({ ...sale, held_deposit_split: { cash: 100 } }, ['cash', 'visa']);
    expect(breakdown?.deposit).toBe(100);
    expect(breakdown?.later).toBe(400);
    expect(breakdown?.depositSplit.cash).toBe(100);
    expect(breakdown?.laterSplit.cash).toBe(400);
  });

  it('keeps the full paid amount available for the customer balance while treasury receives 500 once', () => {
    const net = computeShopAvailable({ orders: [sale], expenses: [deposit], purchases: [], salaries: [] }, {});
    expect(net.cash).toBe(500);
    expect(sale.paid_amount).toBe(500);
  });
});
