import { escapeHtml } from './escapeHtml';
import { openPrintWindow } from './printWindow';

export const printPaymentReceipt = (order: any, storeSettings: any) => {
  const printDate = new Date(order.date || order.created_at || new Date()).toLocaleString('ar-SA');
  
  // Extract info from notes if available
  let description = 'تحصيل مديونية سابقة';
  let paymentType = '';
  
  if (order.notes && order.notes.includes('سداد أجل للفاتورة رقم')) {
    const match = order.notes.match(/سداد أجل للفاتورة رقم #?(\w+)/);
    const invoiceId = match ? match[1] : '';
    
    // Check if there is a custom note
    const descMatch = order.notes.match(/الوصف: (.*?)\s*\|/);
    const customDesc = descMatch ? descMatch[1].trim() : '';

    // Check if it's partial or full based on remaining debt in notes
    const remainingMatch = order.notes.match(/المتبقي: ([\d.]+)/);
    const remaining = remainingMatch ? parseFloat(remainingMatch[1]) : 0;
    
    paymentType = remaining > 0 ? '(سداد جزئي)' : '(سداد كلي)';
    description = `سداد أجل لفاتورة رقم #${invoiceId} ${paymentType}`;
    if (customDesc) {
      description += `<br/><span style="font-size:12px;color:#64748b;margin-top:4px;display:block;">${escapeHtml(customDesc)}</span>`;
    }
  } else if (order.notes && order.notes.includes('PREV-DEBT-')) {
     description = 'تحصيل رصيد مديونية قديم';
  } else if (order.notes && order.notes.includes('تحصيل')) {
     description = order.notes;
  }

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <title>إيصال استلام نقدية #${order.id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
    *{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo', sans-serif;}
    body{background:#fff;color:#1e293b;padding:0;margin:0;}
    .invoice-container{width:148mm;min-height:100mm;margin:0 auto;padding:5mm;position:relative;display:flex;flex-direction:column;gap:5px;}
    
    .header-main{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1e293b;padding-bottom:5px;margin-bottom:5px;}
    .logo{width:80px;height:80px;object-fit:contain;border-radius:12px;border:1px solid #e2e8f0;padding:2px;background:#fff;}
    .store-name{font-size:24px;font-weight:900;color:#1e293b;line-height:1.2;}
    .store-info-center{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 10px;}
    
    .receipt-title{font-size:18px;font-weight:900;margin-bottom:10px;text-align:center;border:2px solid #1e293b;padding:4px;border-radius:8px;}
    
    .customer-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:5px;background:#f8fafc;padding:8px;border-radius:10px;border:1px solid #e2e8f0;}
    .info-item{font-size:12px;display:flex;gap:6px;}
    .info-item strong{color:#64748b;white-space:nowrap;}
    .info-item span{color:#1e293b;font-weight:700;}
    
    table{width:100%;border-collapse:collapse;margin-top:10px;}
    thead th{background:#f1f5f9;color:#475569;font-size:12px;padding:8px 6px;text-align:right;border-bottom:2px solid #cbd5e1;}
    thead th:last-child{text-align:left;}
    
    .totals{margin-top:10px;width:100%;}
    .total-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;border-bottom:1px dashed #e2e8f0;}
    .grand-total{font-size:18px;font-weight:900;border-top:2px solid #1e293b;margin-top:6px;padding-top:8px;}
    .footer{text-align:center;margin-top:16px;font-size:12px;color:#888;font-weight:bold;}
    
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
    </div>
    <div style="width:80px;"></div>
  </div>
  
  <div class="receipt-title">إيصال استلام نقدية</div>
  
  <div class="customer-info-grid">
    <div class="info-item"><strong>رقم الإيصال:</strong> <span>${order.id}</span></div>
    <div class="info-item"><strong>التاريخ:</strong> <span>${printDate}</span></div>
    <div class="info-item"><strong>العميل:</strong> <span>${escapeHtml(order.customer?.name || '—')}</span></div>
    <div class="info-item"><strong>رقم الهاتف:</strong> <span dir="ltr">${escapeHtml(order.customer?.phone || '—')}</span></div>
    ${order.cashier_name ? `<div class="info-item"><strong>المستلم:</strong> <span>${escapeHtml(order.cashier_name)}</span></div>` : ''}
  </div>
  
  <table>
    <thead><tr><th>البيان</th><th style="text-align:left">المبلغ</th></tr></thead>
    <tbody>
      <tr>
        <td style="padding:12px 4px;border-bottom:1px solid #eee;font-size:14px;font-weight:bold;">${description}</td>
        <td style="padding:12px 4px;border-bottom:1px solid #eee;text-align:left;font-size:14px;font-weight:bold;">${(order.paid_amount || 0).toFixed(2)}</td>
      </tr>
    </tbody>
  </table>
  
  <div class="totals">
    <div class="total-row grand-total"><span>إجمالي المبلغ المدفوع:</span><span>${(order.paid_amount || 0).toFixed(2)} ${storeSettings.currency}</span></div>
    
    <div style="margin-top:10px; padding:8px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
      <div style="font-size:11px; color:#64748b; margin-bottom:4px; border-bottom:1px solid #e2e8f0; padding-bottom:2px; text-align:right;">طرق الدفع:</div>
      ${order.paid_cash > 0 ? `<div class="total-row" style="font-size:12px;border:none;"><span>كاش:</span><span>${order.paid_cash.toFixed(2)}</span></div>` : ''}
      ${order.paid_visa > 0 ? `<div class="total-row" style="font-size:12px;border:none;"><span>فيزا:</span><span>${order.paid_visa.toFixed(2)}</span></div>` : ''}
      ${order.paid_wallet > 0 ? `<div class="total-row" style="font-size:12px;border:none;"><span>محفظة:</span><span>${order.paid_wallet.toFixed(2)}</span></div>` : ''}
      ${order.paid_instapay > 0 ? `<div class="total-row" style="font-size:12px;border:none;"><span>انستا باي:</span><span>${order.paid_instapay.toFixed(2)}</span></div>` : ''}
    </div>
    
    ${order.notes && order.notes.includes('المتبقي: ') ? `
      <div style="margin-top:10px; font-size:13px; font-weight:900; color:#dc2626; text-align:center; padding:8px; border:2px dashed #fecaca; background:#fef2f2; border-radius:8px;">
        المديونية المتبقية للفاتورة: ${order.notes.match(/المتبقي: ([\d.]+)/)?.[1] || 0} ${storeSettings.currency}
      </div>
    ` : ''}
  </div>
  
  <div class="footer">شكراً لثقتكم بنا</div>
</div>
  <script>window.onload=()=>{setTimeout(()=>{window.print();window.onafterprint=()=>window.close();},500);}</script>
</body></html>`;

  openPrintWindow(html);
};
