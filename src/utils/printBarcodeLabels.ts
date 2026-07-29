import JsBarcode from 'jsbarcode';
import { escapeHtml } from './escapeHtml';
import { printDocument } from './printWindow';

// باركود تسلسلي: آخر باركود رقمي + 1. يتجاهل الأكواد الطويلة (العالمية أو العشوائية القديمة)
// حتى يبدأ السيريال نظيفاً ويزيد 1 في كل مرة. يبدأ من 1000 لو مفيش باركود تسلسلي بعد.
export function generateBarcode(existing: Set<string> = new Set()): string {
  let max = 0;
  for (const code of existing) {
    if (/^\d+$/.test(code) && code.length <= 9) {
      const n = parseInt(code, 10);
      if (n > max) max = n;
    }
  }
  let next = max > 0 ? max + 1 : 1000;
  let candidate = String(next);
  while (existing.has(candidate)) { next++; candidate = String(next); }
  return candidate;
}

/** صنف واحد في أمر الطباعة: بياناته + عدد الملصقات المطلوبة منه. */
export interface BarcodeLabelItem {
  name: string;
  code: string;
  price: number;
  discountPrice?: number;
  count: number;
}

/**
 * طباعة ملصقات باركود لأكتر من صنف في أمر طباعة واحد (رول 38×25 مم).
 * كل صنف بياخد عدد الملصقات بتاعه، والأصناف بتتطبع ورا بعض بنفس الترتيب —
 * فتقدر تطبع فاتورة مشتريات كاملة بكمياتها مرة واحدة.
 */
export function printBarcodeLabelsBatch(
  items: BarcodeLabelItem[],
  opts: { currency: string; storeName?: string }
) {
  const { currency, storeName } = opts;
  const usable = items.filter((it) => it.code && (Math.floor(it.count) || 0) > 0);
  if (usable.length === 0) { alert('مفيش أصناف بباركود وكمية للطباعة'); return; }

  const blocks: string[] = [];
  const failed: string[] = [];

  for (const it of usable) {
    // صورة الباركود بتتولّد مرة لكل صنف وبتتكرر على ملصقاته.
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, it.code, { format: 'CODE128', displayValue: false, width: 2, height: 40, margin: 0 });
    } catch {
      failed.push(it.name || it.code);
      continue;
    }
    const img = canvas.toDataURL('image/png');

    const hasDiscount = !!(it.discountPrice && it.discountPrice > 0);
    const priceHtml = hasDiscount
      ? `<span class="old">${it.price} ${escapeHtml(currency)}</span> <span class="new">${it.discountPrice} ${escapeHtml(currency)}</span>`
      : `<span class="new">${it.price} ${escapeHtml(currency)}</span>`;

    // كود القطعة بيتكتب على جنب الليبل بالطول (زي ليبلات المحلات) — أوضح وأسهل
    // في القراءة من غير ما ياخد سطر من الارتفاع المحدود.
    const oneLabel = `
    <div class="label">
      <div class="main">
        ${storeName ? `<div class="store">${escapeHtml(storeName)}</div>` : ''}
        <div class="name">${escapeHtml(it.name)}</div>
        <img class="bc" src="${img}" />
        <div class="price">${priceHtml}</div>
      </div>
      <div class="side">${escapeHtml(it.code)}</div>
    </div>`;
    const n = Math.max(1, Math.floor(it.count) || 1);
    blocks.push(Array.from({ length: n }).map(() => oneLabel).join(''));
  }

  if (blocks.length === 0) { alert('تعذّر توليد صور الباركود'); return; }
  if (failed.length) alert(`تعذّر توليد باركود لـ ${failed.length} صنف:\n${failed.slice(0, 5).join('\n')}`);

  void printDocument('barcode', wrapLabels(blocks.join('')));
}

// Prints `count` barcode labels on a 38mm x 25mm thermal label roll.
export function printBarcodeLabels(opts: {
  name: string;
  code: string;
  price: number;
  discountPrice?: number;
  currency: string;
  count: number;
  storeName?: string;
}) {
  const { name, code, price, discountPrice, currency, count, storeName } = opts;
  if (!code) { alert('لا يوجد باركود لطباعته'); return; }
  printBarcodeLabelsBatch([{ name, code, price, discountPrice, count }], { currency, storeName });
}

// Label roll: 38mm wide x 25mm tall.
function wrapLabels(labels: string): string {
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>طباعة باركود</title>
  <style>
    @page { size: 38mm 25mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Tahoma, Arial, sans-serif; }
    .label { width: 38mm; height: 25mm; padding: 0.5mm 0.8mm; page-break-after: always; direction: ltr;
             display: flex; flex-direction: row; align-items: stretch; overflow: hidden; line-height: 1.15; }
    .main { flex: 1; min-width: 0; text-align: center; display: flex; flex-direction: column;
            align-items: center; justify-content: center; overflow: hidden; }
    .store { font-size: 13px; font-weight: 900; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; max-width: 100%; }
    .name { font-size: 8px; font-weight: bold; white-space: nowrap; overflow: hidden; max-width: 100%; }
    /* الباركود أضيق من عرض الليبل عشان يفضل مسافة للكود اللي على الجنب */
    .bc { width: 27mm; height: 7.5mm; object-fit: contain; margin: 0.3mm 0; }
    .price { direction: rtl; }
    .price .old { text-decoration: line-through; color: #777; font-size: 8px; margin-left: 3px; }
    .price .new { font-size: 14px; font-weight: 900; }
    /* كود القطعة بالطول على جنب الليبل — يتقرا من تحت لفوق */
    .side { width: 5mm; flex: 0 0 5mm; display: flex; align-items: center; justify-content: center;
            font-size: 13px; font-weight: 900; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden;
            writing-mode: vertical-rl; transform: rotate(180deg); }
  </style></head><body>${labels}
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},400);};<\/script>
  </body></html>`;

  return html;
}
