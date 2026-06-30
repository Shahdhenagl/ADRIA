import { useState, useMemo } from 'react';
import { X, Search, Plus, Minus, Trash2, Save, AlertCircle, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Order, OrderItem, Product } from '../store/useStore';
import { printDocument } from '../utils/printWindow';
import { escapeHtml } from '../utils/escapeHtml';
import { activePaymentKeys, payLabelOf, primaryMethod as primaryMethod_ } from '../utils/paymentMethods';

interface EditInvoiceModalProps {
  invoice: Order;
  onClose: () => void;
  requireOtp?: boolean; // يطلب رمز تأكيد من المدير قبل الحفظ (للكاشير)
  exchangeMode?: boolean; // وضع الاستبدال (للكاشير): تبديل أصناف + رد/تحصيل الفرق + فاتورة قبل/بعد
}

export function EditInvoiceModal({ invoice, onClose, requireOtp, exchangeMode }: EditInvoiceModalProps) {
  const { products, editOrder, storeSettings, activeCashier, addExpense, markOrderExchanged } = useStore();

  // لقطة من أصناف الفاتورة قبل الاستبدال (للطباعة قبل/بعد)
  const [originalItems] = useState<OrderItem[]>(invoice.items.map(i => ({ ...i })));
  const oldTotal = invoice.total || 0;
  const oldPaid = invoice.paid_amount || 0;

  const [cart, setCart] = useState<OrderItem[]>([...invoice.items]);
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

  const total = cart.reduce((sum, item) => sum + (item.quantity * (item.sale_price || 0)), 0);
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
  const settleAmount = total - oldPaid;
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
      @media print{@page{size:72mm auto;margin:0;}.c{width:72mm;}}
    </style></head><body><div class="c">
      <div class="nm">${escapeHtml(storeSettings.name)}</div>
      <div class="ttl">إيصال استبدال</div>
      <div class="r"><span>رقم الفاتورة:</span><span>#${invoice.id}</span></div>
      <div class="r"><span>التاريخ:</span><span>${date}</span></div>
      <div class="r"><span>المحاسب:</span><span>${escapeHtml(activeCashier?.name || invoice.cashier_name || 'مدير النظام')}</span></div>
      <div class="r"><span>العميل:</span><span>${escapeHtml(invoice.customer?.name || 'عميل نقدي')}</span></div>
      <div class="sec">قبل الاستبدال</div>
      <table>${rows(originalItems)}</table>
      <div class="tot"><span>الإجمالي القديم:</span><span>${oldTotal.toFixed(2)} ${cur}</span></div>
      <div class="sec">بعد الاستبدال</div>
      <table>${rows(cart)}</table>
      <div class="tot"><span>الإجمالي الجديد:</span><span>${total.toFixed(2)} ${cur}</span></div>
      ${diffBlock}
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
      updatedData = { total, paid_amount: total, paid_cash: base.cash || 0, paid_visa: base.visa || 0, paid_wallet: base.wallet || 0, paid_instapay: base.instapay || 0, paid_method5: base.method5 || 0, paid_method6: base.method6 || 0, payment_method: invoice.payment_method as any };
    } else {
      updatedData = { total, paid_amount: paidAmount, paid_cash: pay.cash || 0, paid_visa: pay.visa || 0, paid_wallet: pay.wallet || 0, paid_instapay: pay.instapay || 0, paid_method5: pay.method5 || 0, paid_method6: pay.method6 || 0, payment_method: paymentMethod as any };
    }

    const success = await editOrder(invoice.id, updatedData, cart, reason);

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
          before: originalItems.map((i) => ({ name: i.name, quantity: i.quantity, sale_price: i.sale_price })),
          after: cart.map((i) => ({ name: i.name, quantity: i.quantity, sale_price: i.sale_price })),
          oldTotal, newTotal: total, diff: settleAmount, method: settleMethod, date: new Date().toISOString(),
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
                <span className="text-slate-600 font-medium">الإجمالي القديم:</span>
                <span className="text-lg font-bold text-slate-500">{(invoice.total || 0).toLocaleString()} {storeSettings.currency}</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                <span className="text-slate-600 font-medium">الإجمالي الجديد:</span>
                <span className="text-2xl font-black text-slate-800">{total.toLocaleString()} {storeSettings.currency}</span>
              </div>
              {(() => {
                const diff = total - (invoice.total || 0);
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
