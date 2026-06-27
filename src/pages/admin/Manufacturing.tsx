import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Scissors, Plus, Trash2, Package, Factory } from 'lucide-react';
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
    materials, productionOrders, products, storeSettings,
    loadManufacturing, addMaterial, deleteMaterial, addProductionOrder,
  } = useStore();
  const cur = storeSettings.currency;
  const input = 'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none';

  useEffect(() => { loadManufacturing(); }, []);

  // ── Material form ──────────────────────────────────────────
  const [mName, setMName] = useState('');
  const [mUnit, setMUnit] = useState('متر');
  const [mCost, setMCost] = useState('');
  const [mStock, setMStock] = useState('');
  const [mPay, setMPay] = useState('cash');
  const mTotal = (Number(mCost) || 0) * (Number(mStock) || 0);

  const submitMaterial = async () => {
    if (!mName.trim()) { alert('اسم الخامة مطلوب'); return; }
    await addMaterial(
      { name: mName.trim(), unit: mUnit || 'متر', cost_per_unit: Number(mCost) || 0, stock_quantity: Number(mStock) || 0 },
      mPay,
    );
    setMName(''); setMCost(''); setMStock('');
  };

  // ── Production form ────────────────────────────────────────
  const [pName, setPName] = useState('');
  const [pColor, setPColor] = useState('');
  const [pCode, setPCode] = useState('');
  const [pQty, setPQty] = useState('');
  const [pSale, setPSale] = useState('');
  const [pNotes, setPNotes] = useState('');
  const [rows, setRows] = useState<{ material_id: string; quantity: string }[]>([{ material_id: '', quantity: '' }]);
  const [costs, setCosts] = useState<{ label: string; amount: string }[]>([{ label: '', amount: '' }]);
  const [saving, setSaving] = useState(false);

  const materialsCost = rows.reduce((s, r) => {
    const mat = materials.find((m) => m.id === r.material_id);
    return s + (mat ? mat.cost_per_unit * (Number(r.quantity) || 0) : 0);
  }, 0);
  const extraCosts = costs.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const qtyNum = Number(pQty) || 0;
  const totalCost = materialsCost + extraCosts;
  const perPiece = qtyNum > 0 ? totalCost / qtyNum : 0;
  const profitPerPiece = (Number(pSale) || 0) - perPiece;

  const submitProduction = async () => {
    if (!pName.trim()) { alert('اسم المنتج مطلوب'); return; }
    if (qtyNum <= 0) { alert('عدد القطع المنتجة مطلوب'); return; }
    setSaving(true);
    // Auto-generate a barcode if none was entered.
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
      notes: notesAll,
      materials: rows.filter((r) => r.material_id && Number(r.quantity) > 0).map((r) => ({ material_id: r.material_id, quantity: Number(r.quantity) })),
    });
    setSaving(false);
    if (ok) {
      // Offer to print barcode labels for the produced pieces.
      const n = prompt('تم التصنيع ✅\nعدد ملصقات الباركود المراد طباعتها (أو 0 للتخطّي):', String(qtyNum));
      if (n !== null && (parseInt(n) || 0) > 0) {
        printBarcodeLabels({
          name: pName.trim(), code,
          price: Number(pSale) || 0,
          currency: cur, count: parseInt(n) || 1, storeName: storeSettings.name,
        });
      }
      setPName(''); setPColor(''); setPCode(''); setPQty(''); setPSale(''); setPNotes('');
      setRows([{ material_id: '', quantity: '' }]);
      setCosts([{ label: '', amount: '' }]);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3">
          <Scissors className="text-indigo-600" size={30} />
          التصنيع
        </h1>
        <p className="text-slate-500 mt-1 font-medium text-sm">إدارة الخامات وتصنيع المنتجات وحساب تكلفة القطعة وربحها</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Materials ──────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="bg-amber-50 dark:bg-amber-900/20 px-5 py-3 border-b border-amber-100 dark:border-amber-800 flex items-center gap-2">
            <Package size={20} className="text-amber-600" />
            <h2 className="text-base font-black text-amber-800 dark:text-amber-300">الخامات</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="اسم الخامة"><input className={input} placeholder="مثال: قماش قطن" value={mName} onChange={(e) => setMName(e.target.value)} /></Field>
              <Field label="الوحدة"><input className={input} placeholder="متر / كيلو" value={mUnit} onChange={(e) => setMUnit(e.target.value)} /></Field>
              <Field label={`سعر الوحدة (${cur})`}><input className={input} type="number" placeholder="0" value={mCost} onChange={(e) => setMCost(e.target.value)} /></Field>
              <Field label="الكمية المشتراة"><input className={input} type="number" placeholder="0" value={mStock} onChange={(e) => setMStock(e.target.value)} /></Field>
              <Field label="طريقة الدفع">
                <select className={input} value={mPay} onChange={(e) => setMPay(e.target.value)}>
                  {PAY_METHODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="إجمالي الشراء">
                <div className="px-3 py-2.5 rounded-lg bg-slate-100 dark:bg-slate-900 font-black text-slate-800 dark:text-slate-100 text-sm">{mTotal.toFixed(2)} {cur}</div>
              </Field>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">سيتم خصم قيمة الشراء من الخزنة كمصروف "شراء خامات".</p>
            <button onClick={submitMaterial} className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition">
              <Plus size={18} /> إضافة خامة
            </button>

            <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
              {materials.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-6">لا توجد خامات بعد</p>
              ) : materials.map((m) => (
                <div key={m.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                  <div>
                    <p className="font-bold text-slate-800 dark:text-slate-100">{m.name}</p>
                    <p className="text-[11px] text-slate-500">{m.cost_per_unit} {cur}/{m.unit} · متاح: <b>{m.stock_quantity}</b> {m.unit}</p>
                  </div>
                  <button onClick={() => { if (confirm('حذف الخامة؟')) deleteMaterial(m.id); }} className="text-red-500 hover:bg-red-50 p-2 rounded-lg"><Trash2 size={16} /></button>
                </div>
              ))}
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="اسم المنتج"><input className={input} placeholder="مثال: تيشيرت" value={pName} onChange={(e) => setPName(e.target.value)} /></Field>
              <Field label="اللون"><input className={input} placeholder="أبيض" value={pColor} onChange={(e) => setPColor(e.target.value)} /></Field>
              <Field label="الكود / الباركود (يتولّد تلقائياً لو فاضي)"><input className={input} placeholder="اختياري" value={pCode} onChange={(e) => setPCode(e.target.value)} /></Field>
              <Field label="عدد القطع المنتجة"><input className={input} type="number" placeholder="0" value={pQty} onChange={(e) => setPQty(e.target.value)} /></Field>
              <Field label={`سعر بيع القطعة (${cur})`}><input className={input} type="number" placeholder="0" value={pSale} onChange={(e) => setPSale(e.target.value)} /></Field>
            </div>

            {/* Materials used */}
            <div className="bg-slate-50 dark:bg-slate-900/30 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-black text-slate-700 dark:text-slate-200">الخامات المستخدمة</label>
                <button onClick={() => setRows((rs) => [...rs, { material_id: '', quantity: '' }])} className="text-indigo-600 text-xs font-bold bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded-lg hover:bg-indigo-100">+ خامة</button>
              </div>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <select className={input + ' flex-1 cursor-pointer appearance-none bg-no-repeat'} style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748b\' stroke-width=\'3\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundPosition: 'left 10px center' }} value={r.material_id} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, material_id: e.target.value } : x)))}>
                      <option value="">اختر خامة</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.cost_per_unit} {cur}/{m.unit})</option>)}
                    </select>
                    <input className={input + ' w-24'} type="number" placeholder="كمية" value={r.quantity} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                    {rows.length > 1 && <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-red-500 hover:bg-red-50 p-2 rounded-lg shrink-0"><Trash2 size={16} /></button>}
                  </div>
                ))}
              </div>
            </div>

            {/* Extra costs (multiple rows) */}
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
              <p className="text-[11px] text-slate-400 mt-2">التكاليف الإضافية تُخصم من الخزنة كمصروف "تكاليف تصنيع".</p>
            </div>

            <Field label="ملاحظات (اختياري)"><input className={input} value={pNotes} onChange={(e) => setPNotes(e.target.value)} /></Field>

            {/* Live cost summary */}
            <div className="grid grid-cols-2 gap-3">
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
