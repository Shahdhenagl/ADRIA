import { describe, expect, it } from 'vitest';
import { buildPaymentLedger } from './paymentLedger';
import { computeShopAvailable } from './treasury';
import { heldPaymentBreakdown } from './invoicePayments';
import { isFullyPrepaidOnlineHeld } from './heldInvoiceLifecycle';

describe('held invoice accounting', () => {
  it('treats a shipped prepaid online order like invoice 543 as status-only delivery', () => {
    expect(isFullyPrepaidOnlineHeld({ kind: 'online', status: 'shipped', total: 900, deposit: 0, discount_amount: 0 })).toBe(true);
    expect(isFullyPrepaidOnlineHeld({ kind: 'online', status: 'money_pending', total: 900, deposit: 0, discount_amount: 0 })).toBe(false);
    expect(isFullyPrepaidOnlineHeld({ kind: 'online', status: 'held', total: 500, deposit: 500, discount_amount: 0 })).toBe(true);
    expect(isFullyPrepaidOnlineHeld({ kind: 'shop', status: 'shipped', total: 500, deposit: 500, discount_amount: 0 })).toBe(false);
  });
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

  it('does not treat reservation reclassification as a second cash outflow', () => {
    const reclassification = {
      id: 'reclass-1',
      category: 'تحويل حجز',
      amount: 100,
      paid_cash: 100,
      note: 'تحويل عربون لفاتورة #9001',
    };
    const net = computeShopAvailable(
      { orders: [sale], expenses: [deposit, reclassification], purchases: [], salaries: [] },
      {},
    );
    expect(net.cash).toBe(500);
  });

  it('matches POS by including the cashier closing transfer as a shop outflow', () => {
    const beforeClosing = {
      id: 'old-sale',
      type: 'sale',
      total: 1000,
      paid_amount: 1000,
      paid_cash: 1000,
      created_at: '2026-08-10T20:00:00.000Z',
    };
    const afterClosing = {
      id: 'new-sale',
      type: 'sale',
      total: 125,
      paid_amount: 125,
      paid_cash: 125,
      created_at: '2026-08-12T10:00:00.000Z',
    };
    const net = computeShopAvailable(
      {
        orders: [beforeClosing, afterClosing],
        expenses: [{
          id: 'closing-expense',
          category: 'تحويل للخزنة الرئيسية',
          amount: 1000,
          paid_cash: 1000,
          note: 'تقفيل اليوم',
          created_at: '2026-08-11T12:00:00.000Z',
        }],
        purchases: [],
        salaries: [],
        savingsTransactions: [{
          source: 'day_closing',
          created_at: '2026-08-11T12:00:00.000Z',
          method: 'cash',
          direction: 'in',
          amount: 1000,
        }],
      },
      { initial_balance: 500 },
    );
    expect(net.cash).toBe(125);
  });
});
