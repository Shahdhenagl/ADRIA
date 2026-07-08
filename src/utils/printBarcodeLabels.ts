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

  // Render the barcode to a PNG once, then reuse it on every label.
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, code, { format: 'CODE128', displayValue: false, width: 2, height: 40, margin: 0 });
  } catch {
    alert('تعذّر توليد صورة الباركود');
    return;
  }
  const img = canvas.toDataURL('image/png');

  const hasDiscount = !!(discountPrice && discountPrice > 0);
  const priceHtml = hasDiscount
    ? `<span class="old">${price} ${escapeHtml(currency)}</span> <span class="new">${discountPrice} ${escapeHtml(currency)}</span>`
    : `<span class="new">${price} ${escapeHtml(currency)}</span>`;

  const n = Math.max(1, Math.floor(count) || 1);
  const oneLabel = `
    <div class="label">
      ${storeName ? `<div class="store">${escapeHtml(storeName)}</div>` : ''}
      <div class="name">${escapeHtml(name)}</div>
      <img class="bc" src="${img}" />
      <div class="code">${escapeHtml(code)}</div>
      <div class="price">${priceHtml}</div>
    </div>`;
  const labels = Array.from({ length: n }).map(() => oneLabel).join('');

  // Label roll: 38mm wide x 25mm tall.
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>طباعة باركود</title>
  <style>
    @page { size: 38mm 25mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Tahoma, Arial, sans-serif; }
    .label { width: 38mm; height: 25mm; padding: 0.5mm 1mm; text-align: center; page-break-after: always;
             display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; line-height: 1.1; }
    .store { font-size: 8px; font-weight: 900; white-space: nowrap; overflow: hidden; max-width: 100%; }
    .name { font-size: 7px; font-weight: bold; white-space: nowrap; overflow: hidden; max-width: 100%; }
    .bc { width: 35mm; height: 8mm; object-fit: contain; }
    .code { font-size: 7px; letter-spacing: 0.5px; }
    .price .old { text-decoration: line-through; color: #777; font-size: 7px; margin-left: 3px; }
    .price .new { font-size: 9px; font-weight: 900; }
  </style></head><body>${labels}
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},400);};<\/script>
  </body></html>`;

  void printDocument('barcode', html);
}
