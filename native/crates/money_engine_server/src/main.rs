//! HTTP surface for the Rust money engine.
//!
//! The Mall runs on a Cloudflare Worker, which cannot load a native Node addon.
//! This binary exposes the same `mall_engine`, `money_ledger` and
//! `relational_core` functions over HTTP so the Worker can delegate money math
//! to Rust instead of the TypeScript fallback.
//!
//! Contract notes:
//! - Every route is POST and answers `{"ok":true,"result":...}` or
//!   `{"ok":false,"error":"..."}` with a meaningful status code.
//! - When `MONEY_ENGINE_TOKEN` is set, `Authorization: Bearer <token>` is
//!   required on every route except `/health`. Unset token = open (local dev).
//! - `/health` reports the engine version so the Worker can prove which
//!   implementation answered.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;

use mall_engine::{
    calculate_amount_due_kobo, validate_order_transition, verify_order_totals, MallOrderStatus,
};
use money_ledger::{compute_treasury_balances, MoneyMovementInput};
use serde_json::{json, Value};

const ENGINE_NAME: &str = "idofera-rust-money-engine";
const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_BODY_BYTES: usize = 1 << 20;

pub struct Engine {
    token: Option<String>,
}

#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub body: Value,
}

impl Reply {
    fn ok(value: Value) -> Self {
        Self { status: 200, body: json!({ "ok": true, "result": value }) }
    }

    fn error(status: u16, message: impl Into<String>) -> Self {
        Self { status, body: json!({ "ok": false, "error": message.into() }) }
    }
}

fn engine_identity() -> Value {
    json!({ "engine": ENGINE_NAME, "version": ENGINE_VERSION, "runtime": "rust" })
}
fn parse_status(raw: &str, field: &str) -> Result<MallOrderStatus, Reply> {
    MallOrderStatus::parse(raw)
        .ok_or_else(|| Reply::error(400, format!("Unknown {} order status: {}", field, raw)))
}

fn i64_field(body: &Value, key: &str) -> Result<i64, Reply> {
    body.get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| Reply::error(400, format!("{} must be an integer kobo amount", key)))
}

impl Engine {
    pub fn new(token: Option<String>) -> Self {
        let token = token.filter(|t| !t.trim().is_empty());
        Self { token }
    }

    fn authorized(&self, header: Option<&str>) -> bool {
        match &self.token {
            None => true,
            Some(expected) => header
                .and_then(|h| h.strip_prefix("Bearer "))
                .map(|given| constant_time_eq(given.trim(), expected.trim()))
                .unwrap_or(false),
        }
    }

    /// Handles one request. `path` excludes any query string.
    pub fn handle(&self, method: &str, path: &str, authorization: Option<&str>, body: &[u8]) -> Reply {
        if method != "POST" && path != "/health" {
            return Reply::error(405, "Method not allowed; use POST");
        }
        if path == "/health" {
            // Readiness must stay cheap and must not disclose whether a token is set.
            let mut identity = engine_identity();
            identity["auth"] = json!(if self.token.is_some() { "required" } else { "open" });
            return Reply::ok(identity);
        }
        if !self.authorized(authorization) {
            return Reply::error(401, "Unauthorized");
        }
        let parsed: Value = match serde_json::from_slice(body) {
            Ok(value) => value,
            Err(error) => return Reply::error(400, format!("Invalid JSON body: {}", error)),
        };
        match path {
            "/orders/transition" => self.transition(&parsed),
            "/orders/amount-due" => self.amount_due(&parsed),
            "/orders/verify-totals" => self.verify_totals(&parsed),
            "/ledger/treasury-balances" => self.treasury_balances(&parsed),
            "/relational/plan-upsert" => self.plan_upsert(&parsed),
            "/relational/plan-delete" => self.plan_delete(&parsed),
            other => Reply::error(404, format!("Unknown route: {}", other)),
        }
    }

    fn transition(&self, body: &Value) -> Reply {
        let from_raw = body.get("from").and_then(Value::as_str).unwrap_or("");
        let to_raw = body.get("to").and_then(Value::as_str).unwrap_or("");
        let from = match parse_status(from_raw, "origin") { Ok(v) => v, Err(reply) => return reply };
        let to = match parse_status(to_raw, "target") { Ok(v) => v, Err(reply) => return reply };
        let result = validate_order_transition(from, to);
        Reply::ok(json!({
            "allowed": result.allowed,
            "isIdempotent": result.is_idempotent,
            "errorMessage": result.error_message,
        }))
    }

    fn amount_due(&self, body: &Value) -> Reply {
        let total = match i64_field(body, "totalKobo") { Ok(v) => v, Err(reply) => return reply };
        let paid = match i64_field(body, "paidKobo") { Ok(v) => v, Err(reply) => return reply };
        if total < 0 || paid < 0 {
            return Reply::error(400, "Order amounts must be non-negative kobo");
        }
        let status_raw = body.get("status").and_then(Value::as_str).unwrap_or("");
        let status = match parse_status(status_raw, "order") { Ok(v) => v, Err(reply) => return reply };
        Reply::ok(json!({ "amountDueKobo": calculate_amount_due_kobo(total, paid, status) }))
    }

    fn verify_totals(&self, body: &Value) -> Reply {
        let subtotal = match i64_field(body, "subtotalKobo") { Ok(v) => v, Err(reply) => return reply };
        let discount = match i64_field(body, "discountKobo") { Ok(v) => v, Err(reply) => return reply };
        let delivery = match i64_field(body, "deliveryFeeKobo") { Ok(v) => v, Err(reply) => return reply };
        let total = match i64_field(body, "totalKobo") { Ok(v) => v, Err(reply) => return reply };
        match verify_order_totals(subtotal, discount, delivery, total) {
            Ok(()) => Reply::ok(json!({ "valid": true, "error": Value::Null })),
            Err(message) => Reply::ok(json!({ "valid": false, "error": message })),
        }
    }

    fn treasury_balances(&self, body: &Value) -> Reply {
        let movements: Vec<MoneyMovementInput> = match body.get("movements").is_some() {
            true => match serde_json::from_value(body["movements"].clone()) {
                Ok(parsed) => parsed,
                Err(error) => return Reply::error(400, format!("Invalid movements: {}", error)),
            },
            false => return Reply::error(400, "movements must be an array"),
        };
        let result = compute_treasury_balances(&movements);
        Reply::ok(json!({
            "bizAccountBalance": result.biz_account_balance,
            "physicalCashBalance": result.physical_cash_balance,
            "totalLiquidCash": result.total_liquid_cash,
            "totalOwnerDrawings": result.total_owner_drawings,
            "totalOwnerLoans": result.total_owner_loans,
        }))
    }

    fn plan_upsert(&self, body: &Value) -> Reply {
        let collection = body.get("collection").and_then(Value::as_str).unwrap_or("");
        let Some(document) = body.get("document") else {
            return Reply::error(400, "document is required");
        };
        let now = body.get("now").and_then(Value::as_str).unwrap_or("");
        match relational_core::core_upsert(collection, document, now) {
            Some(statements) => Reply::ok(json!({ "statements": statements })),
            None => Reply::ok(json!({ "statements": Value::Null })),
        }
    }

    fn plan_delete(&self, body: &Value) -> Reply {
        let collection = body.get("collection").and_then(Value::as_str).unwrap_or("");
        let id = body.get("documentId").and_then(Value::as_str).unwrap_or("");
        match relational_core::core_delete(collection, id) {
            Some(statements) => Reply::ok(json!({ "statements": statements })),
            None => Reply::ok(json!({ "statements": Value::Null })),
        }
    }
}

/// Length-independent comparison so a wrong token cannot be guessed by timing.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= x ^ y;
    }
    diff == 0
}

/// Minimal HTTP/1.1 reader: headers, optional content-length body, then one reply.
pub fn serve_stream(mut stream: TcpStream, engine: &Engine) {
    let peer_open = (|| -> std::io::Result<()> {
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut request_line = String::new();
        if reader.read_line(&mut request_line)? == 0 {
            return Ok(());
        }
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let target = parts.next().unwrap_or("/").to_string();
        let path = target.split('?').next().unwrap_or("/").to_string();

        let mut headers: HashMap<String, String> = HashMap::new();
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                break;
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                break;
            }
            if let Some((key, value)) = trimmed.split_once(':') {
                headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
            }
        }

        let length: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let mut body = vec![0u8; length.min(MAX_BODY_BYTES)];
        if !body.is_empty() {
            reader.read_exact(&mut body)?;
        }

        let reply = engine.handle(
            &method,
            &path,
            headers.get("authorization").map(String::as_str),
            &body,
        );
        let payload = serde_json::to_vec(&reply.body).unwrap_or_else(|_| b"{\"ok\":false}".to_vec());
        write!(
            stream,
            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            reply.status,
            status_text(reply.status),
            payload.len()
        )?;
        stream.write_all(&payload)?;
        stream.flush()
    })();

    if let Err(error) = peer_open {
        eprintln!("[money-engine] connection error: {}", error);
    }
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    }
}

fn main() {
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
    let token = std::env::var("MONEY_ENGINE_TOKEN").ok();
    let engine = Arc::new(Engine::new(token.clone()));
    let address = format!("0.0.0.0:{}", port);
    let listener = match TcpListener::bind(&address) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("[money-engine] cannot bind {}: {}", address, error);
            std::process::exit(1);
        }
    };
    println!(
        "[money-engine] {} v{} listening on {} (auth: {})",
        ENGINE_NAME,
        ENGINE_VERSION,
        address,
        if token.is_some() { "required" } else { "open" }
    );
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let engine = Arc::clone(&engine);
                thread::spawn(move || serve_stream(stream, &engine));
            }
            Err(error) => eprintln!("[money-engine] accept failed: {}", error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(value: Value) -> Vec<u8> {
        serde_json::to_vec(&value).unwrap()
    }

    #[test]
    fn health_needs_no_token_and_names_the_engine() {
        let engine = Engine::new(Some("secret".into()));
        let reply = engine.handle("GET", "/health", None, &[]);
        assert_eq!(reply.status, 200);
        assert_eq!(reply.body["result"]["engine"], ENGINE_NAME);
        assert_eq!(reply.body["result"]["auth"], "required");
    }

    #[test]
    fn protected_routes_reject_missing_or_wrong_token() {
        let engine = Engine::new(Some("secret".into()));
        let payload = body(json!({ "totalKobo": 100, "paidKobo": 0, "status": "pending" }));
        assert_eq!(engine.handle("POST", "/orders/amount-due", None, &payload).status, 401);
        assert_eq!(engine.handle("POST", "/orders/amount-due", Some("Bearer nope"), &payload).status, 401);
        assert_eq!(engine.handle("POST", "/orders/amount-due", Some("Bearer secret"), &payload).status, 200);
    }

    #[test]
    fn amount_due_matches_engine_semantics() {
        let engine = Engine::new(None);
        let reply = engine.handle(
            "POST",
            "/orders/amount-due",
            None,
            &body(json!({ "totalKobo": 50000, "paidKobo": 20000, "status": "processing" })),
        );
        assert_eq!(reply.body["result"]["amountDueKobo"], 30000);
        let cancelled = engine.handle(
            "POST",
            "/orders/amount-due",
            None,
            &body(json!({ "totalKobo": 50000, "paidKobo": 20000, "status": "cancelled" })),
        );
        assert_eq!(cancelled.body["result"]["amountDueKobo"], 0);
    }

    #[test]
    fn invalid_kobo_and_unknown_status_are_client_errors() {
        let engine = Engine::new(None);
        let missing = engine.handle("POST", "/orders/amount-due", None, &body(json!({ "status": "pending" })));
        assert_eq!(missing.status, 400);
        let unknown = engine.handle(
            "POST",
            "/orders/transition",
            None,
            &body(json!({ "from": "banana", "to": "confirmed" })),
        );
        assert_eq!(unknown.status, 400);
    }

    #[test]
    fn verify_totals_reports_reason_without_failing_the_request() {
        let engine = Engine::new(None);
        let reply = engine.handle(
            "POST",
            "/orders/verify-totals",
            None,
            &body(json!({ "subtotalKobo": 1000, "discountKobo": 0, "deliveryFeeKobo": 0, "totalKobo": 999 })),
        );
        assert_eq!(reply.status, 200);
        assert_eq!(reply.body["result"]["valid"], false);
    }

    #[test]
    fn treasury_balances_use_integer_cents() {
        let engine = Engine::new(None);
        let reply = engine.handle(
            "POST",
            "/ledger/treasury-balances",
            None,
            &body(json!({ "movements": [
                { "id": "m1", "type": "Sale Inflow", "destinationAccount": "Biz Account", "amount_cents": 1050 }
            ]})),
        );
        assert_eq!(reply.body["result"]["bizAccountBalance"], 10.5);
    }

    #[test]
    fn unknown_route_and_method_are_rejected() {
        let engine = Engine::new(None);
        assert_eq!(engine.handle("POST", "/nope", None, &body(json!({}))).status, 404);
        assert_eq!(engine.handle("GET", "/orders/amount-due", None, &[]).status, 405);
    }

    #[test]
    fn token_comparison_is_exact() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
        assert!(!constant_time_eq("", "x"));
    }
}
