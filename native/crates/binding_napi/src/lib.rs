#[macro_use]
extern crate napi_derive;

use mall_engine::{
    calculate_amount_due_kobo, validate_order_transition, verify_order_totals, MallOrderStatus,
};
use money_ledger::{compute_treasury_balances, MoneyMovementInput, TreasuryBalancesResult};
use napi::bindgen_prelude::*;

#[napi(object)]
pub struct JsTreasuryBalances {
    pub biz_account_balance: f64,
    pub physical_cash_balance: f64,
    pub total_liquid_cash: f64,
    pub total_owner_drawings: f64,
    pub total_owner_loans: f64,
}

#[napi(object)]
pub struct JsSqlStmt {
    pub sql: String,
    pub params_json: String,
}

#[napi(object)]
pub struct JsOrderTransitionResult {
    pub allowed: bool,
    pub is_idempotent: bool,
    pub error_message: Option<String>,
}

#[napi]
pub fn native_compute_treasury_balances(movements_json: String) -> Result<JsTreasuryBalances> {
    let movements: Vec<MoneyMovementInput> = serde_json::from_str(&movements_json)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to parse movements: {}", e)))?;

    let res: TreasuryBalancesResult = compute_treasury_balances(&movements);

    Ok(JsTreasuryBalances {
        biz_account_balance: res.biz_account_balance,
        physical_cash_balance: res.physical_cash_balance,
        total_liquid_cash: res.total_liquid_cash,
        total_owner_drawings: res.total_owner_drawings,
        total_owner_loans: res.total_owner_loans,
    })
}

#[napi]
pub fn native_plan_core_upsert(
    collection: String,
    document_json: String,
    now: String,
) -> Result<Option<Vec<JsSqlStmt>>> {
    let doc: serde_json::Value = serde_json::from_str(&document_json)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to parse document: {}", e)))?;

    let stmts = relational_core::core_upsert(&collection, &doc, &now);
    Ok(stmts.map(|list| {
        list.into_iter()
            .map(|s| JsSqlStmt {
                sql: s.sql,
                params_json: serde_json::to_string(&s.params).unwrap_or_else(|_| "[]".into()),
            })
            .collect()
    }))
}

#[napi]
pub fn native_plan_core_delete(
    collection: String,
    document_id: String,
) -> Result<Option<Vec<JsSqlStmt>>> {
    let stmts = relational_core::core_delete(&collection, &document_id);
    Ok(stmts.map(|list| {
        list.into_iter()
            .map(|s| JsSqlStmt {
                sql: s.sql,
                params_json: serde_json::to_string(&s.params).unwrap_or_else(|_| "[]".into()),
            })
            .collect()
    }))
}

#[napi]
pub fn native_validate_order_transition(from_str: String, to_str: String) -> Result<JsOrderTransitionResult> {
    let from = MallOrderStatus::parse(&from_str)
        .ok_or_else(|| Error::new(Status::InvalidArg, format!("Unknown origin order status: {}", from_str)))?;
    let to = MallOrderStatus::parse(&to_str)
        .ok_or_else(|| Error::new(Status::InvalidArg, format!("Unknown target order status: {}", to_str)))?;

    let res = validate_order_transition(from, to);
    Ok(JsOrderTransitionResult {
        allowed: res.allowed,
        is_idempotent: res.is_idempotent,
        error_message: res.error_message,
    })
}

#[napi]
pub fn native_calculate_amount_due(total_kobo: i64, paid_kobo: i64, status_str: String) -> Result<i64> {
    let status = MallOrderStatus::parse(&status_str)
        .ok_or_else(|| Error::new(Status::InvalidArg, format!("Unknown order status: {}", status_str)))?;
    Ok(calculate_amount_due_kobo(total_kobo, paid_kobo, status))
}

#[napi]
pub fn native_verify_order_totals(
    subtotal_kobo: i64,
    discount_kobo: i64,
    delivery_fee_kobo: i64,
    total_kobo: i64,
) -> Result<bool> {
    match verify_order_totals(subtotal_kobo, discount_kobo, delivery_fee_kobo, total_kobo) {
        Ok(()) => Ok(true),
        Err(msg) => Err(Error::new(Status::GenericFailure, msg)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_transition_and_terminal_amount_due_through_binding_logic() {
        let from = MallOrderStatus::parse("pending").unwrap();
        let to = MallOrderStatus::parse("confirmed").unwrap();
        assert!(validate_order_transition(from, to).allowed);
        assert_eq!(calculate_amount_due_kobo(10_000, 2_500, MallOrderStatus::Cancelled), 0);
    }

    #[test]
    fn invalid_order_total_is_rejected_by_binding_logic() {
        assert!(verify_order_totals(10_000, 1_000, 500, 9_499).is_err());
    }

    #[test]
    fn serialized_ledger_input_uses_integer_minor_units() {
        let movements: Vec<MoneyMovementInput> = serde_json::from_str(
            r#"[{"id":"m1","type":"Sale Inflow","destinationAccount":"Biz Account","amount_cents":1050}]"#,
        ).unwrap();
        let result = compute_treasury_balances(&movements);
        assert_eq!(result.biz_cents, 1_050);
        assert_eq!(result.biz_account_balance, 10.5);
    }
}
