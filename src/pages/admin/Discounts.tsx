import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Check, Edit3, Power, Printer, Search, Tag, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useStore } from '../../store/useStore';
import type { Product } from '../../store/useStore';
import type { BarcodeFormat, DiscountType, ProductDiscount } from '../../utils/productDiscounts';
import { printBarcodeLabels, printBarcodeLabelsBatch } from '../../utils/printBarcodeLabels';

const fmt = (value: number) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const localInput = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16) : '';

export default function Discounts() {
  const { products } = useStore();
  const [rows, setRows] = useState<ProductDiscount[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [value, setValue] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [endsAt, setEndsAt] = useState('');
  const [permanent, setPermanent] = useState(false);
  const [labelText, setLabelText] = useState('خصم خاص');
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormat>('sale');
  const [quantityMode, setQuantityMode] = useState<'all' | 'partial'>('all');
  const [quantityLimit, setQuantityLimit] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [selectedPrintIds, setSelectedPrintIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const barcodeRef = useRef<SVGSVGElement>(null);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('product_discounts').select('*, product:products(id,name,barcode,sale_price)').order('created_at', { ascending: false });
    if (!error) setRows((data || []) as ProductDiscount[]);
    else console.warn(error.message);
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(p => !q || p.name.toLowerCase().includes(q) || String(p.barcode || '').toLowerCase().includes(q)).slice(0, 20);
  }, [products, query]);

  const discountedPrice = selected ? (discountType === 'percentage'
    ? Number(selected.sale_price) * (1 - Math.min(100, Math.max(0, Number(value) || 0)) / 100)
    : Number(value) || 0) : 0;
  const availableQuantity = selected ? Number(selected.stock_quantity || selected.display_quantity || 0) : 0;
  const visibleRows = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    return rows.filter(r => {
      const p = r.product || products.find(x => x.id === r.product_id);
      return !q || String(p?.name || '').toLowerCase().includes(q) || String(p?.barcode || '').toLowerCase().includes(q);
    });
  }, [rows, products, recordSearch]);

  const reset = () => {
    setSelected(null); setQuery(''); setValue(''); setEditing(null); setEndsAt(''); setPermanent(false); setQuantityMode('all'); setQuantityLimit('');
    setStartsAt(new Date().toISOString().slice(0, 16)); setLabelText('خصم خاص'); setBarcodeFormat('sale');
  };
  const startEdit = (row: ProductDiscount) => {
    const p = products.find(x => x.id === row.product_id) || null;
    setSelected(p); setEditing(row.id); setDiscountType(row.discount_type); setValue(String(row.discount_type === 'fixed' ? row.discounted_price : Math.round((1 - row.discounted_price / row.original_price) * 100 * 100) / 100));
    setStartsAt(localInput(row.starts_at)); setEndsAt(localInput(row.ends_at)); setPermanent(!row.ends_at); setLabelText(row.label_text || 'خصم خاص'); setBarcodeFormat(row.barcode_format); setQuantityMode(row.quantity_limit == null ? 'all' : 'partial'); setQuantityLimit(row.quantity_limit == null ? '' : String(row.quantity_limit)); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const save = async () => {
    if (!selected) return alert('اختاري المنتج أولًا');
    if (!Number(value) || discountedPrice <= 0 || discountedPrice >= Number(selected.sale_price)) return alert('أدخلي سعرًا مخفضًا صحيحًا أقل من السعر الأصلي');
    if (!startsAt || (!permanent && !endsAt)) return alert('حددي تاريخ البداية والنهاية أو اختاري دائم');
    const scopedQty = quantityMode === 'all' ? null : Math.floor(Number(quantityLimit) || 0);
    if (quantityMode === 'partial' && (scopedQty == null || scopedQty <= 0 || scopedQty > availableQuantity)) return alert(`حددي كمية من 1 إلى ${availableQuantity}`);
    const duplicate = rows.find(r => r.product_id === selected.id && r.id !== editing && r.is_active && (!r.ends_at || new Date(r.ends_at).getTime() > Date.now()) && new Date(r.starts_at).getTime() <= new Date().getTime());
    if (duplicate) return alert('يوجد خصم مسجل بالفعل لهذا الكود. أوقفي الخصم الحالي أو عدّليه بدل إضافة تكرار جديد.');
    setSaving(true);
    const payload = { product_id: selected.id, discount_type: discountType, original_price: Number(selected.sale_price), discounted_price: Math.round(discountedPrice * 100) / 100, quantity_limit: scopedQty, starts_at: new Date(startsAt).toISOString(), ends_at: permanent ? null : new Date(endsAt).toISOString(), is_active: true, label_text: labelText.trim() || null, barcode_format: barcodeFormat };
    const result = editing ? await supabase.from('product_discounts').update(payload).eq('id', editing) : await supabase.from('product_discounts').insert(payload);
    setSaving(false);
    if (result.error) return alert('تعذر حفظ الخصم: ' + result.error.message);
    await reload(); reset();
  };
  const toggleActive = async (row: ProductDiscount) => {
    const next = !row.is_active;
    const { error } = await supabase.from('product_discounts').update({ is_active: next }).eq('id', row.id);
    if (error) return alert('تعذر تغيير حالة الخصم: ' + error.message);
    setRows(current => current.map(item => item.id === row.id ? { ...item, is_active: next } : item));
  };
  const remove = async (id: string) => {
    if (!confirm('حذف هذا الخصم؟')) return;
    const { error } = await supabase.from('product_discounts').delete().eq('id', id);
    if (error) alert(error.message); else reload();
  };
  const print = (row: ProductDiscount) => {
    const product = row.product || products.find(p => p.id === row.product_id);
    const code = product?.barcode || product?.id || row.product_id;
    if (!code) return alert('لا يوجد باركود لطباعته');
    printBarcodeLabels({ name: product?.name || row.product_id, code: String(code), price: Number(row.original_price), discountPrice: Number(row.discounted_price), labelText: row.label_text || (row.barcode_format === 'clearance' ? 'تصفية' : row.barcode_format === 'sale' ? 'عرض خاص' : ''), currency: 'ج.م', count: Math.max(1, Math.floor(Number(row.quantity_limit) || 1)) });
  };
  const printSelected = () => {
    const selectedRows = visibleRows.filter(r => selectedPrintIds.includes(r.id));
    if (!selectedRows.length) return alert('اختاري خصمًا واحدًا على الأقل للطباعة');
    printBarcodeLabelsBatch(selectedRows.map(r => { const p = r.product || products.find(x => x.id === r.product_id); return { name: p?.name || r.product_id, code: String(p?.barcode || p?.id || r.product_id), price: Number(r.original_price), discountPrice: Number(r.discounted_price), labelText: r.label_text || '', count: Math.max(1, Math.floor(Number(r.quantity_limit) || 1)) }; }), { currency: 'ج.م' });
  };
  useEffect(() => { if (barcodeRef.current && selected && selected.barcode) JsBarcode(barcodeRef.current, String(selected.barcode), { format: 'CODE128', width: 2, height: 44, displayValue: true, margin: 4 }); }, [selected]);

  return <div className="p-4 md:p-8 space-y-6" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2"><Tag className="text-emerald-600"/> خصومات المنتجات</h1><p className="text-sm text-slate-500 mt-1">السعر المخفّض ينعكس تلقائيًا في الكاشير خلال المدة المحددة.</p></div><div className="rounded-2xl bg-emerald-50 text-emerald-700 px-4 py-3 text-sm font-bold">{rows.filter(r => r.is_active).length} خصم مسجل</div></div>
    <div className="grid xl:grid-cols-[1.1fr_.9fr] gap-6">
      <section className="rounded-3xl bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-slate-800 p-5 space-y-4"><h2 className="font-black">{editing ? 'تعديل خصم' : 'إضافة خصم جديد'}</h2>
        <div className="relative"><Search className="absolute right-3 top-3.5 w-4 h-4 text-slate-400"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحثي باسم المنتج أو الباركود" className="w-full rounded-2xl border border-slate-200 pr-10 pl-4 py-3 outline-none focus:ring-2 focus:ring-emerald-200"/></div>
        {!selected && query && <div className="max-h-52 overflow-auto space-y-1">{filteredProducts.map(p => <button key={p.id} onClick={() => { setSelected(p); setQuery(''); setValue(String(Math.max(0, Number(p.sale_price) - 1))); }} className="w-full flex justify-between items-center p-3 rounded-xl hover:bg-emerald-50 text-right"><span className="font-bold">{p.name}</span><span className="text-xs text-slate-500">{p.barcode || 'بدون باركود'} · {fmt(p.sale_price)}</span></button>)}</div>}
        {selected && <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3"><div><div className="font-black">{selected.name}</div><div className="text-xs text-slate-500">كود الصنف: <b>{selected.barcode || 'بدون باركود'}</b> · المتاح: <b>{fmt(availableQuantity)}</b> · السعر: {fmt(selected.sale_price)}</div></div><button onClick={() => setSelected(null)} className="p-2 rounded-xl hover:bg-white"><X className="w-4"/></button></div>}
        <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm font-bold">نوع الخصم<select value={discountType} onChange={e => setDiscountType(e.target.value as DiscountType)} className="mt-1 w-full rounded-xl border p-3"><option value="fixed">سعر نهائي</option><option value="percentage">نسبة مئوية</option></select></label><label className="text-sm font-bold">{discountType === 'fixed' ? 'السعر بعد الخصم' : 'نسبة الخصم %'}<input type="number" min="0" value={value} onChange={e => setValue(e.target.value)} className="mt-1 w-full rounded-xl border p-3"/></label></div>
        {selected && <div className="rounded-2xl bg-emerald-50 p-4 text-sm"><span className="text-slate-500 line-through">قبل الخصم: {fmt(selected.sale_price)}</span><span className="mx-3 font-black text-emerald-700">بعد الخصم: {fmt(discountedPrice)}</span></div>}
        {selected && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3"><div className="font-black text-sm mb-2">نطاق الكمية</div><div className="flex gap-4 text-sm font-bold"><label><input type="radio" checked={quantityMode === 'all'} onChange={() => setQuantityMode('all')} /> كل الكمية ({fmt(availableQuantity)})</label><label><input type="radio" checked={quantityMode === 'partial'} onChange={() => setQuantityMode('partial')} /> جزء منها</label></div>{quantityMode === 'partial' && <input type="number" min="1" max={availableQuantity} value={quantityLimit} onChange={e => setQuantityLimit(e.target.value)} placeholder="الكمية" className="mt-2 w-full rounded-xl border p-2"/>}</div>}
        <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm font-bold">يبدأ في<input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="mt-1 w-full rounded-xl border p-3"/></label><label className="text-sm font-bold">ينتهي في<input type="datetime-local" disabled={permanent} value={endsAt} onChange={e => setEndsAt(e.target.value)} className="mt-1 w-full rounded-xl border p-3 disabled:bg-slate-100"/></label></div>
        <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={permanent} onChange={e => setPermanent(e.target.checked)}/> خصم دائم بدون تاريخ انتهاء</label>
        <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm font-bold">نص الملصق<input value={labelText} onChange={e => setLabelText(e.target.value)} placeholder="مثال: عرض الأسبوع" className="mt-1 w-full rounded-xl border p-3"/></label><label className="text-sm font-bold">شكل الباركود<select value={barcodeFormat} onChange={e => setBarcodeFormat(e.target.value as BarcodeFormat)} className="mt-1 w-full rounded-xl border p-3"><option value="standard">عادي</option><option value="sale">عرض خاص</option><option value="clearance">تصفية</option></select></label></div>
        <div className="flex gap-2"><button disabled={saving} onClick={save} className="flex-1 rounded-2xl bg-emerald-600 text-white py-3 font-black hover:bg-emerald-700 disabled:opacity-50">{saving ? 'جارٍ الحفظ...' : <><Check className="inline w-4 ml-1"/> تأكيد الخصم</>}</button>{editing && <button onClick={reset} className="rounded-2xl bg-slate-100 px-5 font-bold">إلغاء</button>}</div>
      </section>
      <section className="rounded-3xl bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-slate-800 p-5"><h2 className="font-black mb-4">معاينة الملصق</h2><div className="rounded-2xl border-2 border-dashed border-slate-200 p-7 text-center space-y-2"><div className="font-black">{selected?.name || 'اختاري منتجًا'}</div><div className="text-sm text-slate-500">{labelText}</div><div className="line-through text-slate-400">قبل الخصم: {selected ? fmt(selected.sale_price) : '—'}</div><div className="text-2xl font-black text-emerald-600">بعد الخصم: {selected ? fmt(discountedPrice) : '—'}</div>{selected?.barcode ? <svg ref={barcodeRef} className="mx-auto max-w-full"/> : <div className="text-xs text-slate-400">المنتج بدون باركود</div>}</div></section>
    </div>
    <section className="rounded-3xl bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-slate-800 p-5"><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><h2 className="font-black">الخصومات المسجلة</h2><div className="flex gap-2"><input value={recordSearch} onChange={e => setRecordSearch(e.target.value)} placeholder="بحث بالاسم أو الكود" className="rounded-xl border p-2 text-sm"/><button onClick={printSelected} className="rounded-xl bg-emerald-600 text-white px-3 py-2 text-sm font-bold"><Printer className="inline w-4 ml-1"/> طباعة المحدد</button></div></div>{loading ? <div className="text-slate-500">جارٍ التحميل...</div> : rows.length === 0 ? <div className="text-slate-500">لا توجد خصومات بعد.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-right"><th className="p-3"><input type="checkbox" checked={visibleRows.length > 0 && visibleRows.every(r => selectedPrintIds.includes(r.id))} onChange={e => setSelectedPrintIds(e.target.checked ? visibleRows.map(r => r.id) : [])}/></th><th className="p-3">المنتج والكود</th><th className="p-3">الكمية</th><th className="p-3">قبل / بعد</th><th className="p-3">المدة</th><th className="p-3">الحالة</th><th className="p-3">إجراءات</th></tr></thead><tbody>{visibleRows.map(r => <tr key={r.id} className="border-b last:border-0"><td className="p-3"><input type="checkbox" checked={selectedPrintIds.includes(r.id)} onChange={e => setSelectedPrintIds(ids => e.target.checked ? [...new Set([...ids, r.id])] : ids.filter(id => id !== r.id))}/></td><td className="p-3 font-bold">{r.product?.name || products.find(p => p.id === r.product_id)?.name || r.product_id}<div className="text-xs text-slate-500">كود: {r.product?.barcode || products.find(p => p.id === r.product_id)?.barcode || '—'}</div></td><td className="p-3">{r.quantity_limit == null ? 'كل المتاح' : fmt(r.quantity_limit)}</td><td className="p-3"><span className="line-through text-slate-400">{fmt(r.original_price)}</span> <span className="font-black text-emerald-600">{fmt(r.discounted_price)}</span></td><td className="p-3 text-xs">{new Date(r.starts_at).toLocaleString('ar-EG')}<br/>{r.ends_at ? new Date(r.ends_at).toLocaleString('ar-EG') : 'دائم'}</td><td className="p-3">{isActiveRow(r) ? <span className="text-emerald-600 font-bold">فعال الآن</span> : <span className="text-slate-400">غير فعال</span>}</td><td className="p-3 flex gap-2"><button onClick={() => print(r)} title="طباعة" className="p-2 rounded-xl bg-slate-100 hover:bg-emerald-100"><Printer className="w-4"/></button><button onClick={() => toggleActive(r)} title={r.is_active ? 'إيقاف الخصم' : 'تفعيل الخصم'} className={`p-2 rounded-xl ${r.is_active ? 'bg-emerald-100 text-emerald-700 hover:bg-amber-100' : 'bg-slate-100 text-slate-400 hover:bg-emerald-100'}`}><Power className="w-4"/></button><button onClick={() => startEdit(r)} title="تعديل" className="p-2 rounded-xl bg-slate-100 hover:bg-blue-100"><Edit3 className="w-4"/></button><button onClick={() => remove(r.id)} title="حذف" className="p-2 rounded-xl bg-slate-100 hover:bg-red-100 text-red-600"><Trash2 className="w-4"/></button></td></tr>)}</tbody></table></div>}</section>
  </div>;
}
function isActiveRow(row: ProductDiscount) { const now = Date.now(); return row.is_active && new Date(row.starts_at).getTime() <= now && (!row.ends_at || new Date(row.ends_at).getTime() > now); }
