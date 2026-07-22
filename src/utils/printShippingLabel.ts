/**
 * بوليصة شحن / فاتورة طلب أونلاين — بتتسلّم لشركة الشحن.
 * فيها بيانات العميل كاملة (اسم/تليفون/عنوان)، الأصناف، والمبلغ **المطلوب
 * تحصيله عند التسليم** (الإجمالي ناقص العربون المدفوع مقدماً) — ده أهم رقم
 * للمندوب، فمعروض كبير ومنفصل عن الإجمالي عشان ما يتحصّلش الإجمالي بالغلط.
 *
 * مشترك بين شاشة الكاشير وموديول لوحة التحكم عشان الاتنين يطبعوا نفس المستند.
 */
import { escapeHtml } from './escapeHtml';
import { openPrintWindow } from './printWindow';
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
  created_at: string;
  cashier_name?: string | null;
}

export function printShippingLabel(held: ShippingLabelHeld, settings: any) {
  const cur = settings?.currency || 'ج.م';
  const dep = Math.max(0, Number(held.deposit) || 0);
  const total = Number(held.total) || 0;
  const due = Math.max(0, total - dep);
  const orderRef = String(held.id).slice(-6).toUpperCase();

  const rows = (held.items || []).map((it: any, i: number) => `
    <tr>
      <td style="text-align:center;">${i + 1}</td>
      <td style="font-weight:bold;">${escapeHtml(it.name || '')}</td>
      <td style="text-align:center;">${escapeHtml(formatQty(it.quantity, it.unit || 'قطعة'))}</td>
      <td style="text-align:center;">${(Number(it.sale_price) || 0).toFixed(2)}</td>
      <td style="text-align:left;font-weight:bold;">${((Number(it.sale_price) || 0) * (Number(it.quantity) || 0)).toFixed(2)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="UTF-8"/>
<title>بوليصة شحن #${escapeHtml(orderRef)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
  *{font-family:'Cairo',sans-serif;box-sizing:border-box;margin:0;padding:0;}
  body{padding:10mm;color:#000;font-size:13px;}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #000;padding-bottom:8px;margin-bottom:10px;}
  .shop{font-size:20px;font-weight:900;}
  .meta{font-size:11px;color:#444;line-height:1.7;text-align:left;}
  .tag{display:inline-block;background:#000;color:#fff;padding:3px 10px;border-radius:5px;font-weight:900;font-size:12px;}
  .box{border:2px solid #000;border-radius:8px;padding:10px;margin-bottom:10px;}
  .box h3{font-size:12px;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;color:#555;}
  .row{display:flex;gap:8px;margin-bottom:4px;font-size:14px;}
  .row b{min-width:70px;color:#555;font-size:12px;}
  .addr{font-size:16px;font-weight:900;line-height:1.6;}
  table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12px;}
  th,td{border:1px solid #999;padding:5px 7px;text-align:right;}
  thead th{background:#eee;font-weight:900;}
  .due{border:3px solid #000;border-radius:8px;padding:10px 14px;text-align:center;margin-top:10px;background:#f5f5f5;}
  .due .lbl{font-size:12px;font-weight:700;color:#333;}
  .due .val{font-size:30px;font-weight:900;line-height:1.2;}
  .due .sub{font-size:11px;color:#555;margin-top:3px;}
  .sign{display:flex;justify-content:space-between;margin-top:18px;font-size:11px;color:#555;}
  .sign div{border-top:1px dashed #999;padding-top:5px;width:45%;text-align:center;}
  @media print{@page{size:A5;margin:6mm;} body{padding:0;}}
</style></head><body>
  <div class="head">
    <div>
      <div class="shop">${escapeHtml(settings?.name || 'المتجر')}</div>
      <div style="font-size:11px;color:#444;">${escapeHtml(settings?.phone || '')}${settings?.phone2 ? ` · ${escapeHtml(settings.phone2)}` : ''}</div>
    </div>
    <div class="meta">
      <span class="tag">طلب أونلاين #${escapeHtml(orderRef)}</span><br/>
      ${new Date(held.created_at).toLocaleString('ar-EG', { calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short' })}
      ${held.cashier_name ? `<br/>الموظف: ${escapeHtml(held.cashier_name)}` : ''}
    </div>
  </div>

  <div class="box">
    <h3>بيانات المستلم</h3>
    <div class="row"><b>الاسم:</b> <span style="font-weight:900;font-size:15px;">${escapeHtml(held.customer_name?.trim() || 'عميل')}</span></div>
    <div class="row"><b>الموبايل:</b> <span dir="ltr" style="font-weight:900;font-size:15px;">${escapeHtml(held.customer_phone || '—')}</span></div>
    <div class="row"><b>العنوان:</b> <span class="addr">${escapeHtml(held.customer_address?.trim() || '— لم يُسجَّل عنوان —')}</span></div>
    ${held.shipping_note ? `<div class="row"><b>للمندوب:</b> <span style="font-weight:700;">${escapeHtml(held.shipping_note)}</span></div>` : ''}
    ${held.notes ? `<div class="row"><b>ملاحظات:</b> <span>${escapeHtml(held.notes)}</span></div>` : ''}
  </div>

  <table>
    <thead><tr><th style="width:30px;">#</th><th>الصنف</th><th style="width:70px;">الكمية</th><th style="width:70px;">السعر</th><th style="width:80px;">الإجمالي</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;">لا توجد أصناف</td></tr>'}</tbody>
  </table>

  <div class="due">
    <div class="lbl">المطلوب تحصيله عند التسليم</div>
    <div class="val">${due.toFixed(2)} ${escapeHtml(cur)}</div>
    <div class="sub">
      إجمالي الطلب ${total.toFixed(2)} ${escapeHtml(cur)}
      ${dep > 0 ? ` — مدفوع مقدماً ${dep.toFixed(2)} ${escapeHtml(cur)}` : ''}
    </div>
  </div>

  <div class="sign">
    <div>توقيع المندوب</div>
    <div>توقيع المستلم</div>
  </div>

  <script>window.onload=()=>{setTimeout(()=>{window.print();},400);}</script>
</body></html>`;

  openPrintWindow(html);
}
