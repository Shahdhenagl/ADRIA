import { useMemo, useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Landmark, Save, Download, Search, Banknote, CreditCard, Wallet as WalletIcon, Smartphone, Zap, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { activePaymentKeys, payLabelOf, type PaymentKey } from '../../utils/paymentMethods';
import { buildPaymentLedger } from '../../utils/paymentLedger';
import * as XLSX from 'xlsx';

const METHOD_ICON: Record<string, any> = { cash: Banknote, visa: CreditCard, wallet: WalletIcon, instapay: Smartphone, method5: Zap, method6: Landmark };
const KIND_LABEL: Record<string, string> = { sale: 'بيع', payment: 'سداد آجل', return: 'مرتجع', expense: 'مصروف', purchase: 'شراء', transfer: 'تحويل' };

export default function PaymentAccounts() {
  const { orders, expenses, purchaseInvoices, storeSettings, updateSettings } = useStore();
  const cur = storeSettings.currency;
  const methods = activePaymentKeys(storeSettings as any);

  const openingOf = (k: string): number => {
    const ob = storeSettings.paymentOpeningBalances;
    if (ob && ob[k] !== undefined && ob[k] !== null) return Number(ob[k]) || 0;
    return k === 'cash' ? Number(storeSettings.initial_balance) || 0 : 0; // توافق مع الرصيد الافتتاحي القديم للكاش
  };

  const [selected, setSelected] = useState<PaymentKey>(methods[0] || 'cash');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  // محرّر الأرصدة الافتتاحية
  const [openingDraft, setOpeningDraft] = useState<Record<string, string>>({});
  const [savingOpen, setSavingOpen] = useState(false);
  useEffect(() => {
    const d: Record<string, string> = {};
    methods.forEach((k) => { d[k] = String(openingOf(k)); });
    setOpeningDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSettings.paymentOpeningBalances, storeSettings.initial_balance, methods.join(',')]);

  const ledger = useMemo(() => buildPaymentLedger(orders, expenses, purchaseInvoices), [orders, expenses, purchaseInvoices]);

  // ملخص كل الوسائل (كل الفترات)
  const summary = useMemo(() => {
    const map: Record<string, { in: number; out: number; balance: number }> = {};
    methods.forEach((k) => { map[k] = { in: 0, out: 0, balance: openingOf(k) }; });
    for (const e of ledger) {
      if (!map[e.method]) continue;
      map[e.method].in += e.inAmount;
      map[e.method].out += e.outAmount;
      map[e.method].balance += e.inAmount - e.outAmount;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, methods.join(','), storeSettings.paymentOpeningBalances, storeSettings.initial_balance]);

  // كشف الوسيلة المختارة
  const statement = useMemo(() => {
    const all = ledger.filter((e) => e.method === selected).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const fromT = from ? new Date(from).setHours(0, 0, 0, 0) : -Infinity;
    const toT = to ? new Date(to).setHours(23, 59, 59, 999) : Infinity;
    // رصيد افتتاحي للفترة = الافتتاحي العام + صافي كل ما قبل تاريخ البداية
    let periodOpening = openingOf(selected);
    const rows: { e: typeof all[number]; balance: number }[] = [];
    let running = periodOpening;
    for (const e of all) {
      const t = new Date(e.date).getTime();
      if (t < fromT) { periodOpening += e.inAmount - e.outAmount; running = periodOpening; continue; }
      if (t > toT) continue;
      const q = search.trim();
      running += e.inAmount - e.outAmount;
      if (q && !(`${e.desc} ${KIND_LABEL[e.kind]}`.includes(q))) continue;
      rows.push({ e, balance: running });
    }
    const totalIn = rows.reduce((s, r) => s + r.e.inAmount, 0);
    const totalOut = rows.reduce((s, r) => s + r.e.outAmount, 0);
    const closing = running;
    return { rows, periodOpening, totalIn, totalOut, closing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, selected, from, to, search, storeSettings.paymentOpeningBalances, storeSettings.initial_balance]);

  const saveOpening = async () => {
    setSavingOpen(true);
    const obj: Record<string, number> = { ...(storeSettings.paymentOpeningBalances || {}) };
    methods.forEach((k) => { obj[k] = Number(openingDraft[k]) || 0; });
    try {
      // نُبقي الرصيد الافتتاحي القديم للكاش متزامناً مع بقية الحسابات (الخزينة تستخدمه)
      await updateSettings({ paymentOpeningBalances: obj, initial_balance: Number(openingDraft['cash']) || 0 });
      alert('تم حفظ الأرصدة الافتتاحية ✅');
    } catch (err) {
      alert((err as Error)?.message || 'تعذّر حفظ الأرصدة');
    }
    setSavingOpen(false);
  };

  const exportExcel = () => {
    const rows = statement.rows.map((r) => ({
      'التاريخ': new Date(r.e.date).toLocaleString('ar-EG'),
      'البيان': r.e.desc,
      'النوع': KIND_LABEL[r.e.kind],
      'وارد': r.e.inAmount || '',
      'صادر': r.e.outAmount || '',
      'الرصيد': r.balance.toFixed(2),
    }));
    const ws = XLSX.utils.json_to_sheet([{ 'البيان': 'رصيد افتتاحي', 'الرصيد': statement.periodOpening.toFixed(2) }, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, payLabelOf(storeSettings as any, selected).slice(0, 28));
    XLSX.writeFile(wb, `كشف_${payLabelOf(storeSettings as any, selected)}.xlsx`);
  };

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-6 md:p-8 space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><Landmark className="text-indigo-600" size={28} /> كشوف حسابات وسائل الدفع</h1>
        <p className="text-slate-500 mt-1 text-sm font-medium">كشف حساب بالمعاملات لكل وسيلة (وارد/صادر ورصيد جارٍ)، مع رصيد افتتاحي مستقل لكل وسيلة. الفواتير المقسّمة بتظهر نصيب كل وسيلة على حدة.</p>
      </div>

      {/* ملخص أرصدة كل الوسائل */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {methods.map((k) => {
          const Icon = METHOD_ICON[k] || WalletIcon;
          const s = summary[k] || { balance: openingOf(k) };
          const active = selected === k;
          return (
            <button key={k} onClick={() => setSelected(k)} className={`text-right rounded-2xl border p-3 transition ${active ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300'}`}>
              <div className="flex items-center gap-2 mb-1"><Icon size={16} className={active ? 'text-white' : 'text-indigo-500'} /><span className={`text-[11px] font-bold ${active ? 'text-indigo-100' : 'text-slate-500'} truncate`}>{payLabelOf(storeSettings as any, k)}</span></div>
              <div className={`text-lg font-black ${active ? 'text-white' : (s.balance < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-100')}`}>{fmt(s.balance)}</div>
              <div className={`text-[10px] ${active ? 'text-indigo-100' : 'text-slate-400'}`}>{cur}</div>
            </button>
          );
        })}
      </div>

      {/* الأرصدة الافتتاحية */}
      <details className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
        <summary className="cursor-pointer font-black text-slate-800 dark:text-white flex items-center gap-2"><Banknote size={18} className="text-emerald-600" /> الأرصدة الافتتاحية لكل وسيلة</summary>
        <p className="text-[11px] text-slate-400 mt-2 mb-3">الرصيد اللي كان موجود في كل وسيلة قبل ما تبدأ تسجّل على النظام. بيظهر كأول سطر في الكشف ويُضاف للرصيد.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {methods.map((k) => (
            <div key={k}>
              <label className="text-xs font-bold text-slate-500 block mb-1 truncate">{payLabelOf(storeSettings as any, k)}</label>
              <input type="number" value={openingDraft[k] ?? ''} onChange={(e) => setOpeningDraft((d) => ({ ...d, [k]: e.target.value }))} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          ))}
        </div>
        <button onClick={saveOpening} disabled={savingOpen} className="mt-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2"><Save size={18} /> {savingOpen ? 'جاري الحفظ...' : 'حفظ الأرصدة الافتتاحية'}</button>
      </details>

      {/* أدوات الكشف */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {methods.map((k) => (
            <button key={k} onClick={() => setSelected(k)} className={`px-3 py-2 rounded-xl text-sm font-black ${selected === k ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}`}>{payLabelOf(storeSettings as any, k)}</button>
          ))}
        </div>
        <div className="flex items-end gap-2 mr-auto flex-wrap">
          <div><label className="text-[11px] font-bold text-slate-500 block mb-1">من</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold outline-none" /></div>
          <div><label className="text-[11px] font-bold text-slate-500 block mb-1">إلى</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold outline-none" /></div>
          <button onClick={exportExcel} className="bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-bold px-4 py-2 rounded-xl flex items-center gap-2 text-sm"><Download size={16} /> Excel</button>
        </div>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث في البيان..." className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pr-9 pl-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      {/* ملخص الكشف */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="رصيد افتتاحي" value={`${fmt(statement.periodOpening)} ${cur}`} />
        <MiniStat label="إجمالي الوارد" value={`${fmt(statement.totalIn)} ${cur}`} tone="in" />
        <MiniStat label="إجمالي الصادر" value={`${fmt(statement.totalOut)} ${cur}`} tone="out" />
        <MiniStat label="الرصيد الحالي" value={`${fmt(statement.closing)} ${cur}`} tone={statement.closing < 0 ? 'out' : 'bold'} />
      </div>

      {/* جدول الكشف */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 sticky top-0">
              <tr>
                <th className="p-3">التاريخ</th><th className="p-3">البيان</th><th className="p-3 text-center">النوع</th>
                <th className="p-3 text-center">وارد</th><th className="p-3 text-center">صادر</th><th className="p-3 text-center">الرصيد</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50/60 dark:bg-slate-900/30 border-b border-slate-100 dark:border-slate-700/50">
                <td className="p-3 text-slate-400">—</td><td className="p-3 font-black text-slate-600 dark:text-slate-300">رصيد افتتاحي</td><td></td><td></td><td></td>
                <td className="p-3 text-center font-black">{fmt(statement.periodOpening)}</td>
              </tr>
              {statement.rows.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد حركات في هذه الفترة</td></tr>
                : statement.rows.map((r) => (
                  <tr key={r.e.id} className="border-b border-slate-100 dark:border-slate-700/50">
                    <td className="p-3 text-slate-500 whitespace-nowrap text-xs">{new Date(r.e.date).toLocaleDateString('ar-EG')}</td>
                    <td className="p-3 font-semibold text-slate-800 dark:text-slate-100">{r.e.desc}</td>
                    <td className="p-3 text-center"><span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{KIND_LABEL[r.e.kind]}</span></td>
                    <td className="p-3 text-center font-bold text-emerald-600">{r.e.inAmount > 0 ? <span className="inline-flex items-center gap-1"><ArrowDownLeft size={13} />{fmt(r.e.inAmount)}</span> : '—'}</td>
                    <td className="p-3 text-center font-bold text-red-600">{r.e.outAmount > 0 ? <span className="inline-flex items-center gap-1"><ArrowUpRight size={13} />{fmt(r.e.outAmount)}</span> : '—'}</td>
                    <td className={`p-3 text-center font-black ${r.balance < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{fmt(r.balance)}</td>
                  </tr>
                ))}
            </tbody>
            {statement.rows.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-slate-100 dark:bg-slate-900/60 font-black">
                  <td className="p-3" colSpan={3}>الإجمالي</td>
                  <td className="p-3 text-center text-emerald-700">{fmt(statement.totalIn)}</td>
                  <td className="p-3 text-center text-red-700">{fmt(statement.totalOut)}</td>
                  <td className="p-3 text-center">{fmt(statement.closing)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' | 'bold' }) {
  const color = tone === 'in' ? 'text-emerald-600' : tone === 'out' ? 'text-red-600' : 'text-slate-800 dark:text-slate-100';
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 text-center">
      <div className="text-[11px] font-bold text-slate-500">{label}</div>
      <div className={`text-base md:text-lg font-black mt-1 ${color}`}>{value}</div>
    </div>
  );
}
