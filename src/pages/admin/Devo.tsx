import { useMemo, useState } from 'react';
import { useStore, type DevoStatus, type Product } from '../../store/useStore';
import { PackageX, RotateCcw, Search, Plus, Trash2, Factory, Undo2, RefreshCw, CheckCircle2, TriangleAlert } from 'lucide-react';

// ── تسميات وألوان حالات الديڤو ──
const DEVO_STATUS: Record<DevoStatus, { label: string; cls: string }> = {
  pending:    { label: 'مسجّل (خرج من المحل)', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  at_factory: { label: 'عند المصنع',            cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  returned:   { label: 'رجع من المصنع',         cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  replaced:   { label: 'تم استبداله',           cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  closed:     { label: 'رجع خالص / تسوية',      cls: 'bg-slate-200 text-slate-600 border-slate-300' },
};

const ACTIVE_STATUSES: DevoStatus[] = ['pending', 'at_factory'];

// ── منتقي منتج بالبحث (اختياري — يمكن الكتابة يدوياً بدل الاختيار) ──
function ProductPicker({ products, onPick, picked }: { products: Product[]; onPick: (p: Product | null) => void; picked: Product | null }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [] as Product[];
    return products.filter((p) => !p.is_hidden).filter((p) => p.name.toLowerCase().includes(s) || (p.barcode || '').includes(s)).slice(0, 8);
  }, [q, products]);

  if (picked) {
    return (
      <div className="flex items-center justify-between gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2.5">
        <div className="min-w-0">
          <div className="font-bold text-sm text-indigo-900 truncate">{picked.name}</div>
          <div className="text-[11px] text-indigo-500 font-mono">{picked.barcode || '—'} · رصيد {Number(picked.stock_quantity) || 0}</div>
        </div>
        <button type="button" onClick={() => { onPick(null); setQ(''); }} className="text-xs font-bold text-indigo-600 hover:text-red-600 shrink-0">تغيير</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="ابحث عن الصنف بالاسم أو الباركود..."
        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pr-9 pl-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onPick(p); setOpen(false); }}
              className="w-full text-right px-3 py-2 hover:bg-indigo-50 border-b border-slate-50 last:border-0"
            >
              <div className="font-bold text-sm text-slate-800">{p.name}</div>
              <div className="text-[11px] text-slate-400 font-mono">{p.barcode || '—'} · رصيد {Number(p.stock_quantity) || 0}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Devo() {
  const { products, suppliers, storeSettings, devoItems, writeOffs, addDevo, updateDevoStatus, deleteDevo, addWriteOff, deleteWriteOff } = useStore();
  const cur = storeSettings.currency;
  const [tab, setTab] = useState<'devo' | 'writeoff'>('devo');

  // ── فورم الديڤو ──
  const [dProd, setDProd] = useState<Product | null>(null);
  const [dName, setDName] = useState('');
  const [dQty, setDQty] = useState('1');
  const [dCost, setDCost] = useState('');
  const [dSupplier, setDSupplier] = useState('');
  const [dReason, setDReason] = useState('');
  const [dSaving, setDSaving] = useState(false);

  // ── فورم الإهلاك ──
  const [wProd, setWProd] = useState<Product | null>(null);
  const [wName, setWName] = useState('');
  const [wQty, setWQty] = useState('1');
  const [wCost, setWCost] = useState('');
  const [wReason, setWReason] = useState('');
  const [wSaving, setWSaving] = useState(false);

  const costOf = (p: Product | null) => (p ? Number(p.average_purchase_price ?? p.purchase_price) || 0 : 0);

  const submitDevo = async () => {
    const name = dProd?.name || dName.trim();
    if (!name) { alert('اختر صنفاً أو اكتب اسم القطعة'); return; }
    const qty = Number(dQty) || 0;
    if (qty <= 0) { alert('اكتب كمية صحيحة'); return; }
    setDSaving(true);
    await addDevo({
      product_id: dProd?.id || null,
      product_name: name,
      barcode: dProd?.barcode || null,
      quantity: qty,
      unit_cost: dCost !== '' ? Number(dCost) || 0 : costOf(dProd),
      supplier_id: null,
      supplier_name: dSupplier.trim() || null,
      reason: dReason.trim() || null,
    });
    setDSaving(false);
    setDProd(null); setDName(''); setDQty('1'); setDCost(''); setDSupplier(''); setDReason('');
  };

  const submitWriteOff = async () => {
    const name = wProd?.name || wName.trim();
    if (!name) { alert('اختر صنفاً أو اكتب اسم القطعة'); return; }
    const qty = Number(wQty) || 0;
    if (qty <= 0) { alert('اكتب كمية صحيحة'); return; }
    if (!confirm(`تأكيد إهلاك ${qty} من «${name}»؟ سيتم خصمها من المخزون واحتسابها كخسارة.`)) return;
    setWSaving(true);
    await addWriteOff({
      product_id: wProd?.id || null,
      product_name: name,
      barcode: wProd?.barcode || null,
      quantity: qty,
      unit_cost: wCost !== '' ? Number(wCost) || 0 : costOf(wProd),
      reason: wReason.trim() || null,
    });
    setWSaving(false);
    setWProd(null); setWName(''); setWQty('1'); setWCost(''); setWReason('');
  };

  // ── ملخصات ──
  const devoActive = devoItems.filter((d) => ACTIVE_STATUSES.includes(d.status));
  const devoAtFactory = devoItems.filter((d) => d.status === 'at_factory');
  const devoActiveValue = devoActive.reduce((s, d) => s + (Number(d.quantity) || 0) * (Number(d.unit_cost) || 0), 0);
  const writeOffTotal = writeOffs.reduce((s, w) => s + (Number(w.total_cost) || 0), 0);

  const supplierNames = useMemo(() => Array.from(new Set(suppliers.map((s: any) => s.name).filter(Boolean))), [suppliers]);

  return (
    <div className="p-6 md:p-8 space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><RotateCcw className="text-indigo-600" size={28} /> الديڤو والتوالف</h1>
        <p className="text-slate-500 mt-1 text-sm font-medium">تابِع القطع الراجعة للمصنع لحد ما تُسوّى (مفيش حاجة تسقط)، وسجّل القطع التالفة كخسائر.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {([['devo', 'الديڤو (راجع للمصنع)'], ['writeoff', 'الإهلاك (توالف)']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-black ${tab === k ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}`}>{l}</button>
        ))}
      </div>

      {/* ══════════ تبويب الديڤو ══════════ */}
      {tab === 'devo' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat label="قطع نشطة (لم تُسوَّ)" value={String(devoActive.length)} />
            <Stat label="عند المصنع" value={String(devoAtFactory.length)} />
            <Stat label="قيمة القطع النشطة" value={`${devoActiveValue.toFixed(2)} ${cur}`} amber />
          </div>

          {/* فورم إضافة ديڤو */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
            <h2 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2"><Plus size={18} className="text-indigo-600" /> تسجيل قطعة ديڤو</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1">الصنف</label>
                <ProductPicker products={products} picked={dProd} onPick={(p) => { setDProd(p); if (p) setDCost(String(costOf(p))); }} />
                {!dProd && (
                  <input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="أو اكتب اسم القطعة يدوياً (لو مش صنف بالمخزون)" className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500" />
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">الكمية</label>
                <input type="number" value={dQty} onChange={(e) => setDQty(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">تكلفة الوحدة ({cur})</label>
                <input type="number" value={dCost} onChange={(e) => setDCost(e.target.value)} placeholder="0" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">المصنع / المورد</label>
                <input list="devo-suppliers" value={dSupplier} onChange={(e) => setDSupplier(e.target.value)} placeholder="اسم المصنع أو المورد" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                <datalist id="devo-suppliers">{supplierNames.map((n) => <option key={n as string} value={n as string} />)}</datalist>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">السبب / ملاحظة</label>
                <input value={dReason} onChange={(e) => setDReason(e.target.value)} placeholder="عيب صناعة، مقاس غلط..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">تسجيل القطعة كديڤو بيخصمها من رصيد المخزون (خرجت من المحل). لما ترجع أو تتستبدل بترجع للمخزون تلقائياً.</p>
            <button onClick={submitDevo} disabled={dSaving} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2"><Plus size={18} /> {dSaving ? 'جاري الحفظ...' : 'تسجيل الديڤو'}</button>
          </div>

          {/* جدول الديڤو */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                  <tr>
                    <th className="p-3">الصنف</th><th className="p-3 text-center">الكمية</th><th className="p-3">المصنع/المورد</th>
                    <th className="p-3 text-center">القيمة</th><th className="p-3 text-center">الحالة</th><th className="p-3 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {devoItems.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد قطع ديڤو مسجّلة</td></tr>
                    : devoItems.map((d) => {
                      const val = (Number(d.quantity) || 0) * (Number(d.unit_cost) || 0);
                      return (
                        <tr key={d.id} className="border-b border-slate-100 dark:border-slate-700/50 align-top">
                          <td className="p-3">
                            <div className="font-bold text-slate-800 dark:text-slate-100">{d.product_name}</div>
                            {d.reason && <div className="text-[11px] text-slate-400 mt-0.5">{d.reason}</div>}
                            <div className="text-[10px] text-slate-300">{d.created_at ? new Date(d.created_at).toLocaleString('ar-EG') : ''}</div>
                          </td>
                          <td className="p-3 text-center font-black">{Number(d.quantity) || 0}</td>
                          <td className="p-3 text-slate-600 dark:text-slate-300">{d.supplier_name || '—'}</td>
                          <td className="p-3 text-center font-bold">{val.toFixed(2)} {cur}</td>
                          <td className="p-3 text-center"><span className={`inline-block px-2.5 py-1 rounded-lg text-[11px] font-black border ${DEVO_STATUS[d.status].cls}`}>{DEVO_STATUS[d.status].label}</span></td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1.5 justify-center">
                              {(d.status === 'pending') && (
                                <ActBtn onClick={() => updateDevoStatus(d.id, 'at_factory')} icon={<Factory size={13} />} title="اتسلم المصنع" cls="bg-blue-50 text-blue-700 hover:bg-blue-100" />
                              )}
                              {(d.status === 'pending' || d.status === 'at_factory') && (<>
                                <ActBtn onClick={() => updateDevoStatus(d.id, 'returned')} icon={<Undo2 size={13} />} title="رجع منه" cls="bg-emerald-50 text-emerald-700 hover:bg-emerald-100" />
                                <ActBtn onClick={() => updateDevoStatus(d.id, 'replaced')} icon={<RefreshCw size={13} />} title="تم استبداله" cls="bg-emerald-50 text-emerald-700 hover:bg-emerald-100" />
                                <ActBtn onClick={() => updateDevoStatus(d.id, 'closed')} icon={<CheckCircle2 size={13} />} title="رجع خالص" cls="bg-slate-100 text-slate-600 hover:bg-slate-200" />
                              </>)}
                              {(d.status === 'returned' || d.status === 'replaced' || d.status === 'closed') && (
                                <ActBtn onClick={() => updateDevoStatus(d.id, 'at_factory')} icon={<RotateCcw size={13} />} title="إعادة فتح" cls="bg-amber-50 text-amber-700 hover:bg-amber-100" />
                              )}
                              <ActBtn onClick={() => { if (confirm('حذف سجل الديڤو؟')) deleteDevo(d.id); }} icon={<Trash2 size={13} />} title="حذف" cls="bg-red-50 text-red-600 hover:bg-red-100" />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ تبويب الإهلاك ══════════ */}
      {tab === 'writeoff' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="عدد عمليات الإهلاك" value={String(writeOffs.length)} />
            <Stat label="إجمالي الخسائر (توالف)" value={`${writeOffTotal.toFixed(2)} ${cur}`} red />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
            <h2 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2"><TriangleAlert size={18} className="text-red-500" /> إهلاك قطعة تالفة</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1">الصنف</label>
                <ProductPicker products={products} picked={wProd} onPick={(p) => { setWProd(p); if (p) setWCost(String(costOf(p))); }} />
                {!wProd && (
                  <input value={wName} onChange={(e) => setWName(e.target.value)} placeholder="أو اكتب اسم القطعة يدوياً" className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-red-400" />
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">الكمية</label>
                <input type="number" value={wQty} onChange={(e) => setWQty(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-red-400" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">تكلفة الوحدة ({cur})</label>
                <input type="number" value={wCost} onChange={(e) => setWCost(e.target.value)} placeholder="0" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-red-400" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1">السبب</label>
                <input value={wReason} onChange={(e) => setWReason(e.target.value)} placeholder="كسر، تلف، انتهاء صلاحية..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-red-400" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">الإهلاك بيخصم الكمية من المخزون نهائياً وبيتحسب قيمتها كخسارة.</p>
            <button onClick={submitWriteOff} disabled={wSaving} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2"><PackageX size={18} /> {wSaving ? 'جاري الحفظ...' : 'تسجيل الإهلاك'}</button>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                  <tr><th className="p-3">الصنف</th><th className="p-3 text-center">الكمية</th><th className="p-3 text-center">تكلفة الوحدة</th><th className="p-3 text-center">إجمالي الخسارة</th><th className="p-3">السبب</th><th className="p-3 text-center">حذف</th></tr>
                </thead>
                <tbody>
                  {writeOffs.length === 0 ? <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد عمليات إهلاك</td></tr>
                    : writeOffs.map((w) => (
                      <tr key={w.id} className="border-b border-slate-100 dark:border-slate-700/50">
                        <td className="p-3">
                          <div className="font-bold text-slate-800 dark:text-slate-100">{w.product_name}</div>
                          <div className="text-[10px] text-slate-300">{w.created_at ? new Date(w.created_at).toLocaleString('ar-EG') : ''}</div>
                        </td>
                        <td className="p-3 text-center font-black">{Number(w.quantity) || 0}</td>
                        <td className="p-3 text-center">{(Number(w.unit_cost) || 0).toFixed(2)}</td>
                        <td className="p-3 text-center font-black text-red-600">{(Number(w.total_cost) || 0).toFixed(2)} {cur}</td>
                        <td className="p-3 text-slate-600 dark:text-slate-300">{w.reason || '—'}</td>
                        <td className="p-3 text-center">
                          <ActBtn onClick={() => { if (confirm('حذف سجل الإهلاك وإرجاع الكمية للمخزون؟')) deleteWriteOff(w.id); }} icon={<Trash2 size={13} />} title="حذف" cls="bg-red-50 text-red-600 hover:bg-red-100" />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, amber, red }: { label: string; value: string; amber?: boolean; red?: boolean }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-center">
      <div className="text-[11px] font-bold text-slate-500">{label}</div>
      <div className={`text-xl font-black mt-1 ${amber ? 'text-amber-600' : red ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</div>
    </div>
  );
}

function ActBtn({ onClick, icon, title, cls }: { onClick: () => void; icon: React.ReactNode; title: string; cls: string }) {
  return (
    <button onClick={onClick} title={title} className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-black transition ${cls}`}>{icon}<span className="hidden sm:inline">{title}</span></button>
  );
}
