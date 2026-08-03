import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Network, AlertTriangle, CheckCircle2, RefreshCw, Scale } from 'lucide-react';
import { activePaymentKeys, payLabelOf } from '../../utils/paymentMethods';
import { expandAccounts, TYPE_LABEL, type AccountDef, type AccountType } from '../../utils/accounting/accounts';
import { buildTrialBalance } from '../../utils/accounting/trialBalance';
import { runIntegrityChecks } from '../../utils/accounting/integrity';

/**
 * شجرة الحسابات — عرض محاسبي موحّد فوق البيانات القائمة.
 *
 * الصفحة دي **بتقرا بس**. قيمتها إنها بتجمع كل الأرقام المبعثرة في معادلة
 * واحدة (الأصول = الخصوم + حقوق الملكية)، فأي حركة ناقصة طرف بتظهر كفرق فوراً
 * بدل ما تفضل مستخبّية شهور.
 */
export default function Accounting() {
  const { orders, expenses, purchaseInvoices, employeeTransactions, products, stockIntakes, devoItems, storeSettings, loadStockIntakes, loadDevoAndWriteOffs } = useStore();
  const [savingsTransactions, setSavingsTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'tree' | 'checks'>('tree');

  const load = async () => {
    setLoading(true);
    try {
      const { fetchAllRows } = await import('../../lib/supabase');
      const rows = await fetchAllRows('savings_transactions');
      setSavingsTransactions(Array.isArray(rows) ? rows : []);
      // حركات المخزون لازمة للطرف المقابل في المعادلة.
      await Promise.all([loadStockIntakes(), loadDevoAndWriteOffs()]);
    } catch (e) {
      console.error('load savings_transactions:', e);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const cur = storeSettings.currency;
  const payKeys = activePaymentKeys(storeSettings as any);
  const accounts: AccountDef[] = useMemo(
    () => expandAccounts(payKeys, (k) => payLabelOf(storeSettings as any, k)),
    [payKeys.join(','), storeSettings],
  );

  const tb = useMemo(() => buildTrialBalance({
    orders, expenses, purchaseInvoices, employeeTransactions,
    savingsTransactions, products, stockIntakes, devoItems, settings: storeSettings,
  }), [orders, expenses, purchaseInvoices, employeeTransactions, savingsTransactions, products, stockIntakes, devoItems, storeSettings]);

  const issues = useMemo(() => runIntegrityChecks({
    orders, expenses, purchaseInvoices, employeeTransactions, savingsTransactions,
  }), [orders, expenses, purchaseInvoices, employeeTransactions, savingsTransactions]);

  const errors = issues.filter((i) => i.severity === 'error');
  const money = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** رصيد الحساب: للأب = مجموع أبنائه لو مالوش رصيد مباشر. */
  const balanceOf = (code: string): number => {
    const direct = tb.byCode[code];
    const children = accounts.filter((a) => a.parent === code);
    if (children.length === 0) return direct || 0;
    return (direct || 0) + children.reduce((s, c) => s + balanceOf(c.code), 0);
  };

  const roots = accounts.filter((a) => !a.parent);

  const renderNode = (acc: AccountDef, depth = 0) => {
    const children = accounts.filter((a) => a.parent === acc.code);
    const bal = balanceOf(acc.code);
    const parts = tb.partsByCode[acc.code];
    return (
      <div key={acc.code}>
        <div
          className={`flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl ${depth === 0 ? 'bg-slate-100 font-black mt-3' : depth === 1 ? 'bg-slate-50 font-bold' : ''}`}
          style={{ paddingInlineStart: `${12 + depth * 18}px` }}
        >
          <div className="min-w-0">
            <span className={`${depth === 0 ? 'text-base' : 'text-sm'} text-slate-800`}>
              <span className="text-slate-400 font-mono text-[11px] ml-2">{acc.code}</span>
              {acc.name}
            </span>
            {acc.source && depth > 0 && (
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">{acc.source}</p>
            )}
            {parts && (
              <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                {payKeys.map((k) => `${payLabelOf(storeSettings as any, k)}: ${money(parts[k] || 0)}`).join(' · ')}
              </p>
            )}
          </div>
          <span className={`font-black whitespace-nowrap ${bal < -0.004 ? 'text-red-600' : depth === 0 ? 'text-slate-900' : 'text-slate-700'}`}>
            {money(bal)} <span className="text-[10px] text-slate-400">{cur}</span>
          </span>
        </div>
        {children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  const summary: { label: string; value: number; type: AccountType }[] = [
    { label: 'الأصول', value: tb.assets, type: 'asset' },
    { label: 'الخصوم', value: tb.liabilities, type: 'liability' },
    { label: 'حقوق الملكية', value: tb.equity + tb.profit, type: 'equity' },
    { label: 'الإيرادات', value: tb.revenue, type: 'revenue' },
    { label: 'المصروفات', value: tb.expenses, type: 'expense' },
  ];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-3 rounded-2xl text-white shadow-lg shadow-indigo-200"><Network size={26} /></div>
          <div>
            <h1 className="text-2xl font-black text-slate-800">شجرة الحسابات</h1>
            <p className="text-sm text-slate-400 font-bold">عرض محاسبي موحّد — أصول، خصوم، حقوق ملكية، إيرادات، مصروفات</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 font-bold text-sm hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {/* معادلة الميزانية */}
      <div className={`rounded-2xl p-5 border ${Math.abs(tb.imbalance) < 0.5 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex items-center gap-2 mb-2">
          <Scale size={18} className={Math.abs(tb.imbalance) < 0.5 ? 'text-emerald-600' : 'text-amber-600'} />
          <span className={`font-black ${Math.abs(tb.imbalance) < 0.5 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {Math.abs(tb.imbalance) < 0.5 ? 'الميزانية متوازنة' : `فرق غير مفسّر: ${money(tb.imbalance)} ${cur}`}
          </span>
        </div>
        <p className="text-xs font-bold text-slate-600">
          الأصول {money(tb.assets)} = الخصوم {money(tb.liabilities)} + حقوق الملكية {money(tb.equity)} + أرباح الفترة {money(tb.profit)}
        </p>
        {Math.abs(tb.imbalance) >= 0.5 && (
          <div className="mt-3 pt-3 border-t border-amber-200">
            <p className="text-[11px] font-black text-amber-800 mb-1">الفرق ده مش دليل على خطأ في البيانات لوحده.</p>
            <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
              المخزون ({money(tb.inventory)} {cur}) بيتقرا كـ«لقطة» من كميات المنتجات، لكن مصادر تانية
              بتحرّكه والموديول لسه مابيسجّلهاش كقيود: <b>إدخال مخزون بدون فاتورة، الديڤو والتوالف،
              تسويات الجرد، والتصنيع</b>. الفرق بيستوعبهم كلهم.
            </p>
            <p className="text-[11px] font-black text-slate-700 mt-1.5">
              الكشف الموثوق للحركات الناقصة طرف هو تبويب «فحص السلامة» تحت — مش الرقم ده.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {summary.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <p className="text-[10px] font-black text-slate-400 uppercase">{TYPE_LABEL[s.type]}</p>
            <p className="text-sm font-bold text-slate-600 mb-1">{s.label}</p>
            <p className={`text-lg font-black ${s.value < -0.004 ? 'text-red-600' : 'text-slate-800'}`}>{money(s.value)}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {([['tree', 'شجرة الحسابات'], ['checks', `فحص السلامة${issues.length ? ` (${issues.length})` : ''}`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-xl text-sm font-black border transition ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-600'}`}>
            {label}
            {id === 'checks' && errors.length > 0 && <span className="mr-1.5 text-red-500">●</span>}
          </button>
        ))}
      </div>

      {tab === 'tree' ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          {roots.map((r) => renderNode(r))}
          <p className="text-[11px] text-slate-400 font-bold mt-4 pt-3 border-t border-slate-100">
            الأرقام محسوبة من الجداول القائمة (مش متخزّنة) — أي تعديل في أي شاشة بيظهر هنا على طول بعد التحديث.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center">
              <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-2" />
              <p className="font-black text-emerald-700">كل الفحوصات عدّت</p>
              <p className="text-xs font-bold text-emerald-600 mt-1">مفيش حركات ناقصة طرف ولا أرقام متعارضة.</p>
            </div>
          ) : issues.map((issue) => (
            <div key={issue.id} className={`rounded-2xl border p-4 ${issue.severity === 'error' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className={issue.severity === 'error' ? 'text-red-500 mt-0.5' : 'text-amber-500 mt-0.5'} />
                <div className="min-w-0 flex-1">
                  <p className={`font-black ${issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}>{issue.title}</p>
                  <p className="text-xs font-bold text-slate-600 mt-1 leading-relaxed">{issue.detail}</p>
                  <p className="text-xs font-black text-slate-700 mt-2">الحل: <span className="font-bold">{issue.fix}</span></p>
                  {issue.rows.length > 0 && (
                    <div className="mt-2 bg-white/70 rounded-xl p-2 space-y-1 max-h-52 overflow-y-auto">
                      {issue.rows.map((r, i) => (
                        <div key={`${r.id}-${i}`} className="flex justify-between gap-2 text-[11px] font-bold text-slate-600">
                          <span className="truncate">{r.label}</span>
                          <span className="font-mono text-slate-400 shrink-0">{r.id.slice(0, 8)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
