/**
 * Opens the given HTML for printing.
 *
 * On desktop it opens a popup window. On mobile (or whenever the browser blocks
 * the popup, which returns null) it falls back to a hidden iframe so printing
 * still works without a popup. The HTML is expected to call window.print()
 * itself (via an inline onload script).
 */
export function openPrintWindow(html: string, features = 'width=800,height=1000'): Window | null {
  const pw = window.open('', '_blank', features);
  if (pw) {
    pw.document.write(html);
    pw.document.close();
    return pw;
  }

  // Popup blocked (common on mobile) → print via a hidden iframe instead.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return null; }
  doc.open();
  doc.write(html);
  doc.close();

  // Printing is triggered by the HTML's own inline onload script (runs inside
  // the iframe). Clean up the iframe afterwards.
  setTimeout(() => iframe.remove(), 60000);
  return iframe.contentWindow;
}
