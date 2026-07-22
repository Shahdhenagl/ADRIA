/**
 * Prints the given HTML.
 *
 * Desktop: opens a separate window so the document's own `@page` size/margins
 * apply (custom label/receipt size, and margin:0 hides the browser's
 * date/URL/page-number headers & footers).
 *
 * Mobile: popups are blocked there, so we fall back to a hidden iframe and
 * trigger printing once ourselves (so it still prints from the phone).
 */
import { printViaQz, type PrintKind } from './qzPrint';

/**
 * Print a document, preferring silent QZ Tray printing (to the printer mapped
 * for this `kind` in settings) and falling back to the browser print window
 * when QZ isn't enabled/available. Use this for all invoice/barcode printing.
 */
export async function printDocument(kind: PrintKind, html: string, features?: string): Promise<void> {
  try {
    const ok = await printViaQz(kind, html);
    if (ok) return;
  } catch { /* fall through to browser print */ }
  openPrintWindow(html, features);
}

/**
 * سكربت الطباعة التلقائية للمستندات المطبوعة.
 *
 * القديم كان `window.onload = ...` وبس، وده بيقع في حالتين:
 *  - النافذة اتفتحت بـ window.open('') والـ load اتنفّذ على الصفحة الفاضية قبل
 *    document.write → الحدث مش هيحصل تاني والطباعة مبتحصلش خالص (المستخدم
 *    بيفضل مستني وبعدين بيضغط طباعة بنفسه أو يضغط الزرار تاني فتطلع نسخ).
 *  - مورد خارجي (خط أو صورة QR) بيعلّق → الـ load مبيجيش أبداً.
 *
 * الحل: نطبع لما الصفحة تخلص تحميل، أو فوراً لو كانت خلصت بالفعل، مع مؤقّت
 * احتياطي — وكله محمي بعلم `printed` عشان تطلع نسخة واحدة بس.
 */
export const AUTO_PRINT_SCRIPT = `<script>(function(){
  var printed=false;
  function go(){
    if(printed) return; printed=true;
    window.onafterprint=function(){ try{window.close();}catch(e){} };
    try{ window.focus(); window.print(); }catch(e){}
  }
  if(document.readyState==='complete') setTimeout(go,300);
  else window.addEventListener('load',function(){ setTimeout(go,300); });
  setTimeout(go,2500); // احتياطي لو مورد خارجي علّق
})();<\/script>`;

export function openPrintWindow(html: string, features = 'width=800,height=1000'): Window | null {
  const isMobile = typeof navigator !== 'undefined'
    && /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(navigator.userAgent);

  if (!isMobile) {
    const pw = window.open('', '_blank', features);
    if (pw) {
      pw.document.write(html);
      pw.document.close();
      return pw;
    }
    // popup blocked → fall through to iframe
  }

  // Neutralize the HTML's own auto-print so we control it once from here.
  const cleaned = html.replace(/window\.print\(\)/g, 'void 0');
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) { iframe.remove(); return null; }

  doc.open();
  doc.write(cleaned);
  doc.close();

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try { win.focus(); win.print(); } catch { /* ignore */ }
  };
  win.onload = () => setTimeout(triggerPrint, 300);
  setTimeout(triggerPrint, 1200);
  setTimeout(() => iframe.remove(), 60000);

  return win;
}
