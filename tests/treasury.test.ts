// اختبار منطق توزيع مبالغ الخزنة (src/utils/treasury.ts) — التشغيل: npm test
import { describe, it, expect } from 'vitest';
import { applySplit, routeInternalTransfer, applyInternalTransferNet, isInternalTransfer, isSavingsTransfer } from '../src/utils/treasury';
import { ALL_PAYMENT_KEYS } from '../src/utils/paymentMethods';

const zero = (): Record<string, number> => Object.fromEntries(ALL_PAYMENT_KEYS.map((k) => [k, 0]));
const sum = (o: Record<string, number>) => ALL_PAYMENT_KEYS.reduce((s, k) => s + (o[k] || 0), 0);

describe('applySplit', () => {
  it('يوزّع البيع حسب التقسيمة', () => {
    const t = zero();
    applySplit(t, { paid_cash: 60, paid_visa: 40, paid_amount: 100 }, 'paid_amount');
    expect(t.cash).toBe(60);
    expect(t.visa).toBe(40);
  });

  it('بلا تقسيمة يستخدم الوسيلة الأساسية', () => {
    const t = zero();
    applySplit(t, { paid_amount: 100, payment_method: 'visa' }, 'paid_amount');
    expect(t.visa).toBe(100);
  });

  it('التقسيمة السالبة (تحصيل رصيد مورد) تقلّل الخارج = دخل للخزنة', () => {
    const out = zero();
    applySplit(out, { paid_cash: -200, paid_amount: -200 }, 'paid_amount');
    expect(out.cash).toBe(-200);
    const closing = 1000 + 0 - sum(out);
    expect(closing).toBe(1200);
  });

  it('sign=-1 يعكس الاتجاه (الخارج في الخزنة الرئيسية)', () => {
    const net = zero();
    applySplit(net, { paid_cash: 300, amount: 300 }, 'amount', { sign: -1 });
    expect(net.cash).toBe(-300);
  });
});

describe('routeInternalTransfer', () => {
  it('تحويل كاش→فيزا: كاش ينقص وفيزا تزيد والإجمالي ثابت', () => {
    const inN = zero(), outN = zero();
    routeInternalTransfer(inN, outN, { paid_cash: -50, paid_visa: 50 });
    const availCash = 100 + inN.cash - outN.cash;
    const availVisa = 100 + inN.visa - outN.visa;
    expect(availCash).toBe(50);
    expect(availVisa).toBe(150);
    expect(availCash + availVisa).toBe(200);
  });
});

describe('applyInternalTransferNet', () => {
  it('يطبّق التحويل على خزنة واحدة مباشرةً', () => {
    const net = { cash: 100, visa: 100, wallet: 0, instapay: 0, method5: 0, method6: 0 };
    applyInternalTransferNet(net, { paid_cash: -50, paid_visa: 50 });
    expect(net.cash).toBe(50);
    expect(net.visa).toBe(150);
  });
});

describe('تصنيف الفئات', () => {
  it('يميّز التحويل الداخلي وتحويل الخزنة الرئيسية', () => {
    expect(isInternalTransfer('تحويل داخلي')).toBe(true);
    expect(isInternalTransfer('مصروفات')).toBe(false);
    expect(isSavingsTransfer('تحويل للخزنة الرئيسية')).toBe(true);
    expect(isSavingsTransfer('تحويل من الخزنة الرئيسية')).toBe(true);
  });
});
