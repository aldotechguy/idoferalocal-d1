import { staffMallClient } from '../services/staffMallClient';
import type { Sale } from '../types';

/**
 * Mall orders live entirely server-side and are keyed to a Mall-originated sale by
 * the deterministic id `sale-<mallOrderId>` (collect-payment writes exactly that).
 * A POS walk-in sale has no such order, so this returns null for it.
 */
export function mallOrderIdForSale(sale: Pick<Sale, 'id'> | undefined | null): string | null {
  const id = sale?.id || '';
  return id.startsWith('sale-') ? id.slice('sale-'.length) : null;
}

/**
 * Push the committed POS-side state of a Mall-originated sale back onto its Mall
 * order so the buyer's `/mall/orders` tracking page stops showing the checkout-time
 * snapshot (stale total, stale lines, stale status).
 *
 * Deliberately best-effort and non-blocking: the POS edit has already committed
 * locally and must not fail because the Mall worker is unreachable. A failed push
 * is logged, not thrown — the next edit or refund retries with fresh state.
 */
export function syncMallOrderFromPos(
  sale: Sale,
  opts: { orderStatus?: string; paymentStatus?: string; paidAmount?: number } = {},
): void {
  const orderId = mallOrderIdForSale(sale);
  if (!orderId) return;
  const items = (sale.items || []).map((item) => ({
    productId: item.productId,
    name: item.productName || item.sku || 'Item',
    qty: Number(item.quantity) || 0,
    // The Mall order stores integer kobo; the POS sale is naira floats.
    unitPriceKobo: Math.round((Number(item.unitPrice) || 0) * 100),
  }));
  const paidAmount = opts.paidAmount !== undefined ? opts.paidAmount : (Number(sale.paidAmount) || 0);
  staffMallClient.syncFromPos(orderId, {
    subtotalKobo: Math.round((Number(sale.subtotal) || 0) * 100),
    totalKobo: Math.round((Number(sale.totalAmount) || 0) * 100),
    discountKobo: Math.round((Number(sale.discount) || 0) * 100),
    deliveryFeeKobo: Math.round((Number(sale.deliveryFee) || 0) * 100),
    paidKobo: Math.round(paidAmount * 100),
    orderStatus: opts.orderStatus,
    paymentStatus: opts.paymentStatus,
    items,
  }).catch((error) => {
    console.warn(`Mall order ${orderId} could not be reconciled from the POS:`, error);
  });
}
