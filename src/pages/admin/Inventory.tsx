import { useState, useMemo } from 'react';
import { useStore, type Product } from '../../store/useStore';
import { Plus, Edit2, EyeOff, Eye, Search, X, Tag, FileText, Table as TableIcon, Box, AlertTriangle, TrendingUp, ScanLine, CheckCircle2, Printer } from 'lucide-react';
import { normalizeArabic } from '../../utils/textUtils';
import { UNIT_OPTIONS, getUnitConfig, isFractionalUnit, formatQty } from '../../utils/units';
import { generateBarcode, printBarcodeLabels } from '../../utils/printBarcodeLabels';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
// html2canvas-pro يدعم ألوان oklch() في Tailwind v4 (النسخة الأصلية تفشل معها وتكسر تصدير PDF).
import html2canvas from 'html2canvas-pro';

export default function Inventory() {
  const { products, categories, storeSettings, addProduct, updateProduct, orders } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [stockLocation, setStockLocation] = useState<'all' | 'warehouse' | 'display'>('all');
  const [seasonFilter, setSeasonFilter] = useState<'all' | 'summer' | 'winter'>('all');
  const [warehouseQty, setWarehouseQty] = useState(0); // كمية المستودع عند إضافة منتج جديد
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCatForm, setShowCatForm] = useState(false);
  const [showLowStock, setShowLowStock] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);

  const playSuccessSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.log('Audio not supported', e);
    }
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent form submission
      if (formData.barcode.trim().length > 3) {
        playSuccessSound();
        setScanSuccess(true);
        setTimeout(() => setScanSuccess(false), 1500);
      }
    }
  };
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    barcode: '',
    purchase_price: 0,
    average_purchase_price: 0,
    sale_price: 0,
    discount_price: 0,
    wholesale_price: 0,
    half_wholesale_price: 0,
    season: 'summer',
    stock_quantity: 0,
    display_quantity: 0,
    category_id: categories[0]?.id || '',
    unit: 'قطعة'
  });

  // الكمية حسب المخزن المختار: الكل = الإجمالي، المعرض = المعروض، المستودع = الباقي.
  const dispOf = (p: any) => Math.min(Number(p.display_quantity) || 0, Number(p.stock_quantity) || 0);
  const qtyOf = (p: any) => stockLocation === 'display' ? dispOf(p)
    : stockLocation === 'warehouse' ? ((Number(p.stock_quantity) || 0) - dispOf(p))
    : (Number(p.stock_quantity) || 0);
  // كمية مباعة لكل منتج (صافي بعد المرتجع).
  const soldMap = useMemo(() => {
    const m = new Map<string, number>();
    orders.filter((o: any) => !o.is_deleted && o.type !== 'payment').forEach((o: any) => {
      (o.items || []).forEach((it: any) => {
        m.set(it.id, (m.get(it.id) || 0) + ((Number(it.quantity) || 0) - (Number(it.returned_quantity) || 0)));
      });
    });
    return m;
  }, [orders]);

  const normalizedSearch = normalizeArabic(searchQuery);
  const searchTerms = normalizedSearch.split(' ').filter(t => t.trim() !== '');

  const filteredProducts = products.filter(p => {
    const normalizedName = normalizeArabic(p.name);
    const matchesSearch = searchTerms.length === 0 || searchTerms.every(term => normalizedName.includes(term)) || (p.barcode && p.barcode.includes(searchQuery));
    const matchesStock = showLowStock ? qtyOf(p) < 5 : true;
    const matchesHidden = showHidden ? p.is_hidden === true : !p.is_hidden; // showHidden=true → المخفيين فقط
    const matchesCategory = selectedCategory === 'all' || p.category_id === selectedCategory;
    const matchesSeason = seasonFilter === 'all' || p.season === seasonFilter;
    return matchesSearch && matchesStock && matchesHidden && matchesCategory && matchesSeason;
  }).sort((a, b) => new Date((b as any).created_at || 0).getTime() - new Date((a as any).created_at || 0).getTime());
  const hiddenCount = products.filter(p => p.is_hidden).length;

  // الإحصائيات حسب الفلاتر المختارة (الموسم + التصنيف + المخزن).
  const statsBase = products.filter(p => !p.is_hidden
    && (selectedCategory === 'all' || p.category_id === selectedCategory)
    && (seasonFilter === 'all' || p.season === seasonFilter));
  const totalStockValue = statsBase.reduce((acc, p) => acc + (qtyOf(p) * (p.average_purchase_price || p.purchase_price || 0)), 0);
  const lowStockCount = statsBase.filter(p => qtyOf(p) < 5).length;
  const totalItems = statsBase.reduce((acc, p) => acc + qtyOf(p), 0);

  const handleToggleHide = (product: Product) => {
    const action = product.is_hidden ? 'إظهار' : 'إخفاء';
    if (confirm(`هل أنت متأكد من ${action} المنتج: ${product.name}؟\n${product.is_hidden ? 'سيظهر للكاشير مرة أخرى.' : 'لن يظهر للكاشير ولكن سيبقى في قاعدة البيانات.'}`)) {
      updateProduct(product.id, { is_hidden: !product.is_hidden });
    }
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const { supabase } = await import('../../lib/supabase');
    const { data } = await supabase.from('categories').insert({ name }).select().single();
    if (data) {
      useStore.setState(s => ({ categories: [...s.categories, data as any] }));
      setNewCategoryName('');
      setShowCatForm(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    const count = products.filter(p => p.category_id === id).length;
    if (count > 0) {
      alert(`لا يمكن حذف تصنيف "${name}" لأن به ${count} منتج. احذف المنتجات أولاً.`);
      return;
    }
    if (!confirm(`هل أنت متأكد من حذف تصنيف "${name}"؟`)) return;
    const { supabase } = await import('../../lib/supabase');
    await supabase.from('categories').delete().eq('id', id);
    useStore.setState(s => ({ categories: s.categories.filter(c => c.id !== id) }));
  };

  const handleEditStock = (product: Product) => {
    const newStock = prompt(`تعديل المخزون للمنتج (${product.name}) بوحدة (${product.unit || 'قطعة'}):`, product.stock_quantity.toString());
    if (newStock !== null) {
      const parsed = parseFloat(newStock);
      if (!isNaN(parsed) && parsed >= 0) {
        updateProduct(product.id, { stock_quantity: parsed });
      }
    }
  };

  const handleEditPrice = (product: Product) => {
    const newPrice = prompt(`تعديل سعر البيع للمنتج (${product.name}):`, product.sale_price.toString());
    if (newPrice !== null) {
      const parsed = parseFloat(newPrice);
      if (!isNaN(parsed) && parsed >= 0) {
        updateProduct(product.id, { sale_price: parsed });
      }
    }
  };

  const openEditModal = (product: Product) => {
    setEditingProductId(product.id);
    setFormData({
      name: product.name,
      barcode: product.barcode || '',
      purchase_price: product.purchase_price,
      average_purchase_price: product.average_purchase_price || product.purchase_price,
      sale_price: product.sale_price,
      discount_price: product.discount_price || 0,
      wholesale_price: product.wholesale_price || 0,
      half_wholesale_price: product.half_wholesale_price || 0,
      season: product.season || 'summer',
      stock_quantity: product.stock_quantity,
      display_quantity: product.display_quantity || 0,
      category_id: product.category_id,
      unit: product.unit || 'قطعة'
    });
    setShowAddModal(true);
  };

  const openAddModal = () => {
    setEditingProductId(null);
    setFormData({
      name: '',
      barcode: '',
      purchase_price: 0,
      average_purchase_price: 0,
      sale_price: 0,
      discount_price: 0,
      wholesale_price: 0,
      half_wholesale_price: 0,
      season: 'summer',
      stock_quantity: 0,
      display_quantity: 0,
      category_id: categories[0]?.id || '',
      unit: 'قطعة'
    });
    setWarehouseQty(0);
    setShowAddModal(true);
  };

  const submitProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      alert("الرجاء إدخال اسم المنتج.");
      return;
    }

    // الباركود: لو فاضي يتولّد تلقائياً (النظام بيتعامل بالكود ده في البيع على الـ POS)
    let barcode = (formData.barcode || '').trim();
    if (!barcode) {
      const existing = new Set(products.map(p => p.barcode).filter(Boolean) as string[]);
      barcode = generateBarcode(existing);
    }

    const duplicate = products.find(p => p.barcode === barcode && p.id !== editingProductId);
    if (duplicate) {
      alert(`عذراً, هذا الباركود مسجل من قبل للمنتج: "${duplicate.name}". يرجى إدخال باركود فريد.`);
      return;
    }

    let payload = { ...formData, barcode };
    if (editingProductId) {
      // المعروض لا يتجاوز الإجمالي
      payload = { ...payload, display_quantity: Math.min(Number(formData.display_quantity) || 0, Number(formData.stock_quantity) || 0) };
      updateProduct(editingProductId, payload);
    } else {
      // الإجمالي = مستودع + معروض، والمعروض يتسجّل كما هو
      const display = Number(formData.display_quantity) || 0;
      payload = { ...payload, stock_quantity: (Number(warehouseQty) || 0) + display, display_quantity: display };
      addProduct(payload);
      // طباعة ملصقات الباركود بعدد القطع المضافة على طابعة الباركود الحراري
      if (payload.stock_quantity > 0) {
        printBarcodeLabels({
          name: payload.name,
          code: barcode,
          price: payload.sale_price,
          discountPrice: payload.discount_price,
          currency: storeSettings.currency,
          count: payload.stock_quantity,
          storeName: storeSettings.name,
        });
      }
    }

    setShowAddModal(false);
    setEditingProductId(null);
    setFormData({
      name: '',
      barcode: '',
      purchase_price: 0,
      average_purchase_price: 0,
      sale_price: 0,
      discount_price: 0,
      wholesale_price: 0,
      half_wholesale_price: 0,
      season: 'summer',
      stock_quantity: 0,
      display_quantity: 0,
      category_id: categories[0]?.id || '',
      unit: 'قطعة'
    });
    setWarehouseQty(0);
  };

  const exportExcel = () => {
    const wsData = [
      ['تقرير المخزون والمنتجات', '', '', '', '', ''],
      ['التاريخ', new Date().toLocaleDateString(), '', '', '', ''],
      [''],
      ['الباركود', 'اسم المنتج', 'التصنيف', 'الوحدة', 'سعر الشراء', 'متوسط الشراء', 'سعر البيع', `المخزون (${stockLocation === 'warehouse' ? 'المستودع' : stockLocation === 'display' ? 'المحل' : 'الكل'})`, 'مستودع', 'محل', 'مباع'],
      ...filteredProducts.map(p => [
        p.barcode,
        p.name,
        categories.find(c => c.id === p.category_id)?.name || '',
        getUnitConfig(p.unit).label,
        p.purchase_price,
        p.average_purchase_price,
        p.sale_price,
        qtyOf(p),
        Math.max(0, (Number(p.stock_quantity) || 0) - dispOf(p)),
        dispOf(p),
        soldMap.get(p.id) || 0
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    XLSX.writeFile(wb, `inventory_report_${new Date().toLocaleDateString()}.xlsx`);
  };

  const exportPDF = async () => {
    const element = document.getElementById('inventory-table');
    if (!element) return;
    
    setLoading(true);
    
    try {
      const canvas = await html2canvas(element, { 
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        onclone: (clonedDoc) => {
          const el = clonedDoc.getElementById('inventory-table');
          if (el) {
            el.style.height = 'auto';
            el.style.overflow = 'visible';
          }
        }
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      // Add the first page
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      // Add additional pages if needed
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      
      pdf.save(`inventory_report_${new Date().toLocaleDateString()}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
      alert('حدث خطأ أثناء تصدير ملف PDF');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 relative">

      {/* STATS CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-[32px] p-6 shadow-sm border border-slate-100 flex items-center gap-6 group hover:border-indigo-200 transition-all">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
            <TrendingUp size={32} />
          </div>
          <div>
            <p className="text-slate-400 font-bold text-sm">إجمالي قيمة المخزون</p>
            <h3 className="text-2xl font-black text-slate-800">
              {totalStockValue.toLocaleString()} <span className="text-sm font-normal text-slate-400">{storeSettings.currency}</span>
            </h3>
          </div>
        </div>

        <div className="bg-white rounded-[32px] p-6 shadow-sm border border-slate-100 flex items-center gap-6 group hover:border-emerald-200 transition-all">
          <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
            <Box size={32} />
          </div>
          <div>
            <p className="text-slate-400 font-bold text-sm">إجمالي القطع المتوفرة</p>
            <h3 className="text-2xl font-black text-slate-800">
              {totalItems.toLocaleString()} <span className="text-sm font-normal text-slate-400">قطعة</span>
            </h3>
          </div>
        </div>

        <div 
          onClick={() => setShowLowStock(!showLowStock)}
          className={`bg-white rounded-[32px] p-6 shadow-sm border flex items-center gap-6 group hover:border-red-200 transition-all cursor-pointer ${showLowStock ? 'border-red-500 bg-red-50/20 ring-4 ring-red-50' : 'border-slate-100'}`}
        >
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 group-hover:scale-110 transition-transform">
            <AlertTriangle size={32} />
          </div>
          <div>
            <p className="text-slate-400 font-bold text-sm">منتجات قاربت على النفاد</p>
            <h3 className="text-2xl font-black text-slate-800">
              {lowStockCount} <span className="text-sm font-normal text-slate-400">منتج</span>
            </h3>
          </div>
        </div>
      </div>

      {/* فلاتر: الموسم + المخزن */}
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2 bg-white rounded-2xl p-2 shadow-sm border border-slate-100 w-fit">
          <span className="text-xs font-bold text-slate-500 px-2">الموسم:</span>
          {([['all', 'الكل'], ['summer', 'صيفي'], ['winter', 'شتوي']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setSeasonFilter(k)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${seasonFilter === k ? 'bg-amber-500 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 bg-white rounded-2xl p-2 shadow-sm border border-slate-100 w-fit">
          <span className="text-xs font-bold text-slate-500 px-2">المخزن:</span>
          {([['all', 'الكل'], ['warehouse', 'المستودع'], ['display', 'المحل']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setStockLocation(k)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${stockLocation === k ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ADD PRODUCT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b flex justify-between items-center bg-slate-50 shrink-0">
              <h2 className="text-xl font-bold text-slate-800">{editingProductId ? 'تعديل بيانات المنتج' : 'إضافة منتج جديد'}</h2>
              <button onClick={() => { setShowAddModal(false); setEditingProductId(null); }} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-xl shadow-sm border border-slate-200">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submitProduct} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">اسم المنتج <span className="text-red-500">*</span></label>
                  <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none" />
                </div>
                <div className="sm:col-span-2 relative group">
                  <div className="flex justify-between items-end mb-1">
                    <label className="block text-sm font-bold text-slate-700">الباركود</label>
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md flex items-center gap-1 opacity-0 group-focus-within:opacity-100 transition-opacity">
                      <ScanLine size={12} />
                      ضع المؤشر هنا واستخدم جهاز الـ POS للفحص
                    </span>
                  </div>
                  <div className="relative">
                    <input 
                      type="text" 
                      dir="ltr" 
                      value={formData.barcode} 
                      onChange={e => setFormData({...formData, barcode: e.target.value})} 
                      onKeyDown={handleBarcodeKeyDown}
                      style={{ '--tw-ring-color': scanSuccess ? '#10b981' : storeSettings.themeColor + '40' } as any} 
                      className={`w-full bg-slate-50 border py-3 px-4 rounded-xl focus:ring-2 focus:outline-none text-left font-mono font-bold transition-colors ${scanSuccess ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`} 
                      placeholder="امسح الباركود هنا..."
                    />
                    {scanSuccess && (
                      <CheckCircle2 className="absolute left-3 top-3.5 text-emerald-500 animate-in zoom-in" size={20} />
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">وحدة البيع <span className="text-red-500">*</span></label>
                  <select value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 font-bold">
                    {UNIT_OPTIONS.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">{isFractionalUnit(formData.unit) ? '⚖️ منتج يُباع بالوزن — يمكن بيع كميات كسرية' : '🔢 منتج يُباع بالعدد'}</p>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">سعر البيع لكل {getUnitConfig(formData.unit).label} <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" required value={formData.sale_price} onChange={e => setFormData({...formData, sale_price: parseFloat(e.target.value) || 0})} style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">سعر البيع بعد الخصم (اختياري)</label>
                  <input type="number" min="0" step="0.01" value={formData.discount_price} onChange={e => setFormData({...formData, discount_price: parseFloat(e.target.value) || 0})} style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-amber-500" />
                  <p className="text-xs text-slate-400 mt-1">لو دخلت قيمة هنا، هتبقى هي سعر البيع الفعلي على الكاشير. والباركود لو سيبته فاضي هيتولّد تلقائياً.</p>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">سعر نص الجملة <span className="text-[10px] text-slate-400">(اختياري)</span></label>
                  <input type="number" min="0" step="0.01" value={formData.half_wholesale_price} onChange={e => setFormData({...formData, half_wholesale_price: parseFloat(e.target.value) || 0})} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-sky-500" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">سعر الجملة <span className="text-[10px] text-slate-400">(اختياري)</span></label>
                  <input type="number" min="0" step="0.01" value={formData.wholesale_price} onChange={e => setFormData({...formData, wholesale_price: parseFloat(e.target.value) || 0})} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-purple-500" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">الموسم</label>
                  <div className="flex gap-2">
                    {([['summer','صيفي'],['winter','شتوي']] as const).map(([k,label]) => (
                      <button type="button" key={k} onClick={() => setFormData({...formData, season: k})}
                        className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition border ${formData.season === k ? 'bg-indigo-600 text-white border-transparent' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {!editingProductId ? (
                  <>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">كمية المستودع</label>
                      <input type="number" min="0" step={isFractionalUnit(formData.unit) ? '0.001' : '1'} value={warehouseQty}
                        onChange={e => setWarehouseQty(parseFloat(e.target.value) || 0)}
                        className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">كمية المعروض (في المحل)</label>
                      <input type="number" min="0" step={isFractionalUnit(formData.unit) ? '0.001' : '1'} value={formData.display_quantity}
                        onChange={e => setFormData({...formData, display_quantity: parseFloat(e.target.value) || 0})}
                        className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-emerald-500" />
                      <p className="text-xs text-slate-400 mt-1">الإجمالي = {(Number(warehouseQty) || 0) + (Number(formData.display_quantity) || 0)} {getUnitConfig(formData.unit).label} · الافتراضي كله في المستودع.</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">الإجمالي في المخزون</label>
                      <input type="number" min="0" step={isFractionalUnit(formData.unit) ? '0.001' : '1'} value={formData.stock_quantity}
                        onChange={e => setFormData({...formData, stock_quantity: parseFloat(e.target.value) || 0})}
                        className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-1">المعروض في المحل (النقل بين المستودع والمحل)</label>
                      <input type="number" min="0" max={formData.stock_quantity} step={isFractionalUnit(formData.unit) ? '0.001' : '1'} value={formData.display_quantity}
                        onChange={e => setFormData({...formData, display_quantity: Math.min(parseFloat(e.target.value) || 0, formData.stock_quantity)})}
                        className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-emerald-500" />
                      <p className="text-xs text-slate-400 mt-1">المستودع: <b>{Math.max(0, (Number(formData.stock_quantity) || 0) - (Number(formData.display_quantity) || 0))}</b> · المعروض: <b>{Math.min(Number(formData.display_quantity) || 0, Number(formData.stock_quantity) || 0)}</b> · المُباع: <b>{soldMap.get(editingProductId) || 0}</b></p>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">تكلفة شراء الـ{getUnitConfig(formData.unit).label} <span className="text-[10px] text-slate-400">(اختياري)</span></label>
                  <input
                    type="number" min="0" step="0.01"
                    value={formData.purchase_price}
                    onChange={e => { const v = parseFloat(e.target.value) || 0; setFormData({...formData, purchase_price: v, average_purchase_price: v}); }}
                    style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                    className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-amber-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-slate-400 -mt-1">ℹ️ هذه كمية وتكلفة المخزون الافتتاحي — بعدها يتم التحديث تلقائياً عبر فواتير المشتريات. يمكن تعديل سعر البيع لاحقاً.</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">التصنيف</label>
                  <select value={formData.category_id} onChange={e => setFormData({...formData, category_id: e.target.value})} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500">
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="pt-4 mt-2 border-t">
                <button type="submit" style={{ backgroundColor: storeSettings.themeColor }} className="w-full text-white py-4 rounded-xl font-bold transition shadow-lg shrink-0 flex items-center justify-center gap-2">
                  <Plus size={20} />
                  {editingProductId ? 'تحديث بيانات المنتج' : 'حفظ المنتج في قاعدة البيانات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CATEGORIES SECTION */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <Tag size={22} className="text-indigo-500" />
            التصنيفات
          </h2>
          <button
            onClick={() => setShowCatForm(!showCatForm)}
            style={{ backgroundColor: storeSettings.themeColor }}
            className="text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm"
          >
            <Plus size={16} /> إضافة تصنيف
          </button>
        </div>

        {showCatForm && (
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
              placeholder="اسم التصنيف الجديد..."
              className="flex-1 bg-white border border-slate-200 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              autoFocus
            />
            <button onClick={handleAddCategory} style={{ backgroundColor: storeSettings.themeColor }} className="text-white px-5 rounded-xl font-bold text-sm">حفظ</button>
            <button onClick={() => { setShowCatForm(false); setNewCategoryName(''); }} className="bg-slate-100 text-slate-600 px-4 rounded-xl font-bold text-sm">إلغاء</button>
          </div>
        )}

        {categories.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-6 text-center text-slate-400">
            <Tag size={32} className="mx-auto mb-2 opacity-40" />
            <p className="font-semibold">لا توجد تصنيفات بعد - أضف تصنيفات أولاً لتستطيع إضافة منتجات</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {categories.map(cat => {
              const count = products.filter(p => p.category_id === cat.id).length;
              return (
                <div key={cat.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-2.5 shadow-sm">
                  <span className="font-bold text-slate-700">{cat.name}</span>
                  <span style={{ backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor }} className="text-xs font-bold px-2 py-0.5 rounded-lg">{count} منتج</span>
                  <button
                    onClick={() => handleDeleteCategory(cat.id, cat.name)}
                    className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DASHBOARD CONTENT */}
      <div className="flex flex-wrap gap-3 justify-between items-end mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-800">المنتجات</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button 
              onClick={exportExcel}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-emerald-700 transition text-sm"
            >
              <TableIcon size={16} /> Excel
            </button>
            <button 
              onClick={exportPDF}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-red-700 transition text-sm disabled:opacity-50"
              disabled={loading}
            >
              {loading ? '...جاري التصدير' : <><FileText size={16} /> PDF</>}
            </button>
          </div>
          <button onClick={openAddModal} style={{ backgroundColor: storeSettings.themeColor }} className="text-white px-6 py-3 rounded-xl font-bold transition flex items-center gap-2 shadow-lg">
            <Plus size={20} />
            إضافة منتج
          </button>
        </div>
      </div>

      <div id="inventory-table" className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-[500px]">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
          <div className="relative w-full md:w-1/3 md:min-w-[300px]">
            <Search className="absolute right-4 top-3 text-slate-400" size={20} />
              <input
                type="text"
                placeholder="ابحث باسم المنتج أو الباركود..."
                style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pr-12 pl-4 text-sm focus:outline-none focus:ring-2 shadow-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Tag className="absolute right-3 top-2.5 text-slate-400 pointer-events-none" size={18} />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                className="bg-white border border-slate-200 rounded-xl py-2.5 pr-10 pl-4 text-sm font-bold text-slate-600 focus:outline-none focus:ring-2 shadow-sm cursor-pointer"
              >
                <option value="all">كل التصنيفات</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {hiddenCount > 0 && (
              <button
                onClick={() => setShowHidden(!showHidden)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm border transition ${
                  showHidden
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                }`}
              >
                {showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
                {showHidden ? 'إخفاء المخفيين' : `إظهار المخفيين (${hiddenCount})`}
              </button>
            )}
            <div className="text-sm text-slate-500 font-bold bg-white px-4 py-2 border border-slate-200 rounded-xl">
              إجمالي المنتجات: {products.length}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-white border-b border-slate-100 text-slate-400 font-medium">
              <tr>
                <th className="p-4">الباركود</th>
                <th className="p-4">اسم المنتج</th>
                <th className="p-4">التصنيف</th>
                <th className="p-4 text-center">الوحدة</th>
                <th className="p-4 text-center">سعر الشراء</th>
                <th className="p-4 text-center">متوسط الشراء</th>
                <th className="p-4 text-center border-x border-slate-100 bg-slate-50">سعر البيع</th>
                <th className="p-4 text-center border-l border-slate-100 bg-slate-50">المخزون المتوفر</th>
                <th className="p-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredProducts.map((product) => {
                const category = categories.find(c => c.id === product.category_id)?.name;
                const isLowStock = qtyOf(product) < 5;
                
                return (
                  <tr key={product.id} className={`hover:bg-slate-50 transition ${product.is_hidden ? 'opacity-50 bg-slate-50/80' : ''}`}>
                    <td className="p-4 font-mono text-slate-400">
                      {product.barcode}
                      {product.is_hidden && (
                        <span className="mr-2 text-[10px] font-black bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded">مخفي</span>
                      )}
                    </td>
                    <td className={`p-4 font-bold ${product.is_hidden ? 'line-through text-slate-400' : ''}`}>{product.name}</td>
                    <td className="p-4 text-slate-500">{category}</td>
                    <td className="p-4 text-center">
                      <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">{getUnitConfig(product.unit).label}</span>
                    </td>
                    <td className="p-4 text-center">{product.purchase_price} {storeSettings.currency}</td>
                    <td className="p-4 text-center font-bold text-indigo-600 bg-indigo-50/30">{product.average_purchase_price} {storeSettings.currency}</td>

                    <td className="p-4 text-center border-x border-slate-100 bg-slate-50/50">
                      <button onClick={() => handleEditPrice(product)} style={{ '--hover-color': storeSettings.themeColor } as any} className="flex items-center justify-center gap-2 w-full hover:text-[var(--hover-color)] transition group font-black">
                        {product.sale_price} {storeSettings.currency}<span className="text-[10px] text-slate-400 font-normal">/{getUnitConfig(product.unit).label}</span>
                        <Edit2 size={14} className="opacity-0 group-hover:opacity-100" />
                      </button>
                    </td>

                    <td className="p-4 text-center border-l border-slate-100 bg-slate-50/50">
                      <button
                        onClick={() => handleEditStock(product)}
                        style={{ '--hover-bg': storeSettings.themeColor + '15', '--hover-text': storeSettings.themeColor } as any}
                        className={`flex items-center justify-center gap-2 w-full font-bold px-3 py-1.5 rounded-lg transition group ${isLowStock ? 'bg-red-50 text-red-600' : 'hover:bg-[var(--hover-bg)] hover:text-[var(--hover-text)]'}`}
                      >
                        {formatQty(qtyOf(product), product.unit)}
                        <Edit2 size={14} className="opacity-0 group-hover:opacity-100" />
                      </button>
                      <div className="text-[9px] text-slate-400 mt-1">مستودع {Math.max(0, (Number(product.stock_quantity) || 0) - dispOf(product))} · محل {dispOf(product)}</div>
                    </td>

                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openEditModal(product)} className="p-2 text-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition" title="تعديل المنتج">
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => {
                            const code = product.barcode || generateBarcode(new Set(products.map(p => p.barcode).filter(Boolean) as string[]));
                            if (!product.barcode) updateProduct(product.id, { barcode: code });
                            const n = prompt('عدد ملصقات الباركود المراد طباعتها:', String(product.stock_quantity || 1));
                            if (n === null) return;
                            printBarcodeLabels({
                              name: product.name, code,
                              price: product.sale_price, discountPrice: product.discount_price,
                              currency: storeSettings.currency, count: parseInt(n) || 1, storeName: storeSettings.name,
                            });
                          }}
                          className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 rounded-lg transition"
                          title="طباعة باركود"
                        >
                          <Printer size={18} />
                        </button>
                        {/* زر الإخفاء/الإظهار بدلاً من الحذف */}
                        <button
                          onClick={() => handleToggleHide(product)}
                          className={`p-2 rounded-lg transition ${
                            product.is_hidden
                              ? 'text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700'
                              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                          }`}
                          title={product.is_hidden ? 'إظهار المنتج للكاشير' : 'إخفاء المنتج من الكاشير'}
                        >
                          {product.is_hidden ? <Eye size={18} /> : <EyeOff size={18} />}
                        </button>
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
  );
}
