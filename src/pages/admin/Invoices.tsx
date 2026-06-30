import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { ArrowRightLeft, Search, User, Printer, CreditCard, FileText, Table as TableIcon, TrendingUp, Calendar, X, Trash2, Archive, Edit2, Eye } from 'lucide-react';
import { normalizeArabic } from '../../utils/textUtils';
import { calculateInvoiceProfit } from '../../utils/invoiceProfit';
import { calculateOrderReturnValue } from '../../utils/returns';
import { escapeHtml } from '../../utils/escapeHtml';
import { printDocument } from '../../utils/printWindow';
import * as XLSX from 'xlsx';

import jsPDF from 'jspdf';
// html2canvas-pro يدعم ألوان oklch() في Tailwind v4 (النسخة الأصلية تفشل معها وتكسر تصدير PDF).
import html2canvas from 'html2canvas-pro';
import { EditInvoiceModal } from '../../components/EditInvoiceModal';

export default function Invoices() {
  const { orders, storeSettings, deleteOrder } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showReturnsOnly, setShowReturnsOnly] = useState(false);
  const [showExchangeOnly, setShowExchangeOnly] = useState(false);
  const [showDeferredOnly, setShowDeferredOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'active' | 'deleted'>('active');
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedCashier, setSelectedCashier] = useState<string>('all');
  const [selectedSalesperson, setSelectedSalesperson] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any | null>(null);

  const activeOrders = useMemo(() => orders.filter((order) => !order.is_deleted), [orders]);
  const deletedOrders = useMemo(() => orders.filter((order) => order.is_deleted), [orders]);
  const visibleOrders = viewMode === 'deleted' ? deletedOrders : activeOrders;

  const handlePrint = (order: any) => {
    const printDate = new Date(order.created_at || Date.now()).toLocaleString('ar-EG', { calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const isPayment = order.type === 'payment';
    const subtotal = isPayment ? order.total : order.items.reduce((sum: number, item: any) => sum + (item.sale_price * item.quantity), 0);
    const taxValue = isPayment ? 0 : Math.max(0, order.total - (subtotal - (order.discount || 0)));
    
    let debtAfter = 0;
    if (order.customer && !order.is_deleted) {
      const customerOrders = activeOrders.filter(o => o.customer?.id === order.customer.id);
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
      : order.items;

    const itemsHtml = cart.map((item: any, index: number) =>
      `<tr>
        <td style="text-align:center;">${index + 1}</td>
        <td style="text-align:right;font-weight:bold;">${escapeHtml(item.name)}${item.returned_quantity > 0 ? ` <span style="color:red;font-size:8px;">(مرتجع: ${item.returned_quantity})</span>` : ''}</td>
        <td style="text-align:center;">${item.quantity}</td>
        <td style="text-align:center;">${item.sale_price.toFixed(2)}</td>
        <td style="text-align:left;font-weight:bold;">${(item.sale_price * item.quantity).toFixed(2)}</td>
      </tr>`
    ).join('');

    const invoiceUrl = `${window.location.origin}/view-invoice/${order.id}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(invoiceUrl)}`;

    const customerBlock = order.customer
      ? `<div class="customer-info-grid">
            <div class="info-item"><strong>اسم العميل:</strong> <span>${escapeHtml(order.customer.name || '—')}</span></div>
            <div class="info-item"><strong>رقم الهاتف:</strong> <span dir="ltr">${escapeHtml(order.customer.phone || '—')}</span></div>
            <div class="info-item"><strong>رقم الكارت (ID):</strong> <span dir="ltr">${escapeHtml(order.customer.custom_id || order.customer.id.substring(0, 8) || '—')}</span></div>
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
  body{background:#fff;color:#000;margin:0;}
  .invoice-container{width:72mm;margin:0 auto;padding:2mm 1.5mm;display:flex;flex-direction:column;}

  .header-main{text-align:center;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:6px;}
  .logo{max-height:55px;max-width:62mm;width:auto;object-fit:contain;display:block;margin:0 auto 4px;}
  .store-name{font-size:17px;font-weight:900;color:#000;line-height:1.2;}
  .store-details{font-size:9px;color:#333;margin-top:2px;line-height:1.4;font-weight:bold;}

  .customer-info-grid{display:flex;flex-direction:column;gap:2px;margin-bottom:6px;font-size:10px;}
  .info-item{display:flex;justify-content:space-between;gap:6px;}
  .info-item strong{color:#444;white-space:nowrap;}
  .info-item span{color:#000;font-weight:700;}

  table{width:100%;border-collapse:collapse;margin-bottom:5px;}
  thead th{font-size:9px;padding:4px 1px;border-bottom:1px solid #000;font-weight:900;}
  thead th:nth-child(2){text-align:right;}
  thead th:last-child{text-align:left;}
  tbody td{font-size:9px;padding:3px 1px;border-bottom:1px dotted #bbb;vertical-align:top;}

  .summary-section{width:100%;margin-top:4px;}
  .summary-row{display:flex;justify-content:space-between;padding:2px 0;font-size:10px;}
  .summary-row.total{border-top:1px solid #000;border-bottom:1px solid #000;margin-top:3px;padding:4px 0;font-size:15px;font-weight:900;color:#000;}

  .payment-status{margin-top:6px;padding:5px;border-radius:5px;text-align:center;font-weight:bold;font-size:11px;}
  .status-paid{background:#e8f5e9;color:#1b5e20;border:1px solid #a5d6a7;}
  .status-debt{background:#ffebee;color:#b71c1c;border:1px solid #ef9a9a;}

  .qr-code-container{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:8px;}
  .qr-code-img{width:90px;height:90px;}
  .qr-label{font-size:9px;font-weight:900;color:#000;}

  .footer{text-align:center;margin-top:8px;padding-top:6px;border-top:1px dashed #000;font-size:9px;color:#333;font-weight:bold;}

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
    <div class="store-details">
      ${storeSettings.address ? `📍 ${escapeHtml(storeSettings.address)}<br/>` : ''}
      ${storeSettings.phone ? `📞 ${escapeHtml(storeSettings.phone)}` : ''}
      ${storeSettings.phone2 ? ` | ${escapeHtml(storeSettings.phone2)}` : ''}
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

  <div class="qr-code-container">
    <img class="qr-code-img" src="${qrCodeUrl}" alt="QR Code" />
    <div class="qr-label">امسح الكود لعرض الفاتورة</div>
  </div>

  <div class="footer">شكراً لثقتكم بنا - ${escapeHtml(storeSettings.name)} ترحب بكم دائماً</div>
</div>
<script>window.onload=()=>{setTimeout(()=>{window.print();window.onafterprint=()=>window.close();},500);}</script>
</body></html>`;

    void printDocument('invoice', html);
  };

  const handleSendWhatsApp = (order: any) => {
    const customerPhone = order.customer?.phone || '';
    if (!customerPhone) {
      alert('لا يوجد رقم هاتف مسجل لهذا العميل لإرسال الفاتورة عبر واتساب.');
      return;
    }

    const isPayment = order.type === 'payment';
    const invoiceLink = `${window.location.origin}/view-invoice/${order.id}`;
    let message = '';
    
    if (isPayment) {
      message = `*إيصال سداد مديونية من ${storeSettings.name}*\n\n` +
        `*رقم الإيصال:* #${order.id}\n` +
        `*التاريخ:* ${new Date(order.created_at || order.date).toLocaleString('ar-SA')}\n` +
        `*المبلغ المسدد:* ${order.paid_amount.toFixed(2)} ${storeSettings.currency}\n\n` +
        `*عرض التفاصيل:*\n${invoiceLink}\n\n` +
        (order.notes ? `*ملاحظات:* ${order.notes}\n\n` : '') +
        `*شكراً لتعاملكم معنا!*`;
    } else {
      const itemsText = order.items.map((item: any) => `• ${item.name} (عدد: ${item.quantity}) - ${(item.sale_price * item.quantity).toFixed(2)} ${storeSettings.currency}`).join('\n');
      const branchAddress = storeSettings.address || '';
      const branchLocationLink = storeSettings.locationUrl || '';
      message = `*فاتورة جديدة من ${storeSettings.name}*\n\n` +
        `*رقم الفاتورة:* #${order.id}\n` +
        `*التاريخ:* ${new Date(order.created_at || order.date).toLocaleString('ar-SA')}\n` +
        `*الإجمالي:* ${order.total.toFixed(2)} ${storeSettings.currency}\n\n` +
        `*عرض الفاتورة بالتفاصيل:*\n${invoiceLink}\n\n` +
        `*تفاصيل الطلب:*\n${itemsText}\n\n` +
        (branchAddress ? `*عنوان الفرع:* ${branchAddress}\n` : '') +
        (branchLocationLink ? `*لوكيشن الفرع على Google Maps:*\n${branchLocationLink}\n` : '') +
        `${(storeSettings.phone || storeSettings.phone2) ? `*للتواصل أو الشحن:* ${[storeSettings.phone, storeSettings.phone2].filter(Boolean).join(' - ')}\nيمكنكم التواصل هاتفيا أو واتساب، أو زيارة الفرع على العنوان الموضح.\n` : ''}` +
        `\n*شكراً لتعاملكم معنا، في انتظاركم مرة أخرى!*\n` +
        `*ما رأيك في خدمتنا؟ نسعد بتلقي ملاحظاتك.*`;
    }

    let cleanPhone = customerPhone.replace(/\D/g, '');
    const code = storeSettings.whatsappCountryCode || '2';

    if (cleanPhone.startsWith('0')) {
      cleanPhone = code + cleanPhone.substring(1);
    } else if (!cleanPhone.startsWith(code)) {
      cleanPhone = code + cleanPhone;
    }

    const encodedMsg = encodeURIComponent(message);
    window.open(`https://wa.me/${cleanPhone}?text=${encodedMsg}`, '_blank');
  };

  // Extract unique years from orders
  const years = useMemo(() => {
    const y = new Set<string>();
    visibleOrders.forEach(o => y.add(new Date(o.date).getFullYear().toString()));
    return Array.from(y).sort((a, b) => parseInt(b) - parseInt(a));
  }, [visibleOrders]);

  // Extract unique cashiers from orders
  const uniqueCashiers = useMemo(() => {
    const c = new Set<string>();
    visibleOrders.forEach(o => {
      if (o.cashier_name) c.add(o.cashier_name);
    });
    return Array.from(c).sort();
  }, [visibleOrders]);

  // Extract unique salespeople from orders
  const uniqueSalespeople = useMemo(() => {
    const s = new Set<string>();
    visibleOrders.forEach(o => { if ((o as any).salesperson_name) s.add((o as any).salesperson_name); });
    return Array.from(s).sort();
  }, [visibleOrders]);

  const handleDeleteOrder = async (order: any) => {
    const message = [
      `هل أنت متأكد من حذف الفاتورة #${order.id}؟`,
      '',
      'مسح الفاتورة سيحذف تأثيرها من الإيراد والربح والمديونية، ويرجع المنتجات غير المرتجعة إلى المخزون.',
      'ستظل الفاتورة ظاهرة في بروفايل العميل كفاتورة محذوفة، وستظهر في سلة المهملات للعرض فقط بدون استرجاع.',
    ].join('\n');

    if (!confirm(message)) return;

    const ok = await deleteOrder(order.id, 'حذف يدوي بسبب فاتورة خاطئة');
    alert(ok ? 'تم حذف الفاتورة ونقلها إلى سلة المهملات.' : 'تعذر حذف الفاتورة. تأكد من تشغيل تحديث قاعدة البيانات ثم حاول مرة أخرى.');
  };

  const exportExcel = () => {
    const wsData = [
      ['تقرير الفواتير', '', '', '', '', '', '', ''],
      ['التاريخ', new Date().toLocaleDateString(), '', '', '', '', '', ''],
      [''],
      ['رقم الفاتورة', 'العميل', 'التاريخ', 'الإجمالي', 'المدفوع', 'كاش', 'فيزا', 'محفظة', 'انستا', 'الباقي', 'النوع'],
      ...filteredOrders.map(o => [
        o.id,
        o.customer?.name || 'عميل نقدي',
        new Date(o.date).toLocaleString('ar-SA'),
        o.total,
        o.paid_amount,
        o.paid_cash,
        o.paid_visa,
        o.paid_wallet,
        o.paid_instapay,
        o.type === 'payment' ? 0 : Math.max(0, o.total - o.paid_amount),
        o.type === 'payment' ? 'سداد' : 'بيع'
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices');
    XLSX.writeFile(wb, `invoices_report_${new Date().toLocaleDateString()}.xlsx`);
  };

  const exportPDF = async () => {
    const element = document.getElementById('invoices-table');
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
          const el = clonedDoc.getElementById('invoices-table');
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
      
      pdf.save(`invoices_report_${new Date().toLocaleDateString()}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
      alert('حدث خطأ أثناء تصدير ملف PDF');
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = useMemo(() => {
    return visibleOrders.filter(o => {
      const orderDate = new Date(o.date);
      const orderDay = [
        orderDate.getFullYear(),
        String(orderDate.getMonth() + 1).padStart(2, '0'),
        String(orderDate.getDate()).padStart(2, '0')
      ].join('-');
      const matchesDay = !selectedDay || orderDay === selectedDay;
      const matchesMonth = selectedMonth === 'all' || (orderDate.getMonth() + 1).toString() === selectedMonth;
      const matchesYear = selectedYear === 'all' || orderDate.getFullYear().toString() === selectedYear;
      const matchesReturns = showReturnsOnly ? o.items.some(i => i.returned_quantity > 0) : true;
      const matchesExchange = showExchangeOnly ? !!(o as any).exchange_data : true;
      const matchesDeferred = showDeferredOnly ? (o.type !== 'payment' && (o.total - (o.paid_amount || 0)) > 0.009) : true;

      const searchStr = searchQuery.toLowerCase();
      const matchesSearch = 
        o.id.toLowerCase().includes(searchStr) || 
        normalizeArabic(o.customer?.name || '').includes(normalizeArabic(searchStr)) ||
        (o.customer?.phone || '').includes(searchStr);

      const matchesCashier = selectedCashier === 'all' || o.cashier_name === selectedCashier;
      const matchesSalesperson = selectedSalesperson === 'all' || (o as any).salesperson_name === selectedSalesperson;

      return matchesDay && matchesMonth && matchesYear && matchesReturns && matchesExchange && matchesDeferred && matchesSearch && matchesCashier && matchesSalesperson;
    });
  }, [visibleOrders, searchQuery, showReturnsOnly, showExchangeOnly, showDeferredOnly, selectedDay, selectedMonth, selectedYear, selectedCashier, selectedSalesperson]);

  const exchangeInvoicesCount = useMemo(() => visibleOrders.filter(o => (o as any).exchange_data).length, [visibleOrders]);

  const totalInvoiceProfit = useMemo(() => {
    return filteredOrders.reduce((sum, order) => sum + calculateInvoiceProfit(order), 0);
  }, [filteredOrders]);

  const returnedInvoicesCount = useMemo(() => {
    return filteredOrders.filter(order => order.items.some(item => item.returned_quantity > 0)).length;
  }, [filteredOrders]);

  const deferredInvoicesCount = useMemo(() => {
    return filteredOrders.filter(o => o.type !== 'payment' && (o.total - (o.paid_amount || 0)) > 0.009).length;
  }, [filteredOrders]);

  // تقرير مبيعات/أرباح كل مسؤول مبيعات في الفترة المفلترة (كشف عمولة)
  const salespersonReport = useMemo(() => {
    const map = new Map<string, { name: string; count: number; sales: number; profit: number }>();
    filteredOrders.forEach((o) => {
      const name = (o as any).salesperson_name;
      if (!name || o.type === 'payment' || o.is_deleted) return;
      const cur = map.get(name) || { name, count: 0, sales: 0, profit: 0 };
      cur.count += 1;
      cur.sales += Number(o.total) || 0;
      cur.profit += calculateInvoiceProfit(o);
      map.set(name, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [filteredOrders]);

  return (
    <div className="p-8">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-800">فواتير البيع والمرتجعات</h1>
          <p className="text-slate-500 mt-2">مراجعة فواتير البيع وعمليات الاسترجاع مع الفلاتر المتقدمة</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={exportExcel}
            className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg"
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
      </div>

      <div id="invoices-table" className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-[500px]">
        {/* Advanced Filters */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 grid grid-cols-1 xl:grid-cols-5 gap-4 items-center">
          <div className="relative xl:col-span-2">
            <Search className="absolute right-4 top-3 text-slate-400" size={20} />
            <input
              type="text"
              placeholder="ابحث برقم الفاتورة، اسم العميل، أو رقم الهاتف..."
              style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
              className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pr-12 pl-4 text-sm focus:outline-none focus:ring-2 shadow-sm transition"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex flex-wrap gap-3 xl:col-span-3 justify-end items-center">
            <div className="relative">
              <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="date"
                value={selectedDay}
                onChange={e => setSelectedDay(e.target.value)}
                style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
                className="bg-white border border-slate-200 rounded-xl py-2.5 pr-10 pl-10 text-sm focus:ring-2 outline-none min-w-[155px]"
              />
              {selectedDay && (
                <button
                  onClick={() => setSelectedDay('')}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                  title="كل الأيام"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <select 
              value={selectedMonth} 
              onChange={e => setSelectedMonth(e.target.value)} 
              style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
              className="bg-white border border-slate-200 rounded-xl p-2.5 text-sm focus:ring-2 outline-none"
            >
              <option value="all">كل الشهور</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i+1} value={(i+1).toString()}>{`شهر ${i+1}`}</option>
              ))}
            </select>

            <select 
              value={selectedYear} 
              onChange={e => setSelectedYear(e.target.value)} 
              style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
              className="bg-white border border-slate-200 rounded-xl p-2.5 text-sm focus:ring-2 outline-none"
            >
              <option value="all">كل السنوات</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <select 
              value={selectedCashier} 
              onChange={e => setSelectedCashier(e.target.value)} 
              style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
              className="bg-white border border-slate-200 rounded-xl p-2.5 text-sm focus:ring-2 outline-none"
            >
              <option value="all">كل المحاسبين</option>
              {uniqueCashiers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select
              value={selectedSalesperson}
              onChange={e => setSelectedSalesperson(e.target.value)}
              style={{ '--tw-ring-color': storeSettings.themeColor + '40' } as any}
              className="bg-white border border-slate-200 rounded-xl p-2.5 text-sm focus:ring-2 outline-none"
            >
              <option value="all">كل مسؤولي المبيعات</option>
              {uniqueSalespeople.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="p-5 border-b border-slate-100 bg-white">
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setViewMode('active')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition ${
                  viewMode === 'active'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <FileText size={16} /> الفواتير الحالية
              </button>
              <button
                type="button"
                onClick={() => setViewMode('deleted')}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition ${
                  viewMode === 'deleted'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
              >
                <Archive size={16} /> سلة المهملات ({deletedOrders.length})
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div
                style={{ backgroundColor: storeSettings.themeColor + '10', borderColor: storeSettings.themeColor + '25' }}
                className="rounded-2xl border p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black text-slate-500">إجمالي النتائج</p>
                  <FileText size={18} style={{ color: storeSettings.themeColor }} />
                </div>
                <p className="text-2xl font-black mt-2" style={{ color: storeSettings.themeColor }}>{filteredOrders.length}</p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-700">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black text-emerald-600">إجمالي الربح من الفواتير</p>
                  <TrendingUp size={18} />
                </div>
                <p className="text-2xl font-black mt-2">{totalInvoiceProfit.toFixed(2)} <span className="text-xs">{storeSettings.currency}</span></p>
              </div>
              <button
                type="button"
                onClick={() => setShowReturnsOnly((current) => !current)}
                className={`rounded-2xl border p-4 text-right transition-all ${
                  showReturnsOnly
                    ? 'border-orange-300 bg-orange-100 text-orange-800 shadow-sm ring-2 ring-orange-200'
                    : 'border-orange-100 bg-orange-50 text-orange-700 hover:border-orange-200 hover:bg-orange-100/60'
                }`}
                title={showReturnsOnly ? 'عرض كل الفواتير' : 'إظهار الفواتير التي بها مرتجعات فقط'}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black text-orange-600">فواتير بها مرتجعات</p>
                  <ArrowRightLeft size={18} />
                </div>
                <p className="text-2xl font-black mt-2">{returnedInvoicesCount}</p>
              </button>
              <button
                type="button"
                onClick={() => setShowExchangeOnly((current) => !current)}
                className={`rounded-2xl border p-4 text-right transition-all ${
                  showExchangeOnly
                    ? 'border-amber-300 bg-amber-100 text-amber-800 shadow-sm ring-2 ring-amber-200'
                    : 'border-amber-100 bg-amber-50 text-amber-700 hover:border-amber-200 hover:bg-amber-100/60'
                }`}
                title={showExchangeOnly ? 'عرض كل الفواتير' : 'إظهار فواتير الاستبدال فقط'}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black text-amber-600">فواتير استبدال</p>
                  <ArrowRightLeft size={18} />
                </div>
                <p className="text-2xl font-black mt-2">{exchangeInvoicesCount}</p>
              </button>
              <button
                type="button"
                onClick={() => setShowDeferredOnly((current) => !current)}
                className={`rounded-2xl border p-4 text-right transition-all ${
                  showDeferredOnly
                    ? 'border-rose-300 bg-rose-100 text-rose-800 shadow-sm ring-2 ring-rose-200'
                    : 'border-rose-100 bg-rose-50 text-rose-700 hover:border-rose-200 hover:bg-rose-100/60'
                }`}
                title={showDeferredOnly ? 'عرض كل الفواتير' : 'إظهار الفواتير الآجلة (غير المسددة بالكامل) فقط'}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black text-rose-600">فواتير آجلة</p>
                  <CreditCard size={18} />
                </div>
                <p className="text-2xl font-black mt-2">{deferredInvoicesCount}</p>
              </button>
            </div>
        </div>

        {salespersonReport.length > 0 && (
          <div className="bg-white rounded-2xl border border-purple-100 shadow-sm mb-6 overflow-hidden">
            <div className="px-5 py-3 bg-purple-50 border-b border-purple-100 flex items-center gap-2">
              <User size={18} className="text-purple-600" />
              <h3 className="font-black text-purple-800">كشف مبيعات وأرباح مسؤولي المبيعات (الفترة المعروضة)</h3>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-400 font-bold">
                <tr>
                  <th className="p-3">مسؤول المبيعات</th>
                  <th className="p-3 text-center">عدد الفواتير</th>
                  <th className="p-3 text-center">إجمالي المبيعات</th>
                  <th className="p-3 text-center text-emerald-600">إجمالي الأرباح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {salespersonReport.map((r) => (
                  <tr key={r.name} className="hover:bg-slate-50">
                    <td className="p-3 font-black text-slate-800">{r.name}</td>
                    <td className="p-3 text-center font-bold text-slate-600">{r.count}</td>
                    <td className="p-3 text-center font-black text-indigo-600">{r.sales.toFixed(2)} {storeSettings.currency}</td>
                    <td className="p-3 text-center font-black text-emerald-600">{r.profit.toFixed(2)} {storeSettings.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 font-medium">
              <tr>
                <th className="p-4">رقم الفاتورة</th>
                <th className="p-4">بيانات العميل</th>
                <th className="p-4">التاريخ والوقت</th>
                <th className="p-4 text-center">المسؤول</th>
                <th className="p-4 text-center">مسؤول المبيعات</th>
                <th className="p-4">تفاصيل المنتجات</th>
                <th className="p-4 text-center border-x border-slate-100 bg-slate-100/50">الإجمالي</th>
                <th className="p-4 text-center text-emerald-600 bg-emerald-50/50">الربح</th>
                <th className="p-4 text-center text-orange-600">قيمة المرتجع</th>
                <th className="p-4 text-center text-green-600">المدفوع</th>
                <th className="p-4 text-center text-red-500 font-black">الباقي عليه</th>
                <th className="p-4 text-center">الحالة</th>
                <th className="p-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-12 text-center text-slate-400 text-lg font-bold">
                    لا يوجد فواتير تطابق بحثك حالياً.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const hasReturns = order.items.some(i => i.returned_quantity > 0);
                  const returnedValue = calculateOrderReturnValue(order);
                  const effectiveDebt = order.type === 'payment' ? 0 : Math.max(0, order.total - order.paid_amount);

                  // Calculate Profit
                  const profit = calculateInvoiceProfit(order);

                  return (
                    <tr key={order.id} className={`hover:bg-slate-50 transition ${order.is_deleted ? 'bg-red-50/40 opacity-80' : hasReturns ? 'bg-red-50/20' : ''}`}>
                      <td className="p-4 font-mono font-bold" style={{ color: storeSettings.themeColor }}>{order.id}</td>
                      <td className="p-4">
                        {order.customer ? (
                          <div className="flex flex-col">
                            <span className="font-bold flex items-center gap-1"><User size={14} style={{ color: storeSettings.themeColor }} /> {order.customer.name}</span>
                            <span className="text-xs text-slate-500 font-mono mt-1" dir="ltr">{order.customer.phone}</span>
                            {(() => {
                              const cDebt = activeOrders.filter(o => o.customer?.id === order.customer!.id)
                                .reduce((sum, o) => {
                                  if (o.type === 'payment' && o.notes?.includes('سداد أجل للفاتورة رقم')) {
                                    return sum;
                                  }
                                  const eTotal = o.type === 'payment' ? 0 : o.total;
                                  return sum + (eTotal - o.paid_amount);
                                }, 0);
                              return cDebt > 0 ? (
                                <span className="text-[10px] font-black text-red-500 mt-1 bg-red-50 px-2 py-0.5 rounded border border-red-100 w-fit">إجمالي الأجل: {cDebt.toFixed(2)}</span>
                              ) : null;
                            })()}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs font-bold bg-slate-100 px-2 py-1 rounded">عميل نقدي</span>
                        )}
                      </td>
                      <td className="p-4 text-slate-500">{new Date(order.date).toLocaleString('ar-SA')}</td>
                      <td className="p-4 text-center font-bold text-indigo-600">{order.cashier_name || 'غير معروف'}</td>
                      <td className="p-4 text-center font-bold text-purple-600">
                        {(order as any).salesperson_name || '—'}
                        {(order as any).exchange_data && <div className="mt-1"><span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">↺ استبدال</span></div>}
                      </td>
                      <td className="p-4 text-right">
                        {order.is_deleted ? (
                          <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 px-3 py-1 rounded-lg text-xs font-bold">
                            <Archive size={14} /> فاتورة محذوفة
                          </span>
                        ) : order.type === 'payment' ? (
                          <div className="flex items-center gap-2 text-indigo-600 font-bold">
                            <CreditCard size={14} /> سداد مديونية آجل
                          </div>
                        ) : (
                          <ul className="space-y-1">
                            {order.items.map(i => (
                              <li key={i.id} className={`flex items-center gap-2 ${i.returned_quantity > 0 ? 'text-red-500' : ''}`}>
                                • {i.name} <span className="text-xs text-slate-400">(الكمية: {i.quantity})</span> 
                                {i.returned_quantity > 0 && <span className="font-bold text-[10px] bg-red-100 px-1.5 py-0.5 rounded text-red-600">مرتجع: {i.returned_quantity}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                       <td className="p-4 text-center font-black border-x border-slate-100 bg-slate-50/50" style={order.type === 'payment' ? { color: storeSettings.themeColor } : {}}>
                        {order.type === 'payment' ? `+ ${order.paid_amount.toFixed(2)}` : order.total.toFixed(2)} {storeSettings.currency}
                      </td>
                      <td className={`p-4 text-center font-black ${
                        profit >= 0 ? 'text-emerald-600 bg-emerald-50/30' : 'text-red-600 bg-red-50/30'
                      }`}>
                        {order.type === 'payment' ? '—' : profit.toFixed(2)}
                      </td>
                      <td className="p-4 text-center font-bold text-orange-600">
                        {returnedValue > 0 ? returnedValue.toFixed(2) : '-'}
                      </td>
                      <td className="p-4 text-center font-black text-green-600">
                        {order.paid_amount.toFixed(2)} {storeSettings.currency}
                      </td>
                      <td className="p-4 text-center font-black text-red-500">
                        {effectiveDebt.toFixed(2)} {storeSettings.currency}
                      </td>
                      <td className="p-4 text-center">
                        {order.type === 'payment' ? (
                          <span style={{ backgroundColor: storeSettings.themeColor + '15', color: storeSettings.themeColor }} className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold">
                            سداد آجل
                          </span>
                        ) : hasReturns ? (
                          <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 px-3 py-1 rounded-lg text-xs font-bold">
                            <ArrowRightLeft size={14} /> مرتجع جزئي/كلي
                          </span>
                        ) : order.total - order.paid_amount > 0 ? (
                          <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-700 px-3 py-1 rounded-lg text-xs font-bold">
                            فاتورة أجل
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-green-100 text-green-600 px-3 py-1 rounded-lg text-xs font-bold">
                            فاتورة مكتملة
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => window.open(`/view-invoice/${order.id}`, '_blank')}
                            className="p-2 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-200 transition-all shadow-sm border border-slate-100"
                            title="عرض تفاصيل الفاتورة"
                          >
                            <Eye size={18} />
                          </button>
                          <button 
                            onClick={() => handlePrint(order)}
                            style={{ backgroundColor: storeSettings.themeColor + '10', color: storeSettings.themeColor }}
                            className="p-2 rounded-lg hover:bg-opacity-20 transition-all shadow-sm border border-transparent hover:border-current"
                            title="طباعة الفاتورة"
                          >
                            <Printer size={18} />
                          </button>
                          {order.customer?.phone && (
                            <button
                              onClick={() => handleSendWhatsApp(order)}
                              className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all shadow-sm border border-emerald-100"
                              title="إرسال الفاتورة عبر واتساب"
                            >
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                              </svg>
                            </button>
                          )}
                          {!order.is_deleted && order.type === 'sale' && !String(order.id).startsWith('OFF-') && (
                            <button
                              onClick={() => setEditingOrder(order)}
                              className="p-2 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all shadow-sm border border-indigo-100"
                              title="تعديل الفاتورة"
                            >
                              <Edit2 size={18} />
                            </button>
                          )}
                          {!order.is_deleted && (
                            <button
                              onClick={() => handleDeleteOrder(order)}
                              className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-all shadow-sm border border-red-100"
                              title="حذف الفاتورة"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {editingOrder && (
        <EditInvoiceModal
          invoice={editingOrder}
          onClose={() => setEditingOrder(null)}
        />
      )}
    </div>
  );
}
