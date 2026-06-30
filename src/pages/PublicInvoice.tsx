import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Order, StoreSettings } from '../store/useStore';
import { CheckCircle2, Printer, Download, Phone, User, MapPin } from 'lucide-react';
// html2canvas-pro يدعم ألوان oklch() في Tailwind v4 (النسخة الأصلية تفشل معها).
import html2canvas from 'html2canvas-pro';
import { calculateOrderReturnValue } from '../utils/returns';


export default function PublicInvoice() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        // The public page has no Supabase session, so it cannot read the tables
        // directly (they are locked to authenticated users). Instead it calls a
        // single SECURITY DEFINER function that returns just this one invoice.
        const { data: rpc, error: rpcErr } = await supabase.rpc('get_public_invoice', { p_id: id });
        if (rpcErr) throw rpcErr;
        if (!rpc) throw new Error('Invoice not found');

        const s = rpc.settings;
        if (s) {
          setSettings({
            name: s.name,
            currency: s.currency,
            logo: s.logo,
            taxRate: s.tax_rate,
            themeColor: s.theme_color,
            address: s.address,
            phone: s.phone,
            phone2: s.phone2,
            whatsappCountryCode: s.whatsapp_country_code,
            initial_balance: s.initial_balance,
            locationUrl: s.location_url
          });
        }

        // Sale order
        const o = rpc.kind === 'order' ? rpc.order : null;

        if (o) {
          const itemRows = (o.order_items as any[]) ?? [];
          const items = itemRows.map((i: any) => ({
            id: i.product_id,
            name: i.product_name || i.products?.name || 'منتج غير معروف',
            quantity: i.quantity,
            sale_price: i.sale_price,
            regular_price: i.products?.sale_price,
            discount_price: i.products?.discount_price,
            returned_quantity: i.returned_quantity || 0,
          }));

          let debtBefore = 0;
          let debtAfter = 0;
          let currentDebt = 0;
          if (o.customer_id) {
            const allCustOrders = (rpc.customer_orders ?? []) as any[];
            
            if (allCustOrders) {
              const sortedOrders = [...allCustOrders].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              
              const calculateDebtForOrders = (ordersList: any[]) => {
                return Math.max(0, ordersList.reduce((sum, ord) => {
                  if (ord.type === 'payment' && ord.notes?.includes('سداد أجل للفاتورة رقم')) {
                    return sum;
                  }
                  const items = (ord.order_items as any[])?.map((i: any) => ({
                    quantity: i.quantity,
                    sale_price: i.sale_price,
                    returned_quantity: i.returned_quantity || 0,
                    refunded_amount: i.refunded_amount || 0
                  })) || [];
                  
                  const returnedValue = calculateOrderReturnValue({ ...ord, items });
                  const effectiveTotal = ord.type === 'payment' ? 0 : ord.total - returnedValue;
                  return sum + (effectiveTotal - ord.paid_amount);
                }, 0));
              };

              const oIndex = sortedOrders.findIndex(ord => ord.id === o.id);
              const ordersBefore = oIndex !== -1 ? sortedOrders.slice(0, oIndex) : [];
              debtBefore = calculateDebtForOrders(ordersBefore);
              
              const ordersUpTo = oIndex !== -1 ? sortedOrders.slice(0, oIndex + 1) : (o.is_deleted ? [] : [o]);
              debtAfter = calculateDebtForOrders(ordersUpTo);
              currentDebt = calculateDebtForOrders(sortedOrders);
            }
          }


          setOrder({
            id: o.id,
            total: o.total,
            paid_amount: o.paid_amount,
            paid_cash: o.paid_cash,
            paid_visa: o.paid_visa,
            paid_wallet: o.paid_wallet,
            paid_instapay: o.paid_instapay,
            type: o.type,
            payment_method: o.payment_method,
            date: o.created_at,
            items,
            cashier_name: o.cashier_name,
            salesperson_name: o.salesperson_name,
            notes: o.notes,
            coupon_code: o.coupon_code,
            discount_amount: o.discount || 0,
            debtBefore,
            debtAfter,
            currentDebt,
            originType: 'sale',
            customer: o.customers ? { 
              id: o.customers.id, 
              name: o.customers.name, 
              phone: o.customers.phone, 
              custom_id: o.customers.custom_id,
              timestamp: o.customers.created_at 
            } : undefined
          } as any);
          return;
        }

        // Maintenance appointment if not a sale order
        if (!o) {
          const appt = rpc.kind === 'maintenance' ? rpc.appointment : null;

          if (appt) {
            const apptOrders = (rpc.appointment_orders ?? []) as any[];

            const linkedOrders = (apptOrders ?? []).filter(ord => 
              (ord.notes || '').includes(`[زيارة:${appt.id}]`) || 
              (ord.order_items as any[])?.some(i => i.product_id?.startsWith(`maint-${appt.id}`))
            );

            const items = linkedOrders.flatMap(ord => {
              const itemRows = (ord.order_items as any[]) ?? [];
              if (itemRows.length === 0) {
                const name = (ord.notes || '').replace(/\[زيارة:[^\]]+\]/g, '').trim() || 'إيراد صيانة';
                return [{
                  id: `virtual-${ord.id}`,
                  name,
                  quantity: 1,
                  sale_price: ord.total || ord.paid_amount || 0,
                  returned_quantity: 0
                }];
              }
              return itemRows.map((i: any) => ({
                id: i.product_id,
                name: i.product_name || i.products?.name || 'منتج غير معروف',
                quantity: i.quantity,
                sale_price: i.sale_price,
                returned_quantity: i.returned_quantity || 0,
              }));
            });

            const grandTotal = items.reduce((sum, item) => sum + item.sale_price * item.quantity, 0);
            const car = appt.car_subscriptions;

            setOrder({
              id: appt.id,
              total: grandTotal,
              paid_amount: grandTotal,
              paid_cash: linkedOrders[0]?.payment_method === 'cash' ? grandTotal : 0,
              paid_visa: linkedOrders[0]?.payment_method === 'visa' ? grandTotal : 0,
              paid_wallet: linkedOrders[0]?.payment_method === 'wallet' ? grandTotal : 0,
              paid_instapay: linkedOrders[0]?.payment_method === 'instapay' ? grandTotal : 0,
              type: 'sale',
              payment_method: linkedOrders[0]?.payment_method || 'cash',
              date: appt.appointment_date || appt.created_at,
              items,
              originType: 'sale',
              notes: appt.report || appt.description || '',
              customer: car ? {
                id: car.id,
                name: car.customer_name,
                phone: car.customer_phone,
                custom_id: car.car_number,
                timestamp: car.created_at
              } : undefined
            } as any);
            return;
          }
        }

        // Purchase invoice
        const inv = rpc.kind === 'purchase' ? rpc.purchase : null;

        if (inv) {
          const itemRows = (inv.purchase_items as any[]) ?? [];
          const items = itemRows.map((i: any) => ({
            id: i.product_id,
            name: i.products?.name || 'منتج غير معروف',
            quantity: i.quantity,
            sale_price: i.purchase_price,
            returned_quantity: 0
          }));

          setOrder({
            id: inv.invoice_number || inv.id,
            total: inv.total,
            paid_amount: inv.paid_amount,
            paid_cash: inv.paid_cash,
            paid_visa: inv.paid_visa,
            paid_wallet: inv.paid_wallet,
            paid_instapay: inv.paid_instapay,
            type: inv.total === 0 ? 'payment' : 'sale',
            payment_method: inv.payment_method,
            date: inv.created_at,
            items,
            originType: 'purchase',
            supplier: inv.suppliers ? {
              name: inv.suppliers.name,
              phone: inv.suppliers.phone
            } : undefined
          } as any);
          return;
        }

        throw new Error('Invoice not found');
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (id) fetchData();
  }, [id]);

  const downloadAsImage = async () => {
    const element = document.getElementById('invoice-print-area');
    if (!element) return;
    const canvas = await html2canvas(element, { scale: 3, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `invoice-${order?.id}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error || !order || !settings) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6 text-center">
      <div className="text-red-500 text-6xl mb-4">⚠️</div>
      <h1 className="text-2xl font-black text-slate-800">عذراً، الفاتورة غير موجودة</h1>
      <p className="text-slate-500 mt-2">يرجى التأكد من الرابط الصحيح.</p>
    </div>
  );

  const subtotal = order.items.reduce((sum, item) => sum + (item.quantity * item.sale_price), 0);
  const taxRate = settings.taxRate || 0;
  // If Tax exists: Total = (Subtotal - Discount) * (1 + TaxRate)
  // Discount = Subtotal - (Total / (1 + TaxRate))
  const calculatedDiscount = Math.max(0, subtotal - (order.total / (1 + (taxRate / 100))));
  const taxValue = (subtotal - calculatedDiscount) * (taxRate / 100);
  const isPayment = order.type === 'payment';

  const visitMatch = order.notes?.match(/\[زيارة:\s*([^\]]+)\s*\]/);
  const visitId = visitMatch ? visitMatch[1].trim() : null;
  const cleanNotes = order.notes ? order.notes.replace(/\[زيارة:\s*[^\]]+\s*\]/, '').trim() : '';

  let displayCash = order.paid_cash || 0;
  let displayVisa = order.paid_visa || 0;
  let displayWallet = order.paid_wallet || 0;
  let displayInstapay = order.paid_instapay || 0;

  if (displayCash === 0 && displayVisa === 0 && displayWallet === 0 && displayInstapay === 0 && order.paid_amount > 0) {
    const method = (order.payment_method || 'cash').toLowerCase();
    if (method === 'visa') {
      displayVisa = order.paid_amount;
    } else if (method === 'wallet' || method === 'vodafone') {
      displayWallet = order.paid_amount;
    } else if (method === 'instapay') {
      displayInstapay = order.paid_amount;
    } else {
      displayCash = order.paid_amount;
    }
  }


  return (
    <div className="min-h-screen bg-slate-50 py-4 sm:py-10 px-2 sm:px-4 font-sans flex flex-col items-center gap-4 sm:gap-6" dir="rtl">
      
      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3 no-print w-full max-w-2xl justify-center">
         <button onClick={() => window.print()} className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-slate-800 text-white px-4 sm:px-6 py-3 rounded-xl font-bold shadow-md hover:bg-slate-900 transition text-sm">
            <Printer size={18} /> طباعة
         </button>
         <button onClick={downloadAsImage} className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 sm:px-6 py-3 rounded-xl font-bold shadow-md hover:bg-indigo-700 transition text-sm">
            <Download size={18} /> حفظ كصورة
         </button>
         <a 
            href={`tel:${settings.phone}`} 
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 sm:px-6 py-3 rounded-xl font-bold shadow-md hover:bg-emerald-700 transition text-sm"
         >
            <Phone size={18} /> اتصل بنا
         </a>
         {settings.locationUrl && (
           <a 
              href={settings.locationUrl} 
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-sky-600 text-white px-4 sm:px-6 py-3 rounded-xl font-bold shadow-md hover:bg-sky-700 transition text-sm"
           >
              <MapPin size={18} /> المقر
           </a>
         )}
      </div>

      {/* Invoice Area */}
      <div id="invoice-print-area" className="bg-white w-full max-w-2xl shadow-xl sm:shadow-2xl rounded-2xl sm:rounded-none overflow-hidden flex flex-col relative border border-slate-200 sm:border-none">
        
        {/* Decorative Top Bar (no-print) */}
        <div className="h-2 w-full bg-slate-800 no-print"></div>

        <div className="p-5 sm:p-[12mm] flex flex-col h-full">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-center sm:items-start border-b-2 border-slate-100 pb-6 mb-6 gap-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-right">
              {settings.logo && (
                <div className="bg-white p-1 rounded-2xl border border-slate-200 shadow-sm shrink-0">
                  <img src={settings.logo} alt="Logo" className="h-16 w-auto max-w-[220px] object-contain animate-fade-in" />
                </div>
              )}
              <div className="flex flex-col justify-center">
                <h1 className="text-xl sm:text-2xl font-black text-slate-800 leading-tight">{settings.name}</h1>
                <div className="text-xs text-slate-500 mt-2 space-y-1 font-semibold">
                  {settings.address && <p className="flex items-center justify-center sm:justify-start gap-1">📍 {settings.address}</p>}
                  {(settings.phone || settings.phone2) && (
                    <p className="flex items-center justify-center sm:justify-start gap-1" dir="ltr">
                      {settings.phone2 && <span>{settings.phone2} | </span>}
                      {settings.phone} 📞
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center sm:items-end gap-2.5 shrink-0">
              <div className="flex items-center gap-2 justify-end w-full sm:w-auto">
                <span className="text-slate-400 font-bold text-[10px] sm:text-xs uppercase tracking-widest shrink-0">رقم الفاتورة</span>
                <span className="text-xs sm:text-sm font-bold text-slate-700 font-mono bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 select-all" dir="ltr">
                  #{order.id}
                </span>
              </div>
              {visitId && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-bold text-[10px] sm:text-xs uppercase tracking-widest shrink-0">رقم الزيارة</span>
                  <span className="text-[11px] sm:text-xs font-bold text-indigo-700 font-mono bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-100">#{visitId.substring(0, 8)}</span>
                </div>
              )}
              {order.cashier_name && (
                <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100 shadow-sm">
                  <User size={12} className="opacity-70" />
                  <span>المحاسب: {order.cashier_name}</span>
                </div>
              )}
              {(order as any).salesperson_name && (
                <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-purple-600 bg-purple-50 px-3 py-1.5 rounded-full border border-purple-100 shadow-sm">
                  <User size={12} className="opacity-70" />
                  <span>مسؤول المبيعات: {(order as any).salesperson_name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
             <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                    {(order as any).originType === 'purchase' ? 'المورد' : 'العميل'}
                  </span>
                  <CheckCircle2 size={14} className="text-emerald-500" />
                </div>
                <div className="text-sm font-black text-slate-800">
                  {(order as any).originType === 'purchase' ? ((order as any).supplier?.name || 'مورد') : (order.customer?.name || 'عميل نقدي')}
                </div>
                <div className="flex justify-between items-center mt-1">
                  <div className="text-xs font-bold text-slate-500 font-mono" dir="ltr">{order.customer?.phone || '-'}</div>
                  {order.customer && (
                    <div className="text-[10px] font-black bg-red-50 text-red-600 px-2 py-0.5 rounded-lg border border-red-100">
                      إجمالي المديونية: {((order as any).currentDebt || 0).toFixed(2)}
                    </div>
                  )}
                </div>
             </div>
             <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">التفاصيل</span>
                  <span className="text-[10px] text-slate-400 font-mono">{new Date(order.date).toLocaleDateString('ar-SA')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-600">التاريخ:</span>
                  <span className="text-[13px] font-black text-slate-800">{new Date(order.date).toLocaleDateString('ar-EG', { calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-600">التوقيت:</span>
                  <span className="text-[13px] font-black text-slate-800">{new Date(order.date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {visitId && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-600">رقم الزيارة:</span>
                    <span className="text-[13px] font-black text-indigo-600 font-mono">{visitId}</span>
                  </div>
                )}
                {order.customer?.custom_id && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-600">رقم الكارت:</span>
                    <span className="text-[13px] font-black text-indigo-600 font-mono">{order.customer.custom_id}</span>
                  </div>
                )}
             </div>
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto -mx-5 sm:mx-0 mb-6">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50">
                  <th className="p-4 text-center text-[11px] font-black text-slate-400 border-b border-slate-100 w-10">#</th>
                  <th className="p-4 text-right text-[11px] font-black text-slate-400 border-b border-slate-100">{isPayment ? 'البيان' : 'المنتج'}</th>
                  {!isPayment && <th className="p-4 text-center text-[11px] font-black text-slate-400 border-b border-slate-100 w-16">الكمية</th>}
                  <th className="p-4 text-center text-[11px] font-black text-slate-400 border-b border-slate-100 w-24">السعر</th>
                  <th className="p-4 text-left text-[11px] font-black text-slate-400 border-b border-slate-100 w-28">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {order.items.map((item, idx) => (
                  <tr key={idx} className="group">
                    <td className="p-4 text-center text-slate-400 font-bold text-xs">{idx + 1}</td>
                    <td className="p-4 font-black text-slate-800 text-sm">{item.name}</td>
                    {!isPayment && <td className="p-4 text-center font-black text-slate-800">{item.quantity}</td>}
                    <td className="p-4 text-center font-bold text-slate-600 text-xs">
                      {(item as any).regular_price && ((item as any).discount_price || 0) > 0 && Math.abs(item.sale_price - ((item as any).discount_price || 0)) < 0.01 && (item as any).regular_price > item.sale_price ? (
                        <span className="inline-flex items-center gap-1"><span className="line-through text-slate-400">{(item as any).regular_price.toFixed(2)}</span><span className="text-emerald-600 font-black">{item.sale_price.toFixed(2)}</span></span>
                      ) : item.sale_price.toFixed(2)}
                    </td>
                    <td className="p-4 text-left font-black text-slate-900 text-sm">{ (item.quantity * item.sale_price).toFixed(2) }</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary Section */}
          <div className="mr-auto w-full sm:w-3/5 mt-auto space-y-4">
            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 space-y-3">
              {!isPayment && (
                <>
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-500">المجموع الفرعي</span>
                    <span className="text-slate-800">{subtotal.toFixed(2)} {settings.currency}</span>
                  </div>
                  {order.coupon_code && (
                    <div className="flex justify-between text-xs font-bold text-rose-500">
                      <span>كوبون خصم ({order.coupon_code})</span>
                      <span>- {order.discount_amount?.toFixed(2) || '0.00'} {settings.currency}</span>
                    </div>
                  )}
                  {calculatedDiscount - (order.discount_amount || 0) > 0.5 && (
                      <div className="flex justify-between text-xs font-bold text-red-500">
                        <span>خصم الفاتورة</span>
                        <span>- {(calculatedDiscount - (order.discount_amount || 0)).toFixed(2)} {settings.currency}</span>
                      </div>
                    )}
                  {taxRate > 0 && (
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-500">الضريبة ({taxRate}%)</span>
                      <span className="text-slate-800">{taxValue.toFixed(2)} {settings.currency}</span>
                    </div>
                  )}
                  <div className="h-px bg-slate-200 my-1"></div>
                  <div className="flex justify-between items-center text-xl font-black text-slate-800">
                    <span>الإجمالي</span>
                    <span className="text-2xl">{order.total.toFixed(2)} {settings.currency}</span>
                  </div>
                </>
              )}

              {/* Payment Status / Debt info */}
              <div className={`p-4 rounded-xl border text-center font-black ${order.type === 'payment' ? 'bg-indigo-50 border-indigo-100' : (order.paid_amount < order.total ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100')}`}>
                {isPayment ? (
                  <div className="space-y-3">
                    <div className="text-indigo-600 text-lg border-b border-indigo-100 pb-2">المبلغ المدفوع: {order.paid_amount.toFixed(2)} {settings.currency}</div>
                    <div className="flex justify-between items-center text-xs text-slate-500">
                      <span>المديونية قبل السداد:</span>
                      <span className="font-bold">{((order as any).debtBefore || 0).toFixed(2)} {settings.currency}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm text-orange-700 bg-white p-2 rounded-lg border border-orange-100 shadow-sm">
                      <span>المديونية المتبقية:</span>
                      <span className="text-lg font-black">{Math.max(0, (order as any).debtAfter || 0).toFixed(2)} {settings.currency}</span>
                    </div>
                  </div>
                ) : order.paid_amount < order.total ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-base">متبقي آجل: {(order.total - order.paid_amount).toFixed(2)} {settings.currency}</div>
                    <div className="text-[10px] opacity-70">تم سداد: {order.paid_amount.toFixed(2)} {settings.currency}</div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle2 size={18} /> تم السداد بالكامل
                  </div>
                )}
              </div>
            </div>

            {cleanNotes && order.type !== 'payment' && (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 shadow-sm space-y-2 mt-4">
                <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest text-center border-b border-amber-100 pb-2 mb-2">ملاحظات الفاتورة</div>
                <div className="text-sm font-bold text-amber-900 text-center">{cleanNotes}</div>
              </div>
            )}

            {/* Payment Details Card */}
            <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm space-y-2">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center border-b border-slate-50 pb-2 mb-2">طريقة الدفع</div>
              <div className="grid grid-cols-2 gap-2">
                {displayCash > 0 && <div className="flex justify-between p-2 bg-slate-50 rounded-lg text-[11px] font-black text-slate-700"><span>💵 كاش</span><span>{displayCash.toFixed(2)}</span></div>}
                {displayVisa > 0 && <div className="flex justify-between p-2 bg-slate-50 rounded-lg text-[11px] font-black text-slate-700"><span>💳 فيزا</span><span>{displayVisa.toFixed(2)}</span></div>}
                {displayWallet > 0 && <div className="flex justify-between p-2 bg-slate-50 rounded-lg text-[11px] font-black text-slate-700"><span>📱 محفظة</span><span>{displayWallet.toFixed(2)}</span></div>}
                {displayInstapay > 0 && <div className="flex justify-between p-2 bg-slate-50 rounded-lg text-[11px] font-black text-slate-700"><span>⚡ انستا</span><span>{displayInstapay.toFixed(2)}</span></div>}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-10 pt-6 border-t border-dashed border-slate-200 text-[11px] text-slate-400 font-black italic">
             شكراً لثقتكم بنا - {settings.name} ترحب بكم دائماً
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white; padding: 0; }
          .no-print { display: none; }
          .min-h-screen { background: white; padding: 0; min-height: auto; }
          #invoice-print-area { 
            box-shadow: none; 
            border: none; 
            padding: 8mm; 
            margin: 0 auto; 
            width: 148mm; 
            min-height: 205mm; 
            border-radius: 0;
          }
          #invoice-print-area table th, #invoice-print-area table td {
            padding: 8px 4px;
          }
        }
        @media (max-width: 640px) {
          #invoice-print-area {
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
