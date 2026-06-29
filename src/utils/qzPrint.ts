/**
 * QZ Tray integration — silent printing to a named printer.
 *
 * QZ Tray (https://qz.io) is a small free desktop app installed once on each
 * cashier PC. It exposes a localhost WebSocket that lets the browser send a
 * print job straight to a specific printer with NO print dialog / PDF step.
 *
 * This module is intentionally defensive: if QZ Tray isn't installed/running,
 * or printing fails, callers fall back to the normal browser print window.
 *
 * Runs unsigned (small-shop mode): the first connect/print shows a one-time
 * "Allow" prompt in QZ Tray — tick "Remember" and it never asks again.
 */

export type PrintKind = 'invoice' | 'barcode';

export interface QzConfig {
  enabled: boolean;
  invoicePrinter: string; // printer name for receipts/invoices
  barcodePrinter: string; // printer name for barcode labels
}

// Per-device config: printer names differ from machine to machine, so this is
// stored locally on each device (localStorage), NOT in the shared database.
const STORAGE_KEY = 'adria_qz_config';

function readStorage(): QzConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { enabled: !!p.enabled, invoicePrinter: p.invoicePrinter || '', barcodePrinter: p.barcodePrinter || '' };
    }
  } catch { /* ignore */ }
  return { enabled: false, invoicePrinter: '', barcodePrinter: '' };
}

let cfg: QzConfig = readStorage();

export function getQzConfig(): QzConfig {
  return cfg;
}

/** Persist this device's QZ config locally and apply it immediately. */
export function saveQzConfig(next: Partial<QzConfig>) {
  cfg = { ...cfg, ...next };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

// Lazy-loaded qz-tray module + a single shared connection promise.
let qzPromise: Promise<any> | null = null;
let connectPromise: Promise<any> | null = null;

async function loadQz(): Promise<any> {
  if (!qzPromise) {
    qzPromise = import('qz-tray').then((m: any) => {
      const qz = m.default || m;
      // Unsigned mode: tell qz we have no certificate/signature so it uses the
      // one-time "Allow + Remember" prompt instead of throwing.
      try {
        qz.security.setCertificatePromise((_resolve: any, reject: any) => reject());
        qz.security.setSignaturePromise(() => (resolve: any) => resolve());
      } catch { /* ignore */ }
      return qz;
    });
  }
  return qzPromise;
}

/** Ensure a live websocket connection to QZ Tray (shared, retried lazily). */
async function connect(): Promise<any> {
  const qz = await loadQz();
  if (qz.websocket.isActive && qz.websocket.isActive()) return qz;
  if (!connectPromise) {
    connectPromise = qz.websocket
      .connect({ retries: 1, delay: 1 })
      .then(() => qz)
      .catch((e: any) => { connectPromise = null; throw e; });
  }
  return connectPromise;
}

/** True if QZ printing is enabled in settings AND a printer is mapped for this kind. */
export function qzReadyFor(kind: PrintKind): boolean {
  if (!cfg.enabled) return false;
  return kind === 'invoice' ? !!cfg.invoicePrinter : !!cfg.barcodePrinter;
}

/** List installed printer names via QZ Tray (used by the Settings discovery button). */
export async function listPrinters(): Promise<string[]> {
  const qz = await connect();
  const found = await qz.printers.find();
  return Array.isArray(found) ? found : [found].filter(Boolean);
}

interface PrintOptions {
  widthMm: number;
  heightMm?: number | null; // null = auto (continuous roll)
}

const KIND_DEFAULTS: Record<PrintKind, PrintOptions> = {
  invoice: { widthMm: 72, heightMm: null },
  barcode: { widthMm: 38, heightMm: 25 },
};

/**
 * Try to print HTML silently via QZ Tray. Returns true on success.
 * Returns false (without throwing) if QZ isn't ready/available so the caller
 * can fall back to the browser print window.
 */
export async function printViaQz(kind: PrintKind, html: string, optsOverride?: Partial<PrintOptions>): Promise<boolean> {
  if (!qzReadyFor(kind)) return false;
  const printer = kind === 'invoice' ? cfg.invoicePrinter : cfg.barcodePrinter;
  const opts = { ...KIND_DEFAULTS[kind], ...optsOverride };
  try {
    const qz = await connect();
    const config = qz.configs.create(printer, {
      units: 'mm',
      size: opts.heightMm ? { width: opts.widthMm, height: opts.heightMm } : { width: opts.widthMm },
      margins: 0,
      scaleContent: true,
      rasterize: true,
      colorType: 'grayscale',
    });
    await qz.print(config, [{ type: 'pixel', format: 'html', flavor: 'plain', data: html }]);
    return true;
  } catch (e) {
    console.warn('QZ print failed, falling back to browser print:', e);
    return false;
  }
}
