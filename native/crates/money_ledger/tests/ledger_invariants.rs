use money_ledger::*;
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]

    #[test]
    fn total_liquid_equals_sum_of_accounts(
        amounts in proptest::collection::vec(0i64..1_000_000i64, 1..50)
    ) {
        let mut movements = Vec::new();
        for (i, amt) in amounts.into_iter().enumerate() {
            let (src, dst) = match i % 4 {
                0 => (None, Some(LiquidAccount::BizAccount)),
                1 => (None, Some(LiquidAccount::PhysicalCash)),
                2 => (Some(LiquidAccount::BizAccount), None),
                _ => (Some(LiquidAccount::PhysicalCash), None),
            };

            movements.push(MoneyMovementInput {
                id: format!("test_mv_{}", i),
                movement_type: MoneyMovementType::SaleInflow,
                subtype: None,
                source_account: src,
                destination_account: dst,
                amount_cents: amt,
            });
        }

        let res = compute_treasury_balances(&movements);
        prop_assert_eq!(res.biz_cents + res.cash_cents, (res.total_liquid_cash * 100.0).round() as i64);
    }

    #[test]
    fn owner_drawings_net_off_correctly(
        drawings in 0i64..10_000_000i64,
        repayments in 0i64..10_000_000i64
    ) {
        let mvs = vec![
            MoneyMovementInput {
                id: "drawing".into(),
                movement_type: MoneyMovementType::OwnerDrawing,
                subtype: Some("Personal Use".into()),
                source_account: Some(LiquidAccount::BizAccount),
                destination_account: None,
                amount_cents: drawings,
            },
            MoneyMovementInput {
                id: "repay".into(),
                movement_type: MoneyMovementType::OwnerRepayment,
                subtype: None,
                source_account: None,
                destination_account: Some(LiquidAccount::BizAccount),
                amount_cents: repayments,
            },
        ];

        let res = compute_treasury_balances(&mvs);
        let expected_net_cents = (drawings - repayments).max(0);
        prop_assert_eq!((res.total_owner_drawings * 100.0).round() as i64, expected_net_cents);
    }
}
