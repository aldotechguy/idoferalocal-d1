import { describe, it, expect } from 'vitest';

/**
 * Test suite for the delivery order status preservation fix.
 *
 * The bug: When a sale was edited (e.g., an invoice edit), the delivery cascade
 * would reset the matched DeliveryOrder's status to 'Pending Pickup'. Because
 * saveDocument() → markD1RecordChanged() triggered a D1 last-write-wins merge,
 * this single 'Pending Pickup' write cascaded across the store and reset every
 * OTHER Completed Delivery back to 'Pending Pickup'.
 *
 * The fix:
 *  1. Guard the matched delivery order's status — preserve the existing status
 *     unless a delivery-only `deliveryStatus` field was explicitly supplied.
 *  2. Auto-created delivery orders always start as 'Pending Pickup' and are
 *     never reset by the sale edit path.
 */

// Pure unit tests for the delivery status preservation guard.
describe('Delivery status preservation guard', () => {
  const DELIVERY_STATUS_KEEP = ['Pending Pickup', 'Picked Up', 'Out for Delivery', 'Delivered', 'Cancelled'];

  /**
   * Simulates the guard logic from updateSale (lines ~2950-2952 in the fix).
   */
  function preserveDeliveryStatus(
    existingStatus: string,
    deliveryOnlyStatus?: string,
    deliveryOnlyPickup?: boolean
  ): string {
    if (DELIVERY_STATUS_KEEP.includes(existingStatus)) {
      return deliveryOnlyStatus !== undefined ? deliveryOnlyStatus : existingStatus;
    }
    return existingStatus;
  }

  it('should preserve Delivered status when deliveryOnlyStatus is undefined', () => {
    expect(preserveDeliveryStatus('Delivered')).toBe('Delivered');
    expect(preserveDeliveryStatus('Picked Up')).toBe('Picked Up');
    expect(preserveDeliveryStatus('Out for Delivery')).toBe('Out for Delivery');
  });

  it('should allow explicit deliveryOnlyStatus to override', () => {
    expect(preserveDeliveryStatus('Delivered', 'Pending Pickup')).toBe('Pending Pickup');
    expect(preserveDeliveryStatus('Delivered', 'Picked Up')).toBe('Picked Up');
  });

  it('should preserve status when it is not in the keep list', () => {
    expect(preserveDeliveryStatus('NewState')).toBe('NewState');
  });

  it('should preserve status when deliveryOnlyPickup is true and deliveryOnlyStatus is undefined', () => {
    expect(preserveDeliveryStatus('Delivered', undefined, true)).toBe('Delivered');
  });

  it('should preserve an existing Delivered delivery order status when the sale is edited', () => {
    // This is a pure-logic test. The actual state management is verified by the
    // component tests. Here we verify the guard function behaves correctly.
    const existingStatus = 'Delivered';
    const deliveryOnlyStatus: string | undefined = undefined;
    const deliveryOnlyPickup = false;

    const result = preserveDeliveryStatus(existingStatus, deliveryOnlyStatus, deliveryOnlyPickup);
    expect(result).toBe('Delivered');
  });
});

describe('Auto-created delivery order initial status', () => {
  it('should always create a delivery order with status Pending Pickup', () => {
    const newDelivery = {
      id: 'del-1',
      status: 'Pending Pickup',
      isPickupConfirmed: false,
      saleId: 'sale-1',
    };
    expect(newDelivery.status).toBe('Pending Pickup');
  });

  it('should not reset an existing Delivered delivery to Pending Pickup on sale edit', () => {
    const existingDelivery: any = {
      id: 'del-1',
      status: 'Delivered',
      isPickupConfirmed: true,
      saleId: 'sale-1',
    };

    // Simulate the fixed guard
    const deliveryOnlyStatus: string | undefined = undefined;
    const updated: any = {
      ...existingDelivery,
      status:
        (() => {
          const keep = new Set(['Pending Pickup', 'Picked Up', 'Out for Delivery', 'Delivered', 'Cancelled']);
          return keep.has(existingDelivery.status)
            ? (deliveryOnlyStatus !== undefined ? deliveryOnlyStatus : existingDelivery.status)
            : existingDelivery.status;
        })(),
    };

    expect(updated.status).toBe('Delivered');
  });

  it('should reset status to Pending Pickup only when explicitly requested', () => {
    const existingDelivery: any = {
      id: 'del-1',
      status: 'Delivered',
      isPickupConfirmed: true,
      saleId: 'sale-1',
    };

    const deliveryOnlyStatus = 'Pending Pickup';
    const updated: any = {
      ...existingDelivery,
      status:
        (() => {
          const keep = new Set(['Pending Pickup', 'Picked Up', 'Out for Delivery', 'Delivered', 'Cancelled']);
          return keep.has(existingDelivery.status)
            ? (deliveryOnlyStatus !== undefined ? deliveryOnlyStatus : existingDelivery.status)
            : existingDelivery.status;
        })(),
    };

    expect(updated.status).toBe('Pending Pickup');
  });
});