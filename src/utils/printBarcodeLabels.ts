import JsBarcode from 'jsbarcode';
import { escapeHtml } from './escapeHtml';
import { openPrintWindow } from './printWindow';

// Generates a unique numeric barcode (12 digits). Pass existing codes to avoid collisions.
export function generateBarcode(existing: Set<string> = new Set()): string {
  let code = '';
  do {
    code = '2' + String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  } while (existing.has(code));
  return code;
}

// Prints `count` barcode labels on the thermal label printer.
export function printBarcodeLabels(opts: {
  name: string;
  code: string;
  price: number;
  discountPrice?: number;
  currency: string;
  count: number;
}) {
  const { name, code, price, discountPrice, currency, count } = opts;
  if (!code) { alert('لا يوجد باركود لطباعته'); return; }

  // Render the barcode to a PNG once, then reuse it on every label.
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, code, { format: 'CODE128', displayValue: false, width: 2, height: 50, margin: 0 });
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
      <div class="name">${escapeHtml(name)}</div>
      <img class="bc" src="${img}" />
      <div class="code">${escapeHtml(code)}</div>
      <div class="price">${priceHtml}</div>
    </div>`;
  const labels = Array.from({ length: n }).map(() => oneLabel).join('');

  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>طباعة باركود</title>
  <style>
    @page { size: 40mm 30mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Tahoma, Arial, sans-serif; }
    .label { width: 40mm; height: 30mm; padding: 1mm; text-align: center; page-break-after: always;
             display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
    .name { font-size: 9px; font-weight: bold; white-space: nowrap; overflow: hidden; max-width: 100%; }
    .bc { width: 36mm; height: 11mm; object-fit: contain; }
    .code { font-size: 8px; letter-spacing: 1px; }
    .price .old { text-decoration: line-through; color: #777; font-size: 9px; margin-left: 3px; }
    .price .new { font-size: 11px; font-weight: bold; }
  </style></head><body>${labels}
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},400);};<\/script>
  </body></html>`;

  openPrintWindow(html, 'width=420,height=640');
}
