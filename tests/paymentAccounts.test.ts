import { describe, expect, it } from 'vitest';
import { addTreasuryCounterpartsForAll, type LedgerEntry } from '../src/utils/paymentLedger';

const net = (rows: LedgerEntry[]) => rows.reduce((sum, row) => sum + row.inAmount - row.outAmount, 0);

describe('Payment Accounts reconciliation', () => {
  it('keeps shop and main balances distinct while All cancels a shop-to-main transfer', () => {
    const shop: LedgerEntry[] = [
      {
        id: 'sale:cash', date: '2026-08-19T12:00:00Z', method: 'cash',
        desc: 'sale', inAmount: 11570, outAmount: 0, kind: 'sale',
      },
      {
        id: 'expense:closing', date: '2026-08-19T23:00:00Z', method: 'cash',
        desc: 'تحويل للخزنة الرئيسية', inAmount: 0, outAmount: 11570, kind: 'transfer',
      },
    ];
    const main: LedgerEntry[] = [{
      id: 'sav:closing-19', date: '2026-08-19T23:00:00Z', method: 'cash',
      desc: 'تقفيل اليوم', inAmount: 11570, outAmount: 0, kind: 'transfer',
    }];
    const savingsRows = [{
      id: 'closing-19', source: 'day_closing', direction: 'in', amount: 11570,
      method: 'cash', created_at: '2026-08-19T23:00:00Z',
    }];

    const all = addTreasuryCounterpartsForAll(shop, main, savingsRows);
    const transferRows = all.filter((row) => row.kind === 'transfer');

    expect(net(shop)).toBe(0);
    expect(net(main)).toBe(11570);
    expect(transferRows).toHaveLength(2);
    expect(net(all)).toBe(11570);
  });

  it('does not duplicate main-only movements in the All ledger', () => {
    const shop: LedgerEntry[] = [];
    const main: LedgerEntry[] = [{
      id: 'main-income', date: '2026-08-19T12:00:00Z', method: 'cash',
      desc: 'main income', inAmount: 5000, outAmount: 0, kind: 'income',
    }];
    const savingsRows = [{
      id: 'internal-main', source: 'convert', direction: 'in', amount: 5000,
      method: 'cash', created_at: '2026-08-19T13:00:00Z',
    }];

    const all = addTreasuryCounterpartsForAll(shop, main, savingsRows);
    expect(all).toHaveLength(1);
    expect(net(all)).toBe(5000);
  });
});

