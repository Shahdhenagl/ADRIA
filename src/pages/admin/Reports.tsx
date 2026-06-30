import { useEffect, useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { FileBarChart, Printer } from 'lucide-react';
import { openPrintWindow } from '../../utils/printWindow';
import { escapeHtml } from '../../utils/escapeHtml';

const METHODS = [['cash', 'كاش'], ['visa', 'فيزا'], ['wallet', 'محفظة'], ['instapay', 'انستا باي']] as const;
const todayStr = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };

export default function Reports() {
  const { orders, storeSettings } = useStore();
  const cur = storeSettings.currency;
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [tab, setTab] = useState<'sales' | 'methods' | 'treasury'>('sales');
  const [extra, setExtra] = useState<{ expenses: any[]; purchases: any[]; salaries: any[] }>({ expenses: [], purchases: [], salaries: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { supabase } = await import('../../lib/supabase');
        const [e, p, s] = await Promise.all([
          supabase.from('expenses').select('*'),
          supabase.from('purchase_invoices').select('*'),
          supabase.from('employee_transactions').select('*'),
        ]);
        setExtra({ expenses: (e.data as any[]) || [], purchases: (p.data as any[]) || [], salaries: (s.data as any[]) || [] });
      } catch (err) { console.error(err); }
      setLoading(false);
    })();
  }, []);

  const start = useMemo(() => new Date(`${from}T00:00:00`), [from]);
  const end = useMemo(() => { const d = new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1); return d; }, [to]);
  const inRange = (dt: any) => { const d = new Date(dt); return d >= start && d < end; };

  // ── per-method in/out (with manual-income handling) ──
  const computeMethods = (rangeOnly: boolean, beforeStart = false) => {
    const inN: Record<string, number> = { cash: 0, visa: 0, wallet: 0, instapay: 0 };
    const outN: Record<string, number> = { cash: 0, visa: 0, wallet: 0, instapay: 0 };
    const pass = (dt: any) => beforeStart ? new Date(dt) < start : (rangeOnly ? inRange(dt) : true);
    const add = (target: Record<string, number>, rec: any, field: string, methodOverride?: string) => {
      const c = +rec.paid_cash || 0, v = +rec.paid_visa || 0, w = +rec.paid_wallet || 0, i = +rec.paid_instapay || 0;
      if (c + v + w + i > 0) { target.cash += c; target.visa += v; target.wallet += w; target.instapay += i; return; }
      const a = Math.abs(+rec[field] || 0); const m = methodOverride || (['cash', 'visa', 'wallet', 'instapay'].includes(rec.payment_method) ? rec.payment_method : 'cash');
      target[m] += a;
    };
    orders.filter((o: any) => !o.is_deleted && pass(o.date)).forEach((o: any) => {
      if (o.type === 'sale' || o.type === 'payment') add(inN, o, 'paid_amount');
      const ref = (o.items || []).reduce((t: number, it: any) => t + (+it.refunded_amount || 0), 0);
      if (ref > 0) add(outN, { paid_amount: ref, payment_method: o.refund_method || o.payment_method }, 'paid_amount');
    });
    extra.expenses.filter((e) => pass(e.created_at)).forEach((e) => {
      const amt = Number(e.amount) || 0;
      if (amt < 0) add(inN, { ...e, amount: Math.abs(amt), paid_cash: Math.abs(+e.paid_cash || 0), paid_visa: Math.abs(+e.paid_visa || 0), paid_wallet: Math.abs(+e.paid_wallet || 0), paid_instapay: Math.abs(+e.paid_instapay || 0) }, 'amount');
      else add(outN, e, 'amount');
    });
    extra.purchases.filter((p) => pass(p.created_at)).forEach((p) => add(outN, p, 'paid_amount'));
    extra.salaries.filter((s) => pass(s.created_at)).forEach((s) => add(outN, s, 'amount'));
    return { inN, outN };
  };

  const rangeMethods = useMemo(() => computeMethods(true), [orders, extra, from, to]);
  const sum = (o: Record<string, number>) => o.cash + o.visa + o.wallet + o.instapay;

  // ── treasury (opening before range + range movement) ──
  const opening = useMemo(() => {
    const b = computeMethods(false, true);
    const init = Number((storeSettings as any).initialBalance ?? (storeSettings as any).initial_balance) || 0;
    return init + sum(b.inN) - sum(b.outN);
  }, [orders, extra, from]);
  const totalIn = sum(rangeMethods.inN), totalOut = sum(rangeMethods.outN);
  const closing = opening + totalIn - totalOut;

  // ── sales list ──
  const profitOf = (o: any) => (o.items || []).reduce((s: number, it: any) => { const q = (Number(it.quantity) || 0) - (Number(it.returned_quantity) || 0); const cost = Number(it.average_purchase_price ?? it.purchase_price) || 0; return s + ((Number(it.sale_price) || 0) - cost) * q; }, 0);
  const sales = useMemo(() => orders.filter((o: any) => !o.is_deleted && o.type === 'sale' && inRange(o.date)).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()), [orders, from, to]);
  const salesTotals = useMemo(() => sales.reduce((acc: any, o: any) => { acc.total += Number(o.total) || 0; acc.paid += Number(o.paid_amount) || 0; acc.profit += profitOf(o); return acc; }, { total: 0, paid: 0, profit: 0 }), [sales]);

  const fmt = (n: number) => `${(n || 0).toFixed(2)} ${cur}`;

  const printReport = () => {
    let title = '', body = '';
    if (tab === 'sales') {
      title = 'كشف حساب المبيعات';
      body = `<table><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th>مسؤول المبيعات</th><th>الإجمالي</th><th>المدفوع</th><th>الباقي</th><th>الربح</th></tr></thead><tbody>
        ${sales.map((o: any) => `<tr><td>#${o.id}</td><td>${new Date(o.date).toLocaleString('ar-EG')}</td><td>${escapeHtml(o.customer?.name || 'نقدي')}</td><td>${escapeHtml(o.salesperson_name || '-')}</td><td>${(Number(o.total) || 0).toFixed(2)}</td><td>${(Number(o.paid_amount) || 0).toFixed(2)}</td><td>${((Number(o.total) || 0) - (Number(o.paid_amount) || 0)).toFixed(2)}</td><td>${profitOf(o).toFixed(2)}</td></tr>`).join('')}
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
            <button key={k} onClick={() => { const d = new Date(); if (k === 'today') { setFrom(todayStr()); setTo(todayStr()); } else { setFrom([d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), '01'].join('-')); setTo(todayStr()); } }} className="text-xs font-bold bg-slate-100 dark:bg-slate-900 px-3 py-2 rounded-xl">{l}</button>
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
                      <td className="p-2 font-bold">{(Number(o.total) || 0).toFixed(2)}</td>
                      <td className="p-2 text-emerald-600 font-bold">{(Number(o.paid_amount) || 0).toFixed(2)}</td>
                      <td className="p-2 text-red-600 font-bold">{((Number(o.total) || 0) - (Number(o.paid_amount) || 0)).toFixed(2)}</td>
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
