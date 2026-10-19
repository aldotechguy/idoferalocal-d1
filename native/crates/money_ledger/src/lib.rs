use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LiquidAccount {
    #[serde(rename = "Biz Account")]
    BizAccount,
    #[serde(rename = "Physical Cash")]
    PhysicalCash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MoneyMovementType {
    #[serde(rename = "Opening Balance")]
    OpeningBalance,
    #[serde(rename = "Balance Adjustment")]
    BalanceAdjustment,
    #[serde(rename = "Sale Inflow")]
    SaleInflow,
    #[serde(rename = "Sale Refund")]
    SaleRefund,
    #[serde(rename = "Refund Outflow")]
    RefundOutflow,
    #[serde(rename = "Expense Outflow")]
    ExpenseOutflow,
    #[serde(rename = "Supplier Payment")]
    SupplierPayment,
    #[serde(rename = "Customer Debt Payment")]
    CustomerDebtPayment,
    #[serde(rename = "Internal Transfer")]
    InternalTransfer,
    #[serde(rename = "Owner Drawing")]
    OwnerDrawing,
    #[serde(rename = "Owner Repayment")]
    OwnerRepayment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoneyMovementInput {
    pub id: String,
    #[serde(rename = "type")]
    pub movement_type: MoneyMovementType,
    pub subtype: Option<String>,
    #[serde(rename = "sourceAccount")]
    pub source_account: Option<LiquidAccount>,
    #[serde(rename = "destinationAccount")]
    pub destination_account: Option<LiquidAccount>,
    /// Stored in integer cents to completely eliminate float imprecision
    pub amount_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TreasuryBalancesResult {
    pub biz_account_balance: f64,
    pub physical_cash_balance: f64,
    pub total_liquid_cash: f64,
    pub total_owner_drawings: f64,
    pub total_owner_loans: f64,

    // Internal exact cents for 100% bug-free verification
    pub biz_cents: i64,
    pub cash_cents: i64,
}

#[inline(always)]
fn cents_to_f64(cents: i64) -> f64 {
    (cents as f64) / 100.0
}

/// Pure derivation of treasury balances from money movements
pub fn compute_treasury_balances(movements: &[MoneyMovementInput]) -> TreasuryBalancesResult {
    let mut biz_cents: i64 = 0;
    let mut cash_cents: i64 = 0;
    let mut gross_drawings_cents: i64 = 0;
    let mut gross_loans_cents: i64 = 0;
    let mut repayments_cents: i64 = 0;

    for mv in movements {
        let amt = mv.amount_cents.max(0);

        // Credits (Destination)
        match mv.destination_account {
            Some(LiquidAccount::BizAccount) => biz_cents = biz_cents.saturating_add(amt),
            Some(LiquidAccount::PhysicalCash) => cash_cents = cash_cents.saturating_add(amt),
            None => {}
        }

        // Debits (Source)
        match mv.source_account {
            Some(LiquidAccount::BizAccount) => biz_cents = biz_cents.saturating_sub(amt),
            Some(LiquidAccount::PhysicalCash) => cash_cents = cash_cents.saturating_sub(amt),
            None => {}
        }

        // Owner Equity Position
        match mv.movement_type {
            MoneyMovementType::OwnerDrawing => {
                gross_drawings_cents = gross_drawings_cents.saturating_add(amt);
                if let Some(sub) = &mv.subtype {
                    if sub == "Owner Loan" {
                        gross_loans_cents = gross_loans_cents.saturating_add(amt);
                    }
                }
            }
            MoneyMovementType::OwnerRepayment => {
                repayments_cents = repayments_cents.saturating_add(amt);
            }
            _ => {}
        }
    }

    let net_drawings = gross_drawings_cents.saturating_sub(repayments_cents).max(0);
    let net_loans = gross_loans_cents.saturating_sub(repayments_cents).max(0);
    let total_cash = biz_cents.saturating_add(cash_cents);

    TreasuryBalancesResult {
        biz_account_balance: cents_to_f64(biz_cents),
        physical_cash_balance: cents_to_f64(cash_cents),
        total_liquid_cash: cents_to_f64(total_cash),
        total_owner_drawings: cents_to_f64(net_drawings),
        total_owner_loans: cents_to_f64(net_loans),
        biz_cents,
        cash_cents,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_ledger() {
        let res = compute_treasury_balances(&[]);
        assert_eq!(res.biz_cents, 0);
        assert_eq!(res.cash_cents, 0);
        assert_eq!(res.total_liquid_cash, 0.0);
    }

    #[test]
    fn test_sale_inflow_and_owner_drawing() {
        let mvs = vec![
            MoneyMovementInput {
                id: "1".into(),
                movement_type: MoneyMovementType::SaleInflow,
                subtype: None,
                source_account: None,
                destination_account: Some(LiquidAccount::BizAccount),
                amount_cents: 10000,
            },
            MoneyMovementInput {
                id: "2".into(),
                movement_type: MoneyMovementType::OwnerDrawing,
                subtype: Some("Owner Loan".into()),
                source_account: Some(LiquidAccount::BizAccount),
                destination_account: None,
                amount_cents: 3000,
            },
        ];

        let res = compute_treasury_balances(&mvs);
        assert_eq!(res.biz_account_balance, 70.00);
        assert_eq!(res.total_liquid_cash, 70.00);
        assert_eq!(res.total_owner_drawings, 30.00);
        assert_eq!(res.total_owner_loans, 30.00);
    }
}
