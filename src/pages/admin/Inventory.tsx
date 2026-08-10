import { useState, useMemo, useRef } from 'react';
import { useStore, type Product } from '../../store/useStore';
import { Plus, Edit2, EyeOff, Eye, Search, X, Tag, FileText, Table as TableIcon, Box, AlertTriangle, TrendingUp, ScanLine, CheckCircle2, Printer, Upload, Download, ArrowLeftRight, Layers, Trash2, History } from 'lucide-react';
import { normalizeArabic } from '../../utils/textUtils';
import { splitStockValueBySource, totalIntakeValue, intakeSourceLabel } from '../../utils/stockIntake';
import { UNIT_OPTIONS, getUnitConfig, isFractionalUnit, formatQty } from '../../utils/units';
import { generateBarcode, printBarcodeLabels, printBarcodeLabelsBatch } from '../../utils/printBarcodeLabels';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
// html2canvas-pro يدعم ألوان oklch() في Tailwind v4 (النسخة الأصلية تفشل معها وتكسر تصدير PDF).
import html2canvas from 'html2canvas-pro';

type StockMovementLine = {
  at?: string | null;
  source: string;
  ref: string;
  qty: number;
  cost: number;
  note?: string | null;
};

export default function Inventory() {
  const { products, categories, storeSettings, addProduct, updateProduct, orders, suppliers, addSupplier,
    stockIntakes, purchaseInvoices, productionOrders, devoItems, writeOffs, heldInvoices, logStockIntake, deleteStockIntake } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [stockLocation, setStockLocation] = useState<'all' | 'warehouse' | 'display'>('all');
  const [seasonFilter, setSeasonFilter] = useState<'all' | 'summer' | 'winter' | 'annual'>('all');
  const [warehouseQty, setWarehouseQty] = useState(0); // كمية المستودع عند إضافة منتج جديد
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCatForm, setShowCatForm] = useState(false);
  const [showLowStock, setShowLowStock] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [movementProductId, setMovementProductId] = useState<string | null>(null);
  const [movementAdjustments, setMovementAdjustments] = useState<any[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState('');

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
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // استبدال مخزون: نقل كمية من منتج لآخر بنفس سعر البيع
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showQuickMovementModal, setShowQuickMovementModal] = useState(false);
  const [quickMovementSearch, setQuickMovementSearch] = useState('');
  const [swapFromId, setSwapFromId] = useState('');
  const [swapToId, setSwapToId] = useState('');
  const [swapQty, setSwapQty] = useState('');
  const [swapBusy, setSwapBusy] = useState(false);
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
    supplier_name: '',
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

  // ── مخزون دخل بدون فاتورة شراء (db/59) ──────────────────────────────
  // القيمة دي رأس مال بضاعة بادئين بيه: مالهاش فاتورة مورد ولا مصروف ولا حركة خزنة،
  // ومع ذلك بتتخصم كتكلفة وقت البيع — فلازم تكون مقيّدة عشان الربح يبقى مقابل رأس مال.
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [intakeProductId, setIntakeProductId] = useState('');
  const [intakeSearch, setIntakeSearch] = useState('');
  const [intakeTableSearch, setIntakeTableSearch] = useState('');
  const [intakeQty, setIntakeQty] = useState('');
  const [intakeCost, setIntakeCost] = useState('');
  const [intakeNote, setIntakeNote] = useState('');

  const statsFilterActive = selectedCategory !== 'all' || seasonFilter !== 'all';
  const statsBaseIds = useMemo(() => new Set(statsBase.map(p => p.id)), [statsBase]);
  // مع فلتر تصنيف/موسم نعرض قيود منتجات الفلتر فقط؛ من غير فلتر نعرض السجل كامل
  // (بما فيه قيود منتجات اتحذفت — قيمتها اتصرفت فعلاً ولازم تفضل محسوبة).
  const visibleIntakes = useMemo(
    () => (statsFilterActive ? stockIntakes.filter(i => statsBaseIds.has(i.product_id)) : stockIntakes),
    [stockIntakes, statsFilterActive, statsBaseIds]
  );
  const noPurchaseTotal = useMemo(() => totalIntakeValue(visibleIntakes), [visibleIntakes]);
  // تقسيم قيمة المخزون الحالي (المعروضة فوق) على المصدر بنفس منطق المتوسط المرجّح.
  const stockValueSplit = useMemo(
    () => splitStockValueBySource(
      statsBase.map(p => ({ product_id: p.id, value: qtyOf(p) * (p.average_purchase_price || p.purchase_price || 0) })),
      purchaseInvoices,
      stockIntakes
    ),
    [statsBase, purchaseInvoices, stockIntakes, stockLocation]
  );

  const fmtMoney = (n: number) => Math.round(n).toLocaleString();
  const movementProduct = useMemo(
    () => products.find(p => p.id === movementProductId) || null,
    [products, movementProductId]
  );

  const openMovementModal = async (product: Product) => {
    setMovementProductId(product.id);
    setMovementAdjustments([]);
    setMovementError('');
    setMovementLoading(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      const { data, error } = await supabase
        .from('stock_adjustments')
        .select('*')
        .eq('product_id', product.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMovementAdjustments(data || []);
    } catch (e: any) {
      console.warn('Could not load stock adjustments:', e);
      setMovementError('تعذر تحميل تسويات الجرد لهذا المنتج، فالكشف قد ينقصه جزء التسويات.');
    } finally {
      setMovementLoading(false);
    }
  };

  const closeMovementModal = () => {
    setMovementProductId(null);
    setMovementAdjustments([]);
    setMovementError('');
  };

  const movementLines = useMemo<StockMovementLine[]>(() => {
    if (!movementProduct) return [];
    const pid = movementProduct.id;
    const rows: StockMovementLine[] = [];

    purchaseInvoices.forEach((inv: any) => {
      (inv.items || []).forEach((item: any) => {
        if (item.product_id !== pid) return;
        const qty = Number(item.quantity) || 0;
        rows.push({
          at: inv.created_at,
          source: inv.source_invoice_id ? 'مرتجع مورد' : 'فاتورة شراء',
          ref: inv.invoice_number || inv.id,
          qty,
          cost: Number(item.purchase_price) || 0,
          note: inv.source_invoice_id ? `مرتجع من فاتورة ${inv.source_invoice_id}` : (inv.notes || null),
        });
      });
    });

    stockIntakes
      .filter((intake: any) => intake.product_id === pid)
      .forEach((intake: any) => {
        const source = String(intake.source || 'manual');
        rows.push({
          at: intake.created_at,
          source: intakeSourceLabel(source),
          ref: intake.id,
          qty: source === 'stocktake' ? 0 : (Number(intake.quantity) || 0),
          cost: Number(intake.unit_cost) || 0,
          note: source === 'stocktake'
            ? `${intake.note || 'زيادة جرد'} - قيد قيمة فقط، الكمية محسوبة من تسوية الجرد`
            : intake.note,
        });
      });

    orders
      .filter((order: any) => !order.is_deleted && order.type !== 'payment')
      .forEach((order: any) => {
        (order.items || []).forEach((item: any) => {
          if ((item.id || item.product_id) !== pid) return;
          const soldQty = Number(item.quantity) || 0;
          const returnedQty = Number(item.returned_quantity) || 0;
          const cost = Number(item.purchase_price ?? item.average_purchase_price) || 0;
          if (soldQty) {
            rows.push({
              at: order.date,
              source: 'بيع',
              ref: order.id,
              qty: -soldQty,
              cost,
              note: order.customer?.name ? `فاتورة عميل: ${order.customer.name}` : null,
            });
          }
          if (returnedQty) {
            rows.push({
              at: order.refunded_at || order.date,
              source: 'مرتجع عميل',
              ref: order.id,
              qty: returnedQty,
              cost,
              note: 'مرتجع على نفس الفاتورة',
            });
          }
        });
      });

    heldInvoices
      .filter((held: any) => ['held', 'shipped', 'money_pending'].includes(held.status || 'held'))
      .forEach((held: any) => {
        (held.items || []).forEach((item: any) => {
          if (item.id !== pid) return;
          rows.push({
            at: held.created_at,
            source: 'حجز نشط',
            ref: held.id,
            qty: -(Number(item.quantity) || 0),
            cost: Number(item.purchase_price ?? item.average_purchase_price) || 0,
            note: held.customer_name ? `عميل: ${held.customer_name}` : null,
          });
        });
      });

    productionOrders
      .filter((order: any) => order.product_id === pid)
      .forEach((order: any) => {
        rows.push({
          at: order.created_at,
          source: 'تصنيع',
          ref: order.id,
          qty: Number(order.quantity) || 0,
          cost: Number(order.cost_per_piece) || 0,
          note: order.notes || 'إنتاج من التصنيع',
        });
      });

    devoItems
      .filter((item: any) => item.product_id === pid && ['pending', 'at_factory', 'closed'].includes(item.status || 'pending'))
      .forEach((item: any) => {
        rows.push({
          at: item.created_at,
          source: `ديفو - ${item.status || 'pending'}`,
          ref: item.id,
          qty: -(Number(item.quantity) || 0),
          cost: Number(item.unit_cost) || 0,
          note: item.note || item.reason || null,
        });
      });

    writeOffs
      .filter((item: any) => item.product_id === pid)
      .forEach((item: any) => {
        rows.push({
          at: item.created_at,
          source: 'تالف',
          ref: item.id,
          qty: -(Number(item.quantity) || 0),
          cost: Number(item.unit_cost) || 0,
          note: item.reason || null,
        });
      });

    movementAdjustments.forEach((adj: any) => {
      rows.push({
        at: adj.created_at,
        source: 'تسوية جرد',
        ref: adj.id,
        qty: Number(adj.diff) || 0,
        cost: Number(adj.cost) || 0,
        note: `سيستم ${Number(adj.system_qty) || 0} / جرد ${Number(adj.counted_qty) || 0}${adj.note ? ` - ${adj.note}` : ''}`,
      });
    });

    return rows.sort((a, b) => {
      const at = a.at ? new Date(a.at).getTime() : 0;
      const bt = b.at ? new Date(b.at).getTime() : 0;
      return at - bt;
    });
  }, [movementProduct, purchaseInvoices, stockIntakes, orders, heldInvoices, productionOrders, devoItems, writeOffs, movementAdjustments]);

  const movementExpectedStock = movementLines.reduce((sum, line) => sum + line.qty, 0);
  const movementCurrentStock = movementProduct ? Number(movementProduct.stock_quantity) || 0 : 0;
  const movementDisplayStock = movementProduct ? dispOf(movementProduct) : 0;
  const movementWarehouseStock = Math.max(0, movementCurrentStock - movementDisplayStock);
  const movementUnexplainedQty = movementCurrentStock - movementExpectedStock;
  const movementTotalSold = movementLines.filter(line => line.source === 'بيع').reduce((sum, line) => sum + Math.abs(line.qty), 0);
  const movementTotalReturned = movementLines.filter(line => line.source === 'مرتجع عميل').reduce((sum, line) => sum + Math.abs(line.qty), 0);
  const movementDate = (value?: string | null) => value ? new Date(value).toLocaleString('ar-EG') : '—';

  // ── طباعة باركود لأكتر من منتج مع بعض ────────────────────────────────────
  // بدل ما تطبع صنف صنف: تختار الأصناف، تحدّد عدد الملصقات لكل واحد، وتطبعهم
  // كلهم في أمر طباعة واحد على الرول.
  const [showBatchPrint, setShowBatchPrint] = useState(false);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchRows, setBatchRows] = useState<{ id: string; count: string }[]>([]);

  const batchCandidates = useMemo(() => {
    const q = normalizeArabic(batchSearch.trim());
    const chosen = new Set(batchRows.map(r => r.id));
    return products
      .filter(p => !p.is_hidden && !chosen.has(p.id))
      .filter(p => !q || normalizeArabic(p.name).includes(q) || (p.barcode || '').includes(batchSearch.trim()))
      .slice(0, 8);
  }, [products, batchSearch, batchRows]);

  const addBatchRow = (p: Product) => {
    // الافتراضي = الكمية اللي في المخزن، لأن ده أشهر استخدام (طباعة لكل القطع).
    setBatchRows(rows => [...rows, { id: p.id, count: String(Math.max(1, Math.floor(Number(p.stock_quantity) || 0) || 1)) }]);
    setBatchSearch('');
  };

  const batchTotalLabels = batchRows.reduce((s, r) => s + (parseInt(r.count) || 0), 0);

  const submitBatchPrint = () => {
    // المنتج اللي مالوش باركود بيتولّدله كود ويتحفظ على طول — نفس سلوك زرار
    // الطباعة الفردي، عشان مايوقفش الطباعة على حاجة النظام يقدر يعملها لوحده.
    const used = new Set(products.map(p => p.barcode).filter(Boolean) as string[]);
    const labels = batchRows.map(r => {
      const p = products.find(x => x.id === r.id);
      const count = Math.floor(parseInt(r.count) || 0);
      if (!p || count <= 0) return null;
      let code = p.barcode || '';
      if (!code) {
        code = generateBarcode(used);
        used.add(code);
        updateProduct(p.id, { barcode: code });
      }
      return {
        name: p.name,
        code,
        price: Number(p.sale_price) || 0,
        discountPrice: Number(p.discount_price) || 0,
        count,
      };
    }).filter(Boolean) as { name: string; code: string; price: number; discountPrice: number; count: number }[];

    if (labels.length === 0) return alert('اختر منتج واحد على الأقل بكمية أكبر من صفر.');
    printBarcodeLabelsBatch(labels, { currency: storeSettings.currency, storeName: storeSettings.name });
    setShowBatchPrint(false);
  };

  const submitManualIntake = async () => {
    const qty = parseFloat(intakeQty);
    const cost = parseFloat(intakeCost);
    if (!intakeProductId) return alert('اختر المنتج.');
    if (isNaN(qty) || qty <= 0) return alert('أدخل كمية صحيحة.');
    if (isNaN(cost) || cost < 0) return alert('أدخل تكلفة وحدة صحيحة.');
    const prod = products.find(p => p.id === intakeProductId);
    await logStockIntake([{
      product_id: intakeProductId,
      product_name: prod?.name || '',
      quantity: qty,
      unit_cost: cost,
      source: 'manual',
      note: intakeNote.trim() || null,
    }]);
    setIntakeProductId(''); setIntakeQty(''); setIntakeCost(''); setIntakeNote('');
  };

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
      supplier_name: product.supplier_name || '',
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
      supplier_name: '',
      stock_quantity: 0,
      display_quantity: 0,
      category_id: categories[0]?.id || '',
      unit: 'قطعة'
    });
    setWarehouseQty(0);
    setShowAddModal(true);
  };

  // يضمن وجود المورد في قائمة الموردين (ينشئه لو الاسم جديد). يرجّع الاسم المنسّق للتخزين.
  const ensureSupplier = async (rawName: string): Promise<string> => {
    const name = (rawName || '').trim();
    if (!name) return '';
    const existing = suppliers.find(s => normalizeArabic(s.name) === normalizeArabic(name));
    if (existing) return existing.name;
    const created = await addSupplier({ name, phone: '', address: '' } as any);
    return (created as any)?.name || name;
  };

  const submitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      alert("الرجاء إدخال اسم المنتج.");
      return;
    }
    // لو المورد اسم جديد سجّله في قائمة الموردين واستخدم الاسم المنسّق
    const supplierName = await ensureSupplier(formData.supplier_name);

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

    let payload = { ...formData, barcode, supplier_name: supplierName };
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
      supplier_name: '',
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
      ['الباركود', 'اسم المنتج', 'التصنيف', 'المورد', 'الوحدة', 'سعر الشراء', 'متوسط الشراء', 'سعر البيع', `المخزون (${stockLocation === 'warehouse' ? 'المستودع' : stockLocation === 'display' ? 'المحل' : 'الكل'})`, 'مستودع', 'محل', 'مباع'],
      ...filteredProducts.map(p => [
        p.barcode,
        p.name,
        categories.find(c => c.id === p.category_id)?.name || '',
        p.supplier_name || '',
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

  // أعمدة قالب الاستيراد. الترتيب لا يهم عند القراءة — نبحث عن العمود بالاسم.
  const TEMPLATE_HEADERS = ['الباركود', 'اسم المنتج', 'التصنيف', 'المورد', 'الوحدة', 'سعر الشراء', 'سعر البيع', 'سعر الخصم', 'سعر الجملة', 'سعر نص الجملة', 'الموسم (صيفي/شتوي/سنوي)', 'كمية المستودع', 'كمية المحل'];

  // تصدير قالب Excel جاهز للتعبئة وإعادة الاستيراد (يحتوي المنتجات الحالية حسب الفلاتر المختارة).
  const exportTemplate = () => {
    const rows = filteredProducts.map(p => [
      p.barcode || '',
      p.name,
      categories.find(c => c.id === p.category_id)?.name || '',
      p.supplier_name || '',
      getUnitConfig(p.unit).label,
      p.purchase_price || 0,
      p.sale_price || 0,
      p.discount_price || 0,
      p.wholesale_price || 0,
      p.half_wholesale_price || 0,
      p.season === 'winter' ? 'شتوي' : p.season === 'annual' ? 'سنوي' : 'صيفي',
      Math.max(0, (Number(p.stock_quantity) || 0) - dispOf(p)), // كمية المستودع
      dispOf(p),                                                // كمية المحل
    ]);
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...rows]);
    ws['!cols'] = TEMPLATE_HEADERS.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المنتجات');
    XLSX.writeFile(wb, `products_template_${new Date().toLocaleDateString()}.xlsx`);
  };

  // استيراد المنتجات من ملف Excel: يطابق المنتج بالباركود (تحديث) أو يضيفه جديداً،
  // ويطابق/ينشئ التصنيف والمورد بالاسم تلقائياً.
  const importExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { alert('الملف فارغ أو لا يحتوي على صفوف.'); return; }

      // يلتقط قيمة العمود بأي اسم من المرادفات (بحث مرن بعد تطبيع العربية).
      const pick = (row: any, ...keys: string[]): any => {
        for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
        const nk = keys.map(normalizeArabic);
        for (const key of Object.keys(row)) if (nk.includes(normalizeArabic(key))) return row[key];
        return '';
      };
      const num = (v: any) => { const n = parseFloat(String(v).replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; };

      const { supabase } = await import('../../lib/supabase');
      const localCats = [...categories];
      const localSups = [...suppliers];
      const byBarcode = new Map(products.filter(p => p.barcode).map(p => [String(p.barcode), p]));
      const usedBarcodes = new Set(products.map(p => p.barcode).filter(Boolean) as string[]);
      let added = 0, updated = 0, skipped = 0;

      for (const row of rows) {
        try {
          const name = String(pick(row, 'اسم المنتج', 'الاسم', 'name')).trim();
          if (!name) { skipped++; continue; }

          // التصنيف: طابق بالاسم أو أنشئه
          let category_id = localCats[0]?.id || '';
          const catName = String(pick(row, 'التصنيف', 'category')).trim();
          if (catName) {
            let cat = localCats.find(c => normalizeArabic(c.name) === normalizeArabic(catName));
            if (!cat) {
              const { data } = await supabase.from('categories').insert({ name: catName }).select().single();
              if (data) { cat = data as any; localCats.push(cat as any); useStore.setState(s => ({ categories: [...s.categories, data as any] })); }
            }
            if (cat) category_id = cat.id;
          }

          // المورد: طابق بالاسم أو أنشئه
          let supplier_name = '';
          const supName = String(pick(row, 'المورد', 'supplier')).trim();
          if (supName) {
            let sup = localSups.find(s => normalizeArabic(s.name) === normalizeArabic(supName));
            if (!sup) {
              const created = await addSupplier({ name: supName, phone: '', address: '' } as any);
              if (created) { sup = created as any; localSups.push(sup as any); }
            }
            supplier_name = (sup as any)?.name || supName;
          }

          // الوحدة: طابق باسم العرض أو القيمة
          const unitLabel = String(pick(row, 'الوحدة', 'unit')).trim();
          const unit = UNIT_OPTIONS.find(u => u.label === unitLabel || u.value === unitLabel)?.value || 'قطعة';

          // الموسم: يقبل عمود اسمه «الموسم» أو «الموسم (صيفي/شتوي/سنوي)». الافتراضي دائماً صيفي إلا لو مكتوب شتوي/سنوي صراحةً.
          const seasonKey = Object.keys(row).find(k => { const n = normalizeArabic(k); return n.startsWith(normalizeArabic('الموسم')) || /season/i.test(k); });
          const seasonRaw = seasonKey ? String(row[seasonKey]).trim() : '';
          const season = /شتو|winter/i.test(seasonRaw) ? 'winter' : /سنو|annual|year/i.test(seasonRaw) ? 'annual' : 'summer';

          const wh = num(pick(row, 'كمية المستودع', 'مستودع', 'warehouse'));
          const display = num(pick(row, 'كمية المحل', 'محل', 'display'));
          const stock_quantity = wh + display;
          const purchase_price = num(pick(row, 'سعر الشراء', 'purchase'));

          const payload: any = {
            name,
            purchase_price,
            average_purchase_price: purchase_price,
            sale_price: num(pick(row, 'سعر البيع', 'sale')),
            discount_price: num(pick(row, 'سعر الخصم', 'سعر البيع بعد الخصم', 'discount')),
            wholesale_price: num(pick(row, 'سعر الجملة', 'wholesale')),
            half_wholesale_price: num(pick(row, 'سعر نص الجملة', 'half')),
            season,
            supplier_name,
            category_id,
            unit,
            stock_quantity,
            display_quantity: Math.min(display, stock_quantity),
          };

          const rawBarcode = String(pick(row, 'الباركود', 'barcode')).trim();
          const existing = rawBarcode ? byBarcode.get(rawBarcode) : undefined;
          if (existing) {
            await updateProduct(existing.id, payload, { intakeSource: 'excel_import' });
            updated++;
          } else {
            let barcode = rawBarcode;
            if (!barcode) barcode = generateBarcode(usedBarcodes);
            usedBarcodes.add(barcode);
            const created = await addProduct({ ...payload, barcode });
            if (created) { byBarcode.set(barcode, created as any); added++; } else skipped++;
          }
        } catch (rowErr) {
          console.error('Import row error:', rowErr, row);
          skipped++;
        }
      }
      alert(`تم الاستيراد ✅\nمنتجات مضافة: ${added}\nمنتجات محدّثة: ${updated}${skipped ? `\nصفوف متجاهلة: ${skipped}` : ''}`);
    } catch (err) {
      console.error('Import error:', err);
      alert('حدث خطأ أثناء قراءة الملف. تأكد أنه ملف Excel صحيح وبنفس أعمدة القالب.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // استبدال مخزون: ينقص من منتج ويزيد في منتج آخر بنفس سعر البيع (قيمة المخزون لا تتأثر).
  const swapFrom = products.find(p => p.id === swapFromId);
  const swapTo = products.find(p => p.id === swapToId);
  // المنتجات المسموح الاستبدال إليها = نفس سعر البيع تماماً (وغير المنتج المصدر ومش مخفية)
  const swapToCandidates = swapFrom
    ? products.filter(p => p.id !== swapFrom.id && !p.is_hidden && (Number(p.sale_price) || 0) === (Number(swapFrom.sale_price) || 0))
    : [];

  const handleSwap = async () => {
    const from = swapFrom, to = swapTo;
    const qty = parseFloat(swapQty) || 0;
    if (!from || !to) return alert('اختر المنتج الناقص والمنتج الزائد.');
    if (from.id === to.id) return alert('اختر منتجين مختلفين.');
    if (qty <= 0) return alert('أدخل كمية صحيحة.');
    if ((Number(from.sale_price) || 0) !== (Number(to.sale_price) || 0))
      return alert('لا يمكن الاستبدال إلا بين منتجين لهما نفس سعر البيع (حتى لا تتأثر قيمة المخزون).');
    if (qty > (Number(from.stock_quantity) || 0))
      return alert(`الكمية (${qty}) أكبر من مخزون «${from.name}» المتاح (${from.stock_quantity}).`);
    try {
      setSwapBusy(true);
      const fromNewStock = (Number(from.stock_quantity) || 0) - qty;
      const fromNewDisplay = Math.min(Number(from.display_quantity) || 0, fromNewStock);
      const toNewStock = (Number(to.stock_quantity) || 0) + qty;
      // skipIntakeLog: الاستبدال نقل بين منتجين — مش دخول مخزون جديد، فمايتقيّدش في سجل «بدون شراء».
      await updateProduct(from.id, { stock_quantity: fromNewStock, display_quantity: fromNewDisplay }, { skipIntakeLog: true });
      await updateProduct(to.id, { stock_quantity: toNewStock }, { skipIntakeLog: true });
      // تسجيل الحركة في تعديلات المخزون (للمتابعة)
      try {
        const { supabase } = await import('../../lib/supabase');
        const note = `استبدال مخزون: نقص «${from.name}» وزيادة «${to.name}»`;
        await supabase.from('stock_adjustments').insert([
          { product_id: from.id, product_name: from.name, system_qty: Number(from.stock_quantity) || 0, counted_qty: fromNewStock, diff: -qty, cost: Number(from.average_purchase_price ?? from.purchase_price) || 0, note },
          { product_id: to.id, product_name: to.name, system_qty: Number(to.stock_quantity) || 0, counted_qty: toNewStock, diff: qty, cost: Number(to.average_purchase_price ?? to.purchase_price) || 0, note },
        ]);
      } catch (e) { console.warn('تعذّر تسجيل حركة الاستبدال', e); }
      alert(`تم الاستبدال ✅\n«${from.name}»: ${from.stock_quantity} ← ${fromNewStock}\n«${to.name}»: ${to.stock_quantity} ← ${toNewStock}`);
      setShowSwapModal(false); setSwapFromId(''); setSwapToId(''); setSwapQty('');
    } catch (e) {
      console.error('Swap error:', e); alert('تعذّر تنفيذ الاستبدال.');
    } finally {
      setSwapBusy(false);
    }
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
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-[32px] p-6 shadow-sm border border-slate-100 flex items-center gap-6 group hover:border-indigo-200 transition-all">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
            <TrendingUp size={32} />
          </div>
          <div>
            <p className="text-slate-400 font-bold text-sm">إجمالي قيمة المخزون</p>
            <h3 className="text-2xl font-black text-slate-800">
              {totalStockValue.toLocaleString()} <span className="text-sm font-normal text-slate-400">{storeSettings.currency}</span>
            </h3>
            <p className="text-[11px] font-bold text-slate-400 mt-1">
              مشتراة بفواتير: <span className="text-slate-600">{fmtMoney(stockValueSplit.purchased)}</span>
              {' • '}
              بدون شراء: <span className="text-amber-600">{fmtMoney(stockValueSplit.noPurchase)}</span>
            </p>
          </div>
        </div>

        <div
          onClick={() => setShowIntakeModal(true)}
          className="bg-white rounded-[32px] p-6 shadow-sm border border-slate-100 flex items-center gap-6 group hover:border-amber-200 transition-all cursor-pointer"
        >
          <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
            <Layers size={32} />
          </div>
          <div>
            <p className="text-slate-400 font-bold text-sm">مخزون دخل بدون شراء</p>
            <h3 className="text-2xl font-black text-slate-800">
              {fmtMoney(noPurchaseTotal)} <span className="text-sm font-normal text-slate-400">{storeSettings.currency}</span>
            </h3>
            <p className="text-[11px] font-bold text-slate-400 mt-1">رأس مال بضاعة بادئين بيه — {visibleIntakes.length} قيد (اضغط للتفاصيل)</p>
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
          {([['all', 'الكل'], ['summer', 'صيفي'], ['winter', 'شتوي'], ['annual', 'سنوي']] as const).map(([k, label]) => (
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
                {/* ── البيانات الأساسية (الأسرع إدخالاً) ── */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">اسم المنتج <span className="text-red-500">*</span></label>
                  <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">المورد <span className="text-[10px] text-slate-400">(اختياري)</span></label>
                  <input type="text" list="suppliers-datalist" value={formData.supplier_name} onChange={e => setFormData({...formData, supplier_name: e.target.value})} placeholder="اسم المورد الذي يورّد هذا المنتج..." className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-teal-500" />
                  <datalist id="suppliers-datalist">
                    {suppliers.map(s => <option key={s.id} value={s.name} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">وحدة البيع <span className="text-red-500">*</span></label>
                  <select value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500 font-bold">
                    {UNIT_OPTIONS.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">{isFractionalUnit(formData.unit) ? '⚖️ يُباع بالوزن' : '🔢 يُباع بالعدد'}</p>
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
                  <label className="block text-sm font-bold text-slate-700 mb-1">سعر الشراء لكل {getUnitConfig(formData.unit).label} <span className="text-[10px] text-slate-400">(اختياري)</span></label>
                  <input
                    type="number" min="0" step="0.01"
                    value={formData.purchase_price}
                    onChange={e => { const v = parseFloat(e.target.value) || 0; setFormData({...formData, purchase_price: v, average_purchase_price: v}); }}
                    style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                    className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">سعر البيع القطاعي لكل {getUnitConfig(formData.unit).label} <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" required value={formData.sale_price} onChange={e => setFormData({...formData, sale_price: parseFloat(e.target.value) || 0})} style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-green-500" />
                </div>

                {/* ── أسعار وبيانات إضافية ── */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">سعر البيع بعد الخصم <span className="text-[10px] text-slate-400">(اختياري)</span></label>
                  <input type="number" min="0" step="0.01" value={formData.discount_price} onChange={e => setFormData({...formData, discount_price: parseFloat(e.target.value) || 0})} style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:outline-none border-l-4 border-l-amber-500" />
                  <p className="text-xs text-slate-400 mt-1">لو دخلت قيمة هنا، هتبقى هي سعر البيع الفعلي على الكاشير.</p>
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
                    {([['summer','صيفي'],['winter','شتوي'],['annual','سنوي']] as const).map(([k,label]) => (
                      <button type="button" key={k} onClick={() => setFormData({...formData, season: k})}
                        className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition border ${formData.season === k ? 'bg-indigo-600 text-white border-transparent' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-1">التصنيف</label>
                  <select value={formData.category_id} onChange={e => setFormData({...formData, category_id: e.target.value})} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-indigo-500">
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 relative group">
                  <div className="flex justify-between items-end mb-1">
                    <label className="block text-sm font-bold text-slate-700">الباركود <span className="text-[10px] text-slate-400">(يتولّد تلقائياً تسلسلياً لو فاضي)</span></label>
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
                      placeholder="امسح الباركود أو اتركه فارغاً للترقيم التلقائي..."
                    />
                    {scanSuccess && (
                      <CheckCircle2 className="absolute left-3 top-3.5 text-emerald-500 animate-in zoom-in" size={20} />
                    )}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-slate-400 -mt-1">ℹ️ الكمية والتكلفة هنا للمخزون الافتتاحي — بعدها يتم التحديث تلقائياً عبر فواتير المشتريات.</p>
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

      {/* BATCH BARCODE PRINT — أكتر من منتج بكمياتهم في أمر طباعة واحد */}
      {showBatchPrint && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b flex justify-between items-center bg-slate-50 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Printer size={22} className="text-slate-600" /> طباعة باركود لأكتر من منتج</h2>
                <p className="text-xs text-slate-400 font-bold mt-1">اختار المنتجات وحدّد عدد الملصقات لكل واحد — هيتطبعوا كلهم ورا بعض على الرول</p>
              </div>
              <button onClick={() => setShowBatchPrint(false)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-xl shadow-sm border border-slate-200"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              {/* البحث والإضافة */}
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  value={batchSearch}
                  onChange={(e) => setBatchSearch(e.target.value)}
                  placeholder="ابحث بالاسم أو الباركود لإضافة منتج..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pr-10 pl-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                {batchSearch.trim() !== '' && batchCandidates.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    {batchCandidates.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addBatchRow(p)}
                        className="w-full text-right px-4 py-2.5 hover:bg-indigo-50 flex items-center justify-between gap-3 border-b border-slate-50 last:border-0"
                      >
                        <span className="font-bold text-sm text-slate-700 truncate">{p.name}</span>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">{p.barcode || 'بدون باركود'} · مخزون {formatQty(Number(p.stock_quantity) || 0, p.unit)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* المختار */}
              {batchRows.length === 0 ? (
                <p className="text-center text-slate-400 font-bold py-10 text-sm">مفيش منتجات مختارة — ابحث فوق وأضف اللي عايز تطبعه.</p>
              ) : (
                <div className="space-y-2">
                  {batchRows.map((row, idx) => {
                    const p = products.find(x => x.id === row.id);
                    if (!p) return null;
                    return (
                      <div key={row.id} className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm text-slate-800 truncate">{p.name}</p>
                          <p className="text-[11px] font-mono text-slate-400">
                            {p.barcode || <span className="text-red-500 font-sans font-bold">بدون باركود</span>} · {p.sale_price} {storeSettings.currency}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setBatchRows(rows => rows.map((r, i) => i === idx ? { ...r, count: String(Math.max(1, (parseInt(r.count) || 1) - 1)) } : r))} className="w-8 h-8 rounded-lg bg-white border border-slate-200 font-black text-slate-600">−</button>
                          <input
                            type="number" min="1"
                            value={row.count}
                            onChange={(e) => setBatchRows(rows => rows.map((r, i) => i === idx ? { ...r, count: e.target.value } : r))}
                            className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-center font-black outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                          <button onClick={() => setBatchRows(rows => rows.map((r, i) => i === idx ? { ...r, count: String((parseInt(r.count) || 0) + 1) } : r))} className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 font-black">+</button>
                        </div>
                        <button onClick={() => setBatchRows(rows => rows.filter((_, i) => i !== idx))} className="p-2 text-slate-400 hover:text-red-500 shrink-0"><Trash2 size={16} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-5 border-t bg-slate-50 flex items-center justify-between gap-3 shrink-0">
              <span className="text-sm font-black text-slate-600">
                {batchRows.length} منتج · <span className="text-indigo-600">{batchTotalLabels}</span> ملصق
              </span>
              <button
                onClick={submitBatchPrint}
                disabled={batchRows.length === 0}
                className="bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2 transition"
              >
                <Printer size={18} /> طباعة الكل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NO-PURCHASE STOCK INTAKE MODAL — سجل رأس مال البضاعة اللي دخلت بدون فاتورة شراء */}
      {showIntakeModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b flex justify-between items-center bg-amber-50 shrink-0">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Layers size={22} className="text-amber-500" /> مخزون دخل بدون شراء</h2>
              <button onClick={() => setShowIntakeModal(false)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-xl shadow-sm border border-slate-200"><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3 leading-relaxed">
                كل كمية بتدخل المخزون من غير فاتورة مورد (كمية ابتدائية عند إضافة منتج، تعديل كمية يدوي، استيراد Excel، زيادة جرد)
                بتتقيّد هنا بقيمتها. القيمة دي <b>رأس مال بضاعة بادئين بيه</b> — مش بتمسّ الخزنة ولا حساب المورد،
                لكنها بتوضّح إن جزء من الربح مقابله بضاعة مدفوعش تمنها من خلال النظام.
              </p>

              {/* إضافة قيد يدوي — لتصحيح قيمة البضاعة الافتتاحية */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-sm font-bold text-slate-700 mb-1">إضافة قيد يدوي</p>
                <p className="text-[11px] text-slate-400 mb-3">بيسجّل <b>قيمة</b> بضاعة دخلت بدون شراء فقط — مش بيغيّر كمية المخزون.</p>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                  <input type="text" placeholder="بحث بالكود/الاسم" value={intakeSearch} onChange={(e) => setIntakeSearch(e.target.value)}
                    className="p-3 border border-slate-200 rounded-xl text-sm bg-slate-50" />
                  <select value={intakeProductId} onChange={(e) => {
                    setIntakeProductId(e.target.value);
                    const p = products.find(x => x.id === e.target.value);
                    if (p && !intakeCost) setIntakeCost(String(p.average_purchase_price || p.purchase_price || 0));
                  }} className="md:col-span-2 p-3 border border-slate-200 rounded-xl text-sm bg-slate-50">
                    <option value="">اختر المنتج…</option>
                    {products.filter(p => !p.is_hidden).filter(p => !intakeSearch || p.name.includes(intakeSearch) || (p.barcode && p.barcode.includes(intakeSearch))).map(p => <option key={p.id} value={p.id}>{p.name} {p.barcode ? `(${p.barcode})` : ''}</option>)}
                  </select>
                  <input type="number" step="any" placeholder="الكمية" value={intakeQty} onChange={(e) => setIntakeQty(e.target.value)}
                    className="p-3 border border-slate-200 rounded-xl text-sm bg-slate-50" />
                  <input type="number" step="any" placeholder="تكلفة الوحدة" value={intakeCost} onChange={(e) => setIntakeCost(e.target.value)}
                    className="p-3 border border-slate-200 rounded-xl text-sm bg-slate-50" />
                  <button onClick={submitManualIntake} className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold px-4 py-3">إضافة</button>
                </div>
                <input placeholder="ملاحظة (اختياري)" value={intakeNote} onChange={(e) => setIntakeNote(e.target.value)}
                  className="w-full mt-2 p-3 border border-slate-200 rounded-xl text-sm bg-slate-50" />
              </div>

              <div className="flex flex-col md:flex-row md:items-center justify-between bg-amber-50 border border-amber-100 rounded-2xl p-4 gap-3">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-amber-800">الإجمالي المقيّد</span>
                  <span className="text-xl font-black text-amber-700">{fmtMoney(noPurchaseTotal)} {storeSettings.currency}</span>
                </div>
                <div className="relative w-full md:w-1/2">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    placeholder="ابحث في السجل بالكود أو الاسم..."
                    value={intakeTableSearch}
                    onChange={(e) => setIntakeTableSearch(e.target.value)}
                    className="w-full bg-white border border-slate-200 py-2.5 pr-10 pl-4 rounded-xl text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-3 text-right font-bold">التاريخ</th>
                      <th className="p-3 text-right font-bold">المنتج</th>
                      <th className="p-3 text-right font-bold">الكود</th>
                      <th className="p-3 text-right font-bold">الكمية</th>
                      <th className="p-3 text-right font-bold">تكلفة الوحدة</th>
                      <th className="p-3 text-right font-bold">القيمة</th>
                      <th className="p-3 text-right font-bold">المصدر</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleIntakes.filter(i => {
                      if (!intakeTableSearch) return true;
                      const q = intakeTableSearch.toLowerCase();
                      const p = products.find(x => x.id === i.product_id);
                      return (i.product_name && i.product_name.toLowerCase().includes(q)) || (p && p.barcode && p.barcode.toLowerCase().includes(q));
                    }).length === 0 && (
                      <tr><td colSpan={8} className="p-6 text-center text-slate-400 font-bold">لا توجد قيود.</td></tr>
                    )}
                    {visibleIntakes.filter(i => {
                      if (!intakeTableSearch) return true;
                      const q = intakeTableSearch.toLowerCase();
                      const p = products.find(x => x.id === i.product_id);
                      return (i.product_name && i.product_name.toLowerCase().includes(q)) || (p && p.barcode && p.barcode.toLowerCase().includes(q));
                    }).map(i => (
                      <tr key={i.id} className="border-b border-slate-100">
                        <td className="p-3 text-slate-500">{new Date(i.created_at).toLocaleDateString()}</td>
                        <td className="p-3 font-bold text-slate-700">
                          {i.product_name || '—'}
                          {i.note && <span className="block text-[11px] font-normal text-slate-400">{i.note}</span>}
                        </td>
                        <td className="p-3 font-mono text-slate-500 text-xs">{products.find(p => p.id === i.product_id)?.barcode || '—'}</td>
                        <td className="p-3 text-slate-600">{formatQty(Number(i.quantity), products.find(p => p.id === i.product_id)?.unit)}</td>
                        <td className="p-3 text-slate-600">{Number(i.unit_cost).toLocaleString()}</td>
                        <td className="p-3 font-black text-amber-600">{fmtMoney(Number(i.total_value))}</td>
                        <td className="p-3"><span className="text-[11px] font-bold bg-slate-100 text-slate-600 rounded-lg px-2 py-1">{intakeSourceLabel(i.source)}</span></td>
                        <td className="p-3">
                          <button
                            onClick={() => { if (confirm('حذف القيد؟ ده بيشيل قيمته من رأس مال البضاعة فقط — المخزون مش هيتأثر.')) deleteStockIntake(i.id); }}
                            className="text-red-500 hover:bg-red-50 p-2 rounded-lg"><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SWAP STOCK MODAL */}
      {showSwapModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b flex justify-between items-center bg-orange-50 shrink-0">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><ArrowLeftRight size={22} className="text-orange-500" /> استبدال مخزون</h2>
              <button onClick={() => setShowSwapModal(false)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-xl shadow-sm border border-slate-200"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
                يُستخدم لتصحيح بيع قطعة بكود بدل كود آخر: يُنقص الكمية من منتج ويزيدها في منتج آخر <b>بنفس سعر البيع</b> فقط، حتى لا تتأثر قيمة المخزون.
              </p>

              {/* المنتج الناقص */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">المنتج اللي هينقص من المخزون <span className="text-red-500">*</span></label>
                <select value={swapFromId} onChange={e => { setSwapFromId(e.target.value); setSwapToId(''); }} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-orange-400 focus:outline-none">
                  <option value="">-- اختر المنتج --</option>
                  {products.filter(p => !p.is_hidden).map(p => (
                    <option key={p.id} value={p.id}>{p.name} — {p.barcode || 'بدون كود'} — {p.sale_price} {storeSettings.currency} (متاح {formatQty(p.stock_quantity, p.unit)})</option>
                  ))}
                </select>
              </div>

              {/* المنتج الزائد — نفس سعر البيع فقط */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">المنتج اللي هيزيد في المخزون <span className="text-red-500">*</span></label>
                <select value={swapToId} onChange={e => setSwapToId(e.target.value)} disabled={!swapFrom} className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-orange-400 focus:outline-none disabled:opacity-50">
                  <option value="">{swapFrom ? '-- اختر منتج بنفس السعر --' : 'اختر المنتج الناقص أولاً'}</option>
                  {swapToCandidates.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — {p.barcode || 'بدون كود'} — {p.sale_price} {storeSettings.currency} (متاح {formatQty(p.stock_quantity, p.unit)})</option>
                  ))}
                </select>
                {swapFrom && swapToCandidates.length === 0 && (
                  <p className="text-xs text-red-500 mt-1 font-bold">لا يوجد منتج آخر بنفس سعر البيع ({swapFrom.sale_price} {storeSettings.currency}).</p>
                )}
              </div>

              {/* الكمية */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">الكمية <span className="text-red-500">*</span></label>
                <input type="number" min="0" step={swapFrom && isFractionalUnit(swapFrom.unit) ? '0.001' : '1'} value={swapQty}
                  onChange={e => setSwapQty(e.target.value)}
                  placeholder="عدد القطع المراد استبدالها"
                  className="w-full bg-slate-50 border border-slate-200 py-3 px-4 rounded-xl focus:ring-2 focus:ring-orange-400 focus:outline-none border-l-4 border-l-orange-500" />
              </div>

              {swapFrom && swapTo && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-slate-500">🔻 {swapFrom.name}</span><span className="font-bold text-red-600">{formatQty(swapFrom.stock_quantity, swapFrom.unit)} ← {formatQty(Math.max(0, (Number(swapFrom.stock_quantity)||0) - (parseFloat(swapQty)||0)), swapFrom.unit)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">🔺 {swapTo.name}</span><span className="font-bold text-emerald-600">{formatQty(swapTo.stock_quantity, swapTo.unit)} ← {formatQty((Number(swapTo.stock_quantity)||0) + (parseFloat(swapQty)||0), swapTo.unit)}</span></div>
                </div>
              )}
            </div>
            <div className="p-6 border-t flex gap-3 shrink-0">
              <button onClick={handleSwap} disabled={swapBusy || !swapFrom || !swapTo} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3.5 rounded-xl font-bold shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2">
                <ArrowLeftRight size={18} /> {swapBusy ? 'جاري التنفيذ...' : 'تأكيد الاستبدال'}
              </button>
              <button onClick={() => setShowSwapModal(false)} className="flex-1 bg-slate-100 text-slate-700 py-3.5 rounded-xl font-bold hover:bg-slate-200 transition">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK MOVEMENT SEARCH MODAL */}
      {showQuickMovementModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b flex justify-between items-center bg-indigo-50 shrink-0">
              <h2 className="text-xl font-bold text-indigo-800 flex items-center gap-2"><ScanLine size={22} className="text-indigo-600" /> كشف حركة (بحث سريع)</h2>
              <button onClick={() => setShowQuickMovementModal(false)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-xl shadow-sm border border-slate-200"><X size={20} /></button>
            </div>
            <div className="p-6 flex flex-col min-h-0">
              <input
                autoFocus
                type="text"
                placeholder="مرر الباركود هنا أو ابحث بالاسم..."
                value={quickMovementSearch}
                onChange={(e) => {
                  setQuickMovementSearch(e.target.value);
                  const p = products.find(x => x.barcode === e.target.value);
                  if (p) {
                    setShowQuickMovementModal(false);
                    setQuickMovementSearch('');
                    openMovementModal(p);
                  }
                }}
                className="w-full bg-slate-50 border border-slate-200 p-4 rounded-xl text-center font-bold text-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4"
              />
              <div className="overflow-y-auto space-y-2 flex-1">
                {products
                  .filter(p => !p.is_hidden)
                  .filter(p => quickMovementSearch && (p.name.includes(quickMovementSearch) || (p.barcode && p.barcode.includes(quickMovementSearch))))
                  .map(p => (
                   <button key={p.id} onClick={() => { setShowQuickMovementModal(false); setQuickMovementSearch(''); openMovementModal(p); }} className="w-full text-right p-3 bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 rounded-xl transition">
                     <div className="font-bold text-slate-800">{p.name}</div>
                     <div className="text-xs text-slate-500 font-mono mt-1">{p.barcode || 'بدون كود'}</div>
                   </button>
                ))}
                {quickMovementSearch && products.filter(p => !p.is_hidden && (p.name.includes(quickMovementSearch) || (p.barcode && p.barcode.includes(quickMovementSearch)))).length === 0 && (
                  <div className="text-center text-slate-400 font-bold py-4">لا يوجد منتج مطابق.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT STOCK MOVEMENT MODAL */}
      {movementProduct && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh]">
            <div className="p-5 border-b flex justify-between items-start gap-4 bg-slate-50 shrink-0">
              <div className="min-w-0">
                <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                  <History size={22} className="text-emerald-600" /> كشف حركة المنتج
                </h2>
                <p className="text-sm text-slate-500 mt-1 truncate">
                  {movementProduct.name} · باركود {movementProduct.barcode || 'بدون باركود'}
                </p>
              </div>
              <button onClick={closeMovementModal} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-xl shadow-sm border border-slate-200 shrink-0"><X size={20} /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                  <p className="text-[11px] font-bold text-slate-400">الرصيد الحالي</p>
                  <p className="text-lg font-black text-slate-800">{formatQty(movementCurrentStock, movementProduct.unit)}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
                  <p className="text-[11px] font-bold text-emerald-600">المتوقع من الحركة</p>
                  <p className="text-lg font-black text-emerald-700">{formatQty(movementExpectedStock, movementProduct.unit)}</p>
                </div>
                <div className={`border rounded-2xl p-3 ${Math.abs(movementUnexplainedQty) > 0.001 ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}>
                  <p className={`text-[11px] font-bold ${Math.abs(movementUnexplainedQty) > 0.001 ? 'text-amber-600' : 'text-slate-400'}`}>فرق غير مفسر</p>
                  <p className={`text-lg font-black ${Math.abs(movementUnexplainedQty) > 0.001 ? 'text-amber-700' : 'text-slate-600'}`}>
                    {movementUnexplainedQty > 0 ? '+' : ''}{formatQty(movementUnexplainedQty, movementProduct.unit)}
                  </p>
                </div>
                <div className="bg-sky-50 border border-sky-100 rounded-2xl p-3">
                  <p className="text-[11px] font-bold text-sky-600">القطع المباعة</p>
                  <p className="text-lg font-black text-sky-700">{formatQty(movementTotalSold, movementProduct.unit)}</p>
                </div>
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3">
                  <p className="text-[11px] font-bold text-rose-600">المرتجعات</p>
                  <p className="text-lg font-black text-rose-700">{formatQty(movementTotalReturned, movementProduct.unit)}</p>
                </div>
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3">
                  <p className="text-[11px] font-bold text-indigo-600">المستودع</p>
                  <p className="text-lg font-black text-indigo-700">{formatQty(movementWarehouseStock, movementProduct.unit)}</p>
                </div>
                <div className="bg-purple-50 border border-purple-100 rounded-2xl p-3">
                  <p className="text-[11px] font-bold text-purple-600">المحل</p>
                  <p className="text-lg font-black text-purple-700">{formatQty(movementDisplayStock, movementProduct.unit)}</p>
                </div>
              </div>

              {movementLoading && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm font-bold text-slate-500">
                  جاري تحميل تسويات الجرد...
                </div>
              )}
              {movementError && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm font-bold text-amber-700">
                  {movementError}
                </div>
              )}
              {Math.abs(movementUnexplainedQty) > 0.001 && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-800 leading-relaxed">
                  الفرق ده معناه إن الرصيد الحالي فيه كمية مش طالعة من الحركات المحملة قدامك. غالبا بتكون من استيراد/تصفير قديم اتسجل مباشرة في جدول المنتجات بدون قيد حركة، أو تسوية جرد غير مقروءة.
                </div>
              )}

              <div className="overflow-x-auto border border-slate-100 rounded-2xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-3 text-right font-bold">التاريخ</th>
                      <th className="p-3 text-right font-bold">المصدر</th>
                      <th className="p-3 text-center font-bold">الكمية</th>
                      <th className="p-3 text-center font-bold">تكلفة الوحدة</th>
                      <th className="p-3 text-center font-bold">قيمة الحركة</th>
                      <th className="p-3 text-right font-bold min-w-[240px]">ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementLines.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400 font-bold">
                          لا توجد حركات مسجلة لهذا المنتج.
                        </td>
                      </tr>
                    )}
                    {movementLines.map((line, idx) => (
                      <tr key={`${line.source}-${line.ref}-${idx}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="p-3 text-slate-500 whitespace-nowrap">{movementDate(line.at)}</td>
                        <td className="p-3">
                          <span className="text-[11px] font-black bg-slate-100 text-slate-700 rounded-lg px-2 py-1">{line.source}</span>
                          <span className="block mt-1 text-[10px] font-mono text-slate-400 truncate max-w-[180px]">{line.ref}</span>
                        </td>
                        <td className={`p-3 text-center font-black ${line.qty > 0 ? 'text-emerald-600' : line.qty < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {line.qty > 0 ? '+' : ''}{formatQty(line.qty, movementProduct.unit)}
                        </td>
                        <td className="p-3 text-center text-slate-600">{fmtMoney(line.cost)} {storeSettings.currency}</td>
                        <td className={`p-3 text-center font-bold ${(line.qty * line.cost) > 0 ? 'text-emerald-600' : (line.qty * line.cost) < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {fmtMoney(line.qty * line.cost)} {storeSettings.currency}
                        </td>
                        <td className="p-3 text-slate-500 leading-relaxed">{line.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
          <div className="flex gap-2 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={importExcel}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-teal-700 transition text-sm disabled:opacity-50"
              title="استيراد المنتجات من ملف Excel (تحديث بالباركود أو إضافة جديد)"
            >
              {importing ? '...جاري الاستيراد' : <><Upload size={16} /> استيراد Excel</>}
            </button>
            <button
              onClick={exportTemplate}
              className="flex items-center gap-2 bg-slate-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-slate-800 transition text-sm"
              title="تحميل قالب Excel جاهز للتعبئة وإعادة الاستيراد"
            >
              <Download size={16} /> قالب Excel
            </button>
            <button
              onClick={exportExcel}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-emerald-700 transition text-sm"
            >
              <TableIcon size={16} /> تقرير Excel
            </button>
            <button
              onClick={exportPDF}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-red-700 transition text-sm disabled:opacity-50"
              disabled={loading}
            >
              {loading ? '...جاري التصدير' : <><FileText size={16} /> PDF</>}
            </button>
          </div>
          <button onClick={() => { setBatchRows([]); setBatchSearch(''); setShowBatchPrint(true); }} className="bg-slate-700 hover:bg-slate-800 text-white px-5 py-3 rounded-xl font-bold transition flex items-center gap-2 shadow-lg">
            <Printer size={20} />
            طباعة باركود
          </button>
          <button onClick={() => { setQuickMovementSearch(''); setShowQuickMovementModal(true); }} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-5 py-3 rounded-xl font-bold transition flex items-center gap-2 shadow-sm border border-indigo-100">
            <ScanLine size={20} />
            كشف حركة
          </button>
          <button onClick={() => { setSwapFromId(''); setSwapToId(''); setSwapQty(''); setShowSwapModal(true); }} className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-3 rounded-xl font-bold transition flex items-center gap-2 shadow-lg">
            <ArrowLeftRight size={20} />
            استبدال
          </button>
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
                <th className="p-4">المورد</th>
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
                    <td className="p-4 text-slate-500">{product.supplier_name || '—'}</td>
                    <td className="p-4 text-center">
                      <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">{getUnitConfig(product.unit).label}</span>
                    </td>
                    <td className="p-4 text-center">{product.purchase_price} {storeSettings.currency}</td>
                    <td className="p-4 text-center font-bold text-indigo-600 bg-indigo-50/30">{product.average_purchase_price} {storeSettings.currency}</td>

                    <td className="p-4 text-center border-x border-slate-100 bg-slate-50/50">
                      <button onClick={() => handleEditPrice(product)} style={{ '--hover-color': storeSettings.themeColor } as any} className="flex items-center justify-center gap-2 w-full hover:text-[var(--hover-color)] transition group font-black">
                        {product.sale_price} {storeSettings.currency}<span className="text-[10px] text-slate-400 font-normal">/{getUnitConfig(product.unit).label}</span>
                        <Edit2 size={14} className="opacity-100 md:opacity-0 md:group-hover:opacity-100" />
                      </button>
                    </td>

                    <td className="p-4 text-center border-l border-slate-100 bg-slate-50/50">
                      <button
                        onClick={() => handleEditStock(product)}
                        style={{ '--hover-bg': storeSettings.themeColor + '15', '--hover-text': storeSettings.themeColor } as any}
                        className={`flex items-center justify-center gap-2 w-full font-bold px-3 py-1.5 rounded-lg transition group ${isLowStock ? 'bg-red-50 text-red-600' : 'hover:bg-[var(--hover-bg)] hover:text-[var(--hover-text)]'}`}
                      >
                        {formatQty(qtyOf(product), product.unit)}
                        <Edit2 size={14} className="opacity-100 md:opacity-0 md:group-hover:opacity-100" />
                      </button>
                      <div className="text-[9px] text-slate-400 mt-1">مستودع {Math.max(0, (Number(product.stock_quantity) || 0) - dispOf(product))} · محل {dispOf(product)}</div>
                    </td>

                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openEditModal(product)} className="p-2 text-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 rounded-lg transition" title="تعديل المنتج">
                          <Edit2 size={18} />
                        </button>
                        <button onClick={() => openMovementModal(product)} className="p-2 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg transition" title="كشف حركة المنتج">
                          <History size={18} />
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
