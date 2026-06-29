/**
 * Central definition of the store's payment methods.
 *
 * The 4 base methods (cash/visa/wallet/instapay) are always on. Two extra
 * fixed slots (method5/method6) can be enabled from system settings, each with
 * its own custom label and its own treasury balance — just like the wallet.
 *
 * Every money calculation should iterate over ALL_PAYMENT_KEYS (or the active
 * subset) instead of hardcoding the 4, so the 5th/6th are never "lost".
 */

export const BASE_PAYMENT_KEYS = ['cash', 'visa', 'wallet', 'instapay'] as const;
export const EXTRA_PAYMENT_KEYS = ['method5', 'method6'] as const;
export const ALL_PAYMENT_KEYS = [...BASE_PAYMENT_KEYS, ...EXTRA_PAYMENT_KEYS] as const;

export type PaymentKey = typeof ALL_PAYMENT_KEYS[number];

/** Split of an amount across every payment method (all optional, default 0). */
export type PaymentSplit = Partial<Record<PaymentKey, number>>;

export const PAY_DEFAULT_LABELS: Record<PaymentKey, string> = {
  cash: 'كاش',
  visa: 'فيزا',
  wallet: 'محفظة',
  instapay: 'انستا باي',
  method5: 'طريقة دفع 5',
  method6: 'طريقة دفع 6',
};

interface PaymentSettingsLike {
  paymentLabels?: Record<string, string>;
  paymentMethodsEnabled?: Record<string, boolean>;
}

/** Is an extra method (method5/method6) turned on in settings? Base methods are always on. */
export function isPaymentKeyEnabled(settings: PaymentSettingsLike | undefined, k: string): boolean {
  if ((BASE_PAYMENT_KEYS as readonly string[]).includes(k)) return true;
  return !!settings?.paymentMethodsEnabled?.[k];
}

/** The methods to actually show/use: 4 base + any enabled extras. */
export function activePaymentKeys(settings?: PaymentSettingsLike): PaymentKey[] {
  return ALL_PAYMENT_KEYS.filter((k) => isPaymentKeyEnabled(settings, k));
}

/** Display label for a method (custom from settings, else default). */
export function payLabelOf(settings: PaymentSettingsLike | undefined, k: string): string {
  return settings?.paymentLabels?.[k] || PAY_DEFAULT_LABELS[k as PaymentKey] || k;
}

/** DB column name for a method's paid amount, e.g. 'wallet' -> 'paid_wallet'. */
export function paidColOf(k: PaymentKey): string {
  return `paid_${k}`;
}

/** Sum a split across all methods. */
export function sumSplit(split: PaymentSplit | undefined): number {
  if (!split) return 0;
  return ALL_PAYMENT_KEYS.reduce((s, k) => s + (Number(split[k]) || 0), 0);
}

/** Read a row's per-method paid amounts into a full split (missing -> 0). */
export function splitFromRow(row: Record<string, any> | undefined | null): Record<PaymentKey, number> {
  const out = {} as Record<PaymentKey, number>;
  for (const k of ALL_PAYMENT_KEYS) out[k] = Number(row?.[paidColOf(k)]) || 0;
  return out;
}

/** Build a full split (all 6 keys, numeric) from a form object keyed by method name. */
export function formToSplit(form: Record<string, any> | undefined | null): Record<PaymentKey, number> {
  const out = {} as Record<PaymentKey, number>;
  for (const k of ALL_PAYMENT_KEYS) out[k] = parseFloat(form?.[k]) || 0;
  return out;
}

/** The dominant method in a split (largest amount), defaulting to cash. */
export function primaryMethod(split: PaymentSplit | undefined): PaymentKey {
  let best: PaymentKey = 'cash';
  let bestAmt = -Infinity;
  for (const k of ALL_PAYMENT_KEYS) {
    const amt = Number(split?.[k]) || 0;
    if (amt > bestAmt) { bestAmt = amt; best = k; }
  }
  return best;
}
