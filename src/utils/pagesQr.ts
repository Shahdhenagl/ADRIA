/**
 * The store's "follow us" QR — a fixed QR printed on every invoice that points
 * at the shop's social pages, next to the existing per-invoice QR.
 *
 * The URL/label live in store settings (db/43), so the same block renders from
 * both the cashier receipt (POS) and the admin reprint without either one
 * hardcoding the link.
 *
 * Kept on the same api.qrserver.com service the per-invoice QR already uses, so
 * printing gains no new dependency and both codes render identically.
 */
import { escapeHtml } from './escapeHtml';

type SettingsLike = {
  pagesQrUrl?: string;
  pagesQrLabel?: string;
};

export function pagesQrLinkOf(settings: SettingsLike): string {
  return (settings.pagesQrUrl || '').trim();
}

/**
 * HTML for the follow-us QR, or '' when no link is configured — an empty string
 * keeps the invoice exactly as it was for stores that never set one up.
 *
 * The returned markup reuses the `.qr-code-container` / `.qr-code-img` /
 * `.qr-label` classes that both print templates already define, so the two QRs
 * always match in size.
 */
export function buildPagesQrBlock(settings: SettingsLike): string {
  const link = pagesQrLinkOf(settings);
  if (!link) return '';
  const label = (settings.pagesQrLabel || '').trim() || 'تابعنا';
  const img = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(link)}`;
  return `<div class="qr-code-container">
    <img class="qr-code-img" src="${escapeHtml(img)}" alt="Pages QR" />
    <div class="qr-label">${escapeHtml(label)}</div>
  </div>`;
}
