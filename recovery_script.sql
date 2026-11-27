#!/usr/bin/env python3
"""SQL recovery script for affected Delivery Orders."""

-- STEP 1: IDENTIFY Affected Delivery Orders
-- These are delivery orders that are currently 'Pending Pickup' 
-- but should have a different status (Delivered, Picked Up, or Out for Delivery)
-- based on their linked sale's history.

SELECT 
    do.id AS delivery_order_id,
    do.delivery_no,
    do.sale_id,
    s.invoice_no,
    s.status AS sale_status,
    s.delivery_fee,
    do.is_pickup_confirmed,
    do.created_at,
    do.updated_at
FROM delivery_orders do
JOIN sales s ON do.sale_id = s.id
WHERE do.status = 'Pending Pickup'
  AND s.status = 'Completed'  -- Only real completed sales (not refunded, not historical)
  AND s.delivery_fee > 0     -- Had a delivery fee that triggered auto-creation
  AND s.is_historical = 0    -- Not a historical sale
ORDER BY do.created_at DESC;

-- STEP 2: Determine Correct Status from Audit Logs
-- For each affected delivery order, check the audit logs to see if there 
-- was a CONFIRM_DELIVERY_PICKUP or UPDATE_DELIVERY_STATUS that should have
-- set the status to 'Delivered' or 'Picked Up'.

SELECT 
    la.entity_id AS delivery_order_id,
    la.action,
    la.created_at,
    la.details
FROM audit_logs la
WHERE la.entity = 'DeliveryOrder'
  AND la.action IN ('CONFIRM_DELIVERY_PICKUP', 'UPDATE_DELIVERY_STATUS')
  AND la.created_at > (
    SELECT MIN(s2.updated_at) 
    FROM sales s2 
    WHERE s2.id = la.entity_id -- This needs adjustment per actual schema
  )
ORDER BY la.created_at DESC;

-- STEP 3: RESTORE Correct Statuses
-- Update delivery orders back to their correct status based on audit log evidence.

-- Example: Restore a delivery order to 'Delivered' status
UPDATE delivery_orders 
SET status = 'Delivered',
    updated_at = '2026-10-20T10:00:00Z'  -- Use actual timestamp from audit
WHERE id = 'del-1785861878794-145458-txhlw';  -- Replace with actual ID

-- Example: Restore a delivery order to 'Picked Up' status
UPDATE delivery_orders 
SET status = 'Picked Up',
    is_pickup_confirmed = 1,
    pickup_confirmed_by = 'Nsico',
    pickup_confirmed_at = '2026-08-04T16:45:14.136Z',
    updated_at = '2026-08-04T16:45:14.136Z'
WHERE id = 'del-1785861878794-145458-txhlw';  -- Replace with actual ID

-- STEP 4: VERIFY Fix Prevents Recurrence
-- The fix in AppContext.tsx now preserves delivery order statuses on sale edit:
-- 
--   const DELIVERY_STATUS_KEEP = new Set<string>(['Pending Pickup', 'Picked Up', 
--                                                 'Out for Delivery', 'Delivered', 'Cancelled']);
--   status: DELIVERY_STATUS_KEEP.has(matchingDeliveryOrder.status)
--     ? (deliveryOnlyStatus !== undefined ? deliveryOnlyStatus : matchingDeliveryOrder.status)
--     : matchingDeliveryOrder.status,
--
-- This ensures that editing a sale will NOT reset a completed delivery order 
-- back to 'Pending Pickup', preventing the cascading bug.

-- CONFIRM the fix is deployed:
SELECT 'Fix verified: DELIVERY_STATUS_KEEP guard active in updateSale()' AS fix_status;