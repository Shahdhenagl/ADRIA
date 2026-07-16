import { useState, useMemo } from 'react';
import { X, Search, Plus, Minus, Trash2, Save, AlertCircle, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Order, OrderItem, Product } from '../store/useStore';
import { printDocument } from '../utils/printWindow';
import { escapeHtml } from '../utils/escapeHtml';
import { buildPagesQrBlock } from '../utils/pagesQr';
import { activePaymentKeys, payLabelOf, primaryMethod as primaryMethod_ } from '../utils/paymentMethods';

interface EditInvoiceModalProps {
  invoice: Order;
  onClose: () => void;
  requireOtp?: boolean; // يطلب رمز تأكيد من المدير قبل الحفظ (للكاشير)
  exchangeMode?: boolean; // وضع الاستبدال (للكاشير): تبديل أصناف + رد/تحصيل الفرق + فاتورة قبل/بعد
}

export function EditInvoiceModal({ invoice, onClose, requireOtp, exchangeMode }: EditInvoiceModalProps) {
  const { products, editOrder, storeSettings, activeCashier, addExpense, markOrderExchanged, updateOrderRefundedAt } = useStore();

  // لقطة من أصناف الفاتورة قبل الاستبدال (للطباعة قبل/بعد)
  const [originalItems] = useState<OrderItem[]>(invoice.items.map(i => ({ ...i })));
  const oldTotal = invoice.total || 0;
  const oldPaid = invoice.paid_amount || 0;

  const [cart, setCart] = useState<OrderItem[]>(() => exchangeMode ? [] : [...invoice.items]);
  const [selectedOldQty, setSelectedOldQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(invoice.items.map((i) => [i.id, Math.max(0, (i.quantity || 0) - ((i as any).returned_quantity || 0))]))
  );
  const [searchQuery, setSearchQuery] = useState('');

  const payKeys = activePaymentKeys(storeSettings as any);
  const [pay, setPay] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {};
    payKeys.forEach((k) => { p[k] = (invoice as any)['paid_' + k] || (invoice.payment_method === k ? invoice.paid_amount : 0); });
    return p;
  });
  const setPayVal = (k: string, v: number) => setPay((s) => ({ ...s, [k]: v }));
  const [settleMethod, setSettleMethod] = useState<string>(invoice.payment_method || 'cash');

  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // تعديل تاريخ/وقت الفاتورة (وضع التعديل الكامل من لوحة التحكم — مش الاستبدال).
  const toDateInput = (iso?: string) => {
    const d = iso ? new Date(iso) : new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [orderDate, setOrderDate] = useState<string>(() => toDateInput(invoice.date));

  // تاريخ الاسترجاع — بيتحفظ لوحده (updateOrderRefundedAt) مش مع «حفظ التعديلات»،
  // عشان تعديله متعلّقش على سبب تعديل مطلوب ولا على إعادة حساب المخزون.
  const invoiceRefundedAt = (invoice as any).refunded_at as string | null | undefined;
  const [refundDate, setRefundDate] = useState<string>(() => invoiceRefundedAt ? toDateInput(invoiceRefundedAt) : '');
  const [savingRefundDate, setSavingRefundDate] = useState(false);
  const refundDateDirty = !!invoiceRefundedAt && refundDate !== toDateInput(invoiceRefundedAt);

  const handleSaveRefundDate = async () => {
    if (!refundDateDirty) return;
    const d = new Date(refundDate);
    if (isNaN(d.getTime())) { alert('تاريخ غير صحيح'); return; }
    setSavingRefundDate(true);
    // updateOrderRefundedAt بيتأكد إن اليوم القديم واليوم الجديد الاتنين مش
    // مقفولين، وبيعرض السبب بنفسه لو مقفول.
    const ok = await updateOrderRefundedAt(invoice.id, d.toISOString());
    setSavingRefundDate(false);
    if (ok) alert('تم تعديل تاريخ الاسترجاع — حركة المرتجع اتنقلت لليوم الجديد ✅');
  };

  const total = cart.reduce((sum, item) => sum + (item.quantity * (item.sale_price || 0)), 0);
  const exchangeableQty = (item: OrderItem) => Math.max(0, (item.quantity || 0) - ((item as any).returned_quantity || 0));
  const selectedQtyOf = (item: OrderItem) => Math.min(exchangeableQty(item), Math.max(0, selectedOldQty[item.id] || 0));
  const selectedOldItems = originalItems
    .map((item) => ({ ...item, quantity: selectedQtyOf(item), returned_quantity: 0 }))
    .filter((item) => item.quantity > 0);
  const keptOldItems = exchangeMode ? originalItems
    .map((item) => {
      const quantity = Math.max(0, (item.quantity || 0) - selectedQtyOf(item));
      return { ...item, quantity, returned_quantity: Math.min((item as any).returned_quantity || 0, quantity) };
    })
    .filter((item) => item.quantity > 0) : [];
  const selectedOldTotal = selectedOldItems.reduce((sum, item) => sum + (item.quantity * (item.sale_price || 0)), 0);
  const keptOldTotal = keptOldItems.reduce((sum, item) => sum + (item.quantity * (item.sale_price || 0)), 0);
  const finalExchangeItems = [...keptOldItems.map((item) => ({ ...item })), ...cart.map((item) => ({ ...item }))];
  const finalExchangeTotal = keptOldTotal + total;
  const paidAmount = payKeys.reduce((s, k) => s + (pay[k] || 0), 0);
  const debt = Math.max(0, total - paidAmount);

  // Determine main payment method
  const paymentMethod = paidAmount > 0 ? primaryMethod_(pay) : invoice.payment_method;

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return [];
    const query = searchQuery.toLowerCase();
    return products.filter(
      p => p.name.toLowerCase().includes(query) || (p.barcode && p.barcode.includes(query))
    ).slice(0, 5);
  }, [searchQuery, products]);

  const handleAddProduct = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(p => p.id === product.id);
      if (existing) {
        return prev.map(p => p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p);
      }
      return [...prev, { ...product, quantity: 1, returned_quantity: 0 }];
    });
    setSearchQuery('');
  };

  const toggleOldItem = (id: string) => {
    const item = originalItems.find((i) => i.id === id);
    if (!item) return;
    setSelectedOldQty((prev) => ({ ...prev, [id]: (prev[id] || 0) > 0 ? 0 : exchangeableQty(item) }));
  };

  const updateOldItemQty = (id: string, delta: number) => {
    const item = originalItems.find((i) => i.id === id);
    if (!item) return;
    const maxQty = exchangeableQty(item);
    setSelectedOldQty((prev) => {
      const current = prev[id] || 0;
      const next = Math.min(maxQty, Math.max(1, current + delta));
      return { ...prev, [id]: next };
    });
  };

  const handleUpdateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const handleUpdatePrice = (id: string, price: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, sale_price: Math.max(0, price) };
      }
      return item;
    }));
  };

  const handleRemoveItem = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  // فرق الاستبدال: موجب = نحصّل من العميل، سالب = نرجّع للعميل
  const settleAmount = exchangeMode ? total - selectedOldTotal : total - oldPaid;
  const methodLabelOf = (m: string) => payLabelOf(storeSettings as any, m);

  const printExchangeReceipt = () => {
    const cur = storeSettings.currency;
    const date = new Date().toLocaleString('ar-EG', { calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const rows = (items: OrderItem[]) => items.map(i => `<tr><td style="text-align:right;font-weight:700;">${escapeHtml(i.name)}</td><td style="text-align:center;">${i.quantity}</td><td style="text-align:left;">${(i.quantity * (i.sale_price || 0)).toFixed(2)}</td></tr>`).join('');
    const diffBlock = Math.abs(settleAmount) < 0.01
      ? `<div class="rem">لا يوجد فرق</div>`
      : `<div class="rem">${settleAmount > 0 ? 'تحصيل من العميل' : 'مرتجع للعميل'}: ${Math.abs(settleAmount).toFixed(2)} ${cur}<br/><span style="font-size:11px;">طريقة ${settleAmount > 0 ? 'التحصيل' : 'الرد'}: ${methodLabelOf(settleMethod)}</span></div>`;
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>إيصال استبدال #${invoice.id}</title><style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;900&display=swap');
      *{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo',sans-serif;color:#000;}
      .c{width:72mm;margin:0 auto;padding:0 1.5mm 2mm;}
      .nm{font-size:18px;font-weight:900;text-align:center;}
      .ttl{font-size:14px;font-weight:900;text-align:center;border:1.5px solid #000;border-radius:5px;padding:3px;margin:5px 0;}
      .r{display:flex;justify-content:space-between;font-size:11px;font-weight:700;padding:1px 0;}
      .sec{font-size:12px;font-weight:900;margin-top:5px;border-bottom:1px dashed #000;padding-bottom:2px;}
      table{width:100%;border-collapse:collapse;font-size:11px;font-weight:700;}
      td{padding:2px 1px;border-bottom:1px dotted #999;}
      .tot{display:flex;justify-content:space-between;font-size:13px;font-weight:900;border-top:1px solid #000;padding-top:3px;margin-top:2px;}
      .rem{font-size:14px;font-weight:900;text-align:center;border:1.5px solid #000;border-radius:5px;padding:5px;margin-top:6px;}
      .ft{text-align:center;font-size:10px;font-weight:700;margin-top:6px;border-top:1px dashed #000;padding-top:4px;}
      /* نفس أسماء كلاسات باقي المطبوعات عشان buildPagesQrBlock يرندر زيها بالظبط */
      .qr-row{display:flex;justify-content:center;align-items:flex-start;gap:10px;margin-top:6px;}
      .qr-code-container{display:flex;flex-direction:column;align-items:center;gap:1px;}
      .qr-code-img{width:68px;height:68px;}
      .qr-label{font-size:9px;font-weight:900;color:#000;text-align:center;}
      @media print{@page{size:72mm auto;margin:0;}.c{width:72mm;}}
    </style></head><body><div class="c">
      <div class="nm">${escapeHtml(storeSettings.name)}</div>
      <div class="ttl">إيصال استبدال</div>
      <div class="r"><span>رقم الفاتورة:</span><span>#${invoice.id}</span></div>
      <div class="r"><span>التاريخ:</span><span>${date}</span></div>
      <div class="r"><span>المحاسب:</span><span>${escapeHtml(activeCashier?.name || invoice.cashier_name || 'مدير النظام')}</span></div>
      <div class="r"><span>العميل:</span><span>${escapeHtml(invoice.customer?.name || 'عميل نقدي')}</span></div>
      <div class="sec">قبل الاستبدال</div>
      <table>${rows(selectedOldItems)}</table>
      <div class="tot"><span>إجمالي المستبدل:</span><span>${selectedOldTotal.toFixed(2)} ${cur}</span></div>
      <div class="sec">بعد الاستبدال</div>
      <table>${rows(cart)}</table>
      <div class="tot"><span>الإجمالي الجديد:</span><span>${total.toFixed(2)} ${cur}</span></div>
      ${diffBlock}
      ${(() => { const b = buildPagesQrBlock(storeSettings); return b ? `<div class="qr-row">${b}</div>` : ''; })()}
      <div class="ft">شكراً لتعاملكم معنا</div>
    </div><script>window.onload=()=>{setTimeout(()=>{window.print();},400);}</script></body></html>`;
    void printDocument('invoice', html);
  };

  const handleSave = async () => {
    if (!reason.trim()) {
      setError('يرجى إدخال سبب التعديل');
      return;
    }
    if (cart.length === 0) {
      setError('لا يمكن حفظ فاتورة بدون منتجات. قم بحذف الفاتورة بدلاً من ذلك.');
      return;
    }
    if (exchangeMode && selectedOldItems.length === 0) {
      setError('اختاري قطعة واحدة على الأقل من الفاتورة القديمة للاستبدال.');
      return;
    }

    // تأكيد OTP من المدير (للكاشير) قبل الحفظ
    if (requireOtp) {
      try {
        const { supabase } = await import('../lib/supabase');
        const { data } = await supabase.auth.getSession();
        const tk = data.session?.access_token;
        const headers = { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) };
        const details = `${exchangeMode ? 'استبدال' : 'تعديل'} فاتورة #${invoice.id}\nالإجمالي القديم: ${oldTotal.toFixed(2)} ← الجديد: ${total.toFixed(2)} ${storeSettings.currency}\n${exchangeMode ? (settleAmount > 0 ? `تحصيل من العميل: ${settleAmount.toFixed(2)}` : settleAmount < 0 ? `رد للعميل: ${Math.abs(settleAmount).toFixed(2)}` : 'لا فرق') + '\n' : ''}السبب: ${reason}`;
        const r1 = await fetch('/api/wholesale-otp', { method: 'POST', headers, body: JSON.stringify({ action: 'request', purpose: 'invoice', details }) });
        const j1 = await r1.json();
        if (!j1.ok) { setError('تعذّر إرسال رمز التأكيد: ' + (j1.error || '')); return; }
        const code = window.prompt('تم إرسال رمز التأكيد للمدير على تليجرام.\nأدخل الرمز لإتمام التعديل:');
        if (!code) return;
        const r2 = await fetch('/api/wholesale-otp', { method: 'POST', headers, body: JSON.stringify({ action: 'verify', purpose: 'invoice', code: code.trim() }) });
        const j2 = await r2.json();
        if (!j2.ok) { setError(j2.error || 'رمز غير صحيح'); return; }
      } catch { setError('تعذّر التحقق من الرمز'); return; }
    }

    setIsSubmitting(true);
    setError('');

    let updatedData;
    if (exchangeMode) {
      // الاستبدال: نُبقي تقسيمة الدفع الأصلية كما هي (مسجّلة في يومها)، ونسجّل الفرق
      // كمعاملة مالية منفصلة بتاريخ اليوم → لا ازدواج في الحسابات.
      const base: Record<string, number> = {};
      payKeys.forEach((k) => { base[k] = (invoice as any)['paid_' + k] || 0; });
      if (payKeys.reduce((s, k) => s + base[k], 0) === 0) base[invoice.payment_method || 'cash'] = oldPaid;
      updatedData = { total: finalExchangeTotal, paid_amount: finalExchangeTotal, paid_cash: base.cash || 0, paid_visa: base.visa || 0, paid_wallet: base.wallet || 0, paid_instapay: base.instapay || 0, paid_method5: base.method5 || 0, paid_method6: base.method6 || 0, payment_method: invoice.payment_method as any };
    } else {
      const newDateISO = (() => { const d = new Date(orderDate); return isNaN(d.getTime()) ? invoice.date : d.toISOString(); })();
      updatedData = { total, paid_amount: paidAmount, paid_cash: pay.cash || 0, paid_visa: pay.visa || 0, paid_wallet: pay.wallet || 0, paid_instapay: pay.instapay || 0, paid_method5: pay.method5 || 0, paid_method6: pay.method6 || 0, payment_method: paymentMethod as any, date: newDateISO };
    }

    const success = await editOrder(invoice.id, updatedData, exchangeMode ? finalExchangeItems : cart, reason);

    if (success) {
      if (exchangeMode) {
        // سجّل فرق الاستبدال كمعاملة مالية مرئية برقم الفاتورة
        if (Math.abs(settleAmount) >= 0.01) {
          const m = settleMethod;
          const amt = Math.abs(settleAmount);
          const sp: Record<string, number> = {};
          payKeys.forEach((k) => { sp[k] = m === k ? amt : 0; });
          await addExpense({
            category: 'فرق استبدال مبيعات',
            amount: settleAmount > 0 ? -amt : amt, // تحصيل = إيراد (سالب) / رد = مصروف (موجب)
            note: `فرق استبدال ${settleAmount > 0 ? '(تحصيل لينا)' : '(مصروف رد للعميل)'} — فاتورة #${invoice.id}`,
            payment_method: m,
            paid_cash: sp.cash || 0, paid_visa: sp.visa || 0, paid_wallet: sp.wallet || 0, paid_instapay: sp.instapay || 0, paid_method5: sp.method5 || 0, paid_method6: sp.method6 || 0,
          } as any);
        }
        await markOrderExchanged(invoice.id, {
          before: selectedOldItems.map((i) => ({ name: i.name, quantity: i.quantity, sale_price: i.sale_price })),
          kept: keptOldItems.map((i) => ({ name: i.name, quantity: i.quantity, sale_price: i.sale_price })),
          after: cart.map((i) => ({ name: i.name, quantity: i.quantity, sale_price: i.sale_price })),
          originalTotal: oldTotal, oldTotal: selectedOldTotal, keptTotal: keptOldTotal, newTotal: total, finalTotal: finalExchangeTotal, diff: settleAmount, method: settleMethod, date: new Date().toISOString(),
        });
        printExchangeReceipt();
      }
      onClose();
    } else {
      setError('حدث خطأ أثناء حفظ التعديلات');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl" dir="rtl">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
              {exchangeMode ? <RefreshCw size={24} /> : <Save size={24} />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{exchangeMode ? 'استبدال' : 'تعديل الفاتورة'} #{invoice.id}</h2>
              <p className="text-sm text-slate-500">{exchangeMode ? 'بدّل أصناف بأصناف، واحسب الفرق ردًّا أو تحصيلًا' : 'تعديل المنتجات والمبالغ المدفوعة'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-2 border border-red-100">
              <AlertCircle size={20} />
              <p className="font-semibold">{error}</p>
            </div>
          )}

          {/* Product Search */}
          <div className="relative">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن منتج لإضافته (الاسم أو الباركود)..."
                className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              />
            </div>
            {filteredProducts.length > 0 && (
              <div className="absolute top-full mt-2 w-full bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden z-10">
                {filteredProducts.map(product => (
                  <button
                    key={product.id}
                    onClick={() => handleAddProduct(product)}
                    className="w-full px-4 py-3 text-right hover:bg-slate-50 flex justify-between items-center border-b last:border-0 border-slate-50"
                  >
                    <div>
                      <div className="font-bold text-slate-800">{product.name}</div>
                      <div className="text-xs text-slate-500">متاح: {product.stock_quantity}</div>
                    </div>
                    <div className="font-bold text-indigo-600">{product.sale_price} {storeSettings.currency}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart Items */}
          {exchangeMode ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-100 text-slate-700 font-black text-sm">القطع القديمة</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="text-slate-500 font-bold">
                      <tr>
                        <th className="p-3 w-10"></th>
                        <th className="p-3">المنتج</th>
                        <th className="p-3 text-center">الكمية</th>
                        <th className="p-3">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {originalItems.map(item => {
                        const maxQty = exchangeableQty(item);
                        const selectedQty = selectedQtyOf(item);
                        return (
                          <tr key={item.id} className={selectedQty > 0 ? 'bg-amber-50/70' : ''}>
                            <td className="p-3">
                              <input
                                type="checkbox"
                                checked={selectedQty > 0}
                                disabled={maxQty <= 0}
                                onChange={() => toggleOldItem(item.id)}
                                className="w-5 h-5 accent-amber-600 disabled:opacity-40"
                              />
                            </td>
                            <td className="p-3 font-bold text-slate-800">
                              {item.name}
                              {maxQty < (item.quantity || 0) && <div className="text-[11px] text-slate-400 font-bold">متاح للاستبدال: {maxQty}</div>}
                            </td>
                            <td className="p-3">
                              <div className="flex items-center justify-center gap-2">
                                <button disabled={selectedQty <= 1} onClick={() => updateOldItemQty(item.id, -1)} className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded disabled:opacity-30"><Minus size={16} /></button>
                                <span className="w-10 text-center font-black text-slate-700">{selectedQty || 0} / {maxQty}</span>
                                <button disabled={selectedQty >= maxQty || maxQty <= 0} onClick={() => updateOldItemQty(item.id, 1)} className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded disabled:opacity-30"><Plus size={16} /></button>
                              </div>
                            </td>
                            <td className="p-3 font-black text-slate-700">{(selectedQty * (item.sale_price || 0)).toLocaleString()} {storeSettings.currency}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 bg-white border-t border-slate-200 space-y-2 text-sm">
                  <div className="flex justify-between font-black text-amber-700">
                    <span>إجمالي المحدد للاستبدال</span>
                    <span>{selectedOldTotal.toLocaleString()} {storeSettings.currency}</span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-500">
                    <span>باقي في الفاتورة</span>
                    <span>{keptOldTotal.toLocaleString()} {storeSettings.currency}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-emerald-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-emerald-50 text-emerald-700 font-black text-sm">القطع الجديدة</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="text-slate-500 font-bold">
                      <tr>
                        <th className="p-3">المنتج</th>
                        <th className="p-3 text-center">الكمية</th>
                        <th className="p-3">السعر</th>
                        <th className="p-3">الإجمالي</th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cart.map(item => (
                        <tr key={item.id}>
                          <td className="p-3 font-bold text-slate-800">{item.name}</td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => handleUpdateQuantity(item.id, -1)} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"><Minus size={16} /></button>
                              <span className="w-8 text-center font-black text-slate-700">{item.quantity}</span>
                              <button onClick={() => handleUpdateQuantity(item.id, 1)} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"><Plus size={16} /></button>
                            </div>
                          </td>
                          <td className="p-3">
                            <input type="number" min="0" value={item.sale_price} onChange={(e) => handleUpdatePrice(item.id, Number(e.target.value))} className="w-20 p-2 bg-white border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 outline-none" />
                          </td>
                          <td className="p-3 font-black text-emerald-700">{(item.quantity * (item.sale_price || 0)).toLocaleString()} {storeSettings.currency}</td>
                          <td className="p-3 text-left">
                            <button onClick={() => handleRemoveItem(item.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={18} /></button>
                          </td>
                        </tr>
                      ))}
                      {cart.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-500 font-bold">ضيفي القطع الجديدة من البحث فوق</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-100 flex justify-between font-black text-emerald-700">
                  <span>إجمالي الجديد</span>
                  <span>{total.toLocaleString()} {storeSettings.currency}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 text-slate-600 font-medium">
                  <tr>
                    <th className="p-4">المنتج</th>
                    <th className="p-4 text-center">الكمية</th>
                    <th className="p-4">سعر الوحدة</th>
                    <th className="p-4">الإجمالي</th>
                    <th className="p-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cart.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-medium text-slate-800">{item.name}</td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-3">
                          <button onClick={() => handleUpdateQuantity(item.id, -1)} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                            <Minus size={16} />
                          </button>
                          <span className="w-8 text-center font-bold text-slate-700">{item.quantity}</span>
                          <button onClick={() => handleUpdateQuantity(item.id, 1)} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                            <Plus size={16} />
                          </button>
                        </div>
                      </td>
                      <td className="p-4">
                        <input
                          type="number"
                          min="0"
                          value={item.sale_price}
                          onChange={(e) => handleUpdatePrice(item.id, Number(e.target.value))}
                          className="w-24 p-2 bg-white border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </td>
                      <td className="p-4 font-bold text-indigo-600">
                        {(item.quantity * (item.sale_price || 0)).toLocaleString()} {storeSettings.currency}
                      </td>
                      <td className="p-4 text-left">
                        <button onClick={() => handleRemoveItem(item.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        لا يوجد منتجات في الفاتورة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Payment Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                {exchangeMode ? 'تسوية الفرق' : 'المدفوعات'}
              </h3>

              {exchangeMode ? (
                <div className="space-y-3">
                  {Math.abs(settleAmount) < 0.01 ? (
                    <div className="bg-slate-100 rounded-xl p-4 text-center font-bold text-slate-600">لا يوجد فرق — نفس القيمة</div>
                  ) : (
                    <>
                      <div className={`rounded-xl p-4 text-center ${settleAmount > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                        <div className={`text-sm font-bold ${settleAmount > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{settleAmount > 0 ? 'تحصّل من العميل' : 'ترجّع للعميل'}</div>
                        <div className={`text-3xl font-black ${settleAmount > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{Math.abs(settleAmount).toLocaleString()} {storeSettings.currency}</div>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-600 mb-1">{settleAmount > 0 ? 'طريقة تحصيل الفرق' : 'طريقة رد الفلوس للعميل'}</label>
                        <select value={settleMethod} onChange={(e) => setSettleMethod(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold">
                          {payKeys.map((k) => <option key={k} value={k}>{payLabelOf(storeSettings as any, k)}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              ) : (
              <div className="space-y-3">
                {payKeys.map((k) => (
                  <div key={k} className="flex items-center gap-3">
                    <label className="w-24 text-sm font-medium text-slate-600">{payLabelOf(storeSettings as any, k)}:</label>
                    <input type="number" min="0" value={pay[k] || ''} onChange={(e) => setPayVal(k, Number(e.target.value))} className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="0" />
                  </div>
                ))}
              </div>
              )}

              {!exchangeMode && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">تاريخ ووقت الفاتورة</label>
                  <input
                    type="datetime-local"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-bold"
                  />
                  <p className="text-[11px] text-slate-400 mt-1 font-bold">تغيير التاريخ بيحرّك الفاتورة لتقفيل اليوم اللي بيقع فيه.</p>
                </div>
              )}

              {/* تاريخ الاسترجاع/الاستبدال — للعرض بس. مالهومش علاقة بحقل تاريخ
                  الفاتورة فوق: الاسترجاع بيتسجّل على refunded_at (db/36)
                  والاستبدال جوه exchange_data.date، والاتنين بيتحطوا وقت العملية
                  نفسها. بيتعرضوا هنا عشان اللي بيعدّل يعرف إن الفاتورة اتحرّك
                  فيها حاجة في يوم تاني قبل ما يغيّر تاريخها. */}
              {!exchangeMode && invoiceRefundedAt && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">تاريخ الاسترجاع</label>
                  <div className="flex gap-2">
                    <input
                      type="datetime-local"
                      value={refundDate}
                      onChange={(e) => setRefundDate(e.target.value)}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none transition-all font-bold"
                    />
                    <button
                      type="button"
                      onClick={handleSaveRefundDate}
                      disabled={!refundDateDirty || savingRefundDate}
                      className="shrink-0 px-4 rounded-xl bg-rose-600 text-white font-black hover:bg-rose-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {savingRefundDate ? '...' : 'حفظ'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 font-bold">
                    بيتحفظ لوحده. تغييره بينقل حركة المرتجع لتقفيل اليوم الجديد — واليومين القديم والجديد لازم يكونوا مش مقفولين.
                  </p>
                </div>
              )}

              {/* تاريخ الاستبدال — للعرض بس. تعديله مش زي المرتجع: فرق الاستبدال
                  متسجّل كصف مصروف/إيراد مستقل بتاريخه، فتغيير exchange_data.date
                  لوحده كان هيسيب الفرق في اليوم القديم والحركة تتقسم على يومين. */}
              {(() => {
                const exchangedAt = (invoice as any).exchange_data?.date as string | null | undefined;
                if (!exchangedAt) return null;
                const sameDay = new Date(exchangedAt).toDateString() === new Date(invoice.date).toDateString();
                return (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-500">تاريخ الاستبدال</span>
                    <div className="flex items-center gap-2">
                      {!sameDay && (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                          يوم مختلف عن الفاتورة
                        </span>
                      )}
                      <span className="text-xs font-black text-amber-600">
                        {new Date(exchangedAt).toLocaleString('ar-EG', {
                          calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">{exchangeMode ? 'سبب الاستبدال (مطلوب)' : 'سبب التعديل (مطلوب)'}</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
                  rows={2}
                  placeholder="مثال: تعديل سعر منتج، تغيير طريقة الدفع..."
                />
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-6 flex flex-col justify-center space-y-4 border border-slate-100">
              <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                <span className="text-slate-600 font-medium">{exchangeMode ? 'إجمالي المحدد للاستبدال:' : 'الإجمالي القديم:'}</span>
                <span className="text-lg font-bold text-slate-500">{(exchangeMode ? selectedOldTotal : (invoice.total || 0)).toLocaleString()} {storeSettings.currency}</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                <span className="text-slate-600 font-medium">{exchangeMode ? 'إجمالي القطع الجديدة:' : 'الإجمالي الجديد:'}</span>
                <span className="text-2xl font-black text-slate-800">{total.toLocaleString()} {storeSettings.currency}</span>
              </div>
              {exchangeMode && keptOldTotal > 0.009 && (
                <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                  <span className="text-slate-600 font-medium">باقي الفاتورة بدون استبدال:</span>
                  <span className="text-lg font-bold text-slate-500">{keptOldTotal.toLocaleString()} {storeSettings.currency}</span>
                </div>
              )}
              {exchangeMode && (
                <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                  <span className="text-slate-600 font-medium">إجمالي الفاتورة بعد الاستبدال:</span>
                  <span className="text-xl font-black text-slate-800">{finalExchangeTotal.toLocaleString()} {storeSettings.currency}</span>
                </div>
              )}
              {(() => {
                const diff = exchangeMode ? settleAmount : total - (invoice.total || 0);
                if (Math.abs(diff) < 0.01) return null;
                return (
                  <div className={`flex justify-between items-center pb-4 border-b border-slate-200 ${diff > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    <span className="font-bold">{diff > 0 ? '⬆️ تاخد من العميل فرق:' : '⬇️ ترجّع للعميل فرق:'}</span>
                    <span className="text-xl font-black">{Math.abs(diff).toLocaleString()} {storeSettings.currency}</span>
                  </div>
                );
              })()}
              {!exchangeMode && (
                <>
                  <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                    <span className="text-slate-600 font-medium">إجمالي المدفوع:</span>
                    <span className="text-xl font-bold text-emerald-600">{paidAmount.toLocaleString()} {storeSettings.currency}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-slate-600 font-medium">الآجل (المديونية):</span>
                    <span className={`text-xl font-bold ${debt > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {debt.toLocaleString()} {storeSettings.currency}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-3 text-slate-600 hover:bg-slate-100 rounded-xl font-bold transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={handleSave}
            disabled={isSubmitting}
            className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? 'جاري الحفظ...' : (exchangeMode ? 'تأكيد الاستبدال وطباعة' : 'حفظ التعديلات')}
          </button>
        </div>
      </div>
    </div>
  );
}
