import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import type { PurchaseItem, Product } from '../../store/useStore';
import { Users, Search, Plus, Edit2, Trash2, Phone, MapPin, Calendar, ShoppingCart, FileText, X, ChevronDown, Printer, Eye, Download } from 'lucide-react';
import { normalizeArabic } from '../../utils/textUtils';
import { UNIT_OPTIONS, getUnitConfig, isFractionalUnit, formatQty } from '../../utils/units';
import { escapeHtml } from '../../utils/escapeHtml';
import { openPrintWindow } from '../../utils/printWindow';
import PaymentSplitInputs from '../../components/PaymentSplitInputs';
import { activePaymentKeys, formToSplit, sumSplit, primaryMethod as primaryMethod_ } from '../../utils/paymentMethods';

function ProductSearchSelect({
  value, 
  onChange, 
  products
}: { 
  value: string; 
  onChange: (val: string) => void; 
  products: Product[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedProduct = products.find(p => p.id === value);

  const normalizedSearch = normalizeArabic(search);
  const searchTerms = normalizedSearch.split(' ').filter(t => t.trim() !== '');

  const filtered = products.filter(p => {
    const normalizedName = normalizeArabic(p.name);
    return searchTerms.length === 0 || searchTerms.every(term => normalizedName.includes(term)) || (p.barcode && p.barcode.includes(search));
  }).sort((a, b) => {
    // 1. Exact match ranking
    if (search) {
      const aExact = normalizeArabic(a.name) === normalizedSearch;
      const bExact = normalizeArabic(b.name) === normalizedSearch;
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;
      
      const aStarts = normalizeArabic(a.name).startsWith(normalizedSearch);
      const bStarts = normalizeArabic(b.name).startsWith(normalizedSearch);
      if (aStarts && !bStarts) return -1;
      if (bStarts && !aStarts) return 1;
    }
    
    // 2. Sort by newest (created_at descending)
    const timeA = new Date((a as any).created_at || 0).getTime();
    const timeB = new Date((b as any).created_at || 0).getTime();
    return timeB - timeA;
  });

  return (
    <div className="relative flex-1" ref={wrapperRef}>
      <div 
        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm cursor-text flex justify-between items-center font-medium focus-within:ring-2 focus-within:ring-indigo-400 transition"
        onClick={() => setIsOpen(true)}
      >
        {!isOpen ? (
           <span className={selectedProduct ? 'text-slate-800' : 'text-slate-400'}>
             {selectedProduct ? selectedProduct.name : '-- ابحث عن منتج --'}
           </span>
        ) : (
          <input
            type="text"
            className="w-full outline-none bg-transparent"
            placeholder="اكتب اسم المنتج أو الباركود..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        )}
        <ChevronDown size={16} className="text-slate-400" />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
          <div 
            className="px-4 py-2.5 text-sm font-bold text-indigo-600 hover:bg-indigo-50 cursor-pointer flex items-center gap-2 border-b border-slate-100"
            onClick={() => {
              onChange('NEW_PRODUCT');
              setIsOpen(false);
              setSearch('');
            }}
          >
            <Plus size={16} /> إضافة منتج جديد...
          </div>
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400 text-center">لا توجد نتائج</div>
          ) : (
            filtered.map(p => (
              <div 
                key={p.id}
                className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer flex justify-between items-center"
                onClick={() => {
                  onChange(p.id);
                  setIsOpen(false);
                  setSearch('');
                }}
              >
                <span>{p.name}</span>
                {p.barcode && <span className="text-xs text-slate-400 font-mono">{p.barcode}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function Suppliers() {
  const { suppliers, addSupplier, updateSupplier, deleteSupplier, storeSettings, purchaseInvoices, addPurchaseInvoice, updatePurchaseInvoice, products, orders } = useStore();
  const [activeTab, setActiveTab] = useState<'suppliers' | 'invoices'>('suppliers');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchQueryInvoices, setSearchQueryInvoices] = useState('');
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editingPurchaseInvoice, setEditingPurchaseInvoice] = useState<any>(null);
  const [selectedSupplierProfile, setSelectedSupplierProfile] = useState<any>(null);
  const [showSupplierProfile, setShowSupplierProfile] = useState(false);
  const [supFrom, setSupFrom] = useState('');
  const [supTo, setSupTo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isPayingDebt, setIsPayingDebt] = useState(false);
  const [debtPay, setDebtPay] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({ name: '', phone: '', address: '' });

  // Invoice form state
  const [invSupplierId, setInvSupplierId] = useState('');
  const [invPay, setInvPay] = useState<Record<string, string>>({});
  const invPayKeys = activePaymentKeys(storeSettings as any);
  const invPaidTotal = invPayKeys.reduce((s, k) => s + (parseFloat(invPay[k] || '') || 0), 0);
  const [invItems, setInvItems] = useState<{ product_id: string; quantity: string; purchase_price: string }[]>([
    { product_id: '', quantity: '1', purchase_price: '' }
  ]);

  // Quick Add Product State
  const [showQuickProductModal, setShowQuickProductModal] = useState(false);
  const [quickProductIndex, setQuickProductIndex] = useState<number | null>(null);
  const [quickProductData, setQuickProductData] = useState({ name: '', category_id: '', sale_price: '', barcode: '', unit: 'قطعة' });
  const { categories, addProduct } = useStore();

  const filteredSuppliers = suppliers.filter(s =>
    s.name.includes(searchQuery) || (s.phone && s.phone.includes(searchQuery))
  );

  const filteredInvoices = purchaseInvoices.filter(inv => {
    const supplier = suppliers.find(s => s.id === inv.supplier_id);
    const query = searchQueryInvoices.toLowerCase();
    return (
      inv.invoice_number.toLowerCase().includes(query) ||
      (supplier?.name.toLowerCase().includes(query)) ||
      (supplier?.phone && supplier.phone.includes(query))
    );
  });

  const handleSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSupplier) {
      await updateSupplier(editingSupplier.id, formData);
    } else {
      await addSupplier(formData);
    }
    setShowSupplierModal(false);
    setEditingSupplier(null);
    setFormData({ name: '', phone: '', address: '' });
  };

  const invTotal = invItems.reduce((sum, item) => {
    return sum + (parseFloat(item.quantity || '0') * parseFloat(item.purchase_price || '0'));
  }, 0);

  const handleAddInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invSupplierId) return alert('اختر المورد أولاً');
    const validItems = invItems.filter(i => i.product_id && parseFloat(i.quantity) > 0 && parseFloat(i.purchase_price) > 0);
    if (validItems.length === 0) return alert('أضف منتجاً واحداً على الأقل');

    try {
      setIsSaving(true);
      const items: PurchaseItem[] = validItems.map(i => ({
        product_id: i.product_id,
        quantity: parseFloat(i.quantity),
        purchase_price: parseFloat(i.purchase_price),
      }));

      const splitPayments: Record<string, number> = {};
      invPayKeys.forEach((k) => { splitPayments[k] = parseFloat(invPay[k] || '') || 0; });

      const finalPaidAmount = invPayKeys.reduce((s, k) => s + splitPayments[k], 0);
      const change = Math.max(0, finalPaidAmount - invTotal);
      const adjustedSplit: Record<string, number> = { ...splitPayments, cash: Math.max(0, (splitPayments.cash || 0) - change) };
      const primaryMethod = primaryMethod_(adjustedSplit);
      const effectivePaidAmount = finalPaidAmount - change;

      if (editingPurchaseInvoice) {
        await updatePurchaseInvoice(
          editingPurchaseInvoice.id,
          {
            total: invTotal,
            paid_amount: effectivePaidAmount,
            payment_method: primaryMethod as any,
          } as any,
          items,
          adjustedSplit as any
        );
        alert('تم تعديل الفاتورة بنجاح وتحديث المخزن');
      } else {
        const invoiceNumber = `PO-${Date.now()}`;
        await addPurchaseInvoice({
          invoice_number: invoiceNumber,
          supplier_id: invSupplierId,
          total: invTotal,
          paid_amount: effectivePaidAmount,
          payment_method: primaryMethod as any,
        }, items, adjustedSplit as any);
        alert('تم حفظ الفاتورة بنجاح وتحديث المخزن');
      }

      setShowInvoiceModal(false);
      setEditingPurchaseInvoice(null);
      setInvSupplierId('');
      setInvPay({});
      setInvItems([{ product_id: '', quantity: '1', purchase_price: '' }]);
      setActiveTab('invoices');
    } catch (error: any) {
      alert(error.message || 'حدث خطأ أثناء حفظ الفاتورة');
    } finally {
      setIsSaving(false);
    }
  };

  const addInvRow = () => setInvItems([...invItems, { product_id: '', quantity: '1', purchase_price: '' }]);
  const removeInvRow = (idx: number) => setInvItems(invItems.filter((_, i) => i !== idx));
  const updateInvRow = (idx: number, field: string, value: string) => {
    if (field === 'product_id' && value === 'NEW_PRODUCT') {
      setQuickProductIndex(idx);
      setQuickProductData({ ...quickProductData, barcode: `P-${Date.now().toString().slice(-6)}` });
      setShowQuickProductModal(true);
      return;
    }
    const updated = invItems.map((item, i) => i === idx ? { ...item, [field]: value } : item);
    if (field === 'product_id' && value) {
      const prod = products.find(p => p.id === value);
      if (prod) updated[idx].purchase_price = String(prod.purchase_price || prod.average_purchase_price || '');
    }
    setInvItems(updated);
  };

  const handleQuickProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickProductData.name || !quickProductData.category_id) return alert('أكمل بيانات المنتج');
    
    try {
      setIsSaving(true);
      const newProd = {
        name: quickProductData.name,
        barcode: quickProductData.barcode,
        category_id: quickProductData.category_id,
        sale_price: parseFloat(quickProductData.sale_price) || 0,
        purchase_price: 0,
        stock_quantity: 0,
        average_purchase_price: 0,
        unit: quickProductData.unit || 'قطعة'
      };
      
      const createdProduct = await addProduct(newProd);
      
      // Try to find it in store as fallback just in case
      const allProducts = useStore.getState().products;
      const created = createdProduct || allProducts.find(p => p.barcode === quickProductData.barcode);
      
      if (created && quickProductIndex !== null) {
        const updated = [...invItems];
        updated[quickProductIndex] = { ...updated[quickProductIndex], product_id: created.id };
        setInvItems(updated);
      }
      
      setShowQuickProductModal(false);
      setQuickProductData({ name: '', category_id: '', sale_price: '', barcode: '', unit: 'قطعة' });
    } catch (err) {
      alert('خطأ في إضافة المنتج');
    } finally {
      setIsSaving(false);
    }
  };

  const printPurchaseInvoice = (inv: any) => {
    const supplier = suppliers.find(s => s.id === inv.supplier_id);
    const isPaymentReceipt = inv.total === 0;
    
    // Calculate historical debt at the time of this invoice/payment
    const relevantInvoices = purchaseInvoices
      .filter(i => i.supplier_id === inv.supplier_id && new Date(i.created_at) <= new Date(inv.created_at))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    
    let debtBefore = 0;
    relevantInvoices.forEach(i => {
      if (i.id !== inv.id) {
        debtBefore += (i.total - i.paid_amount);
      }
    });

    // If it's a purchase invoice, debtBefore doesn't include the current invoice's total yet.
    // If it's a payment receipt, debtBefore is the total debt just before this payment.
    const currentDebtImpact = inv.total - inv.paid_amount;
    const debtAfter = debtBefore + currentDebtImpact;

    const itemsHtml = (inv.items || []).map((item: any, index: number) => {
      const product = products.find(p => p.id === item.product_id);
      return `
        <tr>
          <td style="text-align:center;">${index + 1}</td>
          <td style="text-align:right;font-weight:bold;">${escapeHtml(product?.name || 'منتج غير معروف')}</td>
          <td style="text-align:center;">${item.quantity}</td>
          <td style="text-align:center;">${item.purchase_price.toFixed(2)}</td>
          <td style="text-align:left;font-weight:bold;">${(item.purchase_price * item.quantity).toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(`https://cashier-branch3.vercel.app/view-invoice/${inv.id}`)}`;

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>${isPaymentReceipt ? 'إيصال سداد' : 'فاتورة مشتريات'} #${inv.invoice_number}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo', sans-serif;}
  body{background:#fff;color:#000;margin:0;}
  .invoice-container{width:72mm;margin:0 auto;padding:2mm 1.5mm;display:flex;flex-direction:column;}

  .header-main{text-align:center;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:6px;}
  .logo{max-height:55px;max-width:62mm;width:auto;object-fit:contain;display:block;margin:0 auto 4px;}
  .store-name{font-size:17px;font-weight:900;color:#000;}
  .store-details{font-size:9px;color:#333;margin-top:2px;line-height:1.4;}
  .invoice-title-badge{display:inline-block;background:#000;color:#fff;padding:3px 12px;border-radius:6px;font-weight:900;font-size:11px;margin-top:5px;}

  .info-grid{display:flex;flex-direction:column;gap:2px;margin:6px 0;font-size:10px;}
  .info-item{display:flex;justify-content:space-between;gap:6px;}
  .info-item strong{color:#444;white-space:nowrap;}
  .info-item span{color:#000;font-weight:700;}

  table{width:100%;border-collapse:collapse;margin-bottom:5px;}
  thead th{font-size:9px;padding:4px 1px;text-align:center;border-bottom:1px solid #000;font-weight:900;}
  thead th:nth-child(2){text-align:right;}
  thead th:last-child{text-align:left;}
  tbody td{font-size:9px;padding:3px 1px;border-bottom:1px dotted #bbb;}

  .summary-section{width:100%;margin-top:4px;}
  .summary-row{display:flex;justify-content:space-between;padding:2px 0;font-size:10px;}
  .summary-row.total{border-top:1px solid #000;border-bottom:1px solid #000;margin-top:3px;padding:4px 0;font-size:14px;font-weight:900;}

  .footer-container{display:flex;flex-direction:column;align-items:center;gap:4px;margin-top:8px;padding-top:6px;border-top:1px dashed #000;}
  .footer-text{font-size:9px;color:#333;text-align:center;}
  .qr-code{width:80px;height:80px;}

  @media print{
    @page{size:72mm auto;margin:0;}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .invoice-container{width:72mm;padding:2mm 1.5mm;}
  }
</style>
</head>
<body>
<div class="invoice-container">
  <div class="header-main">
    <img class="logo" src="${escapeHtml(storeSettings.logo)}" onerror="this.style.display='none'" />
    <div class="store-name">${escapeHtml(storeSettings.name)}</div>
    <div class="store-details">${escapeHtml(storeSettings.address)} | ${escapeHtml(storeSettings.phone)}</div>
    <div class="invoice-title-badge">${isPaymentReceipt ? 'إيصال سداد مورد' : 'فاتورة مشتريات'}</div>
  </div>

  <div class="info-grid">
    <div class="info-item"><strong>المورد:</strong> <span>${escapeHtml(supplier?.name || 'مورد محذوف')}</span></div>
    <div class="info-item"><strong>رقم الهاتف:</strong> <span dir="ltr">${escapeHtml(supplier?.phone || '—')}</span></div>
    <div class="info-item"><strong>رقم المستند:</strong> <span>#${inv.invoice_number}</span></div>
    <div class="info-item"><strong>التاريخ:</strong> <span>${new Date(inv.created_at).toLocaleString('ar-SA')}</span></div>
  </div>

  ${!isPaymentReceipt ? `
  <table>
    <thead><tr>
      <th style="width:40px">#</th>
      <th style="text-align:right">المنتج</th>
      <th style="width:60px">الكمية</th>
      <th style="width:80px">سعر الشراء</th>
      <th style="width:100px;text-align:left">الإجمالي</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  ` : `
  <div style="padding:30px; text-align:center; background:#f0fdf4; border:2px dashed #bbf7d0; border-radius:20px; margin-bottom:20px;">
    <h2 style="color:#15803d; font-size:22px; font-weight:900;">إيصال سداد مديونية</h2>
    <p style="color:#166534; margin-top:5px; font-weight:bold;">تم تسليم المبلغ للمورد وتخفيضه من الحساب</p>
  </div>
  `}

  <div class="summary-section">
    ${!isPaymentReceipt ? `<div class="summary-row total"><span>إجمالي الفاتورة:</span><span>${inv.total.toFixed(2)}</span></div>` : ''}
    
    <div class="summary-row" style="color: #64748b; font-weight: bold;">
      <span>المديونية قبل السداد:</span>
      <span>${debtBefore.toFixed(2)}</span>
    </div>

    <div class="summary-row" style="color: #059669; font-weight: 900; font-size: 20px; background: #ecfdf5; padding: 10px; border-radius: 8px; border: 1px solid #bbf7d0; margin: 8px 0;">
       <span>المبلغ المدفوع حالياً:</span>
       <span>${inv.paid_amount.toFixed(2)}</span>
    </div>

    <div class="summary-row" style="color: #ef4444; font-weight: 900; font-size: 18px; border-top: 2px solid #ef4444; padding-top: 10px;">
       <span>المتبقي للمورد:</span>
       <span>${debtAfter.toFixed(2)}</span>
    </div>
    
    <div style="display: flex; gap: 20px; align-items: flex-end; margin-top: 15px;">
      <div style="flex: 1; padding: 10px; background: #f9fafb; border-radius: 10px; border: 1px solid #eee;">
        <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 4px; text-align: right; font-weight: bold;">طريقة الدفع:</div>
        ${inv.paid_cash > 0 ? `<div class="summary-row" style="font-size: 12px; border: none; padding: 2px 0;"><span>💵 كاش:</span><span>${inv.paid_cash.toFixed(2)}</span></div>` : ''}
        ${inv.paid_visa > 0 ? `<div class="summary-row" style="font-size: 12px; border: none; padding: 2px 0;"><span>💳 فيزا:</span><span>${inv.paid_visa.toFixed(2)}</span></div>` : ''}
        ${inv.paid_wallet > 0 ? `<div class="summary-row" style="font-size: 12px; border: none; padding: 2px 0;"><span>📱 محفظة:</span><span>${inv.paid_wallet.toFixed(2)}</span></div>` : ''}
        ${inv.paid_instapay > 0 ? `<div class="summary-row" style="font-size: 12px; border: none; padding: 2px 0;"><span>⚡ انستا باي:</span><span>${inv.paid_instapay.toFixed(2)}</span></div>` : ''}
      </div>
      <div style="text-align: center;">
        <img src="${qrCodeUrl}" style="width: 80px; height: 80px; border: 1px solid #eee; padding: 5px; border-radius: 8px; background: white;" />
        <div style="font-size: 9px; font-weight: bold; color: #1e293b; margin-top: 4px;">تفاصيل الفاتورة</div>
      </div>
    </div>
  </div>

  <div style="margin-top: 20px; border-top: 1px dashed #cbd5e1; padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
    <div style="font-size: 10px; color: #94a3b8;">${escapeHtml(storeSettings.name)} - إدارة الموردين</div>
    <div style="font-size: 10px; color: #94a3b8; font-family: monospace;">#${inv.invoice_number}</div>
  </div>
</div>
<script>window.onload=()=>{setTimeout(()=>{window.print();window.onafterprint=()=>window.close();},500);}<\/script>
</body></html>`;

    openPrintWindow(html);
  };

  const tc = storeSettings.themeColor;

  return (
    <div className="p-4 md:p-8 h-[calc(100vh-2rem)] overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap gap-3 justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-800 flex items-center gap-3">
            <Users style={{ color: tc }} size={32} />
            الموردين والمشتريات
          </h1>
          <p className="text-slate-500 mt-2 font-medium">إدارة الموردين وتسجيل فواتير الشراء</p>
        </div>
        <button
          onClick={() => {
            if (activeTab === 'suppliers') {
              setEditingSupplier(null);
              setFormData({ name: '', phone: '', address: '' });
              setShowSupplierModal(true);
            } else {
              setEditingPurchaseInvoice(null);
              setInvSupplierId('');
              setInvPay({});
              setInvItems([{ product_id: '', quantity: '1', purchase_price: '' }]);
              setShowInvoiceModal(true);
            }
          }}
          style={{ backgroundColor: tc }}
          className="text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:opacity-90 transition shadow-lg"
        >
          <Plus size={20} />
          {activeTab === 'suppliers' ? 'إضافة مورد جديد' : 'فاتورة مشتريات جديدة'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 bg-slate-100 rounded-2xl p-1.5 w-fit">
        <button
          onClick={() => setActiveTab('suppliers')}
          style={activeTab === 'suppliers' ? { backgroundColor: tc, color: 'white' } : {}}
          className={`px-6 py-2.5 rounded-xl font-bold transition flex items-center gap-2 ${activeTab === 'suppliers' ? 'shadow-lg' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <Users size={18} />
          الموردين ({suppliers.length})
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          style={activeTab === 'invoices' ? { backgroundColor: tc, color: 'white' } : {}}
          className={`px-6 py-2.5 rounded-xl font-bold transition flex items-center gap-2 ${activeTab === 'invoices' ? 'shadow-lg' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <ShoppingCart size={18} />
          فواتير المشتريات ({purchaseInvoices.length})
        </button>
      </div>

      {/* ── Suppliers Tab ── */}
      {activeTab === 'suppliers' && (
        <>
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 mb-6">
            <div className="relative">
              <Search className="absolute right-4 top-3.5 text-slate-400" size={20} />
              <input
                type="text"
                placeholder="ابحث باسم المورد أو رقم الهاتف..."
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 pr-12 pl-4 focus:outline-none focus:ring-2 transition text-slate-700"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredSuppliers.map((supplier) => {
              const supplierInvoices = purchaseInvoices.filter(inv => inv.supplier_id === supplier.id);
              const totalDebt = supplierInvoices.reduce((sum, inv) => sum + (inv.total - inv.paid_amount), 0);
              return (
                <div key={supplier.id} className="bg-white rounded-3xl p-6 shadow-sm hover:shadow-xl transition-all border border-slate-100 group relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-slate-100 to-transparent rounded-bl-full opacity-50 group-hover:scale-150 transition-transform duration-500" />
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-100 shadow-inner">
                      <Users size={28} style={{ color: tc }} />
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setSelectedSupplierProfile(supplier); setShowSupplierProfile(true); }}
                        className="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition"
                        title="ملف المورد"
                      ><Eye size={16} /></button>
                      <button
                        onClick={() => { setEditingSupplier(supplier); setFormData({ name: supplier.name, phone: supplier.phone || '', address: supplier.address || '' }); setShowSupplierModal(true); }}
                        className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition"
                      ><Edit2 size={16} /></button>
                      <button
                        onClick={() => { if (confirm('هل أنت متأكد من حذف هذا المورد؟')) deleteSupplier(supplier.id); }}
                        className="p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition"
                      ><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <h3 className="text-xl font-black text-slate-800 mb-2">{supplier.name}</h3>
                  {totalDebt > 0 && (
                    <div className="mb-4 inline-block bg-red-50 text-red-600 px-3 py-1 rounded-lg text-xs font-bold border border-red-100">
                      مديونية: {totalDebt.toLocaleString()} {storeSettings.currency}
                    </div>
                  )}
                  <div className="space-y-3 text-slate-600 text-sm font-medium">
                    <div className="flex items-center gap-3"><Phone size={16} className="text-slate-400" /><span dir="ltr" className="font-mono">{supplier.phone || 'لا يوجد هاتف'}</span></div>
                    <div className="flex items-center gap-3"><MapPin size={16} className="text-slate-400" /><span>{supplier.address || 'لا يوجد عنوان'}</span></div>
                    <div className="flex items-center gap-3 pt-3 border-t border-slate-50">
                      <Calendar size={16} className="text-slate-400" />
                      <span className="text-xs text-slate-400">أضيف في: {new Date(supplier.created_at).toLocaleDateString('ar-SA')}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredSuppliers.length === 0 && (
              <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-3xl border border-slate-100 shadow-sm">
                <Users size={48} className="mx-auto mb-4 opacity-50" />
                <p className="text-xl font-bold mb-2">لا يوجد موردين</p>
                <p className="text-sm">لم يتم العثور على أي مورد مسجل حالياً.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Invoices Tab ── */}
      {activeTab === 'invoices' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 mb-6">
            <div className="relative">
              <Search className="absolute right-4 top-3.5 text-slate-400" size={20} />
              <input
                type="text"
                placeholder="ابحث برقم الفاتورة أو اسم المورد أو هاتفه..."
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 pr-12 pl-4 focus:outline-none focus:ring-2 transition text-slate-700"
                value={searchQueryInvoices}
                onChange={(e) => setSearchQueryInvoices(e.target.value)}
              />
            </div>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="py-20 text-center text-slate-400 bg-white rounded-3xl border border-slate-100 shadow-sm">
              <ShoppingCart size={48} className="mx-auto mb-4 opacity-50" />
              <p className="text-xl font-bold mb-2">لا توجد فواتير مشتريات</p>
              <p className="text-sm">اضغط على "فاتورة مشتريات جديدة" لإنشاء أول فاتورة.</p>
            </div>
          ) : (
            filteredInvoices.map((inv) => {
              const supplier = suppliers.find(s => s.id === inv.supplier_id);
              const remaining = inv.total - inv.paid_amount;
              return (
                <div key={inv.id} className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 hover:shadow-md transition group">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: tc + '20' }}>
                        <FileText size={22} style={{ color: tc }} />
                      </div>
                      <div>
                        <p className="font-black text-slate-800 text-lg">{inv.invoice_number}</p>
                        <p className="text-slate-500 text-sm font-medium">{supplier?.name || 'مورد محذوف'}</p>
                        <p className="text-slate-400 text-xs mt-1">{new Date(inv.created_at).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                      </div>
                    </div>
                    <div className="flex gap-6 items-start">
                      <div className="text-right">
                        <p className="font-black text-slate-800 text-xl">{inv.total.toLocaleString()} {storeSettings.currency}</p>
                        <p className="text-sm font-bold text-emerald-600 mt-1">مدفوع: {inv.paid_amount.toLocaleString()}</p>
                        {remaining > 0 && <p className="text-sm font-bold text-red-500">متبقي: {remaining.toLocaleString()}</p>}
                      </div>
                      <button
                        onClick={() => {
                          setEditingPurchaseInvoice(inv);
                          setInvSupplierId(inv.supplier_id);
                          {
                            const pop: Record<string, string> = {};
                            invPayKeys.forEach((k) => {
                              const col = (inv as any)['paid_' + k];
                              pop[k] = col ? col.toString() : (inv.payment_method === k ? inv.paid_amount.toString() : '');
                            });
                            setInvPay(pop);
                          }
                          setInvItems((inv.items && inv.items.length > 0) ? inv.items.map((i: any) => ({ product_id: i.product_id, quantity: i.quantity.toString(), purchase_price: i.purchase_price.toString() })) : [{ product_id: '', quantity: '1', purchase_price: '' }]);
                          setShowInvoiceModal(true);
                        }}
                        className="p-3 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-100 transition shadow-sm opacity-0 group-hover:opacity-100"
                        title="تعديل الفاتورة"
                      >
                        <Edit2 size={20} />
                      </button>
                      <button
                        onClick={() => printPurchaseInvoice(inv)}
                        className="p-3 bg-slate-50 text-slate-600 rounded-2xl hover:bg-slate-100 transition shadow-sm opacity-0 group-hover:opacity-100"
                        title="طباعة الفاتورة"
                      >
                        <Printer size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Supplier Modal ── */}
      {showSupplierModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-slate-100">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-black text-slate-800">{editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}</h2>
              <button onClick={() => setShowSupplierModal(false)} className="p-2 rounded-xl hover:bg-slate-200 transition"><X size={20} /></button>
            </div>
            <form onSubmit={handleSupplierSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">اسم المورد أو الشركة <span className="text-red-500">*</span></label>
                <input type="text" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition font-medium" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">رقم الهاتف</label>
                <input type="text" dir="ltr" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition font-medium text-left" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">العنوان</label>
                <textarea value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition font-medium resize-none h-24" />
              </div>
              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button type="submit" style={{ backgroundColor: tc }} className="flex-1 text-white py-3.5 rounded-xl font-bold shadow-lg hover:opacity-90 transition">حفظ البيانات</button>
                <button type="button" onClick={() => setShowSupplierModal(false)} className="flex-1 bg-slate-100 text-slate-700 py-3.5 rounded-xl font-bold hover:bg-slate-200 transition">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Purchase Invoice Modal ── */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center flex-shrink-0">
              <h2 className="text-xl font-black text-slate-800 flex items-center gap-2"><ShoppingCart size={22} style={{ color: tc }} />{editingPurchaseInvoice ? 'تعديل فاتورة المشتريات' : 'فاتورة مشتريات جديدة'}</h2>
              <button onClick={() => setShowInvoiceModal(false)} className="p-2 rounded-xl hover:bg-slate-200 transition"><X size={20} /></button>
            </div>

            <form onSubmit={handleAddInvoice} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 space-y-5 overflow-y-auto flex-1">
                {/* Supplier Select */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">المورد <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select value={invSupplierId} onChange={e => setInvSupplierId(e.target.value)} required className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition font-medium">
                      <option value="">-- اختر المورد --</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute left-4 top-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                {/* Items */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-sm font-bold text-slate-700">المنتجات المشتراة</label>
                    <button type="button" onClick={addInvRow} className="text-sm font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg hover:opacity-80 transition" style={{ color: tc }}>
                      <Plus size={14} /> إضافة منتج
                    </button>
                  </div>
                  <div className="space-y-3">
                    {invItems.map((item, idx) => {
                      const rowProduct = products.find(p => p.id === item.product_id);
                      const rowUnit = rowProduct?.unit || 'قطعة';
                      const rowFractional = isFractionalUnit(rowUnit);
                      return (
                      <div key={idx} className="flex gap-2 items-center bg-slate-50 rounded-2xl p-3 border border-slate-100">
                        <ProductSearchSelect
                          value={item.product_id}
                          onChange={val => updateInvRow(idx, 'product_id', val)}
                          products={products}
                        />
                        <div className="relative w-28 shrink-0">
                          <input
                            type="number" min="0" step={rowFractional ? '0.001' : '1'} placeholder="الكمية"
                            value={item.quantity} onChange={e => updateInvRow(idx, 'quantity', e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-xl pl-3 pr-12 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium text-center"
                          />
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">{getUnitConfig(rowUnit).label}</span>
                        </div>
                        <input
                          type="number" min="0" step="0.01" placeholder={`سعر شراء الـ${getUnitConfig(rowUnit).label}`}
                          value={item.purchase_price} onChange={e => updateInvRow(idx, 'purchase_price', e.target.value)}
                          className="w-32 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-medium text-center"
                        />
                        {invItems.length > 1 && (
                          <button type="button" onClick={() => removeInvRow(idx)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
                            <X size={16} />
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>

                {/* Paid Amount */}
                <PaymentSplitInputs
                  value={invPay}
                  onChange={(k, v) => setInvPay((s) => ({ ...s, [k]: v }))}
                  labelClassName="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide text-right"
                  inputClassName="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition font-bold text-right"
                />

                {/* Summary */}
                <div className="rounded-2xl p-5 border shadow-inner" style={{ backgroundColor: tc + '08', borderColor: tc + '20' }}>
                  <div className="flex justify-between font-black text-slate-800 text-lg mb-3 pb-3 border-b border-white">
                    <span>إجمالي الفاتورة</span>
                    <span>{invTotal.toLocaleString()} {storeSettings.currency}</span>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-slate-500 font-bold">
                      <span>إجمالي المدفوع</span>
                      <span className="text-slate-800">{invPaidTotal.toLocaleString()}</span>
                    </div>

                    <div className="flex justify-between text-sm font-bold">
                      <span className="text-slate-500">متبقي للمورد (آجل)</span>
                      <span className={invTotal - invPaidTotal > 0 ? 'text-red-500' : 'text-slate-400'}>
                        {Math.max(0, invTotal - invPaidTotal).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm font-bold">
                      <span className="text-slate-500">الباقي (مسترد)</span>
                      <span className={invPaidTotal - invTotal > 0 ? 'text-emerald-600' : 'text-slate-400'}>
                        {Math.max(0, invPaidTotal - invTotal).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 flex gap-3 flex-shrink-0">
                <button type="submit" disabled={isSaving} style={{ backgroundColor: tc }} className="flex-1 text-white py-3.5 rounded-xl font-bold shadow-lg hover:opacity-90 transition disabled:opacity-60">
                  {isSaving ? 'جاري الحفظ...' : 'حفظ الفاتورة'}
                </button>
                <button type="button" onClick={() => setShowInvoiceModal(false)} className="flex-1 bg-slate-100 text-slate-700 py-3.5 rounded-xl font-bold hover:bg-slate-200 transition">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Supplier Profile Modal ── */}
      {showSupplierProfile && selectedSupplierProfile && (() => {
        const _start = supFrom ? new Date(`${supFrom}T00:00:00`) : null;
        const _end = supTo ? (() => { const d = new Date(`${supTo}T00:00:00`); d.setDate(d.getDate() + 1); return d; })() : null;
        const inRange = (dt: any) => { const d = new Date(dt); return (!_start || d >= _start) && (!_end || d < _end); };
        const supplierInvoices = purchaseInvoices.filter(inv => inv.supplier_id === selectedSupplierProfile.id && inRange(inv.created_at));
        const totalPurchases = supplierInvoices.reduce((sum, inv) => sum + inv.total, 0);
        const totalPaid = supplierInvoices.reduce((sum, inv) => sum + inv.paid_amount, 0);
        const totalDebt = totalPurchases - totalPaid;

        // ── إحصائيات المنتجات المشتراة من هذا المورد ──
        const productStats = (() => {
          const map = new Map<string, { product_id: string; totalQty: number; totalCost: number; lastPrice: number; lastDate: string }>();
          // ترتيب تصاعدي بالتاريخ حتى يكون آخر سعر هو الأحدث
          const sorted = [...supplierInvoices].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          for (const inv of sorted) {
            for (const it of (inv.items || [])) {
              if (!it.product_id) continue;
              let s = map.get(it.product_id);
              if (!s) { s = { product_id: it.product_id, totalQty: 0, totalCost: 0, lastPrice: 0, lastDate: '' }; map.set(it.product_id, s); }
              const q = Number(it.quantity) || 0;
              s.totalQty += q;
              s.totalCost += q * (Number(it.purchase_price) || 0);
              s.lastPrice = Number(it.purchase_price) || 0;
              s.lastDate = inv.created_at;
            }
          }
          return Array.from(map.values()).map(s => {
            const product = products.find(p => p.id === s.product_id);
            let sold = 0;
            for (const o of orders) {
              if (o.is_deleted || o.type !== 'sale') continue;
              for (const oi of (o.items || [])) {
                if (oi.id === s.product_id) sold += (Number(oi.quantity) || 0) - (Number(oi.returned_quantity) || 0);
              }
            }
            return {
              ...s,
              name: product?.name || 'منتج محذوف',
              unit: product?.unit || 'قطعة',
              avgPrice: s.totalQty > 0 ? s.totalCost / s.totalQty : 0,
              currentStock: product?.stock_quantity ?? 0,
              sold
            };
          }).sort((a, b) => b.totalQty - a.totalQty);
        })();

        const handlePayDebt = async () => {
          const splitPayments = formToSplit(debtPay);
          const totalPaid = sumSplit(splitPayments);

          if (totalPaid <= 0) return alert('أدخل مبلغاً صحيحاً للسداد');
          if (totalPaid > totalDebt + 0.01) return alert('المبلغ المدخل أكبر من المديونية الحالية');

          try {
            setIsPayingDebt(true);
            await useStore.getState().paySupplierDebt(selectedSupplierProfile.id, totalPaid, splitPayments as any);
            alert('تم تسجيل عملية السداد بنجاح');
            setDebtPay({});
          } catch (e) {
            alert('حدث خطأ أثناء تسجيل السداد');
          } finally {
            setIsPayingDebt(false);
          }
        };

        const exportSupplierPDF = () => {
          const cur = storeSettings.currency;
          const period = (supFrom || supTo) ? `الفترة: ${supFrom || '...'} ← ${supTo || '...'}` : 'كل الفترات';
          const prodRows = productStats.map((s: any) => `<tr><td>${escapeHtml(s.name)}</td><td>${formatQty(s.totalQty, s.unit)}</td><td>${s.avgPrice.toFixed(2)}</td><td>${s.lastPrice.toFixed(2)}</td><td>${formatQty(s.currentStock, s.unit)}</td><td>${formatQty(s.sold, s.unit)}</td></tr>`).join('');
          const invRows = [...supplierInvoices].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((inv) => `<tr><td>${escapeHtml(String(inv.invoice_number))}</td><td>${new Date(inv.created_at).toLocaleString('ar-EG')}</td><td>${(inv.total || 0).toFixed(2)}</td><td>${(inv.paid_amount || 0).toFixed(2)}</td><td>${((inv.total || 0) - (inv.paid_amount || 0)).toFixed(2)}</td></tr>`).join('');
          const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>كشف حساب مورد - ${escapeHtml(selectedSupplierProfile.name)}</title><style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
            *{font-family:'Cairo',sans-serif;box-sizing:border-box;} body{padding:12mm;color:#000;}
            h1{font-size:22px;text-align:center;margin:0;} h2{font-size:13px;text-align:center;color:#555;margin:4px 0;font-weight:700;}
            h3{font-size:14px;margin:16px 0 6px;} .sum{display:flex;gap:10px;justify-content:center;margin:10px 0;flex-wrap:wrap;}
            .card{border:1px solid #ccc;border-radius:8px;padding:8px 14px;text-align:center;} .card b{display:block;font-size:16px;}
            table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12px;} th,td{border:1px solid #ccc;padding:5px 7px;text-align:right;} thead th{background:#f1f5f9;font-weight:900;}
            @media print{@page{size:A4;margin:8mm;}}
          </style></head><body>
            <h1>${escapeHtml(storeSettings.name)}</h1>
            <h2>كشف حساب المورد: ${escapeHtml(selectedSupplierProfile.name)} — ${escapeHtml(selectedSupplierProfile.phone || '')}</h2>
            <h2>${period}</h2>
            <div class="sum">
              <div class="card">إجمالي المشتريات<b>${totalPurchases.toFixed(2)} ${cur}</b></div>
              <div class="card">المدفوع<b>${totalPaid.toFixed(2)} ${cur}</b></div>
              <div class="card">المتبقّي (مديونية)<b>${totalDebt.toFixed(2)} ${cur}</b></div>
            </div>
            <h3>الأصناف المشتراة</h3>
            <table><thead><tr><th>المنتج</th><th>الكمية</th><th>متوسط الشراء</th><th>آخر شراء</th><th>المتاح بالمخزون</th><th>المباع</th></tr></thead><tbody>${prodRows || '<tr><td colspan=6>لا يوجد</td></tr>'}</tbody></table>
            <h3>الفواتير</h3>
            <table><thead><tr><th>رقم</th><th>التاريخ</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقّي</th></tr></thead><tbody>${invRows || '<tr><td colspan=5>لا يوجد</td></tr>'}</tbody></table>
            <p style="margin-top:16px;font-size:11px;color:#888;text-align:center;">تم الإصدار: ${new Date().toLocaleString('ar-EG')}</p>
            <script>window.onload=()=>{setTimeout(()=>{window.print();},400);}</script>
          </body></html>`;
          openPrintWindow(html);
        };

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
              <div className="p-8 border-b border-slate-100 flex flex-wrap gap-3 justify-between items-start bg-white">
                <div className="flex gap-6 items-center">
                  <div style={{ backgroundColor: tc }} className="w-16 h-16 rounded-3xl flex items-center justify-center text-white text-2xl font-black">
                    {selectedSupplierProfile.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-800">{selectedSupplierProfile.name}</h2>
                    <p className="text-slate-500 font-bold mt-1 flex items-center gap-2"><Phone size={14} /> {selectedSupplierProfile.phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-slate-400 font-bold">من</span>
                    <input type="date" value={supFrom} onChange={(e) => setSupFrom(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 font-bold" />
                    <span className="text-slate-400 font-bold">إلى</span>
                    <input type="date" value={supTo} onChange={(e) => setSupTo(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 font-bold" />
                    {(supFrom || supTo) && <button onClick={() => { setSupFrom(''); setSupTo(''); }} className="text-slate-400 hover:text-red-500 px-1">✕</button>}
                  </div>
                  <button onClick={exportSupplierPDF} style={{ backgroundColor: tc }} className="text-white px-4 py-2.5 rounded-2xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition"><Download size={16} /> تصدير PDF</button>
                  <button onClick={() => setShowSupplierProfile(false)} className="p-2 rounded-2xl hover:bg-slate-100 transition"><X size={24} /></button>
                </div>
              </div>

              <div id="supplier-profile-pdf" className="p-8 bg-slate-50 flex-1 overflow-y-auto">
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 mb-1">إجمالي المشتريات</p>
                    <p className="text-2xl font-black text-slate-800">{totalPurchases.toLocaleString()} {storeSettings.currency}</p>
                  </div>
                  <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 mb-1">إجمالي المدفوع</p>
                    <p className="text-2xl font-black text-emerald-600">{totalPaid.toLocaleString()} {storeSettings.currency}</p>
                  </div>
                  <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm relative overflow-hidden">
                    <div className="relative z-10">
                      <p className="text-xs font-bold text-slate-400 mb-1">المديونية المتبقية</p>
                      <p className={`text-2xl font-black ${totalDebt > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{totalDebt.toLocaleString()} {storeSettings.currency}</p>
                    </div>
                  </div>
                </div>

                {/* Pay Debt Section */}
                {totalDebt > 0 && (
                  <div className="bg-white p-8 rounded-[40px] border-2 border-emerald-100 shadow-xl mb-8 flex flex-col gap-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-full -z-0 opacity-50" />
                    <div className="relative z-10 flex justify-between items-center">
                      <div>
                        <h3 className="text-xl font-black text-slate-800 mb-1">تسديد مديونية للمورد</h3>
                        <p className="text-sm text-slate-500 font-medium">اختر طريقة الدفع ووزع المبالغ المسددة</p>
                      </div>
                      <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-2xl font-black text-lg">
                        إجمالي السداد: {sumSplit(formToSplit(debtPay)).toLocaleString()}
                      </div>
                    </div>

                    <div className="relative z-10">
                      <PaymentSplitInputs
                        value={debtPay}
                        onChange={(k, v) => setDebtPay((s) => ({ ...s, [k]: v }))}
                        cols={2}
                        labelClassName="text-[10px] font-black text-slate-400 uppercase tracking-widest block pr-2"
                        inputClassName="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-black text-center"
                      />
                    </div>

                    <button 
                      onClick={handlePayDebt}
                      disabled={isPayingDebt}
                      className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-emerald-200 hover:bg-emerald-700 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 relative z-10"
                    >
                      {isPayingDebt ? 'جاري تسجيل السداد...' : 'تأكيد عملية السداد وحفظ الإيصال'}
                    </button>
                  </div>
                )}

                {/* Per-product purchase statistics */}
                <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden mb-8">
                  <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                    <h3 className="font-black text-slate-800 flex items-center gap-2"><ShoppingCart size={18} style={{ color: tc }} /> الأصناف المشتراة من هذا المورد</h3>
                    <span className="text-xs font-bold text-slate-400">{productStats.length} صنف · إجمالي القطع المشتراة: <span className="text-slate-700">{productStats.reduce((sum, s) => sum + s.totalQty, 0).toLocaleString()}</span></span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm">
                      <thead className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wider">
                        <tr>
                          <th className="p-4">المنتج</th>
                          <th className="p-4 text-center">الوحدة</th>
                          <th className="p-4 text-center">الكمية المشتراة</th>
                          <th className="p-4 text-center">متوسط سعر الشراء</th>
                          <th className="p-4 text-center">آخر سعر شراء</th>
                          <th className="p-4 text-center">المتاح بالمخزون</th>
                          <th className="p-4 text-center">المباع</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {productStats.length === 0 ? (
                          <tr><td colSpan={7} className="p-10 text-center text-slate-400 font-bold">لا توجد أصناف مشتراة من هذا المورد</td></tr>
                        ) : (
                          productStats.map(s => (
                            <tr key={s.product_id} className="hover:bg-slate-50/50 transition">
                              <td className="p-4 font-bold text-slate-800">{s.name}</td>
                              <td className="p-4 text-center">
                                <span className="text-[11px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">{getUnitConfig(s.unit).label}</span>
                              </td>
                              <td className="p-4 text-center font-bold text-slate-700">{formatQty(s.totalQty, s.unit)}</td>
                              <td className="p-4 text-center font-bold text-indigo-600">{s.avgPrice.toFixed(2)} {storeSettings.currency}</td>
                              <td className="p-4 text-center font-bold text-orange-500">{s.lastPrice.toFixed(2)} {storeSettings.currency}</td>
                              <td className="p-4 text-center font-bold text-emerald-600">{formatQty(s.currentStock, s.unit)}</td>
                              <td className="p-4 text-center font-bold text-slate-500">{formatQty(s.sold, s.unit)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Transactions Table */}
                <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-50">
                    <h3 className="font-black text-slate-800">سجل المعاملات والفواتير</h3>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="p-4">رقم الفاتورة</th>
                        <th className="p-4">التاريخ</th>
                        <th className="p-4 text-center">الإجمالي</th>
                        <th className="p-4 text-center">المدفوع</th>
                        <th className="p-4 text-center">المتبقي</th>
                        <th className="p-4 text-left">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {supplierInvoices.length === 0 ? (
                        <tr><td colSpan={6} className="p-10 text-center text-slate-400 font-bold">لا يوجد فواتير سابقة</td></tr>
                      ) : (
                        supplierInvoices.map(inv => {
                          const isPayment = inv.total === 0;
                          return (
                            <tr key={inv.id} className={`hover:bg-slate-50 transition ${isPayment ? 'bg-emerald-50/30' : ''}`}>
                              <td className="p-4 font-mono font-bold text-slate-800">
                                {inv.invoice_number}
                                {isPayment && <span className="block text-[10px] text-emerald-600 font-black">إيصال سداد مديونية</span>}
                              </td>
                              <td className="p-4 text-xs font-medium">{new Date(inv.created_at).toLocaleDateString('ar-SA')}</td>
                              <td className="p-4 text-center font-bold">{isPayment ? '—' : inv.total.toLocaleString()}</td>
                              <td className="p-4 text-center font-bold text-emerald-600">{inv.paid_amount.toLocaleString()}</td>
                              <td className="p-4 text-center font-bold text-red-600">{isPayment ? '—' : (inv.total - inv.paid_amount).toLocaleString()}</td>
                              <td className="p-4 text-left">
                                <button onClick={() => printPurchaseInvoice(inv)} className="p-2 text-slate-400 hover:text-slate-800 transition" title="طباعة"><Printer size={16} /></button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {/* ── Quick Add Product Modal ── */}
      {showQuickProductModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto border border-slate-200 animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-black text-slate-800">إضافة منتج سريع</h3>
              <button onClick={() => setShowQuickProductModal(false)} className="p-2 hover:bg-slate-200 rounded-xl transition"><X size={18} /></button>
            </div>
            <form onSubmit={handleQuickProductSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">اسم المنتج</label>
                <input required type="text" value={quickProductData.name} onChange={e => setQuickProductData({...quickProductData, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">التصنيف</label>
                  <select required value={quickProductData.category_id} onChange={e => setQuickProductData({...quickProductData, category_id: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-sm">
                    <option value="">-- اختر --</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">سعر البيع لكل {getUnitConfig(quickProductData.unit).label}</label>
                  <input type="number" step="0.01" value={quickProductData.sale_price} onChange={e => setQuickProductData({...quickProductData, sale_price: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold" placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">وحدة البيع</label>
                <select value={quickProductData.unit} onChange={e => setQuickProductData({...quickProductData, unit: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-sm">
                  {UNIT_OPTIONS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">الباركود (تلقائي)</label>
                <input readOnly type="text" value={quickProductData.barcode} className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-400 font-mono text-xs" />
              </div>
              <button type="submit" disabled={isSaving} className="w-full bg-indigo-600 text-white py-3.5 rounded-2xl font-black shadow-lg hover:bg-indigo-700 transition disabled:opacity-50">
                {isSaving ? 'جاري الحفظ...' : 'تأكيد وإضافة للفاتورة'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
