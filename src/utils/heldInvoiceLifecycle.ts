import type { HeldInvoice } from '../store/useStore';

/** Online order paid in full at checkout: delivery is a lifecycle update, not a sale. */
export const isFullyPrepaidOnlineHeld = (held: Pick<HeldInvoice, 'kind' | 'total' | 'deposit' | 'discount_amount'>): boolean =>
  held.kind === 'online' && (Number(held.deposit) || 0) >= Math.max(0, (Number(held.total) || 0) - (Number(held.discount_amount) || 0)) - 0.01;
