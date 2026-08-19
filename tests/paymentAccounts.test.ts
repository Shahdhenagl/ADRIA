import { describe, expect, it } from 'vitest';
import { addTreasuryCounterpartsForAll, type LedgerEntry } from '../src/utils/paymentLedger';

const net = (rows: LedgerEntry[]) => rows.reduce((sum, row) => sum + row.inAmount - row.outAmount, 0);

describe('Payment Accounts reconciliation', () => {
  it('keeps shop and main balances distinct while All cancels a shop-to-main transfer', () => {
    const shop: LedgerEntry[] = [{
      id: 'sale:cash', date: '2026-08-19T12:00:00Z', method: 'cash',
      desc: 'sale', inAmount: 11570, outAmount: 0, kind: 'sale',
    }];
    const main: LedgerEntry[] = [];
    const savingsRows = [{
      id: 'closing-19', source: 'day_closing', direction: 'in', amount: 11570,
      method: 'cash', created_at: '2026-08-19T23:00:00Z',
    }];

    const all = addTreasuryCounterpartsForAll(shop, main, savingsRows);
    const transferRows = all.filter((row) => row.kind === 'transfer');

    expect(net(shop)).toBe(11570);
    expect(net(main)).toBe(0);
    expect(transferRows).toHaveLength(1);
    expect(transferRows[0].outAmount).toBe(11570);
    expect(net(all)).toBe(0);
  });

  it('ignores main-only savings movements in the All ledger', () => {
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
