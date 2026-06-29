import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { ClipboardCheck, Search, Save } from 'lucide-react';

export default function StockTake() {
  const { products, storeSettings, adjustStock } = useStore();
  const cur = storeSettings.currency;
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => !p.is_hidden).filter((p) => !q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q));
  }, [products, search]);

  const rows = list.map((p) => {
    const system = Number(p.stock_quantity) || 0;
    const raw = counts[p.id];
    const counted = raw === undefined || raw === '' ? null : Number(raw);
    const diff = counted === null ? 0 : counted - system;
    const cost = Number(p.average_purchase_price ?? p.purchase_price) || 0;
    return { p, system, counted, diff, cost, diffValue: diff * cost };
  });

  const changed = rows.filter((r) => r.counted !== null && Math.abs(r.diff) > 0.0001);
  const totalShortageVal = changed.filter((r) => r.diff < 0).reduce((s, r) => s + Math.abs(r.diffValue), 0);
  const totalSurplusVal = changed.filter((r) => r.diff > 0).reduce((s, r) => s + r.diffValue, 0);

  const save = async () => {
    if (changed.length === 0) { alert('لا توجد فروقات للتسوية. أدخل الكميات المجرودة المختلفة عن النظام.'); return; }
    if (!confirm(`تأكيد تسوية ${changed.length} صنف؟ سيتم تعديل المخزون للكميات المجرودة.`)) return;
    setSaving(true);
    const n = await adjustStock(changed.map((r) => ({ product_id: r.p.id, counted_qty: r.counted as number })), note.trim());
    setSaving(false);
    alert(`تمت تسوية ${n} صنف ✅`);
    setCounts({}); setNote('');
  };

  return (
    <div className="p-6 md:p-8 space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><ClipboardCheck className="text-indigo-600" size={30} /> الجرد والتسوية</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">أدخل الكمية الفعلية المجرودة لكل صنف، وراجع الفرق، ثم احفظ التسوية</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-2 text-center"><div className="text-[11px] font-bold text-red-600">قيمة العجز</div><div className="font-black text-red-700">{totalShortageVal.toFixed(2)} {cur}</div></div>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl px-4 py-2 text-center"><div className="text-[11px] font-bold text-emerald-600">قيمة الزيادة</div><div className="font-black text-emerald-700">{totalSurplusVal.toFixed(2)} {cur}</div></div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم المنتج أو الباركود..." className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 pr-10 pl-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة الجرد (اختياري)" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500 min-w-[200px]" />
        <button onClick={save} disabled={saving || changed.length === 0} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2"><Save size={18} /> {saving ? 'جاري...' : `حفظ التسوية (${changed.length})`}</button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh]">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 sticky top-0">
              <tr>
                <th className="p-3">المنتج</th><th className="p-3">الباركود</th>
                <th className="p-3 text-center">رصيد النظام</th><th className="p-3 text-center">المجرود فعلياً</th>
                <th className="p-3 text-center">الفرق</th><th className="p-3 text-center">قيمة الفرق</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد منتجات</td></tr>
                : rows.map((r) => (
                  <tr key={r.p.id} className={`border-b border-slate-100 dark:border-slate-700/50 ${r.counted !== null && Math.abs(r.diff) > 0.0001 ? (r.diff < 0 ? 'bg-red-50/40 dark:bg-red-900/10' : 'bg-emerald-50/40 dark:bg-emerald-900/10') : ''}`}>
                    <td className="p-3 font-bold text-slate-800 dark:text-slate-100">{r.p.name}</td>
                    <td className="p-3 font-mono text-xs text-slate-500">{r.p.barcode || '-'}</td>
                    <td className="p-3 text-center font-bold">{r.system}</td>
                    <td className="p-3 text-center">
                      <input type="number" value={counts[r.p.id] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [r.p.id]: e.target.value }))} placeholder={String(r.system)} className="w-24 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-center font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                    </td>
                    <td className={`p-3 text-center font-black ${r.counted === null ? 'text-slate-300' : r.diff === 0 ? 'text-slate-400' : r.diff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{r.counted === null ? '—' : (r.diff > 0 ? '+' : '') + r.diff}</td>
                    <td className={`p-3 text-center font-bold ${r.diffValue < 0 ? 'text-red-600' : r.diffValue > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{r.counted === null || r.diff === 0 ? '—' : `${r.diffValue.toFixed(2)} ${cur}`}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-slate-400">الأصناف اللي متكتبش ليها كمية بتفضل زي ما هي. الحفظ بيعدّل المخزون للكمية المجرودة ويسجّل الفرق في سجل التسويات.</p>
    </div>
  );
}
