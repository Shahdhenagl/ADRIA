import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { Search, FileText, Table as TableIcon, User, Eye, Printer, X, TrendingUp, Wallet, ArrowRightLeft, CreditCard, Archive } from 'lucide-react';
import { normalizeArabic } from '../../utils/textUtils';
import { calculateOrderReturnValue } from '../../utils/returns';
import { escapeHtml } from '../../utils/escapeHtml';
import { openPrintWindow } from '../../utils/printWindow';
import * as XLSX from 'xlsx';

import { printPaymentReceipt } from '../../utils/printPaymentReceipt';
import PaymentSplitInputs from '../../components/PaymentSplitInputs';
import { formToSplit, sumSplit, primaryMethod as primaryMethod_ } from '../../utils/paymentMethods';

export default function Customers() {
  const { customers, orders, storeSettings } = useStore();
  const activeOrders = orders.filter((order) => !order.is_deleted);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const profileTab: string = 'orders';
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', phone: '', custom_id: '', card_number: '' });
  const [addCustomerForm, setAddCustomerForm] = useState({ name: '', phone: '', card_number: '' });
  const [paymentForm, setPaymentForm] = useState({
    cash: '',
    visa: '',
    wallet: '',
    instapay: '',
    note: ''
  });
  const { updateCustomer, addCustomer, checkout } = useStore();

  const filteredCustomers = customers.filter(c => 
    normalizeArabic(c.name).includes(normalizeArabic(searchQuery)) || 
    c.phone.includes(searchQuery) ||
    (c.custom_id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.id.substring(0, 8).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getCustomerMetrics = (customerId: string) => {
    const customerOrders = orders.filter(o => o.customer?.id === customerId);
    const activeCustomerOrders = activeOrders.filter(o => o.customer?.id === customerId);
    
    const totalReturns = activeCustomerOrders.reduce((sum, o) => {
      return sum + calculateOrderReturnValue(o);
    }, 0);

    const totalSpent = activeCustomerOrders.reduce((sum, o) => {
      if (o.type === 'payment') return sum;
      return sum + o.total;
    }, 0);

    const totalProfit = activeCustomerOrders.reduce((sum, o) => {
      if (o.type === 'payment') return sum;
      return sum + o.items.reduce((itemSum, item) => {
        const netQty = item.quantity - item.returned_quantity;
        return itemSum + (item.sale_price - (item.average_purchase_price ?? item.purchase_price)) * netQty;
      }, 0);
    }, 0);

    // Debt = Original Total - Returned Value - Paid Amount
    // ملاحظة: نفس منطق صفحة "حسابات الآجل" بالضبط حتى يتطابق الرقمان:
    //  - الفواتير ذات مديونية موجبة تُضاف
    //  - مدفوعات السداد العامة (ليست سداد فاتورة محددة) تُطرح
    //  - لا تُحتسب المديونيات السالبة الناتجة عن إرجاع فاتورة مدفوعة (الإرجاع استرداد نقدي وليس رصيداً دائناً)
    const totalDebt = Math.max(0, activeCustomerOrders.reduce((sum, o) => {
      const returnedValue = calculateOrderReturnValue(o);
      const effectiveTotal = o.type === 'payment' ? 0 : o.total - returnedValue;
      const debt = effectiveTotal - o.paid_amount;
      if (debt > 0.009) {
        return sum + debt;
      } else if (o.type === 'payment' && !(o.notes && o.notes.includes('سداد أجل للفاتورة رقم'))) {
        return sum + debt; // مدفوعات السداد العامة (قيمة سالبة)
      }
      return sum;
    }, 0));

    return { customerOrders, activeCustomerOrders, totalSpent, totalProfit, totalDebt, totalReturns };
  };

  const exportExcel = () => {
    const wsData = [
      ['سجل العملاء', '', '', '', '', '', '', '', ''],
      ['التاريخ', new Date().toLocaleDateString(), '', '', '', '', '', '', ''],
      [''],
      ['الاسم', 'رقم الهاتف', 'عدد الطلبات', 'إجمالي المشتريات (صافي)', 'إجمالي المرتجعات', 'المديونية الحالية', 'إجمالي الربح', 'تاريخ التسجيل'],
      ...filteredCustomers.map(c => {
        const metrics = getCustomerMetrics(c.id);
        return [
          c.name,
          c.phone,
          metrics.activeCustomerOrders.length,
          metrics.totalSpent,
          metrics.totalReturns,
          metrics.totalDebt,
          metrics.totalProfit,
          new Date(c.timestamp).toLocaleDateString('ar-SA')
        ];
      })
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    XLSX.writeFile(wb, `customers_report_${new Date().toLocaleDateString()}.xlsx`);
  };

  const reportShell = (title: string, body: string) => `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"/><title>${title}</title><style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
    *{font-family:'Cairo',sans-serif;box-sizing:border-box;} body{padding:12mm;color:#000;}
    h1{font-size:22px;text-align:center;margin:0;} h2{font-size:13px;text-align:center;color:#555;margin:4px 0 12px;font-weight:700;}
    table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12px;} th,td{border:1px solid #ccc;padding:5px 7px;text-align:right;} thead th{background:#f1f5f9;font-weight:900;}
    @media print{@page{size:A4;margin:8mm;}}
  </style></head><body><h1>${escapeHtml(storeSettings.name)}</h1>${body}
    <p style="margin-top:16px;font-size:11px;color:#888;text-align:center;">تم الإصدار: ${new Date().toLocaleString('ar-EG')}</p>
    <script>window.onload=()=>{setTimeout(()=>{window.print();},400);}</script></body></html>`;

  const exportPDF = () => {
    const rows = filteredCustomers.map((c: any) => { const m = getCustomerMetrics(c.id); return `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.phone || '')}</td><td>${(m.totalSpent || 0).toFixed(2)}</td><td>${(m.totalDebt || 0).toFixed(2)}</td></tr>`; }).join('');
    openPrintWindow(reportShell('كشف العملاء', `<h2>كشف العملاء (${filteredCustomers.length})</h2><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>إجمالي المشتريات</th><th>المديونية</th></tr></thead><tbody>${rows}</tbody></table>`));
  };

  const exportCustomerStatementPDF = () => {
    const c = selectedCustomer; if (!c) return;
    const rows = (c.customerOrders || []).map((o: any) => `<tr><td>#${o.id}</td><td>${new Date(o.date).toLocaleString('ar-EG')}</td><td>${o.type === 'payment' ? 'تحصيل' : 'فاتورة'}</td><td>${(o.total || 0).toFixed(2)}</td><td>${(o.paid_amount || 0).toFixed(2)}</td><td>${((o.type === 'payment' ? 0 : (o.total || 0)) - (o.paid_amount || 0)).toFixed(2)}</td></tr>`).join('');
    openPrintWindow(reportShell(`كشف حساب ${c.name}`, `<h2>كشف حساب العميل: ${escapeHtml(c.name)} — ${escapeHtml(c.phone || '')}</h2><table><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>النوع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقّي</th></tr></thead><tbody>${rows}</tbody></table>`));
  };

  const handleOpenProfile = (customer: any) => {
    const metrics = getCustomerMetrics(customer.id);
    setSelectedCustomer({ ...customer, ...metrics });
    setEditForm({ 
      name: customer.name, 
      phone: customer.phone, 
      custom_id: customer.custom_id || '',
      card_number: customer.card_number || ''
    });
    setIsEditMode(false);
    setIsModalOpen(true);
  };

  const handleAddCustomer = async () => {
    if (!addCustomerForm.name.trim() || !addCustomerForm.phone.trim()) {
      alert("يرجى ملء الاسم ورقم الهاتف");
      return;
    }

    try {
      const result = await addCustomer({
        name: addCustomerForm.name,
        phone: addCustomerForm.phone,
        card_number: addCustomerForm.card_number || undefined,
      });

      if (result) {
        alert("تم إضافة العميل بنجاح");
        setAddCustomerForm({ name: '', phone: '', card_number: '' });
        setIsAddCustomerModalOpen(false);
      } else {
        alert("فشل في إضافة العميل. تحقق من البيانات");
      }
    } catch (e: any) {
      alert("خطأ: " + (e.message || "فشل في إضافة العميل"));
    }
  };

  const handleUpdateCustomer = async () => {
    try {
      await updateCustomer(selectedCustomer.id, editForm);
      setSelectedCustomer({ ...selectedCustomer, ...editForm });
      setIsEditMode(false);
      alert("تم تحديث بيانات العميل بنجاح");
    } catch (e: any) {
      alert("خطأ في التحديث: " + e.message);
    }
  };

  const handlePayDebt = async () => {
    const split = formToSplit(paymentForm);
    const totalPaid = sumSplit(split);

    if (totalPaid <= 0) return alert("يرجى إدخال مبلغ التحصيل");

    const primaryMethod = primaryMethod_(split);

    try {
      const invoiceId = await checkout(
        0,
        { name: selectedCustomer.name, phone: selectedCustomer.phone, custom_id: selectedCustomer.custom_id },
        totalPaid,
        'payment',
        primaryMethod,
        split as any
      );
      
      alert("تم تسجيل التحصيل بنجاح");
      
      if (invoiceId) {
        const state = useStore.getState();
        const paymentOrder = state.orders.find(o => o.id === invoiceId);
        if (paymentOrder) printPaymentReceipt(paymentOrder, storeSettings);
      }
      
      setIsPaymentModalOpen(false);
      setPaymentForm({ cash: '', visa: '', wallet: '', instapay: '', note: '' });
      
      // Refresh metrics
      const metrics = getCustomerMetrics(selectedCustomer.id);
      setSelectedCustomer({ ...selectedCustomer, ...metrics });
    } catch (e: any) {
      alert("خطأ في تسجيل التحصيل: " + e.message);
    }
  };

  const handlePrintInvoice = (order: any) => {
    if (order.type === 'payment') {
      printPaymentReceipt(order, storeSettings);
      return;
    }
    
    const printDate = new Date(order.date).toLocaleString('ar-SA');
    
    let itemsHtml = order.items.map((item: any) =>
        `<tr>
          <td style="padding:6px 4px;border-bottom:1px dashed #ddd;font-size:13px;">${escapeHtml(item.name)}${item.returned_quantity > 0 ? ` <span style="color:red;font-size:10px;">(مرتجع: ${item.returned_quantity})</span>` : ''}</td>
          <td style="padding:6px 4px;border-bottom:1px dashed #ddd;text-align:center;font-size:13px;">${item.quantity}</td>
          <td style="padding:6px 4px;border-bottom:1px dashed #ddd;text-align:left;font-size:13px;">${(item.sale_price * item.quantity).toFixed(2)}</td>
        </tr>`
      ).join('');

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <title>فاتورة #${order.id}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;width:320px;margin:0 auto;padding:16px;}
    .header{text-align:center;border-bottom:2px dashed #333;padding-bottom:12px;margin-bottom:12px;}
    .logo{height:64px;width:auto;max-width:260px;object-fit:contain;border-radius:12px;margin-bottom:6px;}
    .store-name{font-size:18px;font-weight:900;margin-bottom:4px;}
    .store-info{font-size:11px;color:#555;line-height:1.7;}
    .invoice-meta{display:flex;justify-content:space-between;font-size:11px;color:#555;margin:8px 0;background:#f5f5f5;padding:6px 8px;border-radius:6px;}
    table{width:100%;border-collapse:collapse;}
    thead th{font-size:12px;color:#888;padding:4px;border-bottom:2px solid #eee;text-align:right;}
    thead th:last-child{text-align:left;}
    .totals{margin-top:10px;border-top:2px dashed #333;padding-top:10px;}
    .total-row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;}
    .grand-total{font-size:17px;font-weight:900;border-top:1px solid #ddd;margin-top:6px;padding-top:8px;}
    .footer{text-align:center;margin-top:16px;font-size:12px;color:#888;}
    @media print{@page{margin:4mm;size:80mm auto;}}
  </style>
</head>
<body>
  <div class="header">
    <img class="logo" src="${escapeHtml(storeSettings.logo)}" onerror="this.style.display='none'" />
    <div class="store-name">${escapeHtml(storeSettings.name)}</div>
  </div>
  <div class="invoice-meta">
    <span>رقم: <strong>${order.id}</strong></span>
    <span>ID العميل: <strong>${escapeHtml(order.customer?.custom_id || order.customer?.id.substring(0, 8) || '—')}</strong></span>
    <span>${printDate}</span>
  </div>
  <table>
    <thead><tr><th>الصنف</th><th style="text-align:center">كمية</th><th style="text-align:left">إجمالي</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="totals">
    <div class="total-row grand-total"><span>الإجمالي الأصلي:</span><span>${order.total.toFixed(2)}</span></div>
    ${(() => {
      const returnedValue = order.items.reduce((sum: number, item: any) => sum + ((item.returned_quantity || 0) * (item.sale_price || 0)), 0);
      if (returnedValue > 0) {
        const refundedCash = order.items.reduce((sum: number, item: any) => sum + (item.refunded_amount || 0), 0);
        const debtDeduction = Math.max(0, returnedValue - refundedCash);
        return `
          <div class="total-row" style="color:#dc2626;font-weight:bold;font-size:12px;"><span>إجمالي المرتجعات:</span><span>- ${returnedValue.toFixed(2)}</span></div>
          ${refundedCash > 0 ? `<div class="total-row" style="color:#ef4444;font-size:11px;"><span>مرتجع كاش نقدي:</span><span>${refundedCash.toFixed(2)}</span></div>` : ''}
          ${debtDeduction > 0 ? `<div class="total-row" style="color:#ef4444;font-size:11px;"><span>مرتجع (خصم من المديونية):</span><span>${debtDeduction.toFixed(2)}</span></div>` : ''}
          <div class="total-row" style="font-weight:bold;margin-top:4px;border-top:1px dashed #ccc;padding-top:4px;"><span>الإجمالي بعد المرتجع:</span><span>${Math.max(0, order.total - returnedValue).toFixed(2)}</span></div>
        `;
      }
      return '';
    })()}
    <div class="total-row" style="margin-top:6px;font-weight:bold;"><span>إجمالي المدفوع:</span><span>${order.paid_amount.toFixed(2)}</span></div>
  </div>

  ${order.notes ? `
    <div style="margin-top:12px; padding:8px; background:#fff7ed; border-radius:6px; border:1px solid #ffedd5; font-size:12px;">
      <strong style="color:#c2410c; display:block; margin-bottom:4px; font-size:11px;">ملاحظات:</strong>
      <span style="color:#9a3412;">${escapeHtml(order.notes)}</span>
    </div>
  ` : ''}

  <div class="footer">شكراً لزيارتكم</div>
  <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;

    openPrintWindow(html, 'width=400,height=600');
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap gap-3 justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-800 flex items-center gap-3">
            <User style={{ color: storeSettings.themeColor }} size={32} />
            قاعدة العملاء
          </h1>
          <p className="text-slate-500 mt-2 font-medium">إدارة بيانات العملاء، سجل المشتريات، والمديونيات المعلقة</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsAddCustomerModalOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg hover:shadow-indigo-200"
          >
            <User size={18} /> إضافة عميل جديد
          </button>
          <button 
            onClick={exportExcel}
            className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg hover:shadow-emerald-200"
          >
            <TableIcon size={18} /> Excel
          </button>
          <button 
            onClick={exportPDF}
            className="flex items-center gap-2 bg-red-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-red-700 transition shadow-lg hover:shadow-red-200"
          >
            <FileText size={18} /> PDF
          </button>
        </div>
      </div>

      <div id="customers-table" className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-[500px]">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-wrap gap-3 items-center justify-between">
          <div className="relative w-full md:w-1/3 md:min-w-[350px]">
            <Search className="absolute right-4 top-3 text-slate-400" size={20} />
            <input
              type="text"
              placeholder="ابحث باسم العميل، رقم الهاتف، أو الـ ID..."
              style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
              className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pr-12 pl-4 text-sm focus:outline-none focus:ring-2 shadow-sm transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div 
            style={{ backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor, borderColor: storeSettings.themeColor + '30' }}
            className="text-sm font-bold border px-4 py-2 rounded-xl"
          >
            إجمالي العملاء: {filteredCustomers.length} عميل
          </div>
        </div>

        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider">
              <tr>
                <th className="p-5">العميل</th>
                <th className="p-5">رقم الهاتف</th>
                <th className="p-5 text-center">الطلبات</th>
                <th className="p-5 text-center">صافي المشتريات</th>
                <th className="p-5 text-center">المرتجعات</th>
                <th className="p-5 text-center">المديونية</th>
                <th className="p-5 text-center">تاريخ التسجيل</th>
                <th className="p-5 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-20 text-center text-slate-400">
                    <User size={64} className="mx-auto mb-4 opacity-20" />
                    <p className="text-xl font-bold">لا يوجد عملاء مسجلين حالياً</p>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => {
                  const { activeCustomerOrders, totalSpent, totalDebt, totalReturns } = getCustomerMetrics(customer.id);
                  return (
                    <tr key={customer.id} className="hover:bg-slate-50/50 transition">
                      <td className="p-5">
                        <div className="flex items-center gap-3">
                          <div 
                            style={{ backgroundColor: storeSettings.themeColor + '20', color: storeSettings.themeColor }}
                            className="w-10 h-10 rounded-full flex items-center justify-center font-black text-lg"
                          >
                            {customer.name.charAt(0)}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-black text-slate-800">{customer.name}</span>
                            <span className="text-[10px] text-indigo-600 font-black font-mono">ID: {customer.custom_id || customer.id.substring(0, 8)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-5 font-mono font-bold text-slate-500" dir="ltr">{customer.phone}</td>
                      <td className="p-5 text-center">
                        <span style={{ backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor }} className="px-3 py-1.5 rounded-lg font-bold">
                          {activeCustomerOrders.length} طلب
                        </span>
                      </td>
                      <td className="p-5 text-center font-black text-slate-900">
                        {totalSpent.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">{storeSettings.currency}</span>
                      </td>
                      <td className="p-5 text-center font-bold text-orange-600">
                        {totalReturns > 0 ? `${totalReturns.toLocaleString()} ${storeSettings.currency}` : '-'}
                      </td>
                      <td className="p-5 text-center">
                        {totalDebt > 0 ? (
                          <span className="bg-red-50 text-red-600 px-3 py-1.5 rounded-xl font-black border border-red-100">
                            {totalDebt.toLocaleString()} <span className="text-[10px] font-normal">{storeSettings.currency}</span>
                          </span>
                        ) : (
                          <span className="text-emerald-500 font-bold">خالص</span>
                        )}
                      </td>
                      <td className="p-5 text-center text-slate-500 font-medium">
                        {new Date(customer.timestamp).toLocaleDateString('ar-SA')}
                      </td>
                      <td className="p-5 text-left">
                        <button 
                          onClick={() => handleOpenProfile(customer)}
                          style={{ backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor }}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold hover:bg-opacity-25 transition-all shadow-sm"
                        >
                          <Eye size={16} /> ملف العميل
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Profile Modal */}
      {isModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div id="customer-profile-modal" className="bg-white rounded-[40px] shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300">
            {/* Modal Header */}
            <div className="p-8 flex justify-between items-center border-b border-slate-100 relative overflow-hidden bg-white">
               <div 
                className="absolute top-0 right-0 w-32 h-32 opacity-5 pointer-events-none"
                style={{ backgroundColor: storeSettings.themeColor, borderRadius: '0 0 0 100%' }}
              />
              <div className="flex gap-4 items-center">
                <div 
                  style={{ backgroundColor: storeSettings.themeColor, boxShadow: `0 8px 16px ${storeSettings.themeColor}30` }}
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-black shrink-0"
                >
                  {selectedCustomer.name.charAt(0)}
                </div>
                
                <div className="flex items-center gap-4 flex-wrap">
                  {isEditMode ? (
                    <div className="flex flex-col gap-2">
                      <input 
                        className="text-xl font-black text-slate-800 border-b-2 border-indigo-500 focus:outline-none"
                        value={editForm.name}
                        onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                      />
                      <div className="flex gap-4">
                         <input 
                          className="bg-slate-100 px-2 py-1 rounded-lg text-slate-600 font-bold focus:outline-none text-sm"
                          placeholder="رقم الهاتف"
                          value={editForm.phone}
                          onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                        />
                        <input 
                          placeholder="رقم الكارت"
                          className="bg-slate-100 px-2 py-1 rounded-lg text-slate-600 font-mono font-bold border border-slate-200 focus:outline-none text-sm"
                          value={editForm.card_number}
                          onChange={e => setEditForm({ ...editForm, card_number: e.target.value })}
                        />
                        <input 
                          placeholder="رقم العميل ID"
                          className="bg-indigo-50 px-2 py-1 rounded-lg text-indigo-600 font-mono font-black border border-indigo-200 focus:outline-none text-sm"
                          value={editForm.custom_id}
                          onChange={e => setEditForm({ ...editForm, custom_id: e.target.value })}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row md:items-center gap-x-4 gap-y-1">
                      <h2 className="text-xl font-black text-slate-800 whitespace-nowrap">{selectedCustomer.name}</h2>
                      <div className="hidden md:block w-px h-4 bg-slate-200" />
                      <div className="flex items-center gap-3 text-slate-500 font-bold text-xs flex-wrap">
                        <span className="flex items-center gap-1"><CreditCard size={12} /> {selectedCustomer.phone}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300" />
                        {selectedCustomer.card_number && (
                          <>
                            <span className="bg-purple-50 px-2 py-0.5 rounded-lg text-purple-600 font-mono font-black border border-purple-100 text-[10px]">Card: {selectedCustomer.card_number}</span>
                            <span className="w-1 h-1 rounded-full bg-slate-300" />
                          </>
                        )}
                        <span className="bg-indigo-50 px-2 py-0.5 rounded-lg text-indigo-600 font-mono font-black border border-indigo-100 text-[10px]">ID: {selectedCustomer.custom_id || selectedCustomer.id.substring(0, 8)}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300" />
                        <span className="text-[10px] whitespace-nowrap">سجل منذ: {new Date(selectedCustomer.timestamp).toLocaleDateString('ar-SA')}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 items-center">
                {isEditMode ? (
                  <>
                    <button 
                      onClick={() => setIsEditMode(false)}
                      className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold hover:bg-slate-200 transition text-sm"
                    >
                      إلغاء
                    </button>
                    <button 
                      onClick={handleUpdateCustomer}
                      className="bg-emerald-600 text-white flex items-center gap-2 px-4 py-2 rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg shadow-emerald-100 text-sm"
                    >
                      حفظ التعديلات
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => setIsEditMode(true)}
                      className="bg-slate-800 text-white flex items-center gap-2 px-4 py-2 rounded-xl font-bold hover:bg-black transition shadow-lg text-sm"
                    >
                      تعديل البيانات
                    </button>
                    <button 
                      onClick={exportCustomerStatementPDF}
                      className="bg-indigo-600 text-white flex items-center gap-2 px-4 py-2 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 text-sm"
                    >
                      <FileText size={16} /> تحميل بيان حساب
                    </button>
                  </>
                )}
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="bg-slate-100 text-slate-400 hover:text-slate-600 p-2 rounded-xl transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <TrendingUp size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 mb-0.5">صافي المشتريات</p>
                    <p className="text-lg font-black text-slate-800">{selectedCustomer.totalSpent.toLocaleString()} {storeSettings.currency}</p>
                  </div>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center">
                    <ArrowRightLeft size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 mb-0.5">إجمالي المرتجعات</p>
                    <p className="text-lg font-black text-orange-600">{selectedCustomer.totalReturns.toLocaleString()} {storeSettings.currency}</p>
                  </div>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Wallet size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 mb-0.5">صافي الربح</p>
                    <p className="text-lg font-black text-emerald-600">{selectedCustomer.totalProfit.toLocaleString()} {storeSettings.currency}</p>
                  </div>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
                    <CreditCard size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 mb-0.5">المديونية الحالية</p>
                    <p className={`text-lg font-black ${selectedCustomer.totalDebt <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {selectedCustomer.totalDebt.toLocaleString()} {storeSettings.currency}
                    </p>
                  </div>
                  {selectedCustomer.totalDebt > 0 && (
                    <button 
                      onClick={() => setIsPaymentModalOpen(true)}
                      className="mr-auto bg-red-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg shadow-red-100 hover:bg-red-700 transition"
                    >
                      تحصيل آجل
                    </button>
                  )}
                </div>
              </div>

              {/* PAYMENT SUB-MODAL */}
              {isPaymentModalOpen && (
                <div className="mb-8 bg-white p-6 rounded-[32px] border-2 border-indigo-500 shadow-xl animate-in slide-in-from-top-4 duration-300">
                  <div className="flex justify-between items-center mb-6">
                    <h4 className="text-xl font-black text-slate-800 flex items-center gap-2">
                      <Wallet className="text-indigo-600" size={24} />
                      تحصيل آجل
                    </h4>
                    <button onClick={() => setIsPaymentModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                      <X size={20} />
                    </button>
                  </div>

                  <div className="mb-6">
                    <PaymentSplitInputs
                      value={paymentForm}
                      onChange={(k, v) => setPaymentForm({ ...paymentForm, [k]: v })}
                      labelClassName="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider text-right"
                      inputClassName="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:ring-1 focus:outline-none font-bold text-right"
                    />
                  </div>

                  <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-400">إجمالي المبلغ المدفوع</span>
                      <span className="text-2xl font-black text-indigo-600">
                        {sumSplit(formToSplit(paymentForm)).toLocaleString()} {storeSettings.currency}
                      </span>
                    </div>
                    <button 
                      onClick={handlePayDebt}
                      className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-black shadow-lg hover:bg-indigo-700 transition flex items-center gap-2"
                    >
                      تأكيد التحصيل
                    </button>
                  </div>
                </div>
              )}

              {/* Orders History Table */}
              {profileTab === 'orders' && (
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-50 flex items-center gap-2">
                    <FileText className="text-slate-400" size={18} />
                    <h3 className="font-black text-slate-800">سجل الطلبات والفواتير</h3>
                  </div>
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-bold">
                    <tr>
                      <th className="p-4">رقم الفاتورة</th>
                      <th className="p-4">التاريخ</th>
                      <th className="p-4">النوع</th>
                      <th className="p-4 text-center">صافي الفاتورة</th>
                      <th className="p-4 text-center">المدفوع</th>
                      <th className="p-4 text-center">الحالة</th>
                      <th className="p-4 text-left">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-slate-600">
                    {selectedCustomer.customerOrders.length === 0 ? (
                      <tr><td colSpan={7} className="p-10 text-center text-slate-400 font-bold">لا يوجد فواتير سابقة لهذا العميل</td></tr>
                    ) : (
                      selectedCustomer.customerOrders.map((order: any) => {
                        const returnedValue = order.is_deleted ? 0 : calculateOrderReturnValue(order);
                        const netTotal = order.is_deleted ? 0 : order.total - returnedValue;
                        // Debt is based on the original invoice total vs paid — returns are cash refunds, NOT debt reductions
                        const rowDebt = order.is_deleted ? 0 : order.total - order.paid_amount;
                        const isDebt = rowDebt > 0;
                        const isPayment = order.type === 'payment';
                        
                        return (
                          <tr key={order.id} className="hover:bg-slate-50 transition">
                            <td className="p-4 font-mono font-bold text-slate-800">#{order.id}</td>
                            <td className="p-4 text-xs font-medium">{new Date(order.date).toLocaleDateString('ar-SA')}</td>
                            <td className="p-4">
                              {order.is_deleted ? (
                                <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1">
                                  <Archive size={12} /> فاتورة محذوفة
                                </span>
                              ) : isPayment ? (
                                <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-bold">تحصيل آجل</span>
                              ) : (
                                <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-bold">فاتورة بيع</span>
                              )}
                            </td>
                            <td className="p-4 text-center font-bold text-slate-900">{netTotal.toLocaleString()}</td>
                            <td className="p-4 text-center font-bold text-emerald-600">{order.paid_amount.toLocaleString()}</td>
                            <td className="p-4 text-center">
                              {order.is_deleted ? (
                                <span className="text-red-500 text-[10px] font-bold">محذوفة</span>
                              ) : isPayment ? (
                                <span className="text-indigo-500 text-[10px] font-bold">مكتمل</span>
                              ) : isDebt ? (
                                <span className="text-red-500 text-[10px] font-bold">
                                  غير مكتملة
                                </span>
                              ) : rowDebt < 0 ? (
                                <span className="text-emerald-600 text-[10px] font-bold">رصيد متبقي</span>
                              ) : (
                                <span className="text-emerald-500 text-[10px] font-bold">مدفوعة بالكامل</span>
                              )}
                            </td>
                            <td className="p-4 text-left">
                              <button 
                                onClick={() => handlePrintInvoice(order)}
                                style={{ color: storeSettings.themeColor }}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                title="طباعة"
                              >
                                <Printer size={16} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {isAddCustomerModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-300">
            {/* Modal Header */}
            <div className="p-8 border-b border-slate-100 flex justify-between items-center relative overflow-hidden">
              <div 
                className="absolute top-0 right-0 w-24 h-24 opacity-5 pointer-events-none"
                style={{ backgroundColor: storeSettings.themeColor, borderRadius: '0 0 0 100%' }}
              />
              <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                <div 
                  style={{ backgroundColor: storeSettings.themeColor + '20' }}
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                >
                  <User size={20} style={{ color: storeSettings.themeColor }} />
                </div>
                إضافة عميل جديد
              </h2>
              <button 
                onClick={() => setIsAddCustomerModalOpen(false)}
                className="bg-slate-100 text-slate-400 hover:text-slate-600 p-2 rounded-xl transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-8 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">اسم العميل *</label>
                <input 
                  type="text"
                  placeholder="أدخل اسم العميل"
                  value={addCustomerForm.name}
                  onChange={(e) => setAddCustomerForm({ ...addCustomerForm, name: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 transition-all"
                  style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">رقم الهاتف *</label>
                <input 
                  type="tel"
                  placeholder="أدخل رقم الهاتف"
                  value={addCustomerForm.phone}
                  onChange={(e) => setAddCustomerForm({ ...addCustomerForm, phone: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 transition-all font-mono"
                  style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">رقم الكارت</label>
                <input 
                  type="text"
                  placeholder="أدخل رقم الكارت (اختياري)"
                  value={addCustomerForm.card_number}
                  onChange={(e) => setAddCustomerForm({ ...addCustomerForm, card_number: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 transition-all font-mono"
                  style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                  dir="ltr"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-8 border-t border-slate-100 flex gap-3 justify-end">
              <button 
                onClick={() => setIsAddCustomerModalOpen(false)}
                className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
              <button 
                onClick={handleAddCustomer}
                style={{ backgroundColor: storeSettings.themeColor, boxShadow: `0 8px 16px ${storeSettings.themeColor}30` }}
                className="px-6 py-2.5 rounded-xl font-bold text-white hover:opacity-90 transition flex items-center gap-2"
              >
                <User size={16} /> إضافة العميل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
