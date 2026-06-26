/**
 * Opens a new browser window and writes the given HTML into it for printing.
 *
 * Consolidates the `window.open(...) + document.write + document.close()`
 * boilerplate that was duplicated across every print/receipt builder.
 * Returns the opened window, or null if the browser blocked the popup.
 */
export function openPrintWindow(html: string, features = 'width=800,height=1000'): Window | null {
  const pw = window.open('', '_blank', features);
  if (!pw) return null;
  pw.document.write(html);
  pw.document.close();
  return pw;
}
