import { describe, expect, it } from 'vitest';
import { buildTrialBalance } from './trialBalance';

const settings = {
  initial_balance: 0,
  payment_opening_balances: {},
  savings_opening_balances: {},
};

describe('رأس مال الشركاء النقدي', () => {
  it('يظهر رأس المال الافتتاحي والإيداعات والسحوبات كحقوق ملكية لا كإيراد أو مصروف', () => {
    const tb = buildTrialBalance({
      orders: [], expenses: [], purchaseInvoices: [], employeeTransactions: [],
      products: [], savingsTransactions: [
        { direction: 'in', amount: 1000, method: 'cash' },
        { direction: 'in', amount: 1000, method: 'cash' },
        { direction: 'out', amount: 250, method: 'cash' },
      ],
      partners: [{ id: 'p1', opening_balance: 1000 }],
      partnerTransactions: [
        { partner_id: 'p1', type: 'deposit', amount: 1000 },
        { partner_id: 'p1', type: 'withdraw', amount: 250 },
      ],
      settings,
    });

    expect(tb.byCode['311']).toBe(1000);
    expect(tb.byCode['31'] || 0).toBe(0);
    expect(tb.byCode['312']).toBe(1000);
    expect(tb.byCode['32']).toBe(-250);
    expect(tb.revenue).toBe(0);
    expect(tb.expenses).toBe(0);
    expect(tb.assets).toBe(1750);
  });
});

describe('حركات رأس المال لا تُخلط بالمبيعات', () => {
  it('يظل الإيراد والربح صفراً عند إيداع رأس مال كاش', () => {
    const tb = buildTrialBalance({
      orders: [], expenses: [], purchaseInvoices: [], employeeTransactions: [],
      products: [], savingsTransactions: [{ direction: 'in', amount: 500, method: 'cash' }],
      partners: [{ id: 'p1', opening_balance: 500 }], partnerTransactions: [], settings,
    });
    expect(tb.revenue).toBe(0);
    expect(tb.profit).toBe(0);
  });
});
