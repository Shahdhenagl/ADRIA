import { ALL_PAYMENT_KEYS, openingBalanceOf, savingsOpeningBalanceOf } from '../paymentMethods';
import {
  applySplit, isInternalTransfer, isMainTreasuryExpense, isMainTreasuryOrder,
  isMainTreasuryPurchase, refundRecordOf,
} from '../treasury';
import type { AccountType } from './accounts';

/**
 * بناء أرصدة شجرة الحسابات من الجداول القائمة — **قراءة فقط، مافيش كتابة**.
 *
 * كل رقم هنا بيتحسب من نفس الصفوف اللي الشاشات التانية بتقراها، بس بيتجمّع في
 * معادلة واحدة: الأصول = الخصوم + حقوق الملكية. لو المعادلة مااتحققتش، يبقى في
 * حركة ناقصة طرف — وده بالظبط شكل الباجات اللي بنقع فيها.
 */

export interface LedgerInput {
  orders: any[];
  expenses: any[];
  purchaseInvoices: any[];
  employeeTransactions: any[];
  savingsTransactions: any[];
  products: any[];
  /** مخزون دخل بدون فاتورة شراء (db/59) — الطرف المقابل لزيادة المخزون. */
  stockIntakes?: any[];
  /** الديڤو والتوالف — بضاعة خرجت كخسارة. */
  devoItems?: any[];
  settings: any;
}

export interface AccountBalance {
  code: string;
  amount: number;
  /** تفصيل اختياري (لكل وسيلة دفع مثلاً). */
  parts?: Record<string, number>;
}

export interface TrialBalance {
  byCode: Record<string, number>;
  partsByCode: Record<string, Record<string, number>>;
  totals: Record<AccountType, number>;
  assets: number;
  liabilities: number;
  equity: number;
  revenue: number;
  expenses: number;
  profit: number;
  inventory: number;
  /**
   * الأصول − (الخصوم + الملكية + الربح).
   *
   * ⚠️ **مش دليل فساد بيانات لوحده.** المخزون هنا بيتقرا كـ«لقطة» من
   * `products.stock_quantity`، بينما حركته بتيجي من مصادر الموديول ده لسه
   * مابيسجّلهاش كقيود: إدخال مخزون بدون فاتورة (db/59)، الديڤو والتوالف
   * (db/27)، تسويات الجرد (db/18)، والتصنيع. الفرق ده بيستوعبهم كلهم.
   * الكشف الموثوق للحركات الناقصة طرف هو تبويب «فحص السلامة».
   */
  imbalance: number;
}

const sumSplit = (row: any) =>
  ALL_PAYMENT_KEYS.reduce((s, k) => s + (Number(row?.['paid_' + k]) || 0), 0);

const zero = (): Record<string, number> =>
  Object.fromEntries(ALL_PAYMENT_KEYS.map((k) => [k, 0]));

const totalOf = (b: Record<string, number>) =>
  ALL_PAYMENT_KEYS.reduce((s, k) => s + (b[k] || 0), 0);

/** قيمة المرتجع من بنود الفاتورة. */
const refundedOf = (o: any) =>
  (o.items || o.order_items || []).reduce((s: number, it: any) => s + (Number(it.refunded_amount) || 0), 0);

export function buildTrialBalance(input: LedgerInput): TrialBalance {
  const { orders, expenses, purchaseInvoices, employeeTransactions, savingsTransactions, products, stockIntakes, devoItems, settings } = input;
  const byCode: Record<string, number> = {};
  const partsByCode: Record<string, Record<string, number>> = {};
  const add = (code: string, v: number) => { byCode[code] = (byCode[code] || 0) + v; };

  const live = (orders || []).filter((o) => !o.is_deleted);

  // ── 111 خزنة المحل، لكل وسيلة ────────────────────────────────────────────
  const shop = zero();
  ALL_PAYMENT_KEYS.forEach((k) => { shop[k] += openingBalanceOf(settings, k); });

  live.forEach((o) => {
    if (isMainTreasuryOrder(o)) return;
    if (o.type === 'sale' || o.type === 'payment') applySplit(shop, o, 'paid_amount', { sign: 1 });
    const ref = refundedOf(o);
    if (ref > 0) applySplit(shop, refundRecordOf(o, ref), 'paid_amount', { sign: -1 });
  });

  (expenses || []).forEach((e) => {
    if (isMainTreasuryExpense(e)) return;
    // الرواتب بتتعدّ من employee_transactions — الصف ده مرآة ليها (شوف db/49).
    if (e.category === 'رواتب') return;
    const amt = Number(e.amount) || 0;
    if (isInternalTransfer(e.category)) {
      ALL_PAYMENT_KEYS.forEach((k) => { shop[k] += Number(e['paid_' + k]) || 0; });
      return;
    }
    if (amt < 0) {
      const abs: any = { ...e, amount: Math.abs(amt) };
      ALL_PAYMENT_KEYS.forEach((k) => { abs['paid_' + k] = Math.abs(Number(e['paid_' + k]) || 0); });
      applySplit(shop, abs, 'amount', { sign: 1 });
    } else {
      applySplit(shop, e, 'amount', { sign: -1 });
    }
  });

  (purchaseInvoices || []).forEach((p) => {
    if (isMainTreasuryPurchase(p)) return;
    const paid = Number(p.paid_amount) || 0;
    if (paid >= 0) applySplit(shop, p, 'paid_amount', { sign: -1 });
    else {
      // مرتجع مورد / تحصيل منه = فلوس داخلة.
      const abs: any = { ...p, paid_amount: Math.abs(paid) };
      ALL_PAYMENT_KEYS.forEach((k) => { abs['paid_' + k] = Math.abs(Number(p['paid_' + k]) || 0); });
      applySplit(shop, abs, 'paid_amount', { sign: 1 });
    }
  });

  (employeeTransactions || []).forEach((t) => {
    if (isMainTreasuryExpense(t)) return;
    applySplit(shop, t, 'amount', { sign: -1 });
  });

  partsByCode['111'] = shop;
  // الرصيد بيتحط على الحسابات الفرعية (وسيلة بوسيلة) والأب بيجمعهم — لو حطّيناه
  // على الأب كمان كان هيتعدّ مرتين.
  ALL_PAYMENT_KEYS.forEach((k, i) => { byCode[`111${i + 1}`] = shop[k] || 0; });

  // ── 112 الخزنة الرئيسية ──────────────────────────────────────────────────
  const main = zero();
  ALL_PAYMENT_KEYS.forEach((k) => { main[k] += savingsOpeningBalanceOf(settings, k); });
  (savingsTransactions || []).forEach((s) => {
    const m = ALL_PAYMENT_KEYS.includes(s.method) ? s.method : 'cash';
    const amt = Number(s.amount) || 0;
    main[m] += s.direction === 'in' ? amt : -amt;
  });
  partsByCode['112'] = main;
  ALL_PAYMENT_KEYS.forEach((k, i) => { byCode[`112${i + 1}`] = main[k] || 0; });

  // ── 12 المخزون بالتكلفة ──────────────────────────────────────────────────
  const stockValue = (products || []).reduce((s, p) => {
    const qty = Number(p.stock_quantity) || 0;
    const cost = Number(p.average_purchase_price ?? p.purchase_price) || 0;
    return s + qty * cost;
  }, 0);
  add('12', stockValue);

  // ── 131 ذمم العملاء + 51 تكلفة البضاعة + 41/42 المبيعات ──────────────────
  let receivable = 0, salesTotal = 0, refundsTotal = 0, cogs = 0;
  live.forEach((o) => {
    const ref = refundedOf(o);
    if (o.type === 'sale') {
      const total = Number(o.total) || 0;
      salesTotal += total;
      refundsTotal += ref;
      // المستحق بعد المرتجع − المدفوع = مديونية العميل (السالب = دفع زيادة).
      const returnedValue = (o.items || []).reduce((s: number, it: any) => {
        const q = Number(it.returned_quantity) || 0;
        return s + q * (Number(it.sale_price) || 0);
      }, 0);
      const due = Math.max(0, total - returnedValue) - (Number(o.paid_amount) || 0);
      if (due > 0.009) receivable += due;
      // تكلفة المباع = (المباع − المرتجع) × سعر الشراء.
      cogs += (o.items || []).reduce((s: number, it: any) => {
        const q = (Number(it.quantity) || 0) - (Number(it.returned_quantity) || 0);
        const c = Number(it.average_purchase_price ?? it.purchase_price) || 0;
        return s + q * c;
      }, 0);
    } else if (o.type === 'previous_debt') {
      receivable += Math.max(0, (Number(o.total) || 0) - (Number(o.paid_amount) || 0));
    }
  });
  add('131', receivable);
  add('41', salesTotal);
  add('42', -refundsTotal);
  add('51', cogs);

  // ── 132 سلف الموظفين القائمة + 52 الرواتب ────────────────────────────────
  let advances = 0, salaries = 0;
  (employeeTransactions || []).forEach((t) => {
    const amt = Number(t.amount) || 0;
    if (t.type === 'advance') advances += amt;
    else salaries += amt; // salary / incentive
  });
  // السلفة بتتعامل كجزء من مصروف الرواتب، **مش كأصل**.
  //
  // ليه؟ السلفة بتتخصم من صافي الراتب وقت صرفه، ومفيش تسجيل مستقل لسدادها —
  // فلو عددناها أصل (ذمة على الموظف) مش هيبقى فيه حاجة تصفّيها وهتفضل تتراكم
  // في الأصول للأبد. وكمان لو عددناها أصل **ومصروف** في نفس الوقت، الميزان
  // بيختل بمقدارها (الكاش نزل مرة والطرف المقابل اتسجّل مرتين).
  // الحساب 132 بيفضل للعرض بس ومستبعد من إجمالي الأصول.
  add('132', Math.max(0, advances));
  add('52', salaries + advances);

  // ── 21 ذمم الموردين / 133 أرصدة لدينا عندهم ──────────────────────────────
  let payable = 0, supplierCredit = 0;
  (purchaseInvoices || []).forEach((p) => {
    const total = Number(p.total) || 0;
    const paid = Number(p.paid_amount) || 0;
    const diff = total - paid;
    if (diff > 0.009) payable += diff;
    else if (diff < -0.009) supplierCredit += -diff;
  });
  add('21', payable);
  add('133', supplierCredit);

  // ── 22 عرابين الحجوزات ───────────────────────────────────────────────────
  // فئة «حجز»: سالب = عربون محصّل (التزام علينا)، موجب = رد العربون.
  const deposits = (expenses || [])
    .filter((e) => e.category === 'حجز')
    .reduce((s, e) => s - (Number(e.amount) || 0), 0);
  add('22', Math.max(0, deposits));

  // ── 43 إيرادات أخرى / 53 مصروفات تشغيلية / 54 تسويات ─────────────────────
  let otherIncome = 0, opex = 0, adjustments = 0;
  const ADJUSTMENT_CATS = ['تسوية جرد الخزنة', 'فرق استبدال مبيعات', 'خصم مرتجع'];
  (expenses || []).forEach((e) => {
    const amt = Number(e.amount) || 0;
    const cat = e.category || '';
    if (cat === 'رواتب' || isInternalTransfer(cat) || cat === 'حجز' || cat === 'تحويل حجز') return;
    if (cat === 'تحويل للخزنة الرئيسية' || cat === 'تحويل من الخزنة الرئيسية') return;
    if (ADJUSTMENT_CATS.includes(cat)) { adjustments += amt; return; }
    if (amt < 0) otherIncome += -amt;
    else opex += amt;
  });
  add('43', otherIncome);
  add('53', opex);
  add('54', adjustments);

  // ── 31 رأس المال (الأرصدة الافتتاحية) ────────────────────────────────────
  const openingCapital =
    ALL_PAYMENT_KEYS.reduce((s, k) => s + openingBalanceOf(settings, k), 0) +
    ALL_PAYMENT_KEYS.reduce((s, k) => s + savingsOpeningBalanceOf(settings, k), 0);
  add('31', openingCapital);

  // ── 34 مخزون داخل بدون فاتورة + 55 خسائر الديڤو ──────────────────────────
  // الإدخال بدون شراء بيزوّد أصل من غير ما فلوس تخرج، فلازم يقابله طرف في
  // حقوق الملكية وإلا الميزان يختل بقيمته كلها.
  const intakeValue = (stockIntakes || []).reduce((s, i) => s + (Number(i.total_value) || 0), 0);
  add('34', intakeValue);
  const devoLoss = (devoItems || []).reduce((s, d) => s + ((Number(d.quantity) || 0) * (Number(d.unit_cost) || 0)), 0);
  add('54', devoLoss);

  // ── الإجماليات ───────────────────────────────────────────────────────────
  // 132 (سلف الموظفين) مستبعد عن قصد — بيتحسب ضمن مصروف الرواتب فوق.
  const cash = totalOf(shop) + totalOf(main);
  const assets = cash + (byCode['12'] || 0) + (byCode['131'] || 0) + (byCode['133'] || 0);
  const liabilities = (byCode['21'] || 0) + (byCode['22'] || 0);
  const revenue = (byCode['41'] || 0) + (byCode['42'] || 0) + (byCode['43'] || 0);
  const expensesTotal = (byCode['51'] || 0) + (byCode['52'] || 0) + (byCode['53'] || 0) + (byCode['54'] || 0);
  const profit = revenue - expensesTotal;
  const equity = (byCode['31'] || 0) + (byCode['32'] || 0) + (byCode['34'] || 0);
  add('33', profit);

  return {
    byCode, partsByCode,
    totals: {
      asset: assets, liability: liabilities, equity: equity + profit,
      revenue, expense: expensesTotal,
    },
    assets, liabilities, equity, revenue, expenses: expensesTotal, profit,
    inventory: byCode['12'] || 0,
    imbalance: assets - (liabilities + equity + profit),
  };
}

export { sumSplit };
