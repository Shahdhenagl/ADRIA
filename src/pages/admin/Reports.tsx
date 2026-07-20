import { useEffect, useState, useMemo } from 'react';
import { useStore, findLinkedSalaryExpense } from '../../store/useStore';
import { FileBarChart, Printer } from 'lucide-react';
import { openPrintWindow } from '../../utils/printWindow';
import { escapeHtml } from '../../utils/escapeHtml';
import { ALL_PAYMENT_KEYS, activePaymentKeys, payLabelOf, totalOpeningBalance } from '../../utils/paymentMethods';
import { calculateCashRefunded, calculateOrderReturnValue } from '../../utils/returns';
import { applySplit, isInternalTransfer, routeInternalTransfer, isMainTreasuryExpense, isMainTreasuryPurchase } from '../../utils/treasury';
import { businessDateStr, businessDayRange } from '../../utils/businessDay';

export default function Reports() {
  const { storeSettings } = useStore();
  const cur = storeSettings.currency;
  // الوسائل المعروضة = الأربع الأساسية + أي طريقة إضافية (5/6) مفعّلة في الإعدادات
  const METHODS = activePaymentKeys(storeSettings as any).map((k) => [k, payLabelOf(storeSettings as any, k)] as const);
  const currentBusinessDay = () => businessDateStr(storeSettings as any);
  const [from, setFrom] = useState(currentBusinessDay());
  const [to, setTo] = useState(currentBusinessDay());
  const [tab, setTab] = useState<'sales' | 'methods' | 'treasury'>('sales');
  const [extra, setExtra] = useState<{ expenses: any[]; purchases: any[]; salaries: any[] }>({ expenses: [], purchases: [], salaries: [] });
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { fetchAllRows } = await import('../../lib/supabase');
        // جلب كل الصفوف (تخطّي حد 1000) عشان الرصيد الافتتاحي والخزنة يطلعوا صح.
        const [e, p, s, o] = await Promise.all([
          fetchAllRows('expenses'),
          fetchAllRows('purchase_invoices'),
          fetchAllRows('employee_transactions'),
          fetchAllRows('orders', '*, order_items(*)'),
        ]);
        setExtra({ expenses: (e as any[]) || [], purchases: (p as any[]) || [], salaries: (s as any[]) || [] });
        setOrders(((o as any[]) || []).map((r) => ({ ...r, date: r.created_at, items: r.order_items || [] })));
      } catch (err) { console.error(err); }
      setLoading(false);
    })();
  }, []);

  const start = useMemo(() => businessDayRange(from, storeSettings as any).start, [from, storeSettings.dayStartHour]);
  const end = useMemo(() => businessDayRange(to, storeSettings as any).end, [to, storeSettings.dayStartHour]);
  const inRange = (dt: any) => { const d = new Date(dt); return d >= start && d < end; };

  // ── per-method in/out (with manual-income handling) ──
  const computeMethods = (rangeOnly: boolean, beforeStart = false) => {
    const inN: Record<string, number> = {}; ALL_PAYMENT_KEYS.forEach((k) => { inN[k] = 0; });
    const outN: Record<string, number> = {}; ALL_PAYMENT_KEYS.forEach((k) => { outN[k] = 0; });
    const pass = (dt: any) => beforeStart ? new Date(dt) < start : (rangeOnly ? inRange(dt) : true);
    const add = (target: Record<string, number>, rec: any, field: string, methodOverride?: string) =>
      applySplit(target, rec, field, { methodOverride });

    const splitsSumAbs = (rec: any) => ALL_PAYMENT_KEYS.reduce((t, k) => t + Math.abs(Number(rec?.['paid_' + k]) || 0), 0);
    const absSplits = (rec: any) => {
      const out: any = { ...rec };
      ALL_PAYMENT_KEYS.forEach((k) => { out['paid_' + k] = Math.abs(Number(rec?.['paid_' + k]) || 0); });
      return out;
    };

    const debtByInvoice = new Map<string, number>();
    orders.filter((o: any) => !o.is_deleted).forEach((o: any) => {
      if (o.type === 'payment' && /سداد [آأ]?جل للفاتورة رقم #/.test(o.notes || '')) {
        const match = String(o.notes || '').match(/سداد [آأ]?جل للفاتورة رقم #([\w-]+)/);
        if (match?.[1]) debtByInvoice.set(match[1], (debtByInvoice.get(match[1]) || 0) + (Number(o.paid_amount) || 0));
      }
    });

    orders.filter((o: any) => !o.is_deleted).forEach((o: any) => {
      if ((o.type === 'sale' || o.type === 'payment') && pass(o.date)) {
        let paid = Number(o.paid_amount) || 0;
        if (o.type === 'sale') {
          const splitSum = splitsSumAbs(o);
          const refunded = calculateCashRefunded(o);
          paid = splitSum > 0 ? splitSum : Math.max(0, paid - (debtByInvoice.get(o.id) || 0) + refunded);
        }
        if (paid > 0.001) add(inN, { ...o, paid_amount: paid }, 'paid_amount');
      }
      const ref = calculateCashRefunded(o);
      // المرتجع على يوم الاسترجاع (refunded_at) لا يوم البيع؛ fallback للتاريخ القديم.
      if (ref > 0 && pass(o.refunded_at || o.date)) add(outN, { paid_amount: ref, payment_method: o.refund_method || o.payment_method }, 'paid_amount');
    });
    extra.expenses.filter((e) => !isMainTreasuryExpense(e) && pass(e.created_at)).forEach((e) => {
      const amt = Number(e.amount) || 0;
      if (isInternalTransfer(e.category)) { routeInternalTransfer(inN, outN, e); return; }
      if (amt < 0) add(inN, { ...absSplits(e), amount: Math.abs(amt) }, 'amount');
      else add(outN, e, 'amount');
    });
    extra.purchases.filter((p) => !isMainTreasuryPurchase(p) && pass(p.created_at)).forEach((p) => {
      const paid = Number(p.paid_amount) || 0;
      if (paid > 0) add(outN, p, 'paid_amount');
      else if (paid < 0) add(inN, { ...absSplits(p), paid_amount: Math.abs(paid) }, 'paid_amount');
    });

    // الراتب متسجّل مرتين (صف موظف + مصروف «رواتب») فبنعدّه مرة واحدة.
    // الأولوية للربط الصريح employee_transaction_id (db/49)، والمطابقة الهشّة
    // للصفوف القديمة بس — راجع findLinkedSalaryExpense في الستور.
    const hasMatchingSalaryExpense = (tx: any) => Boolean(findLinkedSalaryExpense(extra.expenses as any[], tx));
    extra.salaries
      .filter((s) => !isMainTreasuryExpense(s) && !hasMatchingSalaryExpense(s) && pass(s.created_at))
      .forEach((s) => add(outN, s, 'amount'));
    return { inN, outN };
  };

  const rangeMethods = useMemo(() => computeMethods(true), [orders, extra, from, to]);
  const sum = (o: Record<string, number>) => ALL_PAYMENT_KEYS.reduce((s, k) => s + (o[k] || 0), 0);

  // ── treasury (opening before range + range movement) ──
  const opening = useMemo(() => {
    const b = computeMethods(false, true);
    const init = totalOpeningBalance(storeSettings as any);
    return init + sum(b.inN) - sum(b.outN);
  }, [orders, extra, from]);
  const totalIn = sum(rangeMethods.inN), totalOut = sum(rangeMethods.outN);
  const closing = opening + totalIn - totalOut;

  // ── sales list ──
  const profitOf = (o: any) => (o.items || []).reduce((s: number, it: any) => { const q = (Number(it.quantity) || 0) - (Number(it.returned_quantity) || 0); const cost = Number(it.average_purchase_price ?? it.purchase_price) || 0; return s + ((Number(it.sale_price) || 0) - cost) * q; }, 0);
  const splitsSumAbs = (rec: any) => ALL_PAYMENT_KEYS.reduce((t, k) => t + Math.abs(Number(rec?.['paid_' + k]) || 0), 0);
  const deferredPaidForInvoice = (invoiceId: string) =>
    orders
      .filter((o: any) => !o.is_deleted && o.type === 'payment' && String(o.notes || '').match(new RegExp(`سداد [آأ]?جل للفاتورة رقم #${invoiceId}(\\D|$)`)))
      .reduce((sum: number, o: any) => sum + (Number(o.paid_amount) || 0), 0);
  const originalPaidOf = (o: any) => {
    const splitSum = splitsSumAbs(o);
    if (splitSum > 0) return splitSum;
    return Math.max(0, (Number(o.paid_amount) || 0) - deferredPaidForInvoice(o.id) + calculateCashRefunded(o));
  };
  const effectiveTotalOf = (o: any) => Math.max(0, (Number(o.total) || 0) - calculateOrderReturnValue(o));
  const sales = useMemo(() => orders.filter((o: any) => !o.is_deleted && o.type === 'sale' && inRange(o.date)).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()), [orders, from, to]);
  const salesTotals = useMemo(() => sales.reduce((acc: any, o: any) => { acc.total += effectiveTotalOf(o); acc.paid += originalPaidOf(o); acc.profit += profitOf(o); return acc; }, { total: 0, paid: 0, profit: 0 }), [sales, orders]);

  const fmt = (n: number) => `${(n || 0).toFixed(2)} ${cur}`;

  const printReport = () => {
    let title = '', body = '';
    if (tab === 'sales') {
      title = 'كشف حساب المبيعات';
      body = `<table><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th>مسؤول المبيعات</th><th>الإجمالي</th><th>المدفوع</th><th>الباقي</th><th>الربح</th></tr></thead><tbody>
        ${sales.map((o: any) => `<tr><td>#${o.id}</td><td>${new Date(o.date).toLocaleString('ar-EG')}</td><td>${escapeHtml(o.customer?.name || 'نقدي')}</td><td>${escapeHtml(o.salesperson_name || '-')}</td><td>${effectiveTotalOf(o).toFixed(2)}</td><td>${originalPaidOf(o).toFixed(2)}</td><td>${(effectiveTotalOf(o) - originalPaidOf(o)).toFixed(2)}</td><td>${profitOf(o).toFixed(2)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="4">الإجمالي (${sales.length} فاتورة)</td><td>${salesTotals.total.toFixed(2)}</td><td>${salesTotals.paid.toFixed(2)}</td><td>${(salesTotals.total - salesTotals.paid).toFixed(2)}</td><td>${salesTotals.profit.toFixed(2)}</td></tr></tfoot></table>`;
    } else if (tab === 'methods') {
      title = 'كشف وسائل الدفع (مدين / دائن)';
      body = `<table><thead><tr><th>الوسيلة</th><th>مدين (داخل)</th><th>دائن (خارج)</th><th>الصافي</th></tr></thead><tbody>
        ${METHODS.map(([k, l]) => `<tr><td>${l}</td><td>${rangeMethods.inN[k].toFixed(2)}</td><td>${rangeMethods.outN[k].toFixed(2)}</td><td>${(rangeMethods.inN[k] - rangeMethods.outN[k]).toFixed(2)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td>الإجمالي</td><td>${totalIn.toFixed(2)}</td><td>${totalOut.toFixed(2)}</td><td>${(totalIn - totalOut).toFixed(2)}</td></tr></tfoot></table>`;
    } else {
      title = 'كشف الخزينة';
      body = `<table><tbody>
        <tr><td>الرصيد الافتتاحي (قبل الفترة)</td><td>${opening.toFixed(2)}</td></tr>
        <tr><td>إجمالي الداخل</td><td>${totalIn.toFixed(2)}</td></tr>
        <tr><td>إجمالي الخارج</td><td>${totalOut.toFixed(2)}</td></tr>
        <tr><td><b>رصيد الإغلاق</b></td><td><b>${closing.toFixed(2)}</b></td></tr>
        </tbody></table>
        <h3>التفصيل حسب الوسيلة</h3>
        <table><thead><tr><th>الوسيلة</th><th>داخل</th><th>خارج</th><th>صافي</th></tr></thead><tbody>
        ${METHODS.map(([k, l]) => `<tr><td>${l}</td><td>${rangeMethods.inN[k].toFixed(2)}</td><td>${rangeMethods.outN[k].toFixed(2)}</td><td>${(rangeMethods.inN[k] - rangeMethods.outN[k]).toFixed(2)}</td></tr>`).join('')}
        </tbody></table>`;
    }
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>${title}</title><style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
      *{font-family:'Cairo',sans-serif;box-sizing:border-box;} body{padding:12mm;color:#000;}
      h1{font-size:22px;text-align:center;margin:0;} h2{font-size:14px;text-align:center;color:#555;margin:4px 0 14px;font-weight:700;}
      h3{font-size:14px;margin:14px 0 6px;}
      table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:right;}
      thead th{background:#f1f5f9;font-weight:900;} tfoot td{background:#f8fafc;font-weight:900;}
      @media print{@page{size:A4;margin:8mm;}}
    </style></head><body>
      <h1>${escapeHtml(storeSettings.name)}</h1>
      <h2>${title} — من ${from} إلى ${to}</h2>
      ${body}
      <p style="margin-top:18px;font-size:11px;color:#888;text-align:center;">تم الإصدار: ${new Date().toLocaleString('ar-EG')}</p>
      <script>window.onload=()=>{setTimeout(()=>{window.print();},400);}</script>
    </body></html>`;
    openPrintWindow(html);
  };

  const TABS = [['sales', 'كشف المبيعات'], ['methods', 'وسائل الدفع (مدين/دائن)'], ['treasury', 'الخزينة']] as const;

  return (
    <div className="p-6 md:p-8 space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><FileBarChart className="text-indigo-600" size={30} /> التقارير وكشوف الحساب</h1>
        <p className="text-slate-500 mt-1 text-sm font-medium">كشوف المبيعات ووسائل الدفع والخزينة بفلتر الفترة وتصديرها PDF/طباعة</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1">من</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold" /></div>
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1">إلى</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold" /></div>
        <div className="flex gap-1.5">
          {([['today', 'اليوم'], ['month', 'الشهر']] as const).map(([k, l]) => (
            <button key={k} onClick={() => { const businessToday = currentBusinessDay(); const d = new Date(`${businessToday}T00:00:00`); if (k === 'today') { setFrom(businessToday); setTo(businessToday); } else { setFrom([d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), '01'].join('-')); setTo(businessToday); } }} className="text-xs font-bold bg-slate-100 dark:bg-slate-900 px-3 py-2 rounded-xl">{l}</button>
          ))}
        </div>
        <button onClick={printReport} className="mr-auto bg-indigo-600 hover:bg-indigo-700 text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2"><Printer size={18} /> طباعة / PDF</button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)} className={`px-4 py-2 rounded-xl text-sm font-black ${tab === k ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}`}>{l}</button>
        ))}
      </div>

      {loading && <p className="text-slate-400 text-sm">جاري تحميل البيانات...</p>}

      {tab === 'sales' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 border-b border-slate-100 dark:border-slate-700">
            <Stat label="عدد الفواتير" value={String(sales.length)} />
            <Stat label="إجمالي المبيعات" value={fmt(salesTotals.total)} />
            <Stat label="المحصّل" value={fmt(salesTotals.paid)} green />
            <Stat label="إجمالي الربح" value={fmt(salesTotals.profit)} green />
          </div>
          <div className="overflow-x-auto max-h-[55vh]">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 sticky top-0"><tr><th className="p-2">#</th><th className="p-2">التاريخ</th><th className="p-2">العميل</th><th className="p-2">مسؤول المبيعات</th><th className="p-2">الإجمالي</th><th className="p-2">المدفوع</th><th className="p-2">الباقي</th><th className="p-2">الربح</th></tr></thead>
              <tbody>
                {sales.length === 0 ? <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا توجد مبيعات في الفترة</td></tr>
                  : sales.map((o: any) => (
                    <tr key={o.id} className="border-b border-slate-100 dark:border-slate-700/50">
                      <td className="p-2 font-bold">#{o.id}</td>
                      <td className="p-2 text-xs">{new Date(o.date).toLocaleString('ar-EG')}</td>
                      <td className="p-2">{o.customer?.name || 'نقدي'}</td>
                      <td className="p-2">{o.salesperson_name || '-'}</td>
                      <td className="p-2 font-bold">{effectiveTotalOf(o).toFixed(2)}</td>
                      <td className="p-2 text-emerald-600 font-bold">{originalPaidOf(o).toFixed(2)}</td>
                      <td className="p-2 text-red-600 font-bold">{(effectiveTotalOf(o) - originalPaidOf(o)).toFixed(2)}</td>
                      <td className="p-2 font-bold">{profitOf(o).toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(tab === 'methods' || tab === 'treasury') && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
          {tab === 'treasury' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="الرصيد الافتتاحي" value={fmt(opening)} />
              <Stat label="إجمالي الداخل" value={fmt(totalIn)} green />
              <Stat label="إجمالي الخارج" value={fmt(totalOut)} red />
              <Stat label="رصيد الإغلاق" value={fmt(closing)} />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500"><tr><th className="p-3">الوسيلة</th><th className="p-3">مدين (داخل)</th><th className="p-3">دائن (خارج)</th><th className="p-3">الصافي</th></tr></thead>
              <tbody>
                {METHODS.map(([k, l]) => (
                  <tr key={k} className="border-b border-slate-100 dark:border-slate-700/50">
                    <td className="p-3 font-bold">{l}</td>
                    <td className="p-3 text-emerald-600 font-bold">{rangeMethods.inN[k].toFixed(2)}</td>
                    <td className="p-3 text-red-600 font-bold">{rangeMethods.outN[k].toFixed(2)}</td>
                    <td className="p-3 font-black">{(rangeMethods.inN[k] - rangeMethods.outN[k]).toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 dark:bg-slate-900/40 font-black"><td className="p-3">الإجمالي</td><td className="p-3 text-emerald-700">{totalIn.toFixed(2)}</td><td className="p-3 text-red-700">{totalOut.toFixed(2)}</td><td className="p-3">{(totalIn - totalOut).toFixed(2)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, green, red }: { label: string; value: string; green?: boolean; red?: boolean }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 text-center">
      <div className="text-[11px] font-bold text-slate-500">{label}</div>
      <div className={`text-lg font-black ${green ? 'text-emerald-600' : red ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
    </div>
  );
}
