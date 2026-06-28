import { useState, useMemo } from 'react';
import { X, Search, Plus, Minus, Trash2, Save, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Order, OrderItem, Product } from '../store/useStore';

interface EditInvoiceModalProps {
  invoice: Order;
  onClose: () => void;
  requireOtp?: boolean; // يطلب رمز تأكيد من المدير قبل الحفظ (للكاشير)
}

export function EditInvoiceModal({ invoice, onClose, requireOtp }: EditInvoiceModalProps) {
  const { products, editOrder, storeSettings } = useStore();
  
  const [cart, setCart] = useState<OrderItem[]>([...invoice.items]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [paidCash, setPaidCash] = useState<number>(invoice.paid_cash || (invoice.payment_method === 'cash' ? invoice.paid_amount : 0));
  const [paidVisa, setPaidVisa] = useState<number>(invoice.paid_visa || (invoice.payment_method === 'visa' ? invoice.paid_amount : 0));
  const [paidWallet, setPaidWallet] = useState<number>(invoice.paid_wallet || (invoice.payment_method === 'wallet' ? invoice.paid_amount : 0));
  const [paidInstapay, setPaidInstapay] = useState<number>(invoice.paid_instapay || (invoice.payment_method === 'instapay' ? invoice.paid_amount : 0));
  
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const total = cart.reduce((sum, item) => sum + (item.quantity * (item.sale_price || 0)), 0);
  const paidAmount = paidCash + paidVisa + paidWallet + paidInstapay;
  const debt = Math.max(0, total - paidAmount);

  // Determine main payment method
  let paymentMethod = invoice.payment_method;
  if (paidCash > 0 && paidVisa === 0 && paidWallet === 0 && paidInstapay === 0) paymentMethod = 'cash';
  else if (paidVisa > 0 && paidCash === 0 && paidWallet === 0 && paidInstapay === 0) paymentMethod = 'visa';
  else if (paidWallet > 0 && paidCash === 0 && paidVisa === 0 && paidInstapay === 0) paymentMethod = 'wallet';
  else if (paidInstapay > 0 && paidCash === 0 && paidVisa === 0 && paidWallet === 0) paymentMethod = 'instapay';
  else if (paidAmount > 0) paymentMethod = invoice.payment_method;

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
        const details = `تعديل فاتورة #${invoice.id}\nالإجمالي الجديد: ${total.toFixed(2)} ${storeSettings.currency}\nالسبب: ${reason}`;
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

    const updatedData = {
      total,
      paid_amount: paidAmount,
      paid_cash: paidCash,
      paid_visa: paidVisa,
      paid_wallet: paidWallet,
      paid_instapay: paidInstapay,
      payment_method: paymentMethod as any,
    };

    const success = await editOrder(invoice.id, updatedData, cart, reason);
    
    if (success) {
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
              <Save size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">تعديل الفاتورة #{invoice.id}</h2>
              <p className="text-sm text-slate-500">تعديل المنتجات والمبالغ المدفوعة</p>
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

          {/* Payment Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                المدفوعات
              </h3>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="w-24 text-sm font-medium text-slate-600">كاش:</label>
                  <input type="number" min="0" value={paidCash || ''} onChange={(e) => setPaidCash(Number(e.target.value))} className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="0" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-24 text-sm font-medium text-slate-600">فيزا:</label>
                  <input type="number" min="0" value={paidVisa || ''} onChange={(e) => setPaidVisa(Number(e.target.value))} className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="0" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-24 text-sm font-medium text-slate-600">محفظة:</label>
                  <input type="number" min="0" value={paidWallet || ''} onChange={(e) => setPaidWallet(Number(e.target.value))} className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="0" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-24 text-sm font-medium text-slate-600">انستا باي:</label>
                  <input type="number" min="0" value={paidInstapay || ''} onChange={(e) => setPaidInstapay(Number(e.target.value))} className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="0" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">سبب التعديل (مطلوب)</label>
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
            {isSubmitting ? 'جاري الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  );
}
