import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { BookUser, CreditCard, Search, Banknote, X, FileText, Table as TableIcon, Plus, User, UserPlus, Truck, RefreshCw, Eye } from 'lucide-react';
import { normalizeArabic } from '../../utils/textUtils';
import { calculateOrderReturnValue } from '../../utils/returns';
import { escapeHtml } from '../../utils/escapeHtml';
import { openPrintWindow } from '../../utils/printWindow';
import * as XLSX from 'xlsx';

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { printPaymentReceipt } from '../../utils/printPaymentReceipt';
import { printMaintenanceInvoice } from '../../utils/printMaintenanceInvoice';
import PaymentSplitInputs from '../../components/PaymentSplitInputs';
import { formToSplit, sumSplit, activePaymentKeys, primaryMethod as primaryMethod_ } from '../../utils/paymentMethods';

export default function DeferredAccounts() {
  const { customers, orders, suppliers, purchaseInvoices, storeSettings, checkout, payInvoiceDebt, addPurchaseInvoice, addSupplier, carSubscriptions } = useStore();
  const activeOrders = orders.filter((order) => !order.is_deleted);
  
  const [activeTab, setActiveTab] = useState<'customers' | 'suppliers'>('customers');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [debtLoading, setDebtLoading] = useState(true);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<any>(null); // Customer or Supplier
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [paymentForm, setPaymentForm] = useState({
    cash: '',
    visa: '',
    wallet: '',
    instapay: '',
    discount: ''
  });

  useEffect(() => {
    if (selectedEntity) {
      setPaymentForm({
        cash: selectedInvoice ? selectedInvoice.current_debt.toString() : selectedEntity.totalDebt.toString(),
        visa: '',
        wallet: '',
        instapay: '',
        discount: ''
      });
    }
  }, [selectedInvoice, selectedEntity]);

  // Add previous debt state
  const [isAddDebtOpen, setIsAddDebtOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileCustomer, setProfileCustomer] = useState<any>(null);
  const [addDebtSearch, setAddDebtSearch] = useState('');
  const [selectedAddDebtEntity, setSelectedAddDebtEntity] = useState<any>(null);
  const [addDebtAmount, setAddDebtAmount] = useState<string>('');
  const [addDebtNotes, setAddDebtNotes] = useState<string>('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // --- Customers Logic (جلب مباشر من Supabase بدون قيود الـ 200 فاتورة) ---
  const filteredSearchCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(addDebtSearch.toLowerCase()) || 
    c.phone.includes(addDebtSearch)
  ).slice(0, 5);

  const [customersWithDebt, setCustomersWithDebt] = useState<any[]>([]);

  const loadCustomerDebts = async () => {
    setDebtLoading(true);
    try {
      const { supabase } = await import('../../lib/supabase');
      const { data: ordersData, error } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .not('customer_id', 'is', null)
        .eq('is_deleted', false);

      if (error) throw error;

      // Include offline orders that haven't synced yet
      const offlineOrders = activeOrders.filter(o => o.customer && String(o.id).startsWith('OFF-'));
      const combinedOrders = [...(ordersData ?? []), ...offlineOrders];

      const debtMap: Record<string, { total: number; orders: any[] }> = {};
      for (const o of combinedOrders) {
        // Handle both populated customer object and raw ID
        const cid = (typeof o.customer_id === 'string' ? o.customer_id : o.customer?.id) as string;
        if (!cid) continue;
        if (!debtMap[cid]) debtMap[cid] = { total: 0, orders: [] };
        const returnedValue = calculateOrderReturnValue({ ...o, items: o.order_items });
        const effectiveTotal = o.type === 'payment' ? 0 : (o.total as number) - returnedValue;
        const debt = effectiveTotal - (o.paid_amount as number);
        if (debt > 0.009) {
          debtMap[cid].total += debt;
          debtMap[cid].orders.push({ ...o, current_debt: debt });
        } else if (o.type === 'payment' && !(o.notes && o.notes.includes('سداد أجل للفاتورة رقم'))) {
          // Subtract global payments (debt is negative)
          debtMap[cid].total += debt;
        }
      }

      const result = customers
        .map(c => ({
          ...c,
          totalDebt: Math.max(0, debtMap[c.id]?.total ?? 0),
          orders: debtMap[c.id]?.orders ?? []
        }))
        .filter(c => c.totalDebt > 0.009)
        .sort((a, b) => b.totalDebt - a.totalDebt);

      setCustomersWithDebt(result);
    } catch (err) {
      console.error('Failed to load customer debts:', err);
      // Fallback للـ store المحلي
      const fallback = customers.map(c => {
        const customerOrders = activeOrders.filter(o => o.customer?.id === c.id);
        const totalDebt = Math.max(0, customerOrders.reduce((sum, o) => {
          if (o.type === 'payment' && o.notes?.includes('سداد أجل للفاتورة رقم')) {
            return sum;
          }
          const returnedValue = calculateOrderReturnValue(o);
          const effectiveTotal = o.type === 'payment' ? 0 : o.total - returnedValue;
          return sum + (effectiveTotal - o.paid_amount);
        }, 0));
        return { ...c, totalDebt, orderIds: [], orders: customerOrders.filter(o => o.total - o.paid_amount - calculateOrderReturnValue(o) > 0) };
      }).filter(c => c.totalDebt > 0).sort((a, b) => b.totalDebt - a.totalDebt);
      setCustomersWithDebt(fallback);
    } finally {
      setDebtLoading(false);
    }
  };

  useEffect(() => {
    if (customers.length > 0) loadCustomerDebts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, activeOrders.length]);

  // --- Suppliers Logic ---
  const filteredSearchSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(addDebtSearch.toLowerCase()) || 
    (s.phone && s.phone.includes(addDebtSearch))
  ).slice(0, 5);

  const suppliersWithDebt = suppliers.map(s => {
    const supplierInvoices = purchaseInvoices.filter(inv => inv.supplier_id === s.id);
    const totalDebt = Math.max(0, supplierInvoices.reduce((sum, inv) => sum + (inv.total - inv.paid_amount), 0));
    return { ...s, totalDebt, invoices: supplierInvoices.filter(inv => inv.total - inv.paid_amount > 0) };
  }).filter(s => s.totalDebt > 0).sort((a, b) => b.totalDebt - a.totalDebt);

  // Filtered lists for table
  const displayList = activeTab === 'customers' 
    ? customersWithDebt.filter(c => normalizeArabic(c.name).includes(normalizeArabic(searchQuery)) || c.phone.includes(searchQuery))
    : suppliersWithDebt.filter(s => normalizeArabic(s.name).includes(normalizeArabic(searchQuery)) || (s.phone && s.phone.includes(searchQuery)));

  const profileData = useMemo(() => {
    if (!profileCustomer) return null;
    
    const sales = activeOrders.filter(o => 
      o.customer?.id === profileCustomer.id && 
      (o.type === 'sale' || o.type === 'previous_debt')
    );
    
    const payments = activeOrders.filter(o => 
      o.customer?.id === profileCustomer.id && 
      o.type === 'payment'
    );
    
    const invoicePayments = new Map();
    payments.forEach(p => {
      if (p.notes) {
        const match = p.notes.match(/سداد أجل للفاتورة رقم #([\w-]+)/);
        if (match && match[1]) {
          const invId = match[1];
          if (!invoicePayments.has(invId)) invoicePayments.set(invId, []);
          invoicePayments.get(invId).push(p);
        }
      }
    });

    const invoices = sales.map(o => {
      const returnedValue = calculateOrderReturnValue(o);
      const effectiveTotal = o.total - returnedValue;
      const currentDebt = Math.max(0, effectiveTotal - (o.paid_amount || 0));
      const hasHistory = invoicePayments.has(o.id) || currentDebt > 0.009 || (o.discount_amount || 0) > 0;
      
      return {
        ...o,
        effectiveTotal,
        currentDebt,
        current_debt: currentDebt,
        hasHistory,
        paymentsList: invoicePayments.get(o.id) || []
      };
    }).filter(inv => inv.hasHistory || inv.type === 'previous_debt');

    const totalHistoricalDebt = invoices.reduce((sum, inv) => sum + inv.effectiveTotal, 0);
    const totalCurrentDebt = invoices.reduce((sum, inv) => sum + inv.currentDebt, 0);
    const totalPaidDebt = totalHistoricalDebt - totalCurrentDebt;
    const totalDiscounts = invoices.reduce((sum, inv) => sum + (inv.discount_amount || 0), 0);

    return {
      invoices,
      payments,
      totalHistoricalDebt,
      totalCurrentDebt,
      totalPaidDebt,
      totalDiscounts
    };
  }, [profileCustomer, activeOrders]);

  const handleOpenAddDebtModal = () => {
    setSelectedAddDebtEntity(null);
    setAddDebtAmount('');
    setAddDebtSearch('');
    setAddDebtNotes('');
    setIsAddDebtOpen(true);
  };

  const handleProcessAddDebt = async () => {
    const amount = parseFloat(addDebtAmount);
    if (!amount || amount <= 0) {
      alert('الرجاء إدخال مبلغ صحيح أكبر من الصفر');
      return;
    }

    if (activeTab === 'customers') {
      if (!selectedAddDebtEntity && !addDebtSearch.trim()) {
        alert('الرجاء اختيار العميل أولاً');
        return;
      }
      try {
        const invoiceId = await checkout(
          amount, 
          selectedAddDebtEntity ? { name: selectedAddDebtEntity.name, phone: selectedAddDebtEntity.phone, custom_id: selectedAddDebtEntity.custom_id } : { name: addDebtSearch, phone: '' }, 
          0, 
          'previous_debt' as any, // Using previous_debt type if supported, or sale
          'cash',
          undefined,
          undefined,
          addDebtNotes || 'مديونية سابقة'
        );
        alert(`تم إضافة مديونية العميل السابقة بنجاح!\nرقم الفاتورة: ${invoiceId}`);
      } catch (e: any) {
        alert('حدث خطأ أثناء إضافة مديونية العميل السابقة');
        return;
      }
    } else {
      // Supplier
      if (!selectedAddDebtEntity && !addDebtSearch.trim()) {
        alert('الرجاء اختيار المورد أولاً');
        return;
      }
      try {
        let supplierId = selectedAddDebtEntity?.id;
        if (!supplierId) {
          const newSup = await addSupplier({ name: addDebtSearch, phone: '', address: '' });
          if (!newSup) throw new Error('Failed to create supplier');
          supplierId = newSup.id;
        }
        
        const invoiceNum = `PREV-DEBT-${Date.now()}`;
        await addPurchaseInvoice({
          invoice_number: invoiceNum,
          supplier_id: supplierId,
          total: amount,
          paid_amount: 0,
          payment_method: 'cash',
          notes: addDebtNotes || 'مستحقات سابقة'
        }, []);
        alert(`تم إضافة مستحقات المورد السابقة بنجاح!\nرقم الفاتورة: ${invoiceNum}`);
      } catch (e: any) {
        alert('حدث خطأ أثناء إضافة مستحقات المورد السابقة');
        return;
      }
    }

    setIsAddDebtOpen(false);
    setSelectedAddDebtEntity(null);
    setAddDebtAmount('');
    setAddDebtSearch('');
  };

  const exportExcel = () => {
    const wsData = [
      [`تقرير حسابات الآجل - ${activeTab === 'customers' ? 'مديونية العملاء' : 'مستحقات الموردين'}`, '', '', ''],
      ['التاريخ', new Date().toLocaleDateString(), '', ''],
      [''],
      ['الاسم', 'رقم الهاتف', activeTab === 'customers' ? 'مديونية العميل' : 'مستحقات المورد', activeTab === 'customers' ? 'عدد الفواتير' : 'عدد فواتير الشراء'],
      ...displayList.map((item: any) => [
        item.name,
        item.phone || '—',
        item.totalDebt,
        activeTab === 'customers' ? item.orders.length : item.invoices.length
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Debts');
    XLSX.writeFile(wb, `deferred_accounts_${activeTab}_${new Date().toLocaleDateString()}.xlsx`);
  };

  const exportPDF = async () => {
    const element = document.getElementById('deferred-table');
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
          const el = clonedDoc.getElementById('deferred-table');
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
      
      pdf.save(`deferred_accounts_report_${activeTab}_${new Date().toLocaleDateString()}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
      alert('حدث خطأ أثناء تصدير ملف PDF');
    } finally {
      setLoading(false);
    }
  };

  const handlePrintInvoice = (order: any) => {
    const isMaintenance = order.type === 'sale' && (
      (order.notes && order.notes.includes('[زيارة:')) ||
      (order.items && order.items.some((i: any) => i.id?.startsWith('maint-')))
    );

    if (isMaintenance) {
      const car = carSubscriptions.find((c: any) => c.id === order.car_id) || 
                  carSubscriptions.find((c: any) => c.customer_name === profileCustomer?.name || c.customer_phone === profileCustomer?.phone);
      
      const carInfo = car || {
        car_number: '—',
        car_details: '—',
        customer_name: profileCustomer?.name || '—',
        customer_phone: profileCustomer?.phone || '—'
      };

      printMaintenanceInvoice(order, {
        carNumber: carInfo.car_number,
        carDetails: carInfo.car_details,
        customerName: carInfo.customer_name,
        customerPhone: carInfo.customer_phone
      }, storeSettings);
      return;
    }

    const printDate = new Date(order.created_at || Date.now()).toLocaleString('ar-EG', { calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const isPayment = order.type === 'payment';
    const subtotal = isPayment ? order.total : (order.items || []).reduce((sum: number, item: any) => sum + (item.sale_price * item.quantity), 0);
    const taxValue = isPayment ? 0 : Math.max(0, order.total - (subtotal - (order.discount || 0)));
    
    let debtAfter = 0;
    if ((order.customer || profileCustomer) && !order.is_deleted) {
      const customerOrders = activeOrders.filter(o => o.customer?.id === (order.customer?.id || profileCustomer?.id));
      const sortedOrders = [...customerOrders].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const currentIndex = sortedOrders.findIndex(o => o.id === order.id);
      
      const calcDebt = (upToIndex: number) => sortedOrders.slice(0, upToIndex).reduce((sum, o) => {
        const returnedValue = calculateOrderReturnValue(o);
        const effectiveTotal = o.type === 'payment' ? 0 : (o.total - returnedValue);
        const debt = effectiveTotal - (o.paid_amount || 0);

        if (debt > 0.009 && o.type !== 'payment') {
          return sum + debt;
        } else if (o.type === 'payment' && !(o.notes && o.notes.includes('سداد أجل للفاتورة رقم'))) {
          return sum + debt;
        }
        return sum;
      }, 0);

      debtAfter = calcDebt(currentIndex + 1);
    }

    const cart = isPayment 
      ? [{name: order.notes || 'سداد مديونية سابقة', quantity: 1, sale_price: order.paid_amount}] 
      : (order.items || []);

    const itemsHtml = cart.map((item: any, index: number) =>
      `<tr>
        <td style="padding:10px 4px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:#666;">${index + 1}</td>
        <td style="padding:10px 4px;border-bottom:1px solid #eee;font-weight:900;font-size:14px;">${escapeHtml(item.name)}${item.returned_quantity > 0 ? ` <span style="color:red;font-size:10px;">(مرتجع: ${item.returned_quantity})</span>` : ''}</td>
        <td style="padding:10px 4px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;">${item.quantity}</td>
        <td style="padding:10px 4px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;">${item.sale_price.toFixed(2)}</td>
        <td style="padding:10px 4px;border-bottom:1px solid #eee;text-align:left;font-weight:black;font-size:15px;">${(item.sale_price * item.quantity).toFixed(2)}</td>
      </tr>`
    ).join('');

    const invoiceUrl = `${window.location.origin}/view-invoice/${order.id}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(invoiceUrl)}`;

    const customerBlock = order.customer || profileCustomer
      ? `<div class="customer-info-grid">
            <div class="info-item"><strong>اسم العميل:</strong> <span>${escapeHtml((order.customer || profileCustomer).name || '—')}</span></div>
            <div class="info-item"><strong>رقم الهاتف:</strong> <span dir="ltr">${escapeHtml((order.customer || profileCustomer).phone || '—')}</span></div>
            <div class="info-item"><strong>رقم الكارت (ID):</strong> <span dir="ltr">${escapeHtml((order.customer || profileCustomer).custom_id || (order.customer || profileCustomer).id.substring(0, 8) || '—')}</span></div>
            <div class="info-item"><strong>رقم الفاتورة:</strong> <span>#${order.id}</span></div>
            <div class="info-item"><strong>المسؤول:</strong> <span>${escapeHtml(order.cashier_name || '—')}</span></div>
            <div class="info-item"><strong>التاريخ:</strong> <span>${printDate}</span></div>
            <div class="info-item" style="grid-column: span 2; border-top: 1px dashed #e2e8f0; padding-top: 4px; margin-top: 2px;">
              <strong>إجمالي المديونية الحالية:</strong> 
              <span style="color: #dc2626; font-size: 14px;">${(debtAfter || 0).toFixed(2)} ${storeSettings.currency}</span>
            </div>
         </div>`
      : `<div class="customer-info-grid">
            <div class="info-item"><strong>اسم العميل:</strong> <span>عميل نقدي</span></div>
            <div class="info-item"><strong>رقم الفاتورة:</strong> <span>#${order.id}</span></div>
            <div class="info-item"><strong>المسؤول:</strong> <span>${escapeHtml(order.cashier_name || '—')}</span></div>
            <div class="info-item"><strong>التاريخ:</strong> <span>${printDate}</span></div>
         </div>`;

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>فاتورة بيع #${order.id}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo', sans-serif;}
  body{background:#fff;color:#1e293b;padding:0;margin:0;}
  .invoice-container{width:148mm;min-height:100mm;margin:0 auto;padding:5mm;position:relative;display:flex;flex-direction:column;gap:5px;}
  
  .header-main{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1e293b;padding-bottom:5px;margin-bottom:5px;}
  .logo{height:64px;width:auto;max-width:260px;object-fit:contain;border-radius:12px;border:1px solid #e2e8f0;padding:2px;background:#fff;}
  .store-name{font-size:24px;font-weight:900;color:#1e293b;line-height:1.2;}
  .store-details{font-size:10px;color:#64748b;margin-top:3px;line-height:1.3;font-weight:bold;}
  .store-info-center{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 10px;}
  
  .customer-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px;background:#f8fafc;padding:8px;border-radius:10px;border:1px solid #e2e8f0;}
  .info-item{font-size:12px;display:flex;gap:6px;}
  .info-item strong{color:#64748b;white-space:nowrap;}
  .info-item span{color:#1e293b;font-weight:700;}
  
  .qr-code-container{display:flex;flex-direction:column;align-items:center;gap:3px;}
  .qr-code-img{width:80px;height:80px;padding:3px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;box-shadow: 0 1px 3px rgba(0,0,0,0.1);}
  .qr-label{font-size:10px;font-weight:900;color:#1e293b;text-align:center;margin-top:2px;background:#f1f5f9;padding:2px 8px;border-radius:4px;}

  table{width:100%;border-collapse:collapse;margin-bottom:5px;}
  thead th{background:#f1f5f9;color:#475569;font-size:12px;padding:8px 6px;text-align:center;border-bottom:2px solid #cbd5e1;}
  thead th:nth-child(2){text-align:right;}
  thead th:last-child{text-align:left;}
  
  .summary-section{margin-right:auto;width:60%;margin-top:5px;}
  .summary-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;border-bottom:1px solid #f1f5f9;}
  .summary-row.total{border-top:2px solid #1e293b;border-bottom:none;margin-top:3px;font-size:18px;font-weight:900;color:#1e293b;}
  
  .payment-status{margin-top:8px;padding:6px;border-radius:6px;text-align:center;font-weight:bold;font-size:13px;}
  .status-paid{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;}
  .status-debt{background:#fef2f2;color:#dc2626;border:1px solid #fecaca;}
  
  .footer{text-align:center;margin-top:15px;padding-top:10px;border-top:1px dashed #cbd5e1;font-size:11px;color:#94a3b8;font-weight:bold;}
  
  @media print{
    @page{size:A5;margin:0;}
    body{-webkit-print-color-adjust:exact;}
    .invoice-container{width:148mm;height:auto;padding:5mm;}
  }
</style>
</head>
<body>
<div class="invoice-container">
  <div class="header-main">
    <img class="logo" src="${escapeHtml(storeSettings.logo)}" onerror="this.style.display='none'" />

    <div class="store-info-center">
      <div class="store-name">${escapeHtml(storeSettings.name)}</div>
      <div class="store-details">
        ${storeSettings.address ? `📍 ${escapeHtml(storeSettings.address)}<br/>` : ''}
        ${storeSettings.phone ? `📞 ${escapeHtml(storeSettings.phone)}` : ''}
        ${storeSettings.phone2 ? ` | ${escapeHtml(storeSettings.phone2)}` : ''}
      </div>
    </div>

    <div class="qr-code-container">
      <img class="qr-code-img" src="${qrCodeUrl}" alt="QR Code" />
      <div class="qr-label">تفاصيل الفاتورة</div>
    </div>
  </div>

  ${customerBlock}

  <table>
    <thead><tr>
      <th style="width:40px">#</th>
      <th style="text-align:right">${isPayment ? 'البيان' : 'المنتج'}</th>
      <th style="width:60px">${isPayment ? '' : 'الكمية'}</th>
      <th style="width:80px">${isPayment ? '' : 'السعر'}</th>
      <th style="width:100px;text-align:left">الإجمالي</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="summary-section">
    ${!isPayment ? `
    <div class="summary-row"><span>المجموع الفرعي:</span><span>${subtotal.toFixed(2)} ${storeSettings.currency}</span></div>
    ${order.coupon_code ? `<div class="summary-row" style="color:#e53e3e;font-weight:700;"><span>كوبون (${order.coupon_code}):</span><span>- ${(order.discount_amount || 0).toFixed(2)} ${storeSettings.currency}</span></div>` : ''}
    ${(order.discount && !order.coupon_code) ? `<div class="summary-row" style="color:#e53e3e;font-weight:700;"><span>خصم الفاتورة:</span><span>- ${order.discount.toFixed(2)} ${storeSettings.currency}</span></div>` : ''}
    <div class="summary-row"><span>الضريبة (${storeSettings.taxRate}%):</span><span>${taxValue.toFixed(2)} ${storeSettings.currency}</span></div>
    <div class="summary-row total"><span>الإجمالي النهائي:</span><span>${order.total.toFixed(2)} ${storeSettings.currency}</span></div>
    ` : ''}
  
    ${(order.paid_amount !== undefined && order.paid_amount < order.total) ? `
      <div class="payment-status status-debt">
        <div>متبقي للتحصيل (آجل): ${(order.total - (order.paid_amount || 0)).toFixed(2)} ${storeSettings.currency}</div>
        <div style="font-size:11px;opacity:0.8;margin-top:2px;">تم سداد: ${(order.paid_amount || 0).toFixed(2)} ${storeSettings.currency}</div>
      </div>
    ` : `
      <div class="payment-status status-paid">✓ تم سداد الفاتورة بالكامل</div>
    `}
    
    <div style="margin-top:10px; padding:8px; background:#f9fafb; border-radius:8px; border:1px solid #eee;">
      <div style="font-size:11px; color:#64748b; margin-bottom:4px; border-bottom:1px solid #eee; padding-bottom:2px; text-align:right;">تفاصيل الدفع:</div>
      ${order.paid_cash > 0 ? `<div class="summary-row" style="font-size:12px;"><span>💵 كاش:</span><span>${order.paid_cash.toFixed(2)}</span></div>` : ''}
      ${order.paid_visa > 0 ? `<div class="summary-row" style="font-size:12px;"><span>💳 فيزا:</span><span>${order.paid_visa.toFixed(2)}</span></div>` : ''}
      ${order.paid_wallet > 0 ? `<div class="summary-row" style="font-size:12px;"><span>📱 محفظة:</span><span>${order.paid_wallet.toFixed(2)}</span></div>` : ''}
      ${order.paid_instapay > 0 ? `<div class="summary-row" style="font-size:12px;"><span>⚡ انستا باي:</span><span>${order.paid_instapay.toFixed(2)}</span></div>` : ''}
    </div>
  </div>

  <div class="footer">شكراً لثقتكم بنا - ${escapeHtml(storeSettings.name)} ترحب بكم دائماً</div>
</div>
<script>window.onload=()=>{setTimeout(()=>{window.print();window.onafterprint=()=>window.close();},500);}</script>
</body></html>`;

    openPrintWindow(html);
  };

  const handleOpenModal = (entity: any) => {
    setSelectedEntity(entity);
    setSelectedInvoice(null);
    setPaymentForm({
      cash: entity.totalDebt.toString(),
      visa: '',
      wallet: '',
      instapay: '',
      discount: ''
    });
    setIsModalOpen(true);
  };

  const handleProcessPayment = async () => {
    const split = formToSplit(paymentForm);
    const discount = activeTab === 'customers' ? (parseFloat(paymentForm.discount) || 0) : 0;
    const totalPaid = sumSplit(split);
    const totalReduction = totalPaid + discount;

    if (totalReduction <= 0 || !selectedEntity) {
      alert('الرجاء إدخال مبلغ صحيح أو خصم');
      return;
    }
    
    const maxPayable = selectedInvoice ? selectedInvoice.current_debt : selectedEntity.totalDebt;
    if (totalReduction > maxPayable + 1) { // +1 for small rounding issues
      alert('إجمالي السداد والخصم أكبر من إجمالي الدين');
      return;
    }

    try {
      if (activeTab === 'customers') {
         if (selectedInvoice) {
            const paymentId = await payInvoiceDebt(
              selectedInvoice.id,
              selectedEntity.id,
              totalPaid,
              split as any,
              primaryMethod_(split),
              discount
            );
            alert('تم تسجيل سداد للفاتورة بنجاح!');
            
            if (paymentId) {
              const state = useStore.getState();
              const paymentOrder = state.orders.find(o => o.id === paymentId);
              if (paymentOrder) printPaymentReceipt(paymentOrder, storeSettings);
            }
          } else {
            const pendingOrders = [...(selectedEntity.orders || [])].sort((a, b) => new Date(a.created_at || a.date || new Date()).getTime() - new Date(b.created_at || b.date || new Date()).getTime());
            
            if (pendingOrders.length > 0) {
              let remainingPayment = totalPaid;
              let remainingDiscount = discount;
              const remaining: Record<string, number> = { ...split };
              const payKeys = activePaymentKeys(storeSettings as any);
              let lastPaymentId = null;

              for (const order of pendingOrders) {
                if (remainingPayment <= 0.009 && remainingDiscount <= 0.009) break;

                const appliedDiscount = Math.min(order.current_debt, remainingDiscount);
                remainingDiscount -= appliedDiscount;

                const debtAfterDiscount = order.current_debt - appliedDiscount;
                const appliedPayment = Math.min(debtAfterDiscount, remainingPayment);

                // وزّع المبلغ على الطرق المتاحة بالترتيب
                const paySplit: Record<string, number> = {};
                let left = appliedPayment;
                for (const k of payKeys) {
                  const take = Math.min(remaining[k] || 0, left);
                  paySplit[k] = take;
                  remaining[k] -= take;
                  left -= take;
                }
                const actualPaid = payKeys.reduce((s, k) => s + (paySplit[k] || 0), 0);
                if (actualPaid > 0.009 || appliedDiscount > 0.009) {
                  const paymentId = await payInvoiceDebt(
                    order.id,
                    selectedEntity.id,
                    actualPaid,
                    paySplit as any,
                    primaryMethod_(paySplit),
                    appliedDiscount
                  );
                  if (paymentId) lastPaymentId = paymentId;
                }
                remainingPayment -= actualPaid;
              }
              
              alert('تم تسجيل التحصيل وتوزيعه على الفواتير المعلقة بنجاح!');
              if (lastPaymentId) {
                const state = useStore.getState();
                const paymentOrder = state.orders.find(o => o.id === lastPaymentId);
                if (paymentOrder) printPaymentReceipt(paymentOrder, storeSettings);
              }
            } else {
              const invoiceId = await checkout(
                0,
                { name: selectedEntity.name, phone: selectedEntity.phone, custom_id: selectedEntity.custom_id },
                totalPaid,
                'payment',
                primaryMethod_(split),
                split as any
              );
              alert(`تم تسجيل تحصيل عام من العميل بنجاح!\nرقم الإيصال: ${invoiceId}`);
              
              if (invoiceId) {
                const state = useStore.getState();
                const paymentOrder = state.orders.find(o => o.id === invoiceId);
                if (paymentOrder) printPaymentReceipt(paymentOrder, storeSettings);
              }
            }
          }
        } else {
         const invoiceNum = `PAY-DEBT-${Date.now()}`;
         await addPurchaseInvoice({
           invoice_number: invoiceNum,
           supplier_id: selectedEntity.id,
           total: 0,
           paid_amount: totalPaid,
           payment_method: primaryMethod_(split)
         }, [], split as any);
         alert(`تم تسجيل سداد للمورد بنجاح!\nرقم الإيصال: ${invoiceNum}`);
       }
       
       setIsModalOpen(false);
       setSelectedEntity(null);
       setSelectedInvoice(null);
       setPaymentForm({ cash: '', visa: '', wallet: '', instapay: '', discount: '' });
     } catch (e: any) {
       alert('حدث خطأ أثناء معالجة الدفعة: ' + e.message);
     }
   };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto font-sans text-slate-800">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <BookUser style={{ color: storeSettings.themeColor }} size={32} />
            حسابات الآجل
          </h1>
          <p className="text-slate-500 mt-2">إدارة مديونية العملاء وتحصيلها، ومستحقات الموردين وسدادها</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex bg-slate-200/50 p-1 rounded-xl self-end">
            <button
              onClick={() => setActiveTab('customers')}
              className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${activeTab === 'customers' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              مديونية العملاء
            </button>
            <button
              onClick={() => setActiveTab('suppliers')}
              className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${activeTab === 'suppliers' ? 'bg-white text-slate-500 hover:text-slate-700' : 'text-slate-500 hover:text-slate-700'}`}
            >
              مستحقات الموردين
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleOpenAddDebtModal}
              style={{ backgroundColor: storeSettings.themeColor }}
              className="flex items-center gap-2 text-white px-5 py-2.5 rounded-xl font-bold hover:opacity-90 transition shadow-lg shrink-0"
            >
              <Plus size={18} /> إضافة {activeTab === 'customers' ? 'مديونية عميل سابقة' : 'مستحقات مورد سابقة'}
            </button>
            <div className="flex gap-2">
              {debtLoading && (
                <div className="flex items-center gap-2 text-indigo-600 font-bold px-4 py-2 bg-indigo-50 rounded-xl">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>جاري تحديث الديون...</span>
                </div>
              )}
              <button 
                onClick={exportExcel}
                className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg shadow-emerald-100"
              >
                <TableIcon size={18} /> Excel
              </button>
              <button 
                onClick={exportPDF}
                className="flex items-center gap-2 bg-red-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-red-700 transition shadow-lg disabled:opacity-50"
                disabled={loading}
              >
                {loading ? '...جاري التصدير' : <><FileText size={18} /> PDF</>}
              </button>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute right-4 top-3.5 text-slate-400" size={20} />
              <input
                type="text"
                placeholder={`ابحث برقم الهاتف أو اسم ${activeTab === 'customers' ? 'العميل' : 'المورد'}...`}
                className="w-full bg-white border border-slate-200 rounded-2xl py-3 pr-12 pl-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div id="deferred-table" className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right" dir="rtl">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-sm">
              <tr>
                <th className="py-4 px-6 font-bold">{activeTab === 'customers' ? 'اسم العميل' : 'اسم المورد'}</th>
                <th className="py-4 px-6 font-bold">رقم الهاتف</th>
                <th className="py-4 px-6 font-bold">الفواتير المعلقة</th>
                <th className="py-4 px-6 font-bold">{activeTab === 'customers' ? 'مديونية العميل' : 'مستحقات المورد'}</th>
                <th className="py-4 px-6 font-bold text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayList.length > 0 ? (
                displayList.map((entity: any) => (
                  <tr key={entity.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 font-bold text-slate-800">{entity.name}</td>
                    <td className="py-4 px-6 font-mono text-slate-600" dir="ltr">{entity.phone || '—'}</td>
                    <td className="py-4 px-6">
                      <div className="flex flex-wrap gap-2">
                        {(entity.orders || entity.invoices).slice(0, 3).map((o: any) => (
                          <span key={o.id} className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-md font-mono">
                            #{o.id || o.invoice_number}
                          </span>
                        ))}
                        {(entity.orders || entity.invoices).length > 3 && (
                          <span className="text-xs text-slate-400">+{(entity.orders || entity.invoices).length - 3} فواتير أخرى</span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className="text-red-600 font-black text-lg bg-red-50 px-3 py-1 rounded-xl block w-max">
                        {entity.totalDebt.toFixed(2)} <span className="text-xs">{storeSettings.currency}</span>
                      </span>
                    </td>
                    <td className="py-4 px-6 text-left">
                      <div className="flex gap-2 justify-end">
                        {activeTab === 'customers' && (
                          <button 
                            onClick={() => {
                              setProfileCustomer(entity);
                              setIsProfileOpen(true);
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all text-xs"
                          >
                            <BookUser size={14} /> بروفايل الأجل
                          </button>
                        )}
                        <button 
                          onClick={() => handleOpenModal(entity)}
                          style={{ backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor }}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all hover:bg-opacity-25 text-xs"
                        >
                          <CreditCard size={14} /> {activeTab === 'customers' ? 'تحصيل سريع' : 'سداد للمورد'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <BookUser size={48} className="mx-auto mb-4 opacity-50" />
                    لا يوجد {activeTab === 'customers' ? 'عملاء عليهم مديونية' : 'موردين لهم مستحقات'} حالياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Modal */}
      {isModalOpen && selectedEntity && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div 
              style={{ background: `linear-gradient(160deg, ${storeSettings.themeColor} 0%, ${storeSettings.themeColor}dd 100%)` }}
              className="p-6 text-white flex justify-between items-center shrink-0"
            >
              <h2 className="text-xl font-black flex items-center gap-2 drop-shadow">
                <Banknote /> {activeTab === 'customers' ? 'تحصيل من العميل' : 'سداد للمورد'}
              </h2>
              <button onClick={() => { setIsModalOpen(false); setSelectedInvoice(null); }} className="hover:bg-white/20 p-2 rounded-xl transition">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              <div className="flex flex-col items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 shrink-0">
                <div className="text-sm font-bold text-slate-500 mb-1">{activeTab === 'customers' ? 'مديونية العميل' : 'مستحقات المورد'}</div>
                <div className="text-3xl font-black text-red-600">{selectedInvoice ? selectedInvoice.current_debt.toFixed(2) : selectedEntity.totalDebt.toFixed(2)} <span className="text-lg">{storeSettings.currency}</span></div>
                <div className="mt-2 text-sm font-semibold">{selectedEntity.name} - <span dir="ltr">{selectedEntity.phone || '—'}</span></div>
              </div>

              {activeTab === 'customers' && selectedEntity.orders?.length > 0 && (
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 shrink-0 flex flex-col max-h-[35vh]">
                  <div className="text-xs font-bold text-slate-500 mb-3 flex justify-between shrink-0">
                    <span>الفواتير المستحقة ({selectedEntity.orders.length})</span>
                    {selectedInvoice && (
                      <button 
                        onClick={() => setSelectedInvoice(null)}
                        className="text-indigo-600 hover:text-indigo-700"
                      >
                        سداد كلي
                      </button>
                    )}
                  </div>
                  <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                    {selectedEntity.orders.map((o: any) => (
                      <div 
                        key={o.id} 
                        onClick={() => setSelectedInvoice(o)}
                        className={`flex justify-between items-center p-3 rounded-xl border cursor-pointer transition ${selectedInvoice?.id === o.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-300'}`}
                      >
                        <div>
                          <div className="font-bold text-sm text-slate-800">فاتورة #{o.id}</div>
                          <div className="text-xs text-slate-500">{new Date(o.created_at || o.date || new Date()).toLocaleDateString('ar-EG')}</div>
                        </div>
                        <div className="text-left">
                          <div className="font-black text-red-600">{o.current_debt.toFixed(2)} {storeSettings.currency}</div>
                          {o.notes && <div className="text-[10px] text-slate-400 max-w-[120px] truncate" title={o.notes}>{o.notes}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 text-center py-2 bg-indigo-50 rounded-xl mb-2">
                  <span className="text-xs font-bold text-indigo-400">{activeTab === 'customers' ? 'توزيع مبلغ التحصيل' : 'توزيع مبلغ السداد'}</span>
                </div>
                <div className="sm:col-span-2">
                  <PaymentSplitInputs
                    value={paymentForm}
                    onChange={(k, v) => setPaymentForm({ ...paymentForm, [k]: v })}
                    labelClassName="block text-[10px] font-bold text-slate-400 mb-1 uppercase text-right"
                    inputClassName="w-full border border-slate-200 rounded-xl py-3 px-3 text-lg font-black text-center focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                {activeTab === 'customers' && (
                  <div className="sm:col-span-2 border-t border-dashed border-slate-200 pt-3">
                    <label className="block text-xs font-bold text-emerald-600 mb-1 text-right">🎁 خصم / إكرامية (سماح)</label>
                    <input
                      type="number" dir="ltr"
                      placeholder="0"
                      className="w-full border border-emerald-200 bg-emerald-50/20 rounded-xl py-3 px-3 text-lg font-black text-center text-emerald-700 focus:ring-2 focus:ring-emerald-500"
                      value={paymentForm.discount}
                      onChange={(e) => setPaymentForm({...paymentForm, discount: e.target.value})}
                    />
                  </div>
                )}
              </div>

              <div className="bg-slate-900 p-4 rounded-2xl text-center space-y-2">
                <div className="flex justify-between items-center text-xs font-bold text-slate-400 px-2">
                  <span>{activeTab === 'customers' ? 'المبلغ المحصل فعلياً:' : 'المبلغ المدفوع فعلياً:'}</span>
                  <span className="text-white text-sm">
                    {sumSplit(formToSplit(paymentForm)).toLocaleString()} {storeSettings.currency}
                  </span>
                </div>
                {activeTab === 'customers' && (parseFloat(paymentForm.discount) || 0) > 0 && (
                  <div className="flex justify-between items-center text-xs font-bold text-emerald-400 px-2 border-t border-slate-800 pt-2">
                    <span>خصم / سماح:</span>
                    <span className="text-emerald-300 text-sm">
                      {(parseFloat(paymentForm.discount) || 0).toLocaleString()} {storeSettings.currency}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm font-black text-white px-2 border-t border-slate-800 pt-2">
                  <span>إجمالي الخصم من الدين:</span>
                  <span className="text-xl text-yellow-400">
                    {(sumSplit(formToSplit(paymentForm)) + (activeTab === 'customers' ? (parseFloat(paymentForm.discount) || 0) : 0)).toLocaleString()} {storeSettings.currency}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleProcessPayment}
                  style={{ backgroundColor: storeSettings.themeColor, boxShadow: `0 4px 12px ${storeSettings.themeColor}40` }}
                  className="flex-1 text-white py-4 rounded-xl font-bold transition-all hover:bg-opacity-90"
                >
                  {activeTab === 'customers' ? 'إتمام التحصيل' : 'إتمام السداد'}
                </button>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 border border-slate-200 hover:bg-slate-50 text-slate-600 py-3.5 rounded-xl font-bold transition"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Debt Modal */}
      {isAddDebtOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <div
              style={{ background: `linear-gradient(160deg, ${storeSettings.themeColor} 0%, ${storeSettings.themeColor}dd 100%)` }}
              className="p-6 text-white flex justify-between items-center"
            >
              <h2 className="text-xl font-black flex items-center gap-2 drop-shadow">
                <UserPlus /> إضافة {activeTab === 'customers' ? 'مديونية عميل سابقة' : 'مستحقات مورد سابقة'}
              </h2>
              <button onClick={() => setIsAddDebtOpen(false)} className="hover:bg-white/20 p-2 rounded-xl transition">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              {/* Entity selection */}
              <div className="relative">
                <label className="block text-sm font-bold text-slate-700 mb-2">اختر {activeTab === 'customers' ? 'العميل' : 'المورد'}</label>
                {selectedAddDebtEntity ? (
                  <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-inner">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800">{selectedAddDebtEntity.name}</span>
                      <span className="text-xs text-slate-500 font-mono" dir="ltr">{selectedAddDebtEntity.phone || '—'}</span>
                    </div>
                    <button 
                      onClick={() => setSelectedAddDebtEntity(null)}
                      className="text-red-500 hover:text-red-700 font-bold text-sm bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition"
                    >
                      تغيير
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder={`ابحث باسم ${activeTab === 'customers' ? 'العميل' : 'المورد'} أو رقم الموبايل...`}
                        className="w-full bg-white border border-slate-200 rounded-xl py-3.5 pr-4 pl-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                        value={addDebtSearch}
                        onChange={e => {
                          setAddDebtSearch(e.target.value);
                          setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                      />
                    </div>
                    {showSuggestions && addDebtSearch.trim() && (
                      <div className="absolute right-0 left-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-[60] animate-in slide-in-from-top-2 duration-150 max-h-56 overflow-y-auto">
                        {(activeTab === 'customers' ? filteredSearchCustomers : filteredSearchSuppliers).length > 0 ? (
                          (activeTab === 'customers' ? filteredSearchCustomers : filteredSearchSuppliers).map((item: any) => (
                            <button
                              key={item.id}
                              onClick={() => {
                                setSelectedAddDebtEntity(item);
                                setShowSuggestions(false);
                              }}
                              className="w-full p-3 text-right hover:bg-indigo-50 flex items-center justify-between border-b border-slate-100 last:border-0"
                            >
                              <div className="flex flex-col items-start text-right">
                                <span className="font-bold text-slate-800 text-sm">{item.name}</span>
                                <span className="text-xs text-slate-500 font-mono">{item.phone || '—'}</span>
                              </div>
                              {activeTab === 'customers' ? <User size={16} className="text-slate-400" /> : <Truck size={16} className="text-slate-400" />}
                            </button>
                          ))
                        ) : (
                          <div className="p-4 text-center text-slate-400 text-xs text-right">
                            <p>لا يوجد نتائج تطابق بحثك</p>
                            <button 
                              className="mt-2 text-indigo-600 font-bold hover:underline"
                              onClick={() => {
                                // For unknown, just let them submit with the text as name
                                setShowSuggestions(false);
                              }}
                            >
                              الاستمرار بالاسم "{addDebtSearch}"
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {showSuggestions && (
                      <div className="fixed inset-0 z-[55]" onClick={() => setShowSuggestions(false)} />
                    )}
                  </>
                )}
              </div>

              {/* Debt amount */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">{activeTab === 'customers' ? 'رصيد مديونية العميل القديم' : 'رصيد مستحقات المورد القديم'}</label>
                <div className="relative">
                  <input
                    type="number"
                    dir="ltr"
                    className="w-full border border-slate-200 rounded-xl py-4 px-4 text-xl font-black text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner"
                    value={addDebtAmount}
                    onChange={(e) => setAddDebtAmount(e.target.value)}
                    placeholder="0.00"
                    min={1}
                  />
                  <div className="absolute left-4 top-4 text-slate-400 font-bold">{storeSettings.currency}</div>
                </div>
              </div>
              
              {/* Debt Notes */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">الوصف / البيان (اختياري)</label>
                <div className="relative">
                  <input
                    type="text"
                    className="w-full border border-slate-200 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner"
                    value={addDebtNotes}
                    onChange={(e) => setAddDebtNotes(e.target.value)}
                    placeholder="مثال: رصيد مرحل من الدفتر القديم..."
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleProcessAddDebt}
                  style={{ backgroundColor: storeSettings.themeColor, boxShadow: `0 4px 12px ${storeSettings.themeColor}40` }}
                  className="flex-1 text-white py-4 rounded-xl font-bold transition-all hover:bg-opacity-90"
                >
                  إضافة {activeTab === 'customers' ? 'المديونية' : 'المستحقات'}
                </button>
                <button
                  onClick={() => setIsAddDebtOpen(false)}
                  className="px-6 border border-slate-200 hover:bg-slate-50 text-slate-600 py-3.5 rounded-xl font-bold transition"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Profile Modal */}
      {isProfileOpen && profileCustomer && profileData && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div 
              style={{ background: `linear-gradient(160deg, ${storeSettings.themeColor} 0%, ${storeSettings.themeColor}dd 100%)` }}
              className="p-6 text-white flex justify-between items-center shrink-0"
            >
              <h2 className="text-xl font-black flex items-center gap-2 drop-shadow">
                <BookUser /> بروفايل حساب الأجل للعميل: {profileCustomer.name}
              </h2>
              <button 
                onClick={() => { setIsProfileOpen(false); setProfileCustomer(null); }} 
                className="hover:bg-white/20 p-2 rounded-xl transition"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-red-50 border border-red-100 p-4 rounded-2xl text-center">
                  <div className="text-xs font-bold text-red-500 mb-1">المديونية الحالية المتبقية</div>
                  <div className="text-2xl font-black text-red-600">
                    {profileData.totalCurrentDebt.toFixed(2)} <span className="text-sm font-bold">{storeSettings.currency}</span>
                  </div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-center">
                  <div className="text-xs font-bold text-emerald-500 mb-1">إجمالي المبالغ المسددة</div>
                  <div className="text-2xl font-black text-emerald-600">
                    {profileData.totalPaidDebt.toFixed(2)} <span className="text-sm font-bold">{storeSettings.currency}</span>
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl text-center">
                  <div className="text-xs font-bold text-blue-500 mb-1">إجمالي الخصومات والسماح</div>
                  <div className="text-2xl font-black text-blue-600">
                    {profileData.totalDiscounts.toFixed(2)} <span className="text-sm font-bold">{storeSettings.currency}</span>
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-center">
                  <div className="text-xs font-bold text-slate-500 mb-1">إجمالي الدين التاريخي</div>
                  <div className="text-2xl font-black text-slate-700">
                    {profileData.totalHistoricalDebt.toFixed(2)} <span className="text-sm font-bold">{storeSettings.currency}</span>
                  </div>
                </div>
              </div>

              {/* Tabs / Content */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                  <FileText className="text-indigo-600" size={20} />
                  سجل الفواتير والمديونيات
                </h3>
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm" dir="rtl">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                        <tr>
                          <th className="py-3 px-4 font-bold">رقم الفاتورة</th>
                          <th className="py-3 px-4 font-bold">النوع</th>
                          <th className="py-3 px-4 font-bold">التاريخ</th>
                          <th className="py-3 px-4 font-bold">الإجمالي</th>
                          <th className="py-3 px-4 font-bold">المدفوع</th>
                          <th className="py-3 px-4 font-bold">الخصم</th>
                          <th className="py-3 px-4 font-bold">المتبقي (الدين)</th>
                          <th className="py-3 px-4 font-bold text-left">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold">
                        {profileData.invoices.length > 0 ? (
                          profileData.invoices.map((inv) => (
                            <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-3 px-4 font-mono text-indigo-600">#{inv.id}</td>
                              <td className="py-3 px-4">
                                {inv.type === 'previous_debt' ? (
                                  <span className="text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg text-xs font-bold">مديونية سابقة</span>
                                ) : (
                                  <span className="text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg text-xs font-bold">فاتورة صيانة/بيع</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-slate-500">
                                {new Date(inv.date || new Date()).toLocaleDateString('ar-EG', {
                                  year: 'numeric', month: 'short', day: 'numeric'
                                })}
                              </td>
                              <td className="py-3 px-4">{inv.effectiveTotal.toFixed(2)} {storeSettings.currency}</td>
                              <td className="py-3 px-4 text-emerald-600">{(inv.paid_amount || 0).toFixed(2)} {storeSettings.currency}</td>
                              <td className="py-3 px-4 text-blue-600">{(inv.discount_amount || 0).toFixed(2)} {storeSettings.currency}</td>
                              <td className="py-3 px-4">
                                {inv.currentDebt > 0.009 ? (
                                  <span className="text-red-600 font-black bg-red-50 px-2.5 py-1 rounded-lg">{inv.currentDebt.toFixed(2)} {storeSettings.currency}</span>
                                ) : (
                                  <span className="text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg">مسددة بالكامل</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-left">
                                <div className="flex gap-2 justify-end items-center">
                                  <button
                                    type="button"
                                    onClick={() => handlePrintInvoice(inv)}
                                    className="p-1.5 text-slate-500 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 rounded-lg transition"
                                    title="عرض وطباعة الفاتورة"
                                  >
                                    <Eye size={16} />
                                  </button>
                                  {inv.currentDebt > 0.009 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsProfileOpen(false);
                                        setSelectedInvoice(inv);
                                        setSelectedEntity(profileCustomer);
                                        setPaymentForm({
                                          cash: inv.currentDebt.toString(),
                                          visa: '',
                                          wallet: '',
                                          instapay: '',
                                          discount: ''
                                        });
                                        setIsModalOpen(true);
                                      }}
                                      style={{ backgroundColor: storeSettings.themeColor, boxShadow: `0 2px 6px ${storeSettings.themeColor}30` }}
                                      className="text-white text-xs px-3 py-1.5 rounded-lg font-bold hover:opacity-90 transition whitespace-nowrap"
                                    >
                                      تحصيل الفاتورة
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-slate-400 font-bold">
                              لا يوجد فواتير آجل مسجلة لهذا العميل
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Payments History */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                  <Banknote className="text-emerald-600" size={20} />
                  سجل الدفعات وعمليات السداد
                </h3>
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm" dir="rtl">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                        <tr>
                          <th className="py-3 px-4 font-bold">رقم الحركة</th>
                          <th className="py-3 px-4 font-bold">التاريخ</th>
                          <th className="py-3 px-4 font-bold">المبلغ المحصل</th>
                          <th className="py-3 px-4 font-bold">طريقة الدفع</th>
                          <th className="py-3 px-4 font-bold">البيان / الملاحظات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold">
                        {profileData.payments.length > 0 ? (
                          profileData.payments.map((pay) => (
                            <tr key={pay.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-3 px-4 font-mono text-slate-500">#{pay.id}</td>
                              <td className="py-3 px-4 text-slate-500">
                                {new Date(pay.date || new Date()).toLocaleDateString('ar-EG', {
                                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                })}
                              </td>
                              <td className="py-3 px-4 font-bold text-emerald-600">{(pay.paid_amount || 0).toFixed(2)} {storeSettings.currency}</td>
                              <td className="py-3 px-4">
                                <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-bold">
                                  {pay.payment_method === 'cash' ? '💵 كاش' :
                                   pay.payment_method === 'visa' ? '💳 فيزا' :
                                   pay.payment_method === 'wallet' ? '📱 محفظة' : '⚡ انستا باي'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-slate-600 text-xs max-w-[280px] truncate" title={pay.notes || undefined}>
                                {pay.notes || '—'}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-400 font-bold">
                              لا يوجد عمليات سداد مسجلة
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
              <button 
                onClick={() => { setIsProfileOpen(false); setProfileCustomer(null); }}
                className="px-6 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 py-2.5 rounded-xl font-bold transition"
              >
                إغلاق البروفايل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
