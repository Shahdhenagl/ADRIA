import { describe, it, expect } from 'vitest';
import { findLinkedSalaryExpense, findLinkedEmployeeTx } from '../salaryLink';
import { refundPartsOf, refundShareOfMethod, refundRecordOf, applySplit } from '../treasury';

/**
 * ── تستات الربط بين الطرفين ──────────────────────────────────────────────────
 *
 * الحذف والتعديل بيعتمدوا كلياً على دوال الربط دي: لو رجّعت `undefined` غلط،
 * الطرف التاني بيفضل يتيم — وده مصدر كل الفروق اللي ظهرت في الحسابات.
 * فالتستات هنا بتغطي بالظبط الحالات اللي كسرت النظام فعلاً.
 */

describe('findLinkedSalaryExpense — من صف الموظف للمصروف', () => {
  const tx = { id: 't1', created_at: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 };

  it('بيلاقيه بالربط الصريح (db/49) حتى لو التاريخ مختلف', () => {
    const expenses = [
      { id: 'e-other', category: 'رواتب', date: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 },
      { id: 'e1', category: 'رواتب', date: '2026-01-01T12:00:00Z', amount: 999, employee_transaction_id: 't1' },
    ];
    expect(findLinkedSalaryExpense(expenses, tx)?.id).toBe('e1');
  });

  it('بيقع على المطابقة بالتاريخ والمبلغ للصفوف القديمة', () => {
    const expenses = [{ id: 'e1', category: 'رواتب', date: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 }];
    expect(findLinkedSalaryExpense(expenses, tx)?.id).toBe('e1');
  });

  // مهم: مصروف مربوط بمعاملة تانية ماينفعش يتسرق — وإلا الحذف بيمسح
  // مصروف معاملة سليمة ويسيب اليتيم مكانه.
  it('مابياخدش مصروف مربوط بمعاملة تانية', () => {
    const expenses = [{ id: 'e1', category: 'رواتب', date: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500, employee_transaction_id: 'OTHER' }];
    expect(findLinkedSalaryExpense(expenses, tx)).toBeUndefined();
  });

  it('مابيطابقش تصنيف مختلف', () => {
    const expenses = [{ id: 'e1', category: 'إيجار', date: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 }];
    expect(findLinkedSalaryExpense(expenses, tx)).toBeUndefined();
  });
});

describe('findLinkedEmployeeTx — من المصروف لصف الموظف (الاتجاه اللي كان ناقص)', () => {
  const expense = { id: 'e1', category: 'رواتب', date: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 };

  it('بيلاقيه بالربط الصريح', () => {
    const txs = [
      { id: 'tX', created_at: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 },
      { id: 't1', created_at: '2026-02-02T12:00:00Z', amount: 111 },
    ];
    const linked = findLinkedEmployeeTx(txs, { ...expense, employee_transaction_id: 't1' });
    expect(linked?.id).toBe('t1');
  });

  it('بيقع على المطابقة بالتاريخ والمبلغ للصفوف القديمة', () => {
    const txs = [{ id: 't1', created_at: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 }];
    expect(findLinkedEmployeeTx(txs, expense)?.id).toBe('t1');
  });

  it('مابيرجّعش حاجة لمصروف مش رواتب', () => {
    const txs = [{ id: 't1', created_at: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 }];
    expect(findLinkedEmployeeTx(txs, { ...expense, category: 'كهرباء' })).toBeUndefined();
  });

  // الحادثة الحقيقية: حذف المصروف من صفحة الخزنة كان بيسيب صف الموظف.
  // دلوقتي الربط شغّال في الاتجاهين، فالحذف بيلاقيه.
  it('الاتجاهين متسقين: لو A بيلاقي B يبقى B بيلاقي A', () => {
    const tx = { id: 't1', created_at: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 };
    const exp = { id: 'e1', category: 'رواتب', date: '2026-08-01T12:00:00Z', amount: 500, paid_cash: 500 };
    expect(findLinkedSalaryExpense([exp], tx)?.id).toBe('e1');
    expect(findLinkedEmployeeTx([tx], exp)?.id).toBe('t1');
  });
});

describe('تقسيمة المرتجع (db/67)', () => {
  it('بتستخدم التقسيمة المسجّلة لو موجودة', () => {
    const order = { refunded_cash: 400, refunded_instapay: 250, payment_method: 'cash' };
    const parts = refundPartsOf(order, 650);
    expect(parts).toEqual(expect.arrayContaining([['cash', 400], ['instapay', 250]]));
    expect(parts.reduce((s, [, v]) => s + v, 0)).toBeCloseTo(650);
  });

  // الفواتير القديمة: الفلوس بترجع زي ما جت — أكبر وسيلة في تقسيمة الدفع،
  // مش payment_method (اللي كان بينقل المرتجع لوسيلة غلط).
  it('بترجع لأكبر وسيلة في تقسيمة الدفع مش لـ payment_method', () => {
    const order = { paid_cash: 300, paid_visa: 700, payment_method: 'cash' };
    expect(refundPartsOf(order, 100)).toEqual([['visa', 100]]);
  });

  it('refund_method له الأولوية على كل حاجة', () => {
    const order = { paid_cash: 300, paid_visa: 700, payment_method: 'cash', refund_method: 'wallet' };
    expect(refundPartsOf(order, 100)).toEqual([['wallet', 100]]);
  });

  it('بيحافظ على تقسيمة المرتجع الفعلية حتى لو refund_method فيه الوسيلة الأساسية', () => {
    const order = {
      refund_method: 'cash',
      refunded_cash: 60,
      refunded_wallet: 40,
      payment_method: 'cash',
    };
    expect(refundPartsOf(order, 100)).toEqual(expect.arrayContaining([['cash', 60], ['wallet', 40]]));
  });

  it('لو تم تغيير refund_method بعد تسجيل مرتجع كاش، يفضّل الوسيلة الجديدة على القيم القديمة', () => {
    const order = {
      refund_method: 'wallet',
      refunded_cash: 100,
      refunded_visa: 0,
      refunded_wallet: 0,
      refunded_instapay: 0,
      payment_method: 'cash',
    };
    expect(refundPartsOf(order, 100)).toEqual([['wallet', 100]]);
  });

  it('مرتجع فاتورة اتسجل كاش ثم اتعدل لمحفظة يخرج من المحفظة لا الكاش', () => {
    const order = {
      refund_method: 'wallet',
      refunded_cash: 580,
      refunded_wallet: 0,
      payment_method: 'cash',
    };
    expect(refundRecordOf(order, 580)).toMatchObject({
      payment_method: 'wallet',
      paid_cash: 0,
      paid_wallet: 580,
    });
  });

  it('من غير أي تقسيمة بيقع على payment_method', () => {
    expect(refundPartsOf({ payment_method: 'instapay' }, 50)).toEqual([['instapay', 50]]);
  });

  it('نصيب الوسيلة بيجمع للإجمالي', () => {
    const order = { refunded_cash: 400, refunded_instapay: 250 };
    const total = ['cash', 'visa', 'wallet', 'instapay', 'method5', 'method6']
      .reduce((s, m) => s + refundShareOfMethod(order, 650, m), 0);
    expect(total).toBeCloseTo(650);
  });
});

describe('applySplit — أساس كل حسابات الخزنة', () => {
  const bucket = () => ({ cash: 0, visa: 0, wallet: 0, instapay: 0, method5: 0, method6: 0 });

  it('بيستخدم التقسيمة لو فيها أي رقم', () => {
    const b = bucket();
    applySplit(b, { paid_cash: 100, paid_visa: 50, paid_amount: 150, payment_method: 'wallet' }, 'paid_amount');
    expect(b.cash).toBe(100); expect(b.visa).toBe(50); expect(b.wallet).toBe(0);
  });

  // حرج: تقسيمة كلها أصفار **لازم** تقع على المبلغ المفرد. لو اتعاملت كتقسيمة
  // صالحة، كل المرتجعات القديمة كانت هتختفي من الخزنة.
  it('التقسيمة الصفرية بتقع على الوسيلة المفردة', () => {
    const b = bucket();
    applySplit(b, { paid_cash: 0, paid_visa: 0, paid_amount: 150, payment_method: 'wallet' }, 'paid_amount');
    expect(b.wallet).toBe(150);
  });

  it('sign=-1 بيعكس الاتجاه', () => {
    const b = bucket();
    applySplit(b, { paid_cash: 100 }, 'paid_amount', { sign: -1 });
    expect(b.cash).toBe(-100);
  });
});
