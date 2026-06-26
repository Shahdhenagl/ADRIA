/**
 * Escapes a value for safe interpolation into an HTML string.
 *
 * The print/receipt builders assemble HTML via template literals and write it
 * into a popup window. Any value that originates from user input (customer
 * names, notes, product names, addresses, etc.) must be passed through this
 * helper to prevent stored-XSS in the print window.
 *
 * Only escape *leaf* data values — do NOT wrap strings that intentionally
 * contain app-generated markup.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
