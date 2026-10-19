use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MallOrderStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "confirmed")]
    Confirmed,
    #[serde(rename = "processing")]
    Processing,
    #[serde(rename = "packed")]
    Packed,
    #[serde(rename = "ready_for_pickup")]
    ReadyForPickup,
    #[serde(rename = "out_for_delivery")]
    OutForDelivery,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "refunded")]
    Refunded,
}

impl MallOrderStatus {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "pending" => Some(Self::Pending),
            "confirmed" => Some(Self::Confirmed),
            "processing" => Some(Self::Processing),
            "packed" => Some(Self::Packed),
            "ready_for_pickup" => Some(Self::ReadyForPickup),
            "out_for_delivery" => Some(Self::OutForDelivery),
            "completed" => Some(Self::Completed),
            "cancelled" => Some(Self::Cancelled),
            "refunded" => Some(Self::Refunded),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Confirmed => "confirmed",
            Self::Processing => "processing",
            Self::Packed => "packed",
            Self::ReadyForPickup => "ready_for_pickup",
            Self::OutForDelivery => "out_for_delivery",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Refunded => "refunded",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::Refunded)
    }

    pub fn is_active_fulfillment(&self) -> bool {
        matches!(
            self,
            Self::Pending
                | Self::Confirmed
                | Self::Processing
                | Self::Packed
                | Self::ReadyForPickup
                | Self::OutForDelivery
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PaymentStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "paid")]
    Paid,
    #[serde(rename = "partial")]
    Partial,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "refunded")]
    Refunded,
}

impl PaymentStatus {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "pending" => Some(Self::Pending),
            "paid" => Some(Self::Paid),
            "partial" => Some(Self::Partial),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "refunded" => Some(Self::Refunded),
            _ => None,
        }
    }

    pub fn is_settled(&self) -> bool {
        matches!(self, Self::Paid | Self::Partial)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderTransitionResult {
    pub allowed: bool,
    pub is_idempotent: bool,
    pub error_message: Option<String>,
}

/// Evaluates state machine transition rules for order fulfillment
pub fn validate_order_transition(
    from: MallOrderStatus,
    to: MallOrderStatus,
) -> OrderTransitionResult {
    if from == to {
        return OrderTransitionResult {
            allowed: true,
            is_idempotent: true,
            error_message: None,
        };
    }

    let valid = match (from, to) {
        // Confirmation
        (MallOrderStatus::Pending, MallOrderStatus::Confirmed) => true,

        // Payment / Processing
        (MallOrderStatus::Pending, MallOrderStatus::Processing) => true,
        (MallOrderStatus::Confirmed, MallOrderStatus::Processing) => true,

        // Packing
        (MallOrderStatus::Processing, MallOrderStatus::Packed) => true,

        // Handover to pickup or dispatch
        (MallOrderStatus::Packed, MallOrderStatus::ReadyForPickup) => true,
        (MallOrderStatus::Packed, MallOrderStatus::OutForDelivery) => true,

        // Completion
        (MallOrderStatus::ReadyForPickup, MallOrderStatus::Completed) => true,
        (MallOrderStatus::OutForDelivery, MallOrderStatus::Completed) => true,

        // Cancellation (only allowed before processing/fulfillment)
        (MallOrderStatus::Pending, MallOrderStatus::Cancelled) => true,
        (MallOrderStatus::Confirmed, MallOrderStatus::Cancelled) => true,

        // Direct completion on payment for instant-handover
        (MallOrderStatus::Processing, MallOrderStatus::Completed) => true,

        _ => false,
    };

    if valid {
        OrderTransitionResult {
            allowed: true,
            is_idempotent: false,
            error_message: None,
        }
    } else {
        OrderTransitionResult {
            allowed: false,
            is_idempotent: false,
            error_message: Some(format!(
                "An order in {} state cannot move to {}.",
                from.as_str(),
                to.as_str()
            )),
        }
    }
}

/// Validates whether an order can be cancelled
pub fn validate_cancellation(
    status: MallOrderStatus,
    has_linked_sale: bool,
) -> Result<(), &'static str> {
    if status == MallOrderStatus::Cancelled {
        return Ok(());
    }
    if has_linked_sale || status == MallOrderStatus::Completed || status == MallOrderStatus::Refunded {
        return Err("Paid or completed orders must use the refund workflow.");
    }
    if status != MallOrderStatus::Pending && status != MallOrderStatus::Confirmed {
        return Err("Only pending or confirmed orders can be cancelled.");
    }
    Ok(())
}

/// Validates whether an order can receive a payment
pub fn validate_payment_recording(status: MallOrderStatus) -> Result<(), &'static str> {
    if status == MallOrderStatus::Cancelled {
        return Err("Cancelled orders cannot be paid.");
    }
    if status != MallOrderStatus::Pending && status != MallOrderStatus::Confirmed {
        return Err("Only pending or confirmed orders can accept payments.");
    }
    Ok(())
}

/// Validates whether an order can be refunded
pub fn validate_refund(
    status: MallOrderStatus,
    payment_status: PaymentStatus,
    has_linked_sale: bool,
) -> Result<(), &'static str> {
    if status == MallOrderStatus::Refunded {
        return Ok(());
    }
    if !has_linked_sale || !payment_status.is_settled() {
        return Err("Only paid or part-paid Mall orders can be refunded.");
    }
    Ok(())
}

/// Calculates remaining balance due on an order in exact integer kobo
pub fn calculate_amount_due_kobo(
    total_kobo: i64,
    paid_kobo: i64,
    status: MallOrderStatus,
) -> i64 {
    if status == MallOrderStatus::Cancelled || status == MallOrderStatus::Refunded {
        return 0;
    }
    total_kobo.saturating_sub(paid_kobo).max(0)
}

/// Verifies total calculation invariant: total == subtotal - discount + delivery
pub fn verify_order_totals(
    subtotal_kobo: i64,
    discount_kobo: i64,
    delivery_fee_kobo: i64,
    total_kobo: i64,
) -> Result<(), &'static str> {
    if subtotal_kobo < 0 || discount_kobo < 0 || delivery_fee_kobo < 0 || total_kobo < 0 {
        return Err("Negative monetary values are forbidden.");
    }
    if discount_kobo > subtotal_kobo {
        return Err("Discount cannot exceed the order subtotal.");
    }
    let expected = subtotal_kobo.saturating_sub(discount_kobo).saturating_add(delivery_fee_kobo);
    if expected != total_kobo {
        return Err("Order total does not equal subtotal - discount + delivery_fee.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_fulfillment_pipeline() {
        assert!(validate_order_transition(MallOrderStatus::Pending, MallOrderStatus::Confirmed).allowed);
        assert!(validate_order_transition(MallOrderStatus::Confirmed, MallOrderStatus::Processing).allowed);
        assert!(validate_order_transition(MallOrderStatus::Processing, MallOrderStatus::Packed).allowed);
        assert!(validate_order_transition(MallOrderStatus::Packed, MallOrderStatus::OutForDelivery).allowed);
        assert!(validate_order_transition(MallOrderStatus::OutForDelivery, MallOrderStatus::Completed).allowed);
    }

    #[test]
    fn test_illegal_state_jumps() {
        // Cannot complete an un-packed/pending order directly without processing
        assert!(!validate_order_transition(MallOrderStatus::Pending, MallOrderStatus::Completed).allowed);
        // Cannot revert back to pending from completed
        assert!(!validate_order_transition(MallOrderStatus::Completed, MallOrderStatus::Pending).allowed);
        // Cannot cancel a delivered order
        assert!(!validate_order_transition(MallOrderStatus::Completed, MallOrderStatus::Cancelled).allowed);
    }

    #[test]
    fn test_idempotent_no_ops() {
        let res = validate_order_transition(MallOrderStatus::Confirmed, MallOrderStatus::Confirmed);
        assert!(res.allowed);
        assert!(res.is_idempotent);
    }

    #[test]
    fn test_cancellation_rules() {
        assert!(validate_cancellation(MallOrderStatus::Pending, false).is_ok());
        assert!(validate_cancellation(MallOrderStatus::Confirmed, false).is_ok());
        assert!(validate_cancellation(MallOrderStatus::Processing, true).is_err());
        assert!(validate_cancellation(MallOrderStatus::Completed, true).is_err());
    }

    #[test]
    fn test_amount_due_kobo() {
        assert_eq!(calculate_amount_due_kobo(10000, 3000, MallOrderStatus::Processing), 7000);
        assert_eq!(calculate_amount_due_kobo(10000, 10000, MallOrderStatus::Processing), 0);
        // Overpaid clamp
        assert_eq!(calculate_amount_due_kobo(10000, 15000, MallOrderStatus::Processing), 0);
        // Cancelled / Refunded is always zero due
        assert_eq!(calculate_amount_due_kobo(10000, 3000, MallOrderStatus::Cancelled), 0);
        assert_eq!(calculate_amount_due_kobo(10000, 3000, MallOrderStatus::Refunded), 0);
    }
}
