import { describe, it, expect } from 'vitest';
import {
  checkSalaryPairs, checkMainTreasuryPairs, checkRefundSanity,
  checkSplitConsistency, checkDuplicateInvoices, runIntegrityChecks, type IntegrityInput,
} from './integrity';

/**
 * التستات دي بتعيد إنتاج **الباجات الحقيقية اللي حصلت فعلاً** في السيستم.
 * كل واحدة اسمها بيوصف الحادثة، عشان لو رجعت تاني نعرف على طول إيه اللي اتكسر.
 */

const empty: IntegrityInput = {
  orders: [], expenses: [], purchaseInvoices: [],
  employeeTransactions: [], savingsTransactions: [],
};
const input = (p: Partial<IntegrityInput>): IntegrityInput => ({ ...empty, ...p });

describe('أزواج الرواتب: صف الموظف + المصروف', () => {
  it('الزوج الكامل مايطلّعش أي ملاحظة', () => {
    const issues = checkSalaryPairs(input({
      employeeTransactions: [{ id: 't1', created_at: '2026-08-01T12:00:00Z', amount: 500, type: 'advance', note: 'سلفة' }],
      expenses: [{ id: 'e1', created_at: '2026-08-01T12:00:00Z', amount: 500, category: 'رواتب', note: 'سلفة - malak' }],
    }));
    expect(issues).toHaveLength(0);
  });

  // الحادثة: سلفة ٥٠٠ اتسجّلت مرتين، واحدة اتمسحت من صفحة الخزنة فاتمسح المصروف
  // وفضل صف الموظف — فالمبلغ فضل متخصوم من راتب malak.
  it('بيكشف صف موظف يتيم حتى لو مبلغه مكرر في نفس اليوم', () => {
    const issues = checkSalaryPairs(input({
      employeeTransactions: [
        { id: 't1', created_at: '2026-08-01T12:00:00Z', amount: 500, type: 'advance' },
        { id: 't2', created_at: '2026-08-01T12:00:00Z', amount: 500, type: 'advance' },
      ],
      expenses: [{ id: 'e1', created_at: '2026-08-01T12:00:00Z', amount: 500, category: 'رواتب' }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toContain('من غير صرف');
    expect(issues[0].severity).toBe('error');
  });

  it('بيكشف مصروف رواتب من غير صف على الموظف', () => {
    const issues = checkSalaryPairs(input({
      employeeTransactions: [],
      expenses: [{ id: 'e1', created_at: '2026-08-01T12:00:00Z', amount: 300, category: 'رواتب' }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toContain('من غير تسجيل على الموظف');
  });

  // الحادثة: سلفة ١٠ اتسجّلت على خزنة المحل بتاريخ قديم، اتمسحت، واتعادت على
  // الرئيسية. صف المحل فضل يتيم و«رصيد بداية اليوم» فضل -10 لشهر كامل.
  it('بيكشف صف المحل اليتيم لما النسخة الرئيسية موجودة', () => {
    const issues = checkSalaryPairs(input({
      employeeTransactions: [
        { id: 'orphan', created_at: '2026-07-07T12:00:00Z', amount: 10, type: 'advance', note: 'من الراتب' },
        { id: 'main', created_at: '2026-07-07T12:00:00Z', amount: 10, type: 'advance', note: '[MAIN_TREASURY] سلفه [SVG:5e125f85-9d43-4bd0-b0c2-c63474a621ff]' },
      ],
      expenses: [{ id: 'e-main', created_at: '2026-07-07T12:00:00Z', amount: 10, category: 'رواتب', note: '[MAIN_TREASURY] [SVG:5e125f85-9d43-4bd0-b0c2-c63474a621ff]' }],
    }));
    // الصفوف الموسومة بالرئيسية مستبعدة من الفحص ده، فالباقي = صف يتيم واحد.
    expect(issues).toHaveLength(1);
    expect(issues[0].rows.some((r) => r.id === 'orphan')).toBe(true);
  });
});

describe('حركات الخزنة الرئيسية', () => {
  it('الحركة المربوطة بدفترها سليمة', () => {
    const issues = checkMainTreasuryPairs(input({
      expenses: [{ id: 'e1', amount: 10, note: '[MAIN_TREASURY] سلفه [SVG:5e125f85-9d43-4bd0-b0c2-c63474a621ff]', created_at: '2026-07-07' }],
      savingsTransactions: [{ id: 's1', group_id: '5e125f85-9d43-4bd0-b0c2-c63474a621ff', amount: 10, direction: 'out' }],
    }));
    expect(issues).toHaveLength(0);
  });

  it('بيكشف حركة رئيسية اتمسح صف دفترها', () => {
    const issues = checkMainTreasuryPairs(input({
      expenses: [{ id: 'e1', amount: 10, note: '[MAIN_TREASURY] سلفه [SVG:deadbeef-0000-0000-0000-000000000000]', created_at: '2026-07-07' }],
      savingsTransactions: [],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].rows[0].id).toBe('e1');
  });
});

describe('سلامة المرتجعات', () => {
  it('المرتجع في حدود المباع سليم', () => {
    const issues = checkRefundSanity(input({
      orders: [{ id: '1', total: 650, items: [{ name: 'x', quantity: 1, returned_quantity: 1, refunded_amount: 650 }] }],
    }));
    expect(issues).toHaveLength(0);
  });

  it('بيكشف كمية مرتجعة أكبر من المباعة', () => {
    const issues = checkRefundSanity(input({
      orders: [{ id: '9', total: 650, items: [{ name: 'x', quantity: 1, returned_quantity: 2, refunded_amount: 650 }] }],
    }));
    expect(issues).toHaveLength(1);
  });

  it('بيكشف مبلغ مرتجع أكبر من إجمالي الفاتورة', () => {
    const issues = checkRefundSanity(input({
      orders: [{ id: '9', total: 100, items: [{ name: 'x', quantity: 1, returned_quantity: 1, refunded_amount: 500 }] }],
    }));
    expect(issues).toHaveLength(1);
  });

  it('بيتجاهل الفواتير المحذوفة', () => {
    const issues = checkRefundSanity(input({
      orders: [{ id: '9', total: 100, is_deleted: true, items: [{ name: 'x', quantity: 1, returned_quantity: 5, refunded_amount: 500 }] }],
    }));
    expect(issues).toHaveLength(0);
  });

  it('يحسب المبلغ المخصوم من الخزنة بدقة عند الإرجاع بواسطة refundRecordOf', async () => {
    const { refundRecordOf } = await import('../treasury');
    const order = {
      id: 'inv-1',
      total: 650,
      paid_amount: 635,
      paid_cash: 650,
      refunded_cash: 635,
      refund_method: 'cash',
    };
    const rec = refundRecordOf(order, 635);
    expect(rec.paid_cash).toBe(635);
  });
});

describe('تطابق تقسيمة الدفع', () => {
  it('التقسيمة المطابقة سليمة', () => {
    const issues = checkSplitConsistency(input({
      orders: [{ id: '1', paid_amount: 300, paid_cash: 100, paid_visa: 200, items: [] }],
    }));
    expect(issues).toHaveLength(0);
  });

  // التقسيمة مابتتعدّلش وقت المرتجع، فالمقارنة لازم تضيف المرتجع.
  it('التقسيمة بعد مرتجع تفضل مطابقة', () => {
    const issues = checkSplitConsistency(input({
      orders: [{
        id: '1', paid_amount: 50, paid_cash: 300,
        items: [{ refunded_amount: 250 }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it('بيكشف تقسيمة مش مطابقة', () => {
    const issues = checkSplitConsistency(input({
      orders: [{ id: '1', paid_amount: 300, paid_cash: 100, items: [] }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('الفاتورة من غير تقسيمة مسجّلة مقبولة (بيانات قديمة)', () => {
    const issues = checkSplitConsistency(input({
      orders: [{ id: '1', paid_amount: 300, payment_method: 'cash', items: [] }],
    }));
    expect(issues).toHaveLength(0);
  });
});

describe('الفواتير المكررة', () => {
  const at = (iso: string, over: Partial<any> = {}) => ({
    id: over.id || 'x', type: 'sale', total: 100, date: iso,
    items: [{ name: 'a' }], ...over,
  });

  // الحادثة: النت بيفصل بعد ما الطلب يوصل السيرفر، الكاشير يعيد الحفظ فتتسجّل مرتين.
  it('بيكشف فاتورتين متطابقتين خلال دقيقة', () => {
    const issues = checkDuplicateInvoices(input({
      orders: [
        at('2026-08-01T10:00:00Z', { id: '100' }),
        at('2026-08-01T10:00:40Z', { id: '101' }),
      ],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('مابيكشفش لو الفرق أكتر من ٥ دقايق', () => {
    expect(checkDuplicateInvoices(input({
      orders: [
        at('2026-08-01T10:00:00Z', { id: '100' }),
        at('2026-08-01T10:30:00Z', { id: '101' }),
      ],
    }))).toHaveLength(0);
  });

  it('مابيكشفش لو الإجمالي مختلف', () => {
    expect(checkDuplicateInvoices(input({
      orders: [
        at('2026-08-01T10:00:00Z', { id: '100' }),
        at('2026-08-01T10:00:30Z', { id: '101', total: 250 }),
      ],
    }))).toHaveLength(0);
  });

  // بعد db/63 البصمة الفريدة بتضمن إنهم مختلفين فعلاً — مفيش إنذار كاذب.
  it('مابيكشفش لو الاتنين ليهم بصمة client_ref', () => {
    expect(checkDuplicateInvoices(input({
      orders: [
        at('2026-08-01T10:00:00Z', { id: '100', client_ref: 'r1' }),
        at('2026-08-01T10:00:30Z', { id: '101', client_ref: 'r2' }),
      ],
    }))).toHaveLength(0);
  });

  it('بيتجاهل المحذوفة', () => {
    expect(checkDuplicateInvoices(input({
      orders: [
        at('2026-08-01T10:00:00Z', { id: '100' }),
        at('2026-08-01T10:00:30Z', { id: '101', is_deleted: true }),
      ],
    }))).toHaveLength(0);
  });
});

describe('التجميع', () => {
  it('الأخطاء بتيجي قبل التحذيرات', () => {
    const issues = runIntegrityChecks(input({
      orders: [{ id: '1', paid_amount: 300, paid_cash: 100, items: [] }],
      employeeTransactions: [{ id: 't1', created_at: '2026-08-01T12:00:00Z', amount: 500 }],
    }));
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues[0].severity).toBe('error');
    expect(issues[issues.length - 1].severity).toBe('warning');
  });

  it('البيانات السليمة مابتطلّعش أي ملاحظة', () => {
    expect(runIntegrityChecks(empty)).toHaveLength(0);
  });
});
