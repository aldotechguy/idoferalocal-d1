use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqlStmt {
    pub sql: String,
    pub params: Vec<Value>,
}

#[inline]
pub fn naira_to_kobo(v: &Value) -> i64 {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.is_finite() {
                    (f * 100.0).round() as i64
                } else {
                    0
                }
            } else {
                0
            }
        }
        Value::String(s) => {
            if let Ok(f) = s.parse::<f64>() {
                if f.is_finite() {
                    (f * 100.0).round() as i64
                } else {
                    0
                }
            } else {
                0
            }
        }
        _ => 0,
    }
}

#[inline]
pub fn s_val(v: Option<&Value>, fb: &str) -> String {
    match v {
        Some(Value::Null) | None => fb.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => fb.to_string(),
    }
}

#[inline]
pub fn n_val(v: Option<&Value>, fb: f64) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(fb),
        Some(Value::String(s)) => s.parse::<f64>().unwrap_or(fb),
        _ => fb,
    }
}

#[inline]
pub fn b01(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Bool(b)) => if *b { 1 } else { 0 },
        Some(Value::Number(n)) => if n.as_i64() == Some(1) { 1 } else { 0 },
        Some(Value::String(s)) => if s == "true" || s == "1" { 1 } else { 0 },
        _ => 0,
    }
}

pub fn slugify_name(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    let mut last_dash = false;
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            result.push(c);
            last_dash = false;
        } else if !last_dash {
            result.push('-');
            last_dash = true;
        }
    }
    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() {
        "uncategorized".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn json_or_null(value: Option<&Value>) -> Value {
    value.cloned().unwrap_or(Value::Null)
}

fn map_value(value: &Value) -> Value {
    match value {
        Value::Object(_) | Value::Array(_) => Value::String(serde_json::to_string(value).unwrap_or_else(|_| "null".into())),
        _ => value.clone(),
    }
}

fn doc_string(doc: &serde_json::Map<String, Value>, key: &str, fallback: &str) -> String {
    s_val(doc.get(key), fallback)
}

fn doc_number(doc: &serde_json::Map<String, Value>, key: &str) -> Value {
    Value::from(naira_to_kobo(doc.get(key).unwrap_or(&Value::Null)))
}

pub fn clean_image_list(images: Option<&Value>) -> Vec<String> {
    const IMAGE_CAP: usize = 8;
    let mut list = Vec::new();
    if let Some(Value::Array(arr)) = images {
        for v in arr {
            if let Value::String(s) = v {
                if !s.trim().is_empty() && !s.starts_with("data:") {
                    list.push(s.clone());
                    if list.len() >= IMAGE_CAP {
                        break;
                    }
                }
            }
        }
    }
    list
}

pub fn build_upsert_ordered(
    table: &str,
    row: &[(&str, Value)],
    conflict: &str,
    sync_cols: &[&str],
) -> SqlStmt {
    let cols: Vec<&str> = row.iter().map(|(k, _)| *k).collect();
    let placeholders: Vec<&str> = vec!["?"; cols.len()];
    let ph_str = placeholders.join(", ");
    let cols_str = cols.join(", ");

    let up_suffix = if !sync_cols.is_empty() {
        let mut updates: Vec<String> = sync_cols.iter().map(|c| format!("{}=excluded.{}", c, c)).collect();
        if table == "sales" {
            if let Some(index) = sync_cols.iter().position(|column| *column == "created_at") {
                if index + 1 < updates.len() {
                    let created = updates.remove(index);
                    updates.push(created);
                }
            }
        }
        format!(" ON CONFLICT({}) DO UPDATE SET {}", conflict, updates.join(", "))
    } else {
        format!(" ON CONFLICT({}) DO NOTHING", conflict)
    };

    let mut comparison_cols = sync_cols.to_vec();
    // Preserve TypeScript sales upsert ordering: all mutable columns first,
    // then created_at (the transaction timestamp is explicitly mutable).
    if table == "sales" && comparison_cols.contains(&"created_at") {
        comparison_cols.retain(|column| *column != "created_at");
        comparison_cols.push("created_at");
    }
    let no_write_suffix = if !comparison_cols.is_empty() {
        let comparisons: Vec<String> = comparison_cols
            .iter()
            .map(|c| format!("excluded.{} IS NOT {}.{}", c, table, c))
            .collect();
        format!(" WHERE {}", comparisons.join(" OR "))
    } else {
        String::new()
    };

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({}){}{}",
        table, cols_str, ph_str, up_suffix, no_write_suffix
    );

    let params: Vec<Value> = row.iter().map(|(_, v)| v.clone()).collect();
    SqlStmt { sql, params }
}

pub fn core_upsert(collection: &str, doc: &Value, now: &str) -> Option<Vec<SqlStmt>> {
    let doc_obj = doc.as_object()?;
    let id_val = doc_obj.get("id")?;
    let id = s_val(Some(id_val), "");
    if id.is_empty() {
        return Some(vec![]);
    }

    match collection {
        "products" => {
            let cat_name = s_val(doc_obj.get("category"), "").trim().to_string();
            let cat_name = if cat_name.is_empty() { "Uncategorized".to_string() } else { cat_name };
            let cat_slug = slugify_name(&cat_name);
            let category_id = format!("cat-{}", cat_slug);
            let images = clean_image_list(doc_obj.get("images"));

            let dealer = doc_obj.get("dealerPrice").map(naira_to_kobo);
            let promo = doc_obj.get("promotionalPrice").map(naira_to_kobo);
            let mall_price = doc_obj.get("mallPrice").map(naira_to_kobo);
            let mall_display = doc_obj.get("mallDisplayOrder").and_then(|v| v.as_f64()).map(|d| d as i64);
            let mall_promo = doc_obj.get("mallPromoPrice").map(naira_to_kobo);
            let status = s_val(doc_obj.get("status"), "Active");
            let status = if status == "Archived" { "Archived" } else { "Active" };

            let row: Vec<(&str, Value)> = vec![
                ("id", Value::String(id.clone())),
                ("sku", Value::String(s_val(doc_obj.get("sku"), &id))),
                ("barcode", Value::String(s_val(doc_obj.get("barcode"), ""))),
                ("qr_code", doc_obj.get("qrCode").cloned().unwrap_or(Value::Null)),
                ("name", Value::String(s_val(doc_obj.get("name"), "Unnamed Product"))),
                ("description", Value::String(s_val(doc_obj.get("description"), ""))),
                ("category_id", Value::String(category_id.clone())),
                ("category_name", Value::String(cat_name.clone())),
                ("brand", Value::String(s_val(doc_obj.get("brand"), "Unbranded"))),
                ("supplier_id", doc_obj.get("supplierId").cloned().unwrap_or(Value::Null)),
                ("supplier_name", Value::String(s_val(doc_obj.get("supplierName"), "General Supplier"))),
                ("images_json", Value::String(serde_json::to_string(&images).unwrap_or_else(|_| "[]".into()))),
                ("cost_price_kobo", Value::from(naira_to_kobo(doc_obj.get("costPrice").unwrap_or(&Value::Null)))),
                ("retail_price_kobo", Value::from(naira_to_kobo(doc_obj.get("retailPrice").unwrap_or(&Value::Null)))),
                ("wholesale_price_kobo", Value::from(naira_to_kobo(doc_obj.get("wholesalePrice").unwrap_or(&Value::Null)))),
                ("min_wholesale_qty", Value::from(n_val(doc_obj.get("minWholesaleQty"), 1.0) as i64)),
                ("dealer_price_kobo", dealer.map(Value::from).unwrap_or(Value::Null)),
                ("promo_price_kobo", promo.map(Value::from).unwrap_or(Value::Null)),
                ("min_selling_price_kobo", Value::from(naira_to_kobo(doc_obj.get("minimumSellingPrice").unwrap_or(&Value::Null)))),
                ("stock_qty", Value::from(n_val(doc_obj.get("currentStock"), 0.0) as i64)),
                ("low_stock_threshold", Value::from(n_val(doc_obj.get("minimumStockLevel"), 5.0) as i64)),
                ("unit", Value::String(s_val(doc_obj.get("unit"), "pcs"))),
                ("expiry_date", doc_obj.get("expiryDate").cloned().unwrap_or(Value::Null)),
                ("status", Value::String(status.into())),
                ("is_mall_listed", Value::from(b01(doc_obj.get("isMallListed")))),
                ("mall_price_kobo", mall_price.map(Value::from).unwrap_or(Value::Null)),
                ("mall_description", doc_obj.get("mallDescription").cloned().unwrap_or(Value::Null)),
                ("mall_featured", Value::from(b01(doc_obj.get("mallFeatured")))),
                ("mall_display_order", mall_display.map(Value::from).unwrap_or(Value::Null)),
                ("mall_promo_price_kobo", mall_promo.map(Value::from).unwrap_or(Value::Null)),
                ("mall_promo_start", doc_obj.get("mallPromoStart").cloned().unwrap_or(Value::Null)),
                ("mall_promo_end", doc_obj.get("mallPromoEnd").cloned().unwrap_or(Value::Null)),
                ("created_at", Value::String(s_val(doc_obj.get("createdAt"), now))),
                ("updated_at", Value::String(s_val(doc_obj.get("updatedAt"), now))),
            ];

            let sync_cols: Vec<&str> = row.iter().filter(|(k, _)| *k != "id" && *k != "created_at").map(|(k, _)| *k).collect();

            let cat_stmt = SqlStmt {
                sql: "INSERT INTO categories (id, name, slug, parent_id, image_url) VALUES (?, ?, ?, NULL, NULL) ON CONFLICT(id) DO NOTHING".into(),
                params: vec![
                    Value::String(category_id),
                    Value::String(cat_name.clone()),
                    Value::String(cat_slug),
                ],
            };
            let prod_stmt = build_upsert_ordered("products", &row, "id", &sync_cols);
            Some(vec![cat_stmt, prod_stmt])
        }
        "customers" => {
            let row: Vec<(&str, Value)> = vec![
                ("id", Value::String(id)),
                ("name", Value::String(s_val(doc_obj.get("name"), "Walk-in Customer"))),
                ("phone", Value::String(s_val(doc_obj.get("phone"), ""))),
                ("email", Value::String(s_val(doc_obj.get("email"), ""))),
                ("address", doc_obj.get("address").cloned().unwrap_or(Value::Null)),
                ("purchase_history_count", Value::from(n_val(doc_obj.get("purchaseHistoryCount"), 0.0) as i64)),
                ("outstanding_balance_kobo", Value::from(naira_to_kobo(doc_obj.get("outstandingBalance").unwrap_or(&Value::Null)))),
                ("loyalty_points", Value::from(n_val(doc_obj.get("loyaltyPoints"), 0.0) as i64)),
                ("lifetime_value_kobo", Value::from(naira_to_kobo(doc_obj.get("lifetimeValue").unwrap_or(&Value::Null)))),
                ("overage_balance_kobo", Value::from(naira_to_kobo(doc_obj.get("overageBalance").unwrap_or(&Value::Null)))),
                ("created_at", Value::String(s_val(doc_obj.get("createdAt"), now))),
            ];

            let sync_cols: Vec<&str> = row.iter().filter(|(k, _)| *k != "id" && *k != "created_at").map(|(k, _)| *k).collect();
            Some(vec![build_upsert_ordered("customers", &row, "id", &sync_cols)])
        }
        "suppliers" => {
            let row: Vec<(&str, Value)> = vec![
                ("id", Value::String(id)),
                ("name", Value::String(s_val(doc_obj.get("name"), "Unknown Supplier"))),
                ("contact_person", Value::String(s_val(doc_obj.get("contactPerson"), ""))),
                ("email", Value::String(s_val(doc_obj.get("email"), ""))),
                ("phone", Value::String(s_val(doc_obj.get("phone"), ""))),
                ("address", doc_obj.get("address").cloned().unwrap_or(Value::Null)),
                ("payment_terms", Value::String(s_val(doc_obj.get("paymentTerms"), "Due on Receipt"))),
                ("products_count", Value::from(n_val(doc_obj.get("productsCount"), 0.0) as i64)),
                ("opening_balance_kobo", Value::from(0i64)),
                ("outstanding_balance_kobo", Value::from(naira_to_kobo(doc_obj.get("outstandingBalance").unwrap_or(&Value::Null)))),
                ("created_at", Value::String(s_val(doc_obj.get("createdAt"), now))),
            ];

            let sync_cols: Vec<&str> = row.iter().filter(|(k, _)| *k != "id" && *k != "created_at").map(|(k, _)| *k).collect();
            Some(vec![build_upsert_ordered("suppliers", &row, "id", &sync_cols)])
        }
        "sales" => {
            let now = s_val(doc_obj.get("createdAt"), now);
            let raw_receipt = s_val(doc_obj.get("invoiceNo"), "").trim().to_string();
            let is_placeholder = raw_receipt.is_empty() || raw_receipt.eq_ignore_ascii_case("n/a") || raw_receipt.eq_ignore_ascii_case("na") || raw_receipt == "-";
            let receipt_no = if is_placeholder { id.clone() } else { raw_receipt };
            let refunds = doc_obj.get("refunds").and_then(Value::as_array).filter(|a| !a.is_empty()).map(|v| Value::String(serde_json::to_string(v).unwrap_or_else(|_| "[]".into()))).unwrap_or(Value::Null);
            let header: Vec<(&str, Value)> = vec![
                ("id", Value::String(id.clone())),
                ("receipt_no", Value::String(receipt_no)),
                ("customer_id", doc_obj.get("customerId").filter(|v| !v.is_null() && !v.as_str().unwrap_or("").is_empty()).cloned().unwrap_or(Value::Null)),
                ("customer_name", Value::String(doc_string(doc_obj, "customerName", ""))),
                ("type", Value::String(doc_string(doc_obj, "type", "Retail"))),
                ("subtotal_kobo", doc_number(doc_obj, "subtotal")),
                ("discount_kobo", doc_number(doc_obj, "discount")),
                ("tax_kobo", doc_number(doc_obj, "tax")),
                ("delivery_fee_kobo", doc_number(doc_obj, "deliveryFee")),
                ("total_kobo", doc_number(doc_obj, "totalAmount")),
                ("paid_kobo", doc_number(doc_obj, "paidAmount")),
                ("payment_method", Value::String(doc_string(doc_obj, "paymentMethod", "Cash"))),
                ("payment_breakdown_json", doc_obj.get("paymentBreakdown").filter(|v| !v.is_null() && !v.is_boolean() && !v.as_str().map(|s| s.is_empty()).unwrap_or(false)).map(map_value).unwrap_or(Value::Null)),
                ("overage_applied_kobo", doc_number(doc_obj, "overageApplied")),
                ("overage_created_kobo", doc_number(doc_obj, "overageCreated")),
                ("total_refunded_kobo", doc_number(doc_obj, "totalRefunded")),
                ("refunds_json", refunds),
                ("status", Value::String(doc_string(doc_obj, "status", "Completed"))),
                ("notes", doc_obj.get("notes").filter(|v| !v.is_null() && !v.as_str().map(|s| s.is_empty()).unwrap_or(false)).cloned().unwrap_or(Value::Null)),
                ("created_by", Value::String(doc_string(doc_obj, "createdBy", ""))),
                ("order_taken_by", doc_obj.get("orderTakenBy").filter(|v| !v.is_null() && !v.as_str().map(|s| s.is_empty()).unwrap_or(false)).cloned().unwrap_or(Value::Null)),
                ("is_historical", Value::from(b01(doc_obj.get("isHistorical")))),

                ("expense_id", doc_obj.get("expenseId").filter(|v| !v.is_null() && !v.as_str().map(|s| s.is_empty()).unwrap_or(false)).cloned().unwrap_or(Value::Null)),
                ("created_at", Value::String(now)),
                ("updated_at", doc_obj.get("updatedAt").filter(|v| !v.is_null() && !v.as_str().map(|s| s.is_empty()).unwrap_or(false)).cloned().unwrap_or(Value::Null)),
            ];
            let mut sync_cols: Vec<&str> = header.iter().filter(|(key, _)| *key != "id").map(|(key, _)| *key).collect();
            if let Some(index) = sync_cols.iter().position(|column| *column == "created_at") {
                sync_cols.remove(index);
                sync_cols.push("created_at");
            }
            let mut stmts = vec![build_upsert_ordered("sales", &header, "id", &sync_cols)];
            let items = doc_obj.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
            let lines: Vec<Vec<(&str, Value)>> = items.iter().enumerate().map(|(index, item)| {
                let item = item.as_object();
                let is_clearance = item.and_then(|o| o.get("isClearance")).map(|v| b01(Some(v)) == 1).unwrap_or(false)
                    || item.and_then(|o| o.get("sku")).and_then(Value::as_str).map(|s| s.starts_with("CLR-")).unwrap_or(false)
                    || item.and_then(|o| o.get("productId")).and_then(Value::as_str).map(|s| s.starts_with("clearance-")).unwrap_or(false);
                vec![
                    ("id", Value::String(format!("{}-item-{}", id, index))),
                    ("sale_id", Value::String(id.clone())),
                    ("product_id", if is_clearance { Value::Null } else { item.and_then(|o| o.get("productId")).filter(|v| !v.is_null() && !v.as_str().unwrap_or("").is_empty()).cloned().unwrap_or(Value::Null) }),
                    ("product_name", Value::String(item.map(|o| s_val(o.get("productName"), "")).unwrap_or_default())),
                    ("sku", Value::String(item.map(|o| s_val(o.get("sku"), "")).unwrap_or_default())),
                    ("qty", Value::from(item.map(|o| n_val(o.get("quantity"), 0.0)).unwrap_or(0.0))),
                    ("unit_price_kobo", Value::from(naira_to_kobo(item.and_then(|o| o.get("unitPrice")).unwrap_or(&Value::Null)))),
                    ("cost_price_kobo", Value::from(naira_to_kobo(item.and_then(|o| o.get("costPrice")).unwrap_or(&Value::Null)))),
                    ("total_kobo", Value::from(naira_to_kobo(item.and_then(|o| o.get("total")).unwrap_or(&Value::Null)))),
                    ("is_wholesale", Value::from(item.and_then(|o| o.get("isWholesale")).map(|v| b01(Some(v))).unwrap_or(0))),
                    ("is_clearance", Value::from(if is_clearance { 1 } else { 0 })),
                    ("returned_qty", Value::from(item.map(|o| n_val(o.get("returnedQuantity"), 0.0)).unwrap_or(0.0))),
                ]
            }).collect();
            let line_ids: Vec<Value> = lines.iter().map(|line| line[0].1.clone()).collect();
            if line_ids.len() > 900 { return None; }
            if line_ids.is_empty() {
                stmts.push(SqlStmt { sql: "DELETE FROM sale_items WHERE sale_id = ?".into(), params: vec![Value::String(id.clone())] });
            } else {
                let placeholders = vec!["?"; line_ids.len()].join(", ");
                let mut params = vec![Value::String(id.clone())];
                params.extend(line_ids);
                stmts.push(SqlStmt { sql: format!("DELETE FROM sale_items WHERE sale_id = ? AND id NOT IN ({})", placeholders), params });
            }
            for line in lines {
                let update_cols: Vec<&str> = line.iter().filter(|(key, _)| *key != "id" && *key != "created_at").map(|(key, _)| *key).collect();
                stmts.push(build_upsert_ordered("sale_items", &line, "id", &update_cols));
            }
            Some(stmts)
        }
        "purchases" => {
            let now = s_val(doc_obj.get("createdAt"), now);
            let header: Vec<(&str, Value)> = vec![
                ("id", Value::String(id.clone())),
                ("po_number", Value::String(s_val(doc_obj.get("poNumber").filter(|v| !v.is_null() && !v.as_str().unwrap_or("").is_empty()), &id))),
                ("supplier_id", doc_obj.get("supplierId").filter(|v| !v.is_null() && !v.as_str().unwrap_or("").is_empty()).cloned().unwrap_or(Value::Null)),
                ("supplier_name", Value::String(doc_string(doc_obj, "supplierName", ""))),
                ("delivery_fee_kobo", doc_number(doc_obj, "deliveryFee")),
                ("logistics_fee_kobo", doc_number(doc_obj, "localLogisticsFee")),
                ("total_kobo", doc_number(doc_obj, "totalAmount")),
                ("paid_kobo", doc_number(doc_obj, "paidAmount")),
                ("payment_status", Value::String(doc_string(doc_obj, "paymentStatus", "Unpaid"))),
                ("delivery_status", Value::String(doc_string(doc_obj, "deliveryStatus", "Pending"))),
                ("expected_delivery", Value::String(doc_string(doc_obj, "expectedDelivery", ""))),
                ("created_by", Value::String(doc_string(doc_obj, "createdBy", ""))),
                ("notes", doc_obj.get("notes").filter(|v| !v.is_null() && !v.as_str().map(|s| s.is_empty()).unwrap_or(false)).cloned().unwrap_or(Value::Null)),
                ("created_at", Value::String(now.clone())),
                ("updated_at", doc_obj.get("updatedAt").filter(|v| !v.is_null() && !v.as_str().map(|s| s.is_empty()).unwrap_or(false)).cloned().unwrap_or(Value::Null)),
            ];
            let sync_cols: Vec<&str> = header.iter().filter(|(key, _)| *key != "id" && *key != "created_at").map(|(key, _)| *key).collect();
            let mut stmts = vec![build_upsert_ordered("purchases", &header, "id", &sync_cols)];
            let items = doc_obj.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
            let lines: Vec<Vec<(&str, Value)>> = items.iter().enumerate().map(|(index, item)| {
                let item = item.as_object();
                vec![
                    ("id", Value::String(format!("{}-item-{}", id, index))),
                    ("purchase_id", Value::String(id.clone())),
                    ("product_id", item.and_then(|o| o.get("productId")).filter(|v| !v.is_null() && !v.as_str().unwrap_or("").is_empty()).cloned().unwrap_or(Value::Null)),
                    ("product_name", Value::String(item.map(|o| s_val(o.get("productName"), "")).unwrap_or_default())),
                    ("sku", Value::String(item.map(|o| s_val(o.get("sku"), "")).unwrap_or_default())),
                    ("qty", Value::from(item.map(|o| n_val(o.get("quantity"), 0.0)).unwrap_or(0.0))),
                    ("unit_cost_kobo", Value::from(naira_to_kobo(item.and_then(|o| o.get("unitCost")).unwrap_or(&Value::Null)))),
                    ("total_kobo", Value::from(naira_to_kobo(item.and_then(|o| o.get("total")).unwrap_or(&Value::Null)))),
                    ("received_qty", Value::from(item.map(|o| n_val(o.get("receivedQuantity"), 0.0)).unwrap_or(0.0))),
                    ("accepted_qty", Value::from(item.map(|o| n_val(o.get("acceptedQuantity"), 0.0)).unwrap_or(0.0))),
                    ("damaged_qty", Value::from(item.map(|o| n_val(o.get("damagedQuantity"), 0.0)).unwrap_or(0.0))),
                    ("shortage_qty", Value::from(item.map(|o| n_val(o.get("shortageQuantity"), 0.0)).unwrap_or(0.0))),
                    ("excess_qty", Value::from(item.map(|o| n_val(o.get("excessQuantity"), 0.0)).unwrap_or(0.0))),
                ]
            }).collect();
            let line_ids: Vec<Value> = lines.iter().map(|line| line[0].1.clone()).collect();
            if line_ids.len() > 900 { return None; }
            if line_ids.is_empty() {
                stmts.push(SqlStmt { sql: "DELETE FROM purchase_items WHERE purchase_id = ?".into(), params: vec![Value::String(id.clone())] });
            } else {
                let placeholders = vec!["?"; line_ids.len()].join(", ");
                let mut params = vec![Value::String(id.clone())];
                params.extend(line_ids);
                stmts.push(SqlStmt { sql: format!("DELETE FROM purchase_items WHERE purchase_id = ? AND id NOT IN ({})", placeholders), params });
            }
            for line in lines {
                let update_cols: Vec<&str> = line.iter().filter(|(key, _)| *key != "id" && *key != "created_at").map(|(key, _)| *key).collect();
                stmts.push(build_upsert_ordered("purchase_items", &line, "id", &update_cols));
            }
            let receipt_docs = doc_obj.get("receivingHistory").and_then(Value::as_array).cloned().unwrap_or_default();
            let receipts: Vec<Vec<(&str, Value)>> = receipt_docs.iter().enumerate().map(|(index, receipt)| {
                let receipt = receipt.as_object();
                let receipt_id = receipt.and_then(|o| o.get("id")).filter(|v| !v.is_null() && !v.as_str().unwrap_or("").is_empty()).map(|v| s_val(Some(v), "")).unwrap_or_else(|| format!("{}-grn-{}", id, index));
                let items_json = receipt.and_then(|o| o.get("itemsReceived")).filter(|v| !v.is_null()).map(|v| Value::String(serde_json::to_string(v).unwrap_or_else(|_| "[]".into()))).unwrap_or(Value::String("[]".into()));
                vec![
                    ("id", Value::String(receipt_id)),
                    ("purchase_id", Value::String(id.clone())),
                    ("grn_number", Value::String(receipt.map(|o| s_val(o.get("grnNumber"), "")).unwrap_or_default())),
                    ("received_by", Value::String(receipt.map(|o| s_val(o.get("receivedBy"), "")).unwrap_or_default())),
                    ("notes", receipt.and_then(|o| o.get("notes")).filter(|v| !v.is_null() && !v.as_str().map(|s| s.is_empty()).unwrap_or(false)).cloned().unwrap_or(Value::Null)),
                    ("items_json", items_json),
                    ("received_at", Value::String(receipt.map(|o| s_val(o.get("receivedAt"), &now)).unwrap_or_else(|| now.clone()))),
                ]
            }).collect();
            let receipt_ids: Vec<Value> = receipts.iter().map(|receipt| receipt[0].1.clone()).collect();
            if receipt_ids.len() > 900 { return None; }
            if receipt_ids.is_empty() {
                stmts.push(SqlStmt { sql: "DELETE FROM receiving_history WHERE purchase_id = ?".into(), params: vec![Value::String(id.clone())] });
            } else {
                let placeholders = vec!["?"; receipt_ids.len()].join(", ");
                let mut params = vec![Value::String(id.clone())];
                params.extend(receipt_ids);
                stmts.push(SqlStmt { sql: format!("DELETE FROM receiving_history WHERE purchase_id = ? AND id NOT IN ({})", placeholders), params });
            }
            for receipt in receipts {
                let update_cols: Vec<&str> = receipt.iter().filter(|(key, _)| *key != "id" && *key != "created_at").map(|(key, _)| *key).collect();
                stmts.push(build_upsert_ordered("receiving_history", &receipt, "id", &update_cols));
            }
            Some(stmts)
        }
        _ => None,
    }
}

pub fn core_delete(collection: &str, document_id: &str) -> Option<Vec<SqlStmt>> {
    let id = document_id.trim();
    if id.is_empty() {
        return Some(vec![]);
    }

    match collection {
        "products" => Some(vec![SqlStmt {
            sql: "DELETE FROM products WHERE id = ?".into(),
            params: vec![Value::String(id.to_string())],
        }]),
        "customers" => Some(vec![SqlStmt {
            sql: "DELETE FROM customers WHERE id = ?".into(),
            params: vec![Value::String(id.to_string())],
        }]),
        "suppliers" => Some(vec![SqlStmt {
            sql: "DELETE FROM suppliers WHERE id = ?".into(),
            params: vec![Value::String(id.to_string())],
        }]),
        "sales" => Some(vec![
            SqlStmt {
                sql: "DELETE FROM sale_items WHERE sale_id = ?".into(),
                params: vec![Value::String(id.to_string())],
            },
            SqlStmt {
                sql: "DELETE FROM sales WHERE id = ?".into(),
                params: vec![Value::String(id.to_string())],
            },
        ]),
        "purchases" => Some(vec![
            SqlStmt {
                sql: "DELETE FROM purchase_items WHERE purchase_id = ?".into(),
                params: vec![Value::String(id.to_string())],
            },
            SqlStmt {
                sql: "DELETE FROM receiving_history WHERE purchase_id = ?".into(),
                params: vec![Value::String(id.to_string())],
            },
            SqlStmt {
                sql: "DELETE FROM purchases WHERE id = ?".into(),
                params: vec![Value::String(id.to_string())],
            },
        ]),
        _ => None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slugify() {
        assert_eq!(slugify_name("Groceries & Food"), "groceries-food");
        assert_eq!(slugify_name("  --Hello World!!--  "), "hello-world");
        assert_eq!(slugify_name("???"), "uncategorized");
    }

    #[test]
    fn test_naira_to_kobo() {
        assert_eq!(naira_to_kobo(&serde_json::json!(150.25)), 15025);
        assert_eq!(naira_to_kobo(&serde_json::json!("99.99")), 9999);
        assert_eq!(naira_to_kobo(&serde_json::json!(null)), 0);
    }

    #[test]
    fn test_customer_upsert() {
        let cust = serde_json::json!({
            "id": "cust-1",
            "name": "Jane Doe",
            "phone": "08012345678",
            "outstandingBalance": 500.0,
            "loyaltyPoints": 25
        });
        let stmts = core_upsert("customers", &cust, "2026-10-19T00:00:00Z").unwrap();
        assert_eq!(stmts.len(), 1);
        assert!(stmts[0].sql.starts_with("INSERT INTO customers"));
        assert!(stmts[0].sql.contains("ON CONFLICT(id) DO UPDATE SET"));
        assert_eq!(stmts[0].params[0], serde_json::json!("cust-1"));
    }

    #[test]
    fn test_sale_upsert_reconciles_lines_and_placeholder_receipts() {
        let sale = serde_json::json!({
            "id":"sale-1", "invoiceNo":"N/A", "subtotal":30, "totalAmount":30,
            "createdAt":"2026-10-19T00:00:00Z",
            "items":[{"productId":"p1","productName":"Item","sku":"A","quantity":2,"unitPrice":15,"costPrice":10,"total":30}]
        });
        let statements = core_upsert("sales", &sale, "fallback").unwrap();
        assert_eq!(statements.len(), 3);
        assert!(statements[0].sql.starts_with("INSERT INTO sales"));
        assert_eq!(statements[0].params[1], serde_json::json!("sale-1"));
        assert!(statements[1].sql.contains("DELETE FROM sale_items"));
        assert!(statements[2].sql.starts_with("INSERT INTO sale_items"));
        assert_eq!(statements[2].params[0], serde_json::json!("sale-1-item-0"));
    }

    #[test]
    fn test_purchase_upsert_reconciles_items_and_receipts() {
        let purchase = serde_json::json!({
            "id":"po-1", "totalAmount":50, "createdAt":"2026-10-19T00:00:00Z",
            "items":[{"productId":"p1","productName":"Item","sku":"A","quantity":2,"unitCost":25,"total":50}],
            "receivingHistory":[{"grnNumber":"GRN-1","receivedAt":"2026-10-19T00:00:00Z","itemsReceived":[{"productId":"p1","quantityReceived":2}]}]
        });
        let statements = core_upsert("purchases", &purchase, "fallback").unwrap();
        assert_eq!(statements.len(), 5);
        assert!(statements[0].sql.starts_with("INSERT INTO purchases"));
        assert!(statements[1].sql.contains("DELETE FROM purchase_items"));
        assert!(statements[2].sql.starts_with("INSERT INTO purchase_items"));
        assert!(statements[3].sql.contains("DELETE FROM receiving_history"));
        assert!(statements[4].sql.starts_with("INSERT INTO receiving_history"));
        assert_eq!(statements[4].params[0], serde_json::json!("po-1-grn-0"));
    }

    #[test]
    fn test_sale_delete_cascade() {
        let stmts = core_delete("sales", "sale-999").unwrap();
        assert_eq!(stmts.len(), 2);
        assert_eq!(stmts[0].sql, "DELETE FROM sale_items WHERE sale_id = ?");
        assert_eq!(stmts[1].sql, "DELETE FROM sales WHERE id = ?");
    }
}
