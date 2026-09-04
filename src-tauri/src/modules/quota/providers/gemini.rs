use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{Local, TimeZone};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::dirs_home;
use crate::modules::quota::cost_engine::CostEngine;
use crate::modules::quota::types::*;

const LOAD_CODE_ASSIST_URL: &str =
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const QUOTA_URL: &str = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Deserialize, Debug, Clone)]
struct GeminiOAuthCreds {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expiry_date: Option<f64>,
    id_token: Option<String>,
    client_id: Option<String>,
    client_secret: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct GoogleTokenRefreshResponse {
    access_token: String,
    #[allow(dead_code)]
    expires_in: Option<u64>,
    #[allow(dead_code)]
    id_token: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GoogleAccountsFile {
    active: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct QuotaBucket {
    remaining_fraction: Option<f64>,
    #[allow(dead_code)]
    remaining_amount: Option<Value>,
    reset_time: Option<String>,
    model_id: Option<String>,
    #[allow(dead_code)]
    token_type: Option<String>,
}

#[derive(Deserialize, Debug)]
struct QuotaResponse {
    buckets: Option<Vec<QuotaBucket>>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CodeAssistTier {
    id: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct PaidTier {
    id: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CodeAssistResponse {
    current_tier: Option<CodeAssistTier>,
    paid_tier: Option<PaidTier>,
    #[serde(alias = "cloudaicompanionProject")]
    cloudai_companion_project: Option<String>,
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn iso_now() -> String {
    format!("{:?}", SystemTime::now())
}

fn gemini_creds_path() -> Option<PathBuf> {
    dirs_home().map(|h| PathBuf::from(h).join(".gemini").join("oauth_creds.json"))
}

fn google_accounts_path() -> Option<PathBuf> {
    dirs_home().map(|h| PathBuf::from(h).join(".gemini").join("google_accounts.json"))
}

fn read_fallback_email() -> Option<String> {
    let path = google_accounts_path()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let accounts: GoogleAccountsFile = serde_json::from_str(&content).ok()?;
    accounts.active.filter(|e| !e.is_empty())
}

fn extract_email(creds: Option<&GeminiOAuthCreds>) -> Option<String> {
    let jwt_email = creds.and_then(|c| c.id_token.as_ref()).and_then(|jwt| {
        let parts: Vec<&str> = jwt.split('.').collect();
        if parts.len() < 2 {
            return None;
        }
        let payload = parts[1];
        let padded = match payload.len() % 4 {
            2 => format!("{}==", payload),
            3 => format!("{}=", payload),
            _ => payload.to_string(),
        };
        let decoded = padded.replace('-', "+").replace('_', "/");
        let bytes = base64_decode(&decoded)?;
        let val: Value = serde_json::from_slice(&bytes).ok()?;
        val.get("email").and_then(|e| e.as_str()).map(|s| s.to_string())
    });
    jwt_email.or_else(read_fallback_email)
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(input).ok()
}

fn read_credentials() -> Option<GeminiOAuthCreds> {
    let path = gemini_creds_path()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<GeminiOAuthCreds>(&content).ok()
}

fn refresh_token_if_needed(creds: &mut GeminiOAuthCreds) -> bool {
    let raw_expiry = creds.expiry_date.unwrap_or(0.0) as u64;
    let expiry = if raw_expiry > 0 && raw_expiry < 10_000_000_000 {
        raw_expiry * 1000
    } else {
        raw_expiry
    };
    let now = now_epoch_ms();
    if expiry > now + 60_000 && creds.access_token.is_some() {
        return true;
    }

    let Some(ref refresh) = creds.refresh_token else {
        return creds.access_token.is_some();
    };

    let client_id_env = std::env::var("GEMINI_OAUTH_CLIENT_ID").ok();
    let client_secret_env = std::env::var("GEMINI_OAUTH_CLIENT_SECRET").ok();
    let Some(client_id) = creds.client_id.as_deref().or(client_id_env.as_deref()) else {
        return creds.access_token.is_some();
    };
    let Some(client_secret) = creds.client_secret.as_deref().or(client_secret_env.as_deref()) else {
        return creds.access_token.is_some();
    };

    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let body = format!(
        "grant_type=refresh_token&client_id={}&client_secret={}&refresh_token={}",
        client_id, client_secret, refresh
    );

    let Ok(resp) = agent
        .post("https://oauth2.googleapis.com/token")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_bytes(body.as_bytes())
    else {
        return creds.access_token.is_some();
    };

    if resp.status() >= 200 && resp.status() < 300 {
        let resp_str = resp.into_string().unwrap_or_default();
        if let Ok(token_resp) = serde_json::from_str::<GoogleTokenRefreshResponse>(&resp_str) {
            let tok = token_resp.access_token;
            creds.access_token = Some(tok.clone());
            if let Some(exp_sec) = token_resp.expires_in {
                let new_exp = (now + exp_sec * 1000) as f64;
                creds.expiry_date = Some(new_exp);
            }
            if let Some(ref new_id) = token_resp.id_token {
                creds.id_token = Some(new_id.clone());
            }
            if let Some(path) = gemini_creds_path() {
                if let Ok(existing) = fs::read_to_string(&path) {
                    if let Ok(mut map) = serde_json::from_str::<Value>(&existing) {
                        map["access_token"] = json!(tok);
                        if let Some(exp) = creds.expiry_date {
                            map["expiry_date"] = json!(exp);
                        }
                        if let Some(ref id) = creds.id_token {
                            map["id_token"] = json!(id);
                        }
                        let _ = fs::write(path, map.to_string());
                    }
                }
            }
            return true;
        }
    }
    creds.access_token.is_some()
}

pub fn collect_gemini_quota(cost_engine: &CostEngine) -> ProviderQuota {
    let email = read_fallback_email();
    let mut creds = match read_credentials() {
        Some(c) => c,
        None => return fallback_local_transcripts(cost_engine, "Gemini credentials not found", email),
    };

    let user_email = extract_email(Some(&creds)).or(email);
    refresh_token_if_needed(&mut creds);

    let Some(ref token) = creds.access_token else {
        return fallback_local_transcripts(cost_engine, "Connected (Antigravity CLI)", user_email);
    };

    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();

    // Step 1: loadCodeAssist to get project ID
    let body_ca = json!({
        "metadata": {
            "ideType": "GEMINI_CLI",
            "pluginType": "GEMINI"
        }
    }).to_string();

    let code_assist_resp = agent
        .post(LOAD_CODE_ASSIST_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .set("User-Agent", "google-cloud-code-vscode/1.22.0")
        .send_string(&body_ca);

    let mut project_id = String::new();
    let mut plan_name = Some("Google AI / Antigravity".to_string());

    if let Ok(resp) = code_assist_resp {
        if resp.status() >= 200 && resp.status() < 300 {
            let body = resp.into_string().unwrap_or_default();
            if let Ok(ca) = serde_json::from_str::<CodeAssistResponse>(&body) {
                if let Some(p) = ca.cloudai_companion_project {
                    project_id = p;
                }
                if let Some(paid) = ca.paid_tier {
                    plan_name = paid.name.or(paid.id);
                } else if let Some(cur) = ca.current_tier {
                    plan_name = cur.name.or(cur.id);
                }
            }
        }
    }

    // Step 2: retrieveUserQuota
    let quota_body = if project_id.is_empty() {
        json!({}).to_string()
    } else {
        json!({ "project": project_id }).to_string()
    };

    let quota_resp = agent
        .post(QUOTA_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .set("User-Agent", "google-cloud-code-vscode/1.22.0")
        .send_string(&quota_body);

    match quota_resp {
        Ok(response) => {
            if response.status() >= 200 && response.status() < 300 {
                let body_str = response.into_string().unwrap_or_default();
                if let Ok(quota) = serde_json::from_str::<QuotaResponse>(&body_str) {
                    return build_quota_from_response(quota, cost_engine, plan_name, user_email);
                }
            }
            fallback_local_transcripts(cost_engine, "Connected (quota buckets offline)", user_email)
        }
        Err(ureq::Error::Status(status, _)) => {
            if status == 429 {
                let mut quota = fallback_local_transcripts(cost_engine, "Rate limited", user_email);
                quota.state = LimitState::RateLimited {
                    retry_after_secs: None,
                    message: "Gemini rate limit active".into(),
                };
                quota
            } else if status == 401 || status == 403 {
                // If Cloud Code endpoint returns 401/403 but local credentials/account exist,
                // keep status as Healthy connected with local Antigravity metrics.
                fallback_local_transcripts(cost_engine, "Connected (Antigravity CLI)", user_email)
            } else {
                fallback_local_transcripts(cost_engine, &format!("HTTP {status}"), user_email)
            }
        }
        Err(e) => fallback_local_transcripts(cost_engine, &format!("Network: {e}"), user_email),
    }
}

fn build_quota_from_response(
    quota: QuotaResponse,
    cost_engine: &CostEngine,
    plan_name: Option<String>,
    email: Option<String>,
) -> ProviderQuota {
    let mut windows = Vec::new();
    let mut worst_utilization = 0.0;
    let mut worst_resets_at = None;
    let mut worst_label = String::new();

    let mut tier_map: HashMap<String, (f64, Option<String>)> = HashMap::new();

    if let Some(buckets) = quota.buckets {
        for bucket in buckets {
            let model_id = bucket.model_id.unwrap_or_else(|| "unknown".into());
            let tier = if model_id.contains("flash-lite") || model_id.contains("flash_lite") {
                "Flash Lite Models".to_string()
            } else if model_id.contains("flash") {
                "Flash Models".to_string()
            } else if model_id.contains("pro") {
                "Pro Models".to_string()
            } else {
                "Default Models".to_string()
            };

            let remaining_fraction = bucket.remaining_fraction.unwrap_or(1.0);
            let used_percent = (1.0 - remaining_fraction) * 100.0;

            let entry = tier_map.entry(tier).or_insert((0.0, None));
            if used_percent > entry.0 {
                entry.0 = used_percent;
                entry.1 = bucket.reset_time;
            }
        }
    }

    let tier_order = ["Flash Models", "Pro Models", "Flash Lite Models", "Default Models"];
    for tier in &tier_order {
        if let Some((used_pct, reset_time)) = tier_map.get(*tier) {
            if *used_pct > worst_utilization {
                worst_utilization = *used_pct;
                worst_resets_at = reset_time.clone();
                worst_label = tier.to_string();
            }

            windows.push(QuotaWindow {
                id: format!("gemini-{}", tier.to_lowercase().replace(' ', "-")),
                provider_id: "gemini".into(),
                label: tier.to_string(),
                used_percent: used_pct.clamp(0.0, 100.0),
                remaining_percent: (100.0 - used_pct).clamp(0.0, 100.0),
                resets_at: reset_time.clone(),
                resets_in_seconds: None,
                raw_used: None,
                raw_limit: None,
                unit: Some("%".into()),
            });
        }
    }

    let state = if worst_utilization >= 100.0 {
        LimitState::Reached {
            used_percent: worst_utilization,
            resets_at: worst_resets_at,
        }
    } else if worst_utilization >= 80.0 {
        LimitState::Approaching {
            used_percent: worst_utilization,
            label: worst_label,
            resets_at: worst_resets_at,
        }
    } else {
        LimitState::Healthy
    };

    let (in_tokens, out_tokens, cache_tokens) = scan_today_tokens();
    let cost =
        cost_engine.calculate_cost_usd("gemini-3.8-flash", in_tokens, out_tokens, cache_tokens);

    ProviderQuota {
        provider_id: "gemini".into(),
        provider_name: "Google Gemini / Antigravity".into(),
        state,
        windows,
        plan_name,
        account_email: email,
        cost_today_usd: Some(cost),
        total_input_tokens: Some(in_tokens),
        total_output_tokens: Some(out_tokens),
        updated_at: iso_now(),
    }
}

fn fallback_local_transcripts(
    cost_engine: &CostEngine,
    reason: &str,
    email: Option<String>,
) -> ProviderQuota {
    let (in_tokens, out_tokens, cache_tokens) = scan_today_tokens();
    let cost =
        cost_engine.calculate_cost_usd("gemini-3.8-flash", in_tokens, out_tokens, cache_tokens);
    let total_tokens = in_tokens + out_tokens;
    let is_connected = email.is_some() || gemini_installed();

    let state = if is_connected {
        LimitState::Healthy
    } else {
        LimitState::Unavailable {
            message: reason.into(),
        }
    };

    let mut windows = Vec::new();
    if total_tokens > 0 {
        let session_limit = 1_000_000.0;
        let prompt_limit = 1_000_000.0;
        let output_limit = 1_000_000.0;

        let used_pct = (total_tokens as f64 / session_limit * 100.0).clamp(0.0, 100.0);
        let in_pct = (in_tokens as f64 / prompt_limit * 100.0).clamp(0.0, 100.0);
        let out_pct = (out_tokens as f64 / output_limit * 100.0).clamp(0.0, 100.0);

        windows.push(QuotaWindow {
            id: "gemini-local-today".into(),
            provider_id: "gemini".into(),
            label: "Tokens Today (Session)".into(),
            used_percent: used_pct,
            remaining_percent: (100.0 - used_pct).clamp(0.0, 100.0),
            resets_at: None,
            resets_in_seconds: None,
            raw_used: Some(total_tokens as f64),
            raw_limit: Some(session_limit),
            unit: Some("tokens".into()),
        });
        windows.push(QuotaWindow {
            id: "gemini-flash".into(),
            provider_id: "gemini".into(),
            label: "Flash / Prompt Tokens".into(),
            used_percent: in_pct,
            remaining_percent: (100.0 - in_pct).clamp(0.0, 100.0),
            resets_at: None,
            resets_in_seconds: None,
            raw_used: Some(in_tokens as f64),
            raw_limit: Some(prompt_limit),
            unit: Some("tokens".into()),
        });
        windows.push(QuotaWindow {
            id: "gemini-pro".into(),
            provider_id: "gemini".into(),
            label: "Pro / Output Tokens".into(),
            used_percent: out_pct,
            remaining_percent: (100.0 - out_pct).clamp(0.0, 100.0),
            resets_at: None,
            resets_in_seconds: None,
            raw_used: Some(out_tokens as f64),
            raw_limit: Some(output_limit),
            unit: Some("tokens".into()),
        });
    } else if is_connected {
        windows.push(QuotaWindow {
            id: "gemini-flash".into(),
            provider_id: "gemini".into(),
            label: "Flash Models".into(),
            used_percent: 0.0,
            remaining_percent: 100.0,
            resets_at: None,
            resets_in_seconds: None,
            raw_used: None,
            raw_limit: None,
            unit: Some("%".into()),
        });
        windows.push(QuotaWindow {
            id: "gemini-pro".into(),
            provider_id: "gemini".into(),
            label: "Pro Models".into(),
            used_percent: 0.0,
            remaining_percent: 100.0,
            resets_at: None,
            resets_in_seconds: None,
            raw_used: None,
            raw_limit: None,
            unit: Some("%".into()),
        });
    }

    ProviderQuota {
        provider_id: "gemini".into(),
        provider_name: "Google Gemini / Antigravity".into(),
        state,
        windows,
        plan_name: if is_connected {
            Some("Google AI / Antigravity".into())
        } else {
            None
        },
        account_email: email,
        cost_today_usd: Some(cost),
        total_input_tokens: Some(in_tokens),
        total_output_tokens: Some(out_tokens),
        updated_at: iso_now(),
    }
}

fn gemini_installed() -> bool {
    let Some(home) = dirs_home() else {
        return false;
    };
    let gemini_dir = PathBuf::from(home).join(".gemini");
    gemini_dir.exists()
}

fn scan_today_tokens() -> (u64, u64, u64) {
    let Some(home) = dirs_home() else {
        return (0, 0, 0);
    };
    let gemini_dir = PathBuf::from(home).join(".gemini");
    if !gemini_dir.exists() {
        return (0, 0, 0);
    }

    let today = Local::now().date_naive();
    let mut total_in = 0u64;
    let mut total_out = 0u64;
    let mut total_cache = 0u64;

    for sub in &["tmp", "antigravity-cli", "antigravity", "history"] {
        let dir = gemini_dir.join(sub);
        if dir.exists() {
            scan_dir_recursive(&dir, today, &mut total_in, &mut total_out, &mut total_cache, 0);
        }
    }

    (total_in, total_out, total_cache)
}

fn scan_dir_recursive(
    dir: &Path,
    today: chrono::NaiveDate,
    total_in: &mut u64,
    total_out: &mut u64,
    total_cache: &mut u64,
    depth: u8,
) {
    if depth > 5 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            scan_dir_recursive(&p, today, total_in, total_out, total_cache, depth + 1);
        } else if p.is_file() {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "jsonl" || ext == "json" {
                scan_single_file(&p, today, total_in, total_out, total_cache);
            }
        }
    }
}

fn parse_date_value(v: &Value) -> Option<chrono::NaiveDate> {
    match v {
        Value::String(s) => {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                return Some(dt.with_timezone(&Local).date_naive());
            }
            if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
                return Some(d);
            }
            s.parse::<i64>()
                .ok()
                .and_then(|ms| {
                    if ms > 0 && ms < 10_000_000_000 {
                        Local.timestamp_opt(ms, 0).single()
                    } else {
                        Local.timestamp_millis_opt(ms).single()
                    }
                })
                .map(|dt| dt.date_naive())
        }
        Value::Number(n) => {
            let ms = n.as_i64()?;
            if ms > 0 && ms < 10_000_000_000 {
                Local.timestamp_opt(ms, 0).single().map(|dt| dt.date_naive())
            } else {
                Local.timestamp_millis_opt(ms).single().map(|dt| dt.date_naive())
            }
        }
        _ => None,
    }
}

fn scan_single_file(
    path: &Path,
    today: chrono::NaiveDate,
    total_in: &mut u64,
    total_out: &mut u64,
    total_cache: &mut u64,
) {
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    for line in content.lines() {
        let line_trimmed = line.trim();
        if line_trimmed.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line_trimmed) else {
            continue;
        };

        let date = v.get("timestamp")
            .or_else(|| v.get("startTime"))
            .or_else(|| v.get("lastUpdated"))
            .or_else(|| v.get("created_at"))
            .and_then(parse_date_value);

        // Only count tokens from today
        if let Some(d) = date {
            if d != today {
                continue;
            }
        }

        let tokens_obj = v.get("tokens")
            .or_else(|| v.get("usage"))
            .or_else(|| v.get("tokenUsage"));

        if let Some(tokens) = tokens_obj {
            if let Some(i) = tokens.get("input")
                .or_else(|| tokens.get("input_tokens"))
                .or_else(|| tokens.get("inputTokens"))
                .or_else(|| tokens.get("prompt_tokens"))
                .and_then(|n| n.as_u64())
            {
                *total_in += i;
            }
            if let Some(o) = tokens.get("output")
                .or_else(|| tokens.get("output_tokens"))
                .or_else(|| tokens.get("outputTokens"))
                .or_else(|| tokens.get("completion_tokens"))
                .and_then(|n| n.as_u64())
            {
                *total_out += o;
            }
            if let Some(c) = tokens.get("cached")
                .or_else(|| tokens.get("cached_tokens"))
                .or_else(|| tokens.get("cache_read_input_tokens"))
                .and_then(|n| n.as_u64())
            {
                *total_cache += c;
            }
        } else {
            // Fallback token estimation (approx 4 chars/token) for Antigravity transcript format
            let src = v.get("source").and_then(Value::as_str).unwrap_or("");
            let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
            let content_len = v.get("content").and_then(Value::as_str).map(|s| s.len()).unwrap_or(0);
            let thinking_len = v.get("thinking").and_then(Value::as_str).map(|s| s.len()).unwrap_or(0);
            let tool_calls_len = v.get("tool_calls").map(|tc| tc.to_string().len()).unwrap_or(0);

            if src == "USER_EXPLICIT" || kind == "USER_INPUT" || kind == "user" {
                let in_est = (content_len as u64 / 4).max(1);
                *total_in += in_est;
            } else if src == "MODEL" || kind == "PLANNER_RESPONSE" || kind == "gemini" || kind == "assistant" {
                let out_est = ((content_len + thinking_len + tool_calls_len) as u64 / 4).max(1);
                *total_out += out_est;
            }
        }
    }
}

