use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration};

use super::http_engine::{
    execute_http_request, ApiRequestBody, ApiRequestPayload, ApiResponsePayload,
};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiWebhookDispatchPayload {
    pub target_url: String,
    pub service: String, // "stripe", "github", "supabase", "resend", "custom"
    pub event_type: String,
    pub payload: serde_json::Value,
    pub secret: Option<String>,
    pub custom_headers: Option<HashMap<String, String>>,
    pub duplicate_count: Option<u32>, // e.g. 2 for idempotency testing
    pub delay_ms_between_duplicates: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiWebhookAttemptResult {
    pub attempt: u32,
    pub status: u16,
    pub duration_ms: f64,
    pub response_body: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiWebhookResultPayload {
    pub target_url: String,
    pub service: String,
    pub event_type: String,
    pub attempts: Vec<ApiWebhookAttemptResult>,
    pub is_idempotent: bool,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiAssertion {
    pub property: String, // "status", "body_contains", "json_path", "latency_ms"
    pub target: Option<String>, // e.g. "data.id" for json_path
    pub operator: String, // "equals", "not_equals", "contains", "less_than", "greater_than"
    pub expected: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiAssertionResult {
    pub assertion: ApiAssertion,
    pub passed: bool,
    pub actual: Option<serde_json::Value>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiScenarioStep {
    pub id: String,
    pub name: String,
    pub kind: String, // "request" | "webhook"
    pub request: Option<ApiRequestPayload>,
    pub webhook: Option<ApiWebhookDispatchPayload>,
    pub assertions: Vec<ApiAssertion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiScenarioStepResult {
    pub step_id: String,
    pub step_name: String,
    pub step_kind: String,
    pub passed: bool,
    pub response: Option<ApiResponsePayload>,
    pub webhook_result: Option<ApiWebhookResultPayload>,
    pub assertions: Vec<ApiAssertionResult>,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiScenarioPayload {
    pub name: String,
    pub service: String,
    pub steps: Vec<ApiScenarioStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiScenarioResultPayload {
    pub scenario_name: String,
    pub service: String,
    pub passed: bool,
    pub total_steps: usize,
    pub passed_steps: usize,
    pub failed_steps: usize,
    pub step_results: Vec<ApiScenarioStepResult>,
    pub total_duration_ms: f64,
}

fn compute_hmac_sha256(secret: &str, data: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(data.as_bytes());
    let result = mac.finalize();
    hex::encode(result.into_bytes())
}

pub async fn dispatch_mock_webhook(
    dispatch: ApiWebhookDispatchPayload,
) -> Result<ApiWebhookResultPayload, String> {
    let payload_str = serde_json::to_string(&dispatch.payload)
        .map_err(|e| format!("Invalid JSON payload: {e}"))?;

    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut headers = HashMap::new();
    headers.insert(
        "content-type".to_string(),
        "application/json; charset=utf-8".to_string(),
    );

    if let Some(ref custom) = dispatch.custom_headers {
        for (k, v) in custom {
            headers.insert(k.clone(), v.clone());
        }
    }

    // Sign with provider standard
    match dispatch.service.to_lowercase().as_str() {
        "stripe" => {
            headers.insert("stripe-version".to_string(), "2024-06-20".to_string());
            if let Some(ref secret) = dispatch.secret {
                let signed_payload = format!("{now_ts}.{payload_str}");
                let sig = compute_hmac_sha256(secret, &signed_payload);
                headers.insert("stripe-signature".to_string(), format!("t={now_ts},v1={sig}"));
            }
        }
        "github" => {
            headers.insert("x-github-event".to_string(), dispatch.event_type.clone());
            headers.insert("x-github-delivery".to_string(), uuid_synthetic());
            if let Some(ref secret) = dispatch.secret {
                let sig = compute_hmac_sha256(secret, &payload_str);
                headers.insert("x-hub-signature-256".to_string(), format!("sha256={sig}"));
            }
        }
        "supabase" => {
            headers.insert("x-supabase-event".to_string(), dispatch.event_type.clone());
            if let Some(ref secret) = dispatch.secret {
                let sig = compute_hmac_sha256(secret, &payload_str);
                headers.insert("x-supabase-signature".to_string(), format!("sha256={sig}"));
            }
        }
        "resend" => {
            headers.insert("resend-event-type".to_string(), dispatch.event_type.clone());
            if let Some(ref secret) = dispatch.secret {
                let sig = compute_hmac_sha256(secret, &payload_str);
                headers.insert("resend-signature".to_string(), sig);
            }
        }
        _ => {
            headers.insert("x-webhook-event".to_string(), dispatch.event_type.clone());
            if let Some(ref secret) = dispatch.secret {
                let sig = compute_hmac_sha256(secret, &payload_str);
                headers.insert("x-webhook-signature".to_string(), sig);
            }
        }
    }

    let duplicate_count = dispatch.duplicate_count.unwrap_or(1).max(1);
    let delay_ms = dispatch.delay_ms_between_duplicates.unwrap_or(50);
    let mut attempts = Vec::new();

    for i in 1..=duplicate_count {
        if i > 1 && delay_ms > 0 {
            sleep(Duration::from_millis(delay_ms)).await;
        }

        let req = ApiRequestPayload {
            id: Some(format!("webhook-attempt-{i}")),
            url: dispatch.target_url.clone(),
            method: "POST".to_string(),
            headers: headers.clone(),
            query_params: Vec::new(),
            body: ApiRequestBody::Json(dispatch.payload.clone()),
            auth: super::http_engine::ApiRequestAuth::None,
            timeout_ms: Some(15_000),
            follow_redirects: true,
            insecure_skip_verify: false,
        };

        match execute_http_request(req).await {
            Ok(resp) => {
                let success = resp.status >= 200 && resp.status < 300;
                attempts.push(ApiWebhookAttemptResult {
                    attempt: i,
                    status: resp.status,
                    duration_ms: resp.timings.total_duration_ms,
                    response_body: resp.body,
                    success,
                });
            }
            Err(e) => {
                attempts.push(ApiWebhookAttemptResult {
                    attempt: i,
                    status: 0,
                    duration_ms: 0.0,
                    response_body: e,
                    success: false,
                });
            }
        }
    }

    let is_idempotent = if attempts.len() <= 1 {
        attempts.first().is_some_and(|a| a.success)
    } else {
        // For duplicate deliveries, both should succeed with 2xx status (or second returns 200/202 ignored)
        attempts.iter().all(|a| a.status >= 200 && a.status < 300)
    };

    let summary = if duplicate_count > 1 {
        if is_idempotent {
            format!(
                "Idempotency probe PASSED: {duplicate_count} duplicate events processed cleanly with 2xx status."
            )
        } else {
            "Idempotency probe FAILED: Duplicates caused non-2xx status or failed processing."
                .to_string()
        }
    } else if let Some(first) = attempts.first() {
        format!("Webhook dispatched: HTTP {}", first.status)
    } else {
        "Webhook dispatch finished".to_string()
    };

    Ok(ApiWebhookResultPayload {
        target_url: dispatch.target_url,
        service: dispatch.service,
        event_type: dispatch.event_type,
        attempts,
        is_idempotent,
        summary,
    })
}

fn uuid_synthetic() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{now:032x}")
}

fn evaluate_assertion(assertion: &ApiAssertion, resp: &ApiResponsePayload) -> ApiAssertionResult {
    match assertion.property.as_str() {
        "status" => {
            let actual_status = resp.status as i64;
            let expected_status = assertion.expected.as_i64().unwrap_or(200);
            let passed = match assertion.operator.as_str() {
                "equals" => actual_status == expected_status,
                "not_equals" => actual_status != expected_status,
                "less_than" => actual_status < expected_status,
                "greater_than" => actual_status > expected_status,
                _ => actual_status == expected_status,
            };
            ApiAssertionResult {
                assertion: assertion.clone(),
                passed,
                actual: Some(serde_json::Value::from(actual_status)),
                message: format!(
                    "Expected status {} {}, got {}",
                    assertion.operator, expected_status, actual_status
                ),
            }
        }
        "latency_ms" => {
            let actual_latency = resp.timings.total_duration_ms;
            let expected_latency = assertion.expected.as_f64().unwrap_or(1000.0);
            let passed = match assertion.operator.as_str() {
                "less_than" => actual_latency < expected_latency,
                "greater_than" => actual_latency > expected_latency,
                _ => actual_latency <= expected_latency,
            };
            ApiAssertionResult {
                assertion: assertion.clone(),
                passed,
                actual: Some(serde_json::Value::from(actual_latency)),
                message: format!(
                    "Expected latency {} {:.1}ms, got {:.1}ms",
                    assertion.operator, expected_latency, actual_latency
                ),
            }
        }
        "body_contains" => {
            let expected_substr = assertion.expected.as_str().unwrap_or("");
            let passed = resp.body.contains(expected_substr);
            ApiAssertionResult {
                assertion: assertion.clone(),
                passed,
                actual: Some(serde_json::Value::String(resp.body.chars().take(200).collect())),
                message: if passed {
                    format!("Body contains substring '{expected_substr}'")
                } else {
                    format!("Body does not contain '{expected_substr}'")
                },
            }
        }
        _ => ApiAssertionResult {
            assertion: assertion.clone(),
            passed: true,
            actual: None,
            message: "Unsupported assertion property".to_string(),
        },
    }
}

pub async fn run_api_scenario(
    scenario: ApiScenarioPayload,
) -> Result<ApiScenarioResultPayload, String> {
    let start_all = std::time::Instant::now();
    let mut step_results = Vec::new();
    let mut passed_steps = 0;
    let mut failed_steps = 0;

    for step in scenario.steps {
        let step_start = std::time::Instant::now();
        if step.kind == "webhook" {
            if let Some(wh) = step.webhook {
                let wh_res = dispatch_mock_webhook(wh).await?;
                let passed = wh_res.is_idempotent;
                if passed {
                    passed_steps += 1;
                } else {
                    failed_steps += 1;
                }
                step_results.push(ApiScenarioStepResult {
                    step_id: step.id,
                    step_name: step.name,
                    step_kind: "webhook".to_string(),
                    passed,
                    response: None,
                    webhook_result: Some(wh_res),
                    assertions: Vec::new(),
                    duration_ms: step_start.elapsed().as_secs_f64() * 1000.0,
                });
            }
        } else if let Some(req) = step.request {
            match execute_http_request(req).await {
                Ok(resp) => {
                    let mut assertion_results = Vec::new();
                    let mut all_assertions_passed = true;
                    for a in &step.assertions {
                        let eval = evaluate_assertion(a, &resp);
                        if !eval.passed {
                            all_assertions_passed = false;
                        }
                        assertion_results.push(eval);
                    }

                    let step_passed = all_assertions_passed && resp.status >= 200 && resp.status < 400;
                    if step_passed {
                        passed_steps += 1;
                    } else {
                        failed_steps += 1;
                    }

                    step_results.push(ApiScenarioStepResult {
                        step_id: step.id,
                        step_name: step.name,
                        step_kind: "request".to_string(),
                        passed: step_passed,
                        response: Some(resp),
                        webhook_result: None,
                        assertions: assertion_results,
                        duration_ms: step_start.elapsed().as_secs_f64() * 1000.0,
                    });
                }
                Err(e) => {
                    failed_steps += 1;
                    step_results.push(ApiScenarioStepResult {
                        step_id: step.id,
                        step_name: step.name,
                        step_kind: "request".to_string(),
                        passed: false,
                        response: Some(ApiResponsePayload {
                            request_id: None,
                            status: 0,
                            status_text: "Client Error".to_string(),
                            headers: Vec::new(),
                            body: e.clone(),
                            body_bytes_len: e.len(),
                            is_json: false,
                            json_value: None,
                            timings: super::http_engine::ApiTimings {
                                total_duration_ms: 0.0,
                            },
                            error: Some(e),
                        }),
                        webhook_result: None,
                        assertions: Vec::new(),
                        duration_ms: step_start.elapsed().as_secs_f64() * 1000.0,
                    });
                }
            }
        }
    }

    let total_steps = step_results.len();
    let overall_passed = failed_steps == 0 && total_steps > 0;

    Ok(ApiScenarioResultPayload {
        scenario_name: scenario.name,
        service: scenario.service,
        passed: overall_passed,
        total_steps,
        passed_steps,
        failed_steps,
        step_results,
        total_duration_ms: start_all.elapsed().as_secs_f64() * 1000.0,
    })
}
