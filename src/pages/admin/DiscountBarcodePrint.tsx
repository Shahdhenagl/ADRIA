import { useMemo, useState } from 'react';
import { Printer, Search, CheckSquare, Square, ShieldAlert } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { printBarcodeLabelsBatch } from '../../utils/printBarcodeLabels';

export default function DiscountBarcodePrint() {
  const { products, storeSettings, adminPermissions } = useStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});

  if (adminPermissions !== null && !adminPermissions.includes('/admin/discount-barcode-print')) {
    return <div className="min-h-full flex items-center justify-center p-8" dir="rtl"><div className="bg-red-50 text-red-700 rounded-2xl p-8 text-center font-black">ليس لديك صلاحية الوصول إلى طباعة باركود الخصومات.</div></div>;
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p: any) => {
      const hasDiscount = Number(p.discount_price || 0) > 0 && Number(p.sale_price || 0) > Number(p.discount_price || 0);
      const text = `${p.name || ''} ${p.barcode || ''}`.toLowerCase();
      return hasDiscount && (!q || text.includes(q));
    });
  }, [products, query]);

  const toggle = (id: string, available: number) => {
    setSelected((s) => {
      if (s[id] !== undefined) { const next = { ...s }; delete next[id]; return next; }
      return { ...s, [id]: Math.max(1, Math.floor(available) || 1) };
    });
  };

  const printSelected = () => {
    const items = rows.filter((p: any) => selected[p.id] !== undefined).map((p: any) => ({
      name: p.name,
      code: String(p.barcode || p.id),
      price: Number(p.sale_price || 0),
      discountPrice: Number(p.discount_price || 0),
      labelText: 'عرض خصم',
      count: Math.max(1, Math.floor(selected[p.id] || 1)),
    }));
    if (!items.length) return alert('حدد منتجًا واحدًا على الأقل');
    printBarcodeLabelsBatch(items, { currency: storeSettings.currency, storeName: storeSettings.name });
  };

  return (
    <div className="p-6 md:p-8 space-y-5 animate-fade-in" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-3"><Printer className="text-indigo-600" size={30} /> طباعة باركود الخصومات</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">حدد المنتجات واختار عدد الملصقات ثم اطبعها دفعة واحدة</p>
        </div>
        <button onClick={printSelected} className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-5 py-3 rounded-xl flex items-center gap-2"><Printer size={18} /> طباعة المحدد</button>
      </div>
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex gap-3 items-start text-indigo-800"><ShieldAlert size={20} className="shrink-0 mt-0.5" /><p className="text-sm font-bold">هذه الشاشة مخصصة لطباعة ملصقات الخصم فقط. لا تحتوي على إدارة الأسعار أو التقارير أو إعدادات النظام.</p></div>
      <div className="relative"><Search className="absolute right-3 top-3 text-slate-400" size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم المنتج أو الكود" className="w-full rounded-xl border border-slate-200 bg-white px-10 py-3 font-bold" /></div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        {rows.length === 0 ? <div className="p-12 text-center text-slate-400 font-bold">لا توجد منتجات عليها خصم فعال</div> : rows.map((p: any) => {
          const available = Math.max(0, Number(p.stock_quantity ?? p.display_quantity ?? 0));
          const isSelected = selected[p.id] !== undefined;
          return <div key={p.id} className="p-4 border-b last:border-0 flex items-center gap-3 flex-wrap">
            <button onClick={() => toggle(p.id, available)} className="text-indigo-600" aria-label="تحديد المنتج">{isSelected ? <CheckSquare size={23} /> : <Square size={23} />}</button>
            <div className="flex-1 min-w-[180px]"><p className="font-black text-slate-800 dark:text-white">{p.name}</p><p className="text-xs text-slate-500">الكود: {p.barcode || '—'} · المتاح: {available}</p></div>
            <div className="text-sm font-bold"><span className="line-through text-slate-400 ml-2">{Number(p.sale_price).toLocaleString()}</span><span className="text-emerald-600">{Number(p.discount_price).toLocaleString()} {storeSettings.currency}</span></div>
            {isSelected && <input type="number" min="1" max={Math.max(1, available)} value={selected[p.id]} onChange={(e) => setSelected((s) => ({ ...s, [p.id]: Math.max(1, Math.min(available || 1, Number(e.target.value) || 1)) }))} className="w-24 rounded-lg border px-2 py-2 text-center font-bold" title="عدد الملصقات" />}
          </div>;
        })}
      </div>
    </div>
  );
}
