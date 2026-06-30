import { useEffect, useState, Fragment } from 'react';
import { useStore } from '../../store/useStore';
import { Scissors, Plus, Trash2, Package, Factory, Warehouse } from 'lucide-react';
import { generateBarcode, printBarcodeLabels } from '../../utils/printBarcodeLabels';

const PAY_METHODS = [
  { value: 'cash', label: 'كاش' },
  { value: 'visa', label: 'فيزا' },
  { value: 'wallet', label: 'محفظة' },
  { value: 'instapay', label: 'انستا باي' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</label>
      {children}
    </div>
  );
}

export default function Manufacturing() {
  const {
    materials, productionOrders, products, storeSettings, suppliers,
    loadManufacturing, addMaterial, deleteMaterial, addProductionOrder, transferFromFactory,
  } = useStore();
  const [transfer, setTransfer] = useState<{ id: string; display: string; warehouse: string } | null>(null);
  const cur = storeSettings.currency;
  const input = 'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none';
  const selectCls = input + ' cursor-pointer';

  useEffect(() => { loadManufacturing(); }, []);

  // ── Material form ──────────────────────────────────────────
  const [mName, setMName] = useState('');
  const [mUnit, setMUnit] = useState('متر');
  const [mCost, setMCost] = useState('');
  const [mStock, setMStock] = useState('');
  const [mSupplier, setMSupplier] = useState('');
  const [mSplit, setMSplit] = useState<Record<string, string>>({ cash: '', visa: '', wallet: '', instapay: '' });
  const mTotal = (Number(mCost) || 0) * (Number(mStock) || 0);
  const mPaid = PAY_METHODS.reduce((s, p) => s + (Number(mSplit[p.value]) || 0), 0);
  const mRemaining = mTotal - mPaid;

  const submitMaterial = async () => {
    if (!mName.trim()) { alert('اسم الخامة مطلوب'); return; }
    if (mRemaining < -0.01) { alert('المبلغ المدفوع أكبر من إجمالي الشراء'); return; }
    if (mRemaining > 0.01 && !mSupplier) { alert('فيه مبلغ متبقّي — اختر مورد لتأجيله عليه، أو أكمل الدفع'); return; }
    await addMaterial(
      { name: mName.trim(), unit: mUnit || 'متر', cost_per_unit: Number(mCost) || 0, stock_quantity: Number(mStock) || 0 },
      { supplierId: mSupplier || undefined, split: { cash: Number(mSplit.cash) || 0, visa: Number(mSplit.visa) || 0, wallet: Number(mSplit.wallet) || 0, instapay: Number(mSplit.instapay) || 0 } },
    );
    setMName(''); setMCost(''); setMStock(''); setMSupplier(''); setMSplit({ cash: '', visa: '', wallet: '', instapay: '' });
  };

  // ── Production form ────────────────────────────────────────
  const [pName, setPName] = useState('');
  const [pColor, setPColor] = useState('');
  const [pCode, setPCode] = useState('');
  const [pQty, setPQty] = useState('');
  const [pSale, setPSale] = useState('');
  const [pDisplay, setPDisplay] = useState('');
  const [pWarehouse, setPWarehouse] = useState('');
  const [pNotes, setPNotes] = useState('');
  const [pExtraPay, setPExtraPay] = useState('cash');
  const [rows, setRows] = useState<{ material_id: string; quantity: string }[]>([{ material_id: '', quantity: '' }]);
  const [costs, setCosts] = useState<{ label: string; amount: string }[]>([{ label: '', amount: '' }]);
  const [saving, setSaving] = useState(false);

  const materialsCost = rows.reduce((s, r) => {
    const mat = materials.find((m) => m.id === r.material_id);
    return s + (mat ? mat.cost_per_unit * (Number(r.quantity) || 0) : 0);
  }, 0);
  const extraCosts = costs.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const qtyNum = Number(pQty) || 0;
  const dispNum = Number(pDisplay) || 0;
  const whNum = Number(pWarehouse) || 0;
  const sellableNum = Math.min(qtyNum, dispNum + whNum);
  const factoryNum = Math.max(0, qtyNum - sellableNum);
  const totalCost = materialsCost + extraCosts;
  const perPiece = qtyNum > 0 ? totalCost / qtyNum : 0;
  const profitPerPiece = (Number(pSale) || 0) - perPiece;

  // قيمة مخزون المصنع (قطع مُصنّعة محتجزة لم تُحوّل للبيع بعد)
  const factoryValue = products.reduce((s, p) => s + (Number(p.factory_quantity) || 0) * (Number(p.average_purchase_price ?? p.purchase_price) || 0), 0);
  const factoryItems = products.filter((p) => (Number(p.factory_quantity) || 0) > 0);

  const onQtyChange = (v: string) => {
    setPQty(v);
    // افتراضياً كل القطع تروح للمستودع (متاحة للبيع) — وتقدر تعدّلي.
    setPWarehouse(v);
    setPDisplay('');
  };

  const submitProduction = async () => {
    if (!pName.trim()) { alert('اسم المنتج مطلوب'); return; }
    if (qtyNum <= 0) { alert('عدد القطع المنتجة مطلوب'); return; }
    if (dispNum + whNum > qtyNum) { alert('مجموع العرض + المستودع أكبر من عدد القطع المنتجة'); return; }
    setSaving(true);
    let code = pCode.trim();
    if (!code) code = generateBarcode(new Set(products.map((p) => p.barcode).filter(Boolean) as string[]));

    const notesAll = [pNotes.trim(), ...costs.filter((c) => c.label.trim() && Number(c.amount) > 0).map((c) => `${c.label.trim()}: ${c.amount}`)].filter(Boolean).join(' | ');

    const ok = await addProductionOrder({
      product_name: pName.trim(),
      color: pColor.trim(),
      code,
      quantity: qtyNum,
      sale_price: Number(pSale) || 0,
      extra_costs: extraCosts,
      display_quantity: dispNum,
      warehouse_quantity: whNum,
      extra_costs_split: {
        cash: pExtraPay === 'cash' ? extraCosts : 0,
        visa: pExtraPay === 'visa' ? extraCosts : 0,
        wallet: pExtraPay === 'wallet' ? extraCosts : 0,
        instapay: pExtraPay === 'instapay' ? extraCosts : 0,
      },
      notes: notesAll,
      materials: rows.filter((r) => r.material_id && Number(r.quantity) > 0).map((r) => ({ material_id: r.material_id, quantity: Number(r.quantity) })),
    });
    setSaving(false);
    if (ok) {
      const n = prompt('تم التصنيع ✅\nعدد ملصقات الباركود المراد طباعتها (أو 0 للتخطّي):', String(qtyNum));
      if (n !== null && (parseInt(n) || 0) > 0) {
        printBarcodeLabels({ name: pName.trim(), code, price: Number(pSale) || 0, currency: cur, count: parseInt(n) || 1, storeName: storeSettings.name });
      }
      setPName(''); setPColor(''); setPCode(''); setPQty(''); setPSale(''); setPNotes(''); setPDisplay(''); setPWarehouse('');
      setRows([{ material_id: '', quantity: '' }]);
      setCosts([{ label: '', amount: '' }]);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3">
            <Scissors className="text-indigo-600" size={30} /> التصنيع
          </h1>
          <p className="text-slate-500 mt-1 font-medium text-sm">الخامات (بمورد ودفع مقسّم/آجل) وتصنيع المنتجات وتوزيعها على المخازن</p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl px-5 py-3 text-center">
          <div className="text-[11px] font-bold text-purple-600 dark:text-purple-300 flex items-center gap-1"><Warehouse size={14} /> قيمة مخزون المصنع</div>
          <div className="text-xl font-black text-purple-700 dark:text-purple-300">{factoryValue.toFixed(2)} {cur}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Materials ──────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="bg-amber-50 dark:bg-amber-900/20 px-5 py-3 border-b border-amber-100 dark:border-amber-800 flex items-center gap-2">
            <Package size={20} className="text-amber-600" />
            <h2 className="text-base font-black text-amber-800 dark:text-amber-300">شراء خامة</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <Field label="اسم الخامة"><input className={input} placeholder="مثال: قماش قطن" value={mName} onChange={(e) => setMName(e.target.value)} /></Field>
              <Field label="الوحدة"><input className={input} placeholder="متر / كيلو" value={mUnit} onChange={(e) => setMUnit(e.target.value)} /></Field>
              <Field label={`سعر الوحدة (${cur})`}><input className={input} type="number" placeholder="0" value={mCost} onChange={(e) => setMCost(e.target.value)} /></Field>
              <Field label="الكمية المشتراة"><input className={input} type="number" placeholder="0" value={mStock} onChange={(e) => setMStock(e.target.value)} /></Field>
            </div>

            <Field label="المورد (اختياري — لتسجيل الشراء عليه والتأجيل)">
              <select className={selectCls} value={mSupplier} onChange={(e) => setMSupplier(e.target.value)}>
                <option value="">بدون مورد (دفع مباشر)</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>

            <div className="mt-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-black text-slate-700 dark:text-slate-200">الدفع</span>
                <button type="button" onClick={() => setMSplit({ cash: String(mTotal || ''), visa: '', wallet: '', instapay: '' })} className="text-[11px] font-bold text-amber-700 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded-lg">الكل كاش</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PAY_METHODS.map((p) => (
                  <div key={p.value}>
                    <label className="text-[11px] font-bold text-slate-500">{p.label}</label>
                    <input className={input} type="number" placeholder="0" value={mSplit[p.value]} onChange={(e) => setMSplit((s) => ({ ...s, [p.value]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 text-center text-xs">
                <div className="bg-white dark:bg-slate-800 rounded-lg p-2"><div className="text-slate-400 font-bold">الإجمالي</div><div className="font-black text-slate-800 dark:text-slate-100">{mTotal.toFixed(2)}</div></div>
                <div className="bg-white dark:bg-slate-800 rounded-lg p-2"><div className="text-slate-400 font-bold">المدفوع</div><div className="font-black text-emerald-600">{mPaid.toFixed(2)}</div></div>
                <div className="bg-white dark:bg-slate-800 rounded-lg p-2"><div className="text-slate-400 font-bold">آجل (متبقّي)</div><div className={`font-black ${mRemaining > 0.01 ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{mRemaining.toFixed(2)}</div></div>
              </div>
              {mRemaining > 0.01 && mSupplier && <p className="text-[11px] text-red-500 mt-2 font-bold">المتبقّي {mRemaining.toFixed(2)} {cur} هيتسجّل دين على المورد ويتسدّد من صفحة الموردين.</p>}
            </div>

            <button onClick={submitMaterial} className="mt-3 w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition">
              <Plus size={18} /> إضافة الخامة
            </button>

            <div className="mt-4 space-y-2 max-h-72 overflow-y-auto">
              {materials.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-6">لا توجد خامات بعد</p>
              ) : materials.map((m) => {
                const sup = suppliers.find((s) => s.id === m.supplier_id);
                return (
                  <div key={m.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-100">{m.name}</p>
                      <p className="text-[11px] text-slate-500">{m.cost_per_unit} {cur}/{m.unit} · متاح: <b>{m.stock_quantity}</b> {m.unit}{sup ? <> · مورد: <b>{sup.name}</b></> : null}</p>
                    </div>
                    <button onClick={() => { if (confirm('حذف الخامة؟')) deleteMaterial(m.id); }} className="text-red-500 hover:bg-red-50 p-2 rounded-lg"><Trash2 size={16} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Production ─────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="bg-indigo-50 dark:bg-indigo-900/20 px-5 py-3 border-b border-indigo-100 dark:border-indigo-800 flex items-center gap-2">
            <Factory size={20} className="text-indigo-600" />
            <h2 className="text-base font-black text-indigo-800 dark:text-indigo-300">أمر تصنيع جديد</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="اسم المنتج"><input className={input} placeholder="مثال: تيشيرت" value={pName} onChange={(e) => setPName(e.target.value)} /></Field>
              <Field label="اللون"><input className={input} placeholder="أبيض" value={pColor} onChange={(e) => setPColor(e.target.value)} /></Field>
              <Field label="الكود / الباركود (يتولّد تلقائياً لو فاضي)"><input className={input} placeholder="اختياري" value={pCode} onChange={(e) => setPCode(e.target.value)} /></Field>
              <Field label="عدد القطع المنتجة"><input className={input} type="number" placeholder="0" value={pQty} onChange={(e) => onQtyChange(e.target.value)} /></Field>
              <Field label={`سعر بيع القطعة (${cur})`}><input className={input} type="number" placeholder="0" value={pSale} onChange={(e) => setPSale(e.target.value)} /></Field>
            </div>

            {/* Distribution to warehouses */}
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-3 border border-purple-200 dark:border-purple-800">
              <label className="text-sm font-black text-purple-800 dark:text-purple-300 flex items-center gap-2 mb-2"><Warehouse size={16} /> توزيع القطع</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="للعرض (المحل)"><input className={input} type="number" placeholder="0" value={pDisplay} onChange={(e) => setPDisplay(e.target.value)} /></Field>
                <Field label="للمستودع"><input className={input} type="number" placeholder="0" value={pWarehouse} onChange={(e) => setPWarehouse(e.target.value)} /></Field>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 text-center text-xs">
                <div className="bg-white dark:bg-slate-800 rounded-lg p-2"><div className="text-emerald-600 font-bold">متاح للبيع</div><div className="font-black text-slate-800 dark:text-slate-100">{sellableNum}</div></div>
                <div className="bg-white dark:bg-slate-800 rounded-lg p-2"><div className="text-slate-400 font-bold">منها عرض</div><div className="font-black text-slate-800 dark:text-slate-100">{Math.min(dispNum, qtyNum)}</div></div>
                <div className="bg-white dark:bg-slate-800 rounded-lg p-2"><div className="text-purple-600 font-bold">مخزن المصنع</div><div className="font-black text-purple-700">{factoryNum}</div></div>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">المتاح للبيع (عرض + مستودع) بيتضاف للكاشير. الباقي بيتحجز في مخزن المصنع بقيمته.</p>
            </div>

            {/* Materials used */}
            <div className="bg-slate-50 dark:bg-slate-900/30 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-black text-slate-700 dark:text-slate-200">الخامات المستخدمة</label>
                <button onClick={() => setRows((rs) => [...rs, { material_id: '', quantity: '' }])} className="text-indigo-600 text-xs font-bold bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded-lg hover:bg-indigo-100">+ خامة</button>
              </div>
              <div className="space-y-2">
                {rows.map((r, i) => {
                  const mat = materials.find((m) => m.id === r.material_id);
                  const lineCost = mat ? mat.cost_per_unit * (Number(r.quantity) || 0) : 0;
                  return (
                    <div key={i}>
                      <div className="flex gap-2 items-center">
                        <select className={selectCls + ' flex-1'} value={r.material_id} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, material_id: e.target.value } : x)))}>
                          <option value="">— اختر خامة —</option>
                          {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.cost_per_unit} {cur}/{m.unit})</option>)}
                        </select>
                        <input className={input + ' w-24'} type="number" placeholder="كمية" value={r.quantity} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                        {rows.length > 1 && <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-red-500 hover:bg-red-50 p-2 rounded-lg shrink-0"><Trash2 size={16} /></button>}
                      </div>
                      {mat && <div className="text-[11px] text-slate-500 mt-1 pr-1">المختار: <b className="text-slate-700 dark:text-slate-200">{mat.name}</b> · متاح {mat.stock_quantity} {mat.unit} · تكلفة السطر: <b className="text-amber-700">{lineCost.toFixed(2)} {cur}</b></div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Extra costs */}
            <div className="bg-slate-50 dark:bg-slate-900/30 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-black text-slate-700 dark:text-slate-200">تكاليف إضافية <span className="text-[10px] font-normal text-slate-400">(مصنعية، خيوط، شحن...)</span></label>
                <button onClick={() => setCosts((cs) => [...cs, { label: '', amount: '' }])} className="text-indigo-600 text-xs font-bold bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded-lg hover:bg-indigo-100">+ تكلفة</button>
              </div>
              <div className="space-y-2">
                {costs.map((c, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input className={input + ' flex-1'} placeholder="نوع التكلفة" value={c.label} onChange={(e) => setCosts((cs) => cs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <input className={input + ' w-24'} type="number" placeholder={cur} value={c.amount} onChange={(e) => setCosts((cs) => cs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                    {costs.length > 1 && <button onClick={() => setCosts((cs) => cs.filter((_, j) => j !== i))} className="text-red-500 hover:bg-red-50 p-2 rounded-lg shrink-0"><Trash2 size={16} /></button>}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-[11px] font-bold text-slate-500 shrink-0">دفع التكاليف بـ</label>
                <select className={selectCls} value={pExtraPay} onChange={(e) => setPExtraPay(e.target.value)}>
                  {PAY_METHODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">تُخصم من الخزنة كمصروف "تكاليف تصنيع" بطريقة الدفع المختارة.</p>
            </div>

            <Field label="ملاحظات (اختياري)"><input className={input} value={pNotes} onChange={(e) => setPNotes(e.target.value)} /></Field>

            {/* Live cost summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-100 dark:bg-slate-900/40 rounded-xl p-3 text-center">
                <div className="text-[10px] font-bold text-slate-500">تكلفة الخامات</div>
                <div className="font-black text-slate-800 dark:text-slate-100">{materialsCost.toFixed(2)}</div>
              </div>
              <div className="bg-slate-100 dark:bg-slate-900/40 rounded-xl p-3 text-center">
                <div className="text-[10px] font-bold text-slate-500">إجمالي التكلفة</div>
                <div className="font-black text-slate-800 dark:text-slate-100">{totalCost.toFixed(2)}</div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center border border-amber-200 dark:border-amber-800">
                <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400">تكلفة القطعة</div>
                <div className="font-black text-amber-700 dark:text-amber-400">{perPiece.toFixed(2)} {cur}</div>
              </div>
              <div className={`rounded-xl p-3 text-center border ${profitPerPiece >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-red-50 border-red-200'}`}>
                <div className={`text-[10px] font-bold ${profitPerPiece >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}>ربح القطعة</div>
                <div className={`font-black ${profitPerPiece >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}>{profitPerPiece.toFixed(2)} {cur}</div>
              </div>
            </div>

            <button onClick={submitProduction} disabled={saving} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black py-3 rounded-xl flex items-center justify-center gap-2 transition">
              <Factory size={18} /> {saving ? 'جاري الحفظ...' : 'تصنيع وإضافة للمخزون'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Factory stock ─────────────────────────────── */}
      {factoryItems.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-purple-200 dark:border-purple-800 p-5">
          <h2 className="text-base font-black text-purple-800 dark:text-purple-300 mb-4 flex items-center gap-2"><Warehouse size={18} /> مخزن المصنع (قطع محتجزة) — قيمته {factoryValue.toFixed(2)} {cur}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead><tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="p-2">المنتج</th><th className="p-2">الكود</th><th className="p-2">بالمصنع</th><th className="p-2">تكلفة القطعة</th><th className="p-2">القيمة</th><th className="p-2">تحويل للبيع</th></tr></thead>
              <tbody>
                {factoryItems.map((p) => {
                  const c = Number(p.average_purchase_price ?? p.purchase_price) || 0;
                  const q = Number(p.factory_quantity) || 0;
                  const open = transfer?.id === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr className="border-b border-slate-100 dark:border-slate-700/50">
                        <td className="p-2 font-bold text-slate-800 dark:text-slate-100">{p.name}</td>
                        <td className="p-2 font-mono text-xs">{p.barcode || '-'}</td>
                        <td className="p-2 font-black text-purple-700">{q}</td>
                        <td className="p-2">{c.toFixed(2)} {cur}</td>
                        <td className="p-2 font-bold">{(q * c).toFixed(2)} {cur}</td>
                        <td className="p-2">
                          <button onClick={() => setTransfer(open ? null : { id: p.id, display: '', warehouse: String(q) })} className="text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg">
                            {open ? 'إغلاق' : 'تحويل'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-purple-50/50 dark:bg-purple-900/10">
                          <td colSpan={6} className="p-3">
                            <div className="flex flex-wrap items-end gap-2">
                              <div>
                                <label className="block text-[11px] font-bold text-slate-500 mb-1">للعرض</label>
                                <input className={input + ' w-24'} type="number" min="0" placeholder="0" value={transfer!.display} onChange={(e) => setTransfer((t) => t && { ...t, display: e.target.value })} />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-slate-500 mb-1">للمستودع</label>
                                <input className={input + ' w-24'} type="number" min="0" placeholder="0" value={transfer!.warehouse} onChange={(e) => setTransfer((t) => t && { ...t, warehouse: e.target.value })} />
                              </div>
                              <span className="text-xs text-slate-500 pb-2">المتاح بالمصنع: <b className="text-purple-700">{q}</b></span>
                              <button
                                onClick={async () => {
                                  const ok = await transferFromFactory(p.id, Number(transfer!.display) || 0, Number(transfer!.warehouse) || 0);
                                  if (ok) { setTransfer(null); alert('تم تحويل القطع للبيع ✅'); }
                                }}
                                className="mr-auto bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-4 py-2 rounded-lg">
                                تأكيد التحويل
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Production history ─────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
        <h2 className="text-base font-black text-slate-800 dark:text-white mb-4">سجل أوامر التصنيع</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="p-2">المنتج</th><th className="p-2">اللون</th><th className="p-2">الكود</th>
                <th className="p-2">العدد</th><th className="p-2">إجمالي التكلفة</th><th className="p-2">تكلفة القطعة</th><th className="p-2">سعر البيع</th>
              </tr>
            </thead>
            <tbody>
              {productionOrders.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-slate-400 py-6">لا توجد أوامر تصنيع بعد</td></tr>
              ) : productionOrders.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-slate-700/50">
                  <td className="p-2 font-bold text-slate-800 dark:text-slate-100">{p.product_name}</td>
                  <td className="p-2">{p.color || '-'}</td>
                  <td className="p-2 font-mono text-xs">{p.code || '-'}</td>
                  <td className="p-2">{p.quantity}</td>
                  <td className="p-2">{Number(p.total_cost).toFixed(2)} {cur}</td>
                  <td className="p-2 font-bold text-amber-700">{Number(p.cost_per_piece).toFixed(2)} {cur}</td>
                  <td className="p-2 font-bold text-emerald-700">{Number(p.sale_price).toFixed(2)} {cur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
