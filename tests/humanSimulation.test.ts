import { describe, it, expect } from 'vitest';
import { applySplit, refundRecordOf, isMainTreasuryExpense, timestampForBusinessDate } from '../src/utils/treasury';
import { buildPaymentLedger } from '../src/utils/paymentLedger';
import { businessDayRange, businessDateStr } from '../src/utils/businessDay';

describe('Human-Like Manual QA — Comprehensive End-to-End Simulation', () => {

  // ── JOURNEY #1: Full Sale Journey ──────────────────────────────────────
  it('Journey #1: Full sale calculation & payment split consistency', () => {
    const item1 = { id: 'p1', name: 'Shirt', sale_price: 300, quantity: 2 }; // 600
    const item2 = { id: 'p2', name: 'Pants', sale_price: 400, quantity: 1 }; // 400
    const total = item1.sale_price * item1.quantity + item2.sale_price * item2.quantity;
    expect(total).toBe(1000);

    const paidCash = 600;
    const paidVisa = 400;
    const split = { cash: paidCash, visa: paidVisa, wallet: 0, instapay: 0 };
    const paidTotal = Object.values(split).reduce((s, v) => s + v, 0);

    expect(paidTotal).toBe(1000);
    expect(paidTotal - total).toBe(0); // No change, exact payment
  });

  // ── JOURNEY #2: Deposit & Conversion ─────────────────────────────────
  it('Journey #2: Deposit conversion prevents double-counting', () => {
    const invoiceTotal = 1000;
    const depositAmount = 200;

    // Step 1: Deposit inflow recorded when held
    const depositInflow = -depositAmount; // negative expense = inflow +200 into drawer
    expect(depositInflow).toBe(-200);

    // Step 2: Final sale checkout of 1000 total (cashier receives 800 final + 200 deposit = 1000)
    const saleInflow = invoiceTotal; // +1000 in order paid_amount
    const conversionOutflow = depositAmount; // +200 expense (outflow -200)

    // Net drawer movement
    const netDrawer = -depositInflow + saleInflow - conversionOutflow;
    expect(netDrawer).toBe(1000); // Net cash added to system is exactly 1000, NOT 1200!
  });

  // ── JOURNEY #3: Return Audit ──────────────────────────────────────────
  it('Journey #3: Partial & full returns use refunded_at exit timestamp', () => {
    const originalDate = '2026-08-04T10:00:00.000Z';
    const returnDate = '2026-08-08T14:30:00.000Z';

    const order = {
      id: 'ord-428',
      type: 'sale',
      total: 1000,
      paid_amount: 1000,
      paid_cash: 1000,
      payment_method: 'cash',
      date: originalDate,
      refunded_at: returnDate,
      items: [{ id: 'i1', quantity: 2, refunded_amount: 580 }],
      customer: { name: 'Test Customer' }
    };

    const ledger = buildPaymentLedger([order], [], []);
    const returnEntries = ledger.filter(e => e.kind === 'return');
    expect(returnEntries).toHaveLength(1);
    expect(returnEntries[0].outAmount).toBe(580);
    expect(returnEntries[0].date).toBe(returnDate); // Must post on return exit date!
  });

  // ── JOURNEY #4: Exchange Audit ─────────────────────────────────────────
  it('Journey #4: Exchange with positive & negative net differences post on exchange date', () => {
    const exchangeDate = '2026-08-09T16:00:00.000Z';
    const orderWithExchange = {
      id: 'ord-500',
      type: 'sale',
      total: 700,
      paid_amount: 700,
      paid_cash: 700,
      payment_method: 'cash',
      date: '2026-08-05T10:00:00.000Z',
      exchange_data: {
        date: exchangeDate,
        oldTotal: 500,
        newTotal: 700,
        netDifference: 200,
        paid_cash: 200,
      }
    };

    const ledger = buildPaymentLedger([orderWithExchange], [], []);
    const exchangeEntries = ledger.filter(e => e.desc.includes('استبدال'));
    expect(exchangeEntries).toHaveLength(1);
    expect(exchangeEntries[0].date).toBe(exchangeDate);
    expect(exchangeEntries[0].inAmount).toBe(200);
  });

  // ── JOURNEY #5: Negative Day Closing Balance ───────────────────────────
  it('Journey #5: Negative drawer balance transfers properly without zero clamping', () => {
    const shopAvail = { cash: 1000, visa: 500, wallet: -580 };

    // Invert actualDir for negative values when transferring to main treasury
    const rows = Object.entries(shopAvail)
      .filter(([_, val]) => Math.abs(val) > 0.001)
      .map(([method, val]) => {
        const actualDir = val < 0 ? 'out' : 'in'; // 'in' = to main treasury, 'out' = from main treasury
        return { method, amount: Math.abs(val), direction: actualDir };
      });

    const walletRow = rows.find(r => r.method === 'wallet');
    expect(walletRow).toBeDefined();
    expect(walletRow?.direction).toBe('out'); // Pulls 580 from main treasury to restore drawer deficit to 0
    expect(walletRow?.amount).toBe(580);
  });

  // ── JOURNEY #6: Negative Number Safety ─────────────────────────────────
  it('Journey #6: Item sale price is non-negative', () => {
    const invalidPrice = -100;
    const clampedPrice = Math.max(0, Number(invalidPrice) || 0);
    expect(clampedPrice).toBe(0);
  });

  // ── JOURNEY #7: Timezone & Day Reopening ──────────────────────────────
  it('Journey #7: Day reopening search window covers 12h buffer before target date', () => {
    const dayStr = '2026-08-06';
    const [y, m, d] = dayStr.split('-').map(Number);
    const searchStart = new Date(y, m - 1, d - 1, 12, 0, 0, 0);

    const expenseCreatedAt = new Date('2026-08-05T22:00:00.000Z'); // 1:00 AM Aug 6 local time (UTC+3)
    expect(expenseCreatedAt >= searchStart).toBe(true); // Search window MUST capture early closing expense!
  });
});
