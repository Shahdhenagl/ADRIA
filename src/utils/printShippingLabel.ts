/**
 * إيصال الطلب الأونلاين — بيتطبع على نفس رول الـ 80mm بتاع فاتورة البيع.
 *
 * قبل كده كان مستند A5 بجداول وبراويز (شكل مختلف تماماً عن فاتورة البيع وبياخد
 * ورق كتير). دلوقتي بيستخدم نفس ستايل فاتورة البيع بالظبط (72mm، نفس أسماء
 * الكلاسات عشان buildPagesQrBlock يرندر زيها) + الزيادات اللي الطلب الأونلاين
 * محتاجها:
 *   - وسم «طلب أونلاين» وحالة الطلب.
 *   - عنوان التوصيل وملاحظة المندوب (بارزين — دي أهم حاجة للمندوب).
 *   - المدفوع مقدماً (العربون) والمطلوب تحصيله عند التسليم.
 *
 * مشترك بين شاشة الكاشير وموديول لوحة التحكم عشان الاتنين يطبعوا نفس المستند.
 */
import { escapeHtml } from './escapeHtml';
import { printDocument, AUTO_PRINT_SCRIPT } from './printWindow';
import { buildPagesQrBlock } from './pagesQr';
import { formatQty } from './units';

export interface ShippingLabelHeld {
  id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  shipping_note?: string | null;
  notes?: string | null;
  items?: any[];
  total: number;
  deposit?: number | null;
  deposit_split?: Record<string, number> | null;
  status?: string | null;
  created_at: string;
  cashier_name?: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  held: 'قيد التجهيز',
  shipped: 'تم الشحن',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

export async function printShippingLabel(held: ShippingLabelHeld, settings: any): Promise<void> {
  const cur = settings?.currency || 'ج.م';
  const dep = Math.max(0, Number(held.deposit) || 0);
  const total = Number(held.total) || 0;
  const due = Math.max(0, total - dep);
  const orderRef = String(held.id).slice(-6).toUpperCase();
  const statusText = STATUS_TEXT[String(held.status || 'held')] || '';

  const printDate = new Date(held.created_at).toLocaleString('ar-EG', {
    calendar: 'gregory', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const itemsHtml = (held.items || []).map((it: any, i: number) => {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.sale_price) || 0;
    return `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td style="font-weight:bold;">${escapeHtml(it.name || '')}</td>
        <td style="text-align:center;">${escapeHtml(formatQty(qty, it.unit || 'قطعة'))}</td>
        <td style="text-align:center;">${price.toFixed(2)}</td>
        <td style="text-align:left;font-weight:bold;">${(price * qty).toFixed(2)}</td>
      </tr>`;
  }).join('');

  const pagesQrBlock = buildPagesQrBlock(settings);

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>طلب أونلاين #${escapeHtml(orderRef)}</title>
<style>
  /* من غير @import لخطوط جوجل: الـ CSS import ده بيوقف رسم الصفحة كلها لحد ما
     السيرفر يرد. الطابعة بتاخد «صورة» من الصفحة، فلو النت بطيء بتتصور نص
     صفحة → الإيصال بيطلع مقصوص. الخط بيتاخد من الجهاز لو متسطّب، وإلا Tahoma. */
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif;}
  body{background:#fff;color:#000;margin:0;}
  .invoice-container{width:72mm;margin:0 auto;padding:0 1.5mm 2mm;display:flex;flex-direction:column;}

  .header-main{text-align:center;border-bottom:1px dashed #000;padding-bottom:3px;margin-bottom:3px;}
  .logo{max-height:42px;max-width:48mm;width:auto;object-fit:contain;display:block;margin:0 auto 1px;}
  .store-name{font-size:18px;font-weight:900;color:#000;line-height:1.1;}
  .store-details{font-size:10px;color:#000;margin-top:1px;line-height:1.3;font-weight:bold;}

  /* برواز أسود على أبيض — مش خلفية سوداء. الطابعة الحرارية بتاخد وقت في طباعة
     البلوك الأسود الكامل وبيطلع مسحة سودا والكلام مش باين. */
  .kind-bar{margin:3px 0;padding:3px 0;text-align:center;border:2px solid #000;border-radius:4px;
            font-size:13px;font-weight:900;letter-spacing:1px;}

  .customer-info-grid{display:flex;flex-direction:column;gap:1px;margin-bottom:4px;font-size:11px;}
  .info-item{display:flex;justify-content:space-between;gap:6px;padding:1px 0;}
  .info-item strong{color:#000;white-space:nowrap;}
  .info-item span{color:#000;font-weight:700;}

  .addr-box{border:1.5px solid #000;border-radius:4px;padding:4px 5px;margin-bottom:4px;}
  .addr-box .lbl{font-size:10px;font-weight:900;}
  .addr-box .addr{font-size:13px;font-weight:900;line-height:1.45;}
  .addr-box .note{font-size:11px;font-weight:700;margin-top:2px;border-top:1px dotted #999;padding-top:2px;}

  table{width:100%;border-collapse:collapse;margin-bottom:3px;}
  thead th{font-size:11px;padding:3px 1px;border-bottom:1.5px solid #000;font-weight:900;white-space:nowrap;}
  thead th:nth-child(2){text-align:right;}
  thead th:last-child{text-align:left;}
  tbody td{font-size:12px;padding:3px 1px;border-bottom:1px dotted #999;vertical-align:middle;font-weight:700;}
  tbody td:nth-child(1),tbody td:nth-child(3),tbody td:nth-child(4),tbody td:nth-child(5){white-space:nowrap;}

  .summary-section{width:100%;margin-top:3px;}
  .summary-row{display:flex;justify-content:space-between;padding:2px 0;font-size:12px;font-weight:700;}
  .summary-row.total{border-top:1.5px solid #000;border-bottom:1.5px solid #000;margin-top:2px;padding:4px 0;font-size:18px;font-weight:900;color:#000;}

  .payment-status{margin-top:5px;padding:5px;border:1.5px solid #000;border-radius:4px;text-align:center;font-weight:900;font-size:13px;color:#000;}
  .due-big{font-size:22px;font-weight:900;line-height:1.2;margin-top:1px;}

  .qr-row{display:flex;justify-content:center;align-items:flex-start;gap:10px;}
  .qr-code-container{display:flex;flex-direction:column;align-items:center;gap:1px;margin-top:4px;}
  .qr-code-img{width:68px;height:68px;}
  .qr-label{font-size:9px;font-weight:900;color:#000;text-align:center;}

  .sign{display:flex;justify-content:space-between;gap:6px;margin-top:10px;font-size:9px;font-weight:bold;}
  .sign div{border-top:1px dashed #000;padding-top:3px;width:48%;text-align:center;}

  .footer{text-align:center;margin-top:4px;padding-top:3px;border-top:1px dashed #000;font-size:9px;color:#000;font-weight:bold;}

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
    ${settings?.logo ? `<img class="logo" src="${escapeHtml(settings.logo)}" onerror="this.style.display='none'" />` : `<div class="store-name">${escapeHtml(settings?.name || 'المتجر')}</div>`}
    <div class="store-details">
      ${settings?.address ? `${escapeHtml(settings.address)}<br/>` : ''}
      ${settings?.phone ? `${escapeHtml(settings.phone)}` : ''}
      ${settings?.phone2 ? ` | ${escapeHtml(settings.phone2)}` : ''}
    </div>
  </div>

  <div class="kind-bar">طلب أونلاين${statusText ? ` — ${escapeHtml(statusText)}` : ''}</div>

  <div class="customer-info-grid">
    <div class="info-item"><strong>اسم العميل:</strong> <span>${escapeHtml(held.customer_name?.trim() || 'عميل')}</span></div>
    <div class="info-item"><strong>رقم الهاتف:</strong> <span dir="ltr">${escapeHtml(held.customer_phone || '—')}</span></div>
    <div class="info-item"><strong>رقم الطلب:</strong> <span>#${escapeHtml(orderRef)}</span></div>
    <div class="info-item"><strong>التاريخ:</strong> <span>${printDate}</span></div>
    ${held.cashier_name ? `<div class="info-item"><strong>الموظف:</strong> <span>${escapeHtml(held.cashier_name)}</span></div>` : ''}
  </div>

  <div class="addr-box">
    <div class="lbl">عنوان التوصيل:</div>
    <div class="addr">${escapeHtml(held.customer_address?.trim() || '— لم يُسجَّل عنوان —')}</div>
    ${held.shipping_note ? `<div class="note">للمندوب: ${escapeHtml(held.shipping_note)}</div>` : ''}
  </div>

  <table>
    <thead><tr>
      <th style="width:8%">#</th>
      <th style="text-align:right">الصنف</th>
      <th style="width:14%">كمية</th>
      <th style="width:20%">سعر</th>
      <th style="width:22%;text-align:left">إجمالي</th>
    </tr></thead>
    <tbody>${itemsHtml || '<tr><td colspan="5" style="text-align:center;">لا توجد أصناف</td></tr>'}</tbody>
  </table>

  <div class="summary-section">
    <div class="summary-row total"><span>إجمالي الطلب:</span><span>${total.toFixed(2)} ${escapeHtml(cur)}</span></div>
    ${dep > 0 ? `<div class="summary-row"><span>مدفوع مقدماً (عربون):</span><span>− ${dep.toFixed(2)} ${escapeHtml(cur)}</span></div>` : ''}

    <div class="payment-status">
      ${due > 0.009 ? `
        <div>المطلوب تحصيله عند التسليم</div>
        <div class="due-big">${due.toFixed(2)} ${escapeHtml(cur)}</div>
      ` : `<div>✓ الطلب مدفوع بالكامل — لا يُحصَّل أي مبلغ</div>`}
    </div>

    ${held.notes ? `
      <div style="margin-top:5px; padding:4px 5px; border:1px solid #000; border-radius:4px;">
        <span style="font-size:10px; font-weight:900;">ملاحظات: </span>
        <span style="font-size:11px; font-weight:700;">${escapeHtml(held.notes)}</span>
      </div>
    ` : ''}
  </div>

  ${pagesQrBlock ? `<div class="qr-row">${pagesQrBlock}</div>` : ''}

  <div class="sign">
    <div>توقيع المندوب</div>
    <div>توقيع المستلم</div>
  </div>

  <div class="footer">شكراً لتعاملكم معنا</div>
</div>
${AUTO_PRINT_SCRIPT}
</body></html>`;

  await printDocument('invoice', html);
}
