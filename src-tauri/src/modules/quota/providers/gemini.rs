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
struct IneligibleTier {
    reason_code: Option<String>,
    #[allow(dead_code)]
    reason_message: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CodeAssistResponse {
    current_tier: Option<CodeAssistTier>,
    paid_tier: Option<PaidTier>,
    #[serde(default)]
    ineligible_tiers: Vec<IneligibleTier>,
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

fn is_token_expired(creds: &GeminiOAuthCreds) -> bool {
    match creds.expiry_date {
        Some(raw_expiry) => {
            let expiry_ms = if raw_expiry > 0.0 && raw_expiry < 10_000_000_000.0 {
                (raw_expiry * 1000.0) as u64
            } else {
                raw_expiry as u64
            };
            now_epoch_ms() + 60_000 >= expiry_ms
        }
        None => true,
    }
}

fn refresh_token_if_needed(creds: &mut GeminiOAuthCreds) -> bool {
    if !is_token_expired(creds) && creds.access_token.is_some() {
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
                let new_exp = (now_epoch_ms() + exp_sec * 1000) as f64;
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
                        let tmp_path = path.with_extension("tmp");
                        if fs::write(&tmp_path, map.to_string()).is_ok() {
                            let _ = fs::rename(&tmp_path, &path);
                        }
                    }
                }
            }
            return true;
        }
    }
    creds.access_token.is_some()
}

fn lenient_f64(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
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

    // Step 1: loadCodeAssist to resolve companion project and tier
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
                    let name = match cur.id.as_deref() {
                        Some("free-tier") => "Free".to_string(),
                        Some("standard-tier") => "Standard".to_string(),
                        Some("legacy-tier") => "Legacy".to_string(),
                        _ => cur.name.unwrap_or_else(|| "Google AI / Antigravity".into()),
                    };
                    plan_name = Some(name);
                } else if ca.ineligible_tiers.iter().any(|t| t.reason_code.as_deref() == Some("UNSUPPORTED_CLIENT")) {
                    plan_name = Some("Individual tier (sunset)".into());
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
                    if let Some(ref buckets) = quota.buckets {
                        if !buckets.is_empty() {
                            return build_quota_from_response(quota, cost_engine, plan_name, user_email);
                        }
                    }
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
                // Subscription required / OAuth tier sunset -> healthy with local stats
                fallback_local_transcripts(cost_engine, "Connected (Antigravity CLI)", user_email)
            } else {
                fallback_local_transcripts(cost_engine, &format!("HTTP {status}"), user_email)
            }
        }
        Err(e) => fallback_local_transcripts(cost_engine, &format!("Network: {e}"), user_email),
    }
}

struct TierAgg {
    remaining_fraction: f64,
    reset_time: Option<String>,
    remaining_amount: Option<f64>,
    limit: Option<f64>,
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

    let mut tier_map: HashMap<&str, TierAgg> = HashMap::new();

    if let Some(buckets) = quota.buckets {
        let tier_of = |m: &str| -> &'static str {
            if m.contains("flash-lite") || m.contains("flash_lite") {
                "Flash Lite Models"
            } else if m.contains("flash") {
                "Flash Models"
            } else if m.contains("pro") {
                "Pro Models"
            } else {
                "Other Models"
            }
        };

        for bucket in &buckets {
            let model_id = bucket.model_id.as_deref().unwrap_or("unknown");
            let tier = tier_of(model_id);
            let remaining = bucket.remaining_fraction.unwrap_or(1.0);
            let remaining_amount = lenient_f64(bucket.remaining_amount.as_ref());
            let limit = match (remaining_amount, bucket.remaining_fraction) {
                (Some(ra), Some(rf)) if rf > 0.0 => Some(ra / rf),
                _ => None,
            };
            let valid_reset = bucket
                .reset_time
                .as_deref()
                .filter(|t| !t.starts_with("1970"))
                .map(String::from);

            let entry = tier_map.entry(tier).or_insert(TierAgg {
                remaining_fraction: 1.0,
                reset_time: None,
                remaining_amount: None,
                limit: None,
            });

            if remaining < entry.remaining_fraction {
                entry.remaining_fraction = remaining;
                entry.remaining_amount = remaining_amount;
                entry.limit = limit;
            }
            if entry.reset_time.is_none() && valid_reset.is_some() {
                entry.reset_time = valid_reset;
            }
        }
    }

    let tier_order = ["Flash Models", "Pro Models", "Flash Lite Models", "Other Models"];
    for tier in &tier_order {
        if let Some(agg) = tier_map.get(tier) {
            let used = ((1.0 - agg.remaining_fraction) * 100.0).clamp(0.0, 100.0);
            if used > worst_utilization {
                worst_utilization = used;
                worst_resets_at = agg.reset_time.clone();
                worst_label = tier.to_string();
            }

            let raw_used = match (agg.limit, agg.remaining_amount) {
                (Some(lim), Some(rem)) => Some((lim - rem).max(0.0)),
                _ => None,
            };

            windows.push(QuotaWindow {
                id: format!("gemini-{}", tier.to_lowercase().replace(' ', "-")),
                provider_id: "gemini".into(),
                label: tier.to_string(),
                used_percent: used,
                remaining_percent: (agg.remaining_fraction * 100.0).clamp(0.0, 100.0),
                resets_at: agg.reset_time.clone(),
                resets_in_seconds: None,
                raw_used,
                raw_limit: agg.limit,
                unit: if agg.limit.is_some() { Some("req".into()) } else { Some("%".into()) },
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

    let (in_tokens, out_tokens, cache_tokens, primary_model) = scan_today_tokens();
    let cost_model = primary_model.as_deref().unwrap_or("gemini-3.8-flash");
    let cost = cost_engine.calculate_cost_usd(cost_model, in_tokens, out_tokens, cache_tokens);

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
    let (in_tokens, out_tokens, cache_tokens, primary_model) = scan_today_tokens();
    let cost_model = primary_model.as_deref().unwrap_or("gemini-3.8-flash");
    let cost = cost_engine.calculate_cost_usd(cost_model, in_tokens, out_tokens, cache_tokens);
    let is_connected = email.is_some() || gemini_installed();

    let state = if is_connected {
        LimitState::Healthy
    } else {
        LimitState::Unavailable {
            message: reason.into(),
        }
    };

    ProviderQuota {
        provider_id: "gemini".into(),
        provider_name: "Google Gemini / Antigravity".into(),
        state,
        windows: vec![],
        plan_name: if is_connected {
            Some("Google AI / Antigravity".into())
        } else {
            None
        },
        account_email: email,
        cost_today_usd: if in_tokens > 0 || out_tokens > 0 { Some(cost) } else { None },
        total_input_tokens: if in_tokens > 0 { Some(in_tokens) } else { None },
        total_output_tokens: if out_tokens > 0 { Some(out_tokens) } else { None },
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

#[derive(Deserialize, Debug, Default)]
struct GeminiTokensField {
    input: Option<u64>,
    output: Option<u64>,
    cached: Option<u64>,
    thoughts: Option<u64>,
    tool: Option<u64>,
    #[allow(dead_code)]
    total: Option<u64>,
}

#[derive(Deserialize, Debug, Default)]
struct GeminiChatRecord {
    #[serde(rename = "sessionId")]
    #[allow(dead_code)]
    session_id: Option<String>,
    timestamp: Option<Value>,
    #[serde(rename = "startTime")]
    start_time: Option<Value>,
    #[serde(rename = "lastUpdated")]
    last_updated: Option<Value>,
    #[allow(dead_code)]
    #[serde(rename = "type")]
    kind: Option<String>,
    model: Option<String>,
    tokens: Option<GeminiTokensField>,
}

fn parse_date_val(v: &Value) -> Option<chrono::NaiveDate> {
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

/// Scans real Gemini and Antigravity chat logs from ~/.gemini/tmp/*/chats/*.jsonl
/// Extracts real token usage and counts for today.
fn scan_today_tokens() -> (u64, u64, u64, Option<String>) {
    let Some(home) = dirs_home() else {
        return (0, 0, 0, None);
    };
    let gemini_dir = PathBuf::from(home).join(".gemini");
    if !gemini_dir.exists() {
        return (0, 0, 0, None);
    }

    let today = Local::now().date_naive();
    let mut total_in = 0u64;
    let mut total_out = 0u64;
    let mut total_cache = 0u64;
    let mut model_counts: HashMap<String, u64> = HashMap::new();

    let tmp_dir = gemini_dir.join("tmp");
    if tmp_dir.is_dir() {
        if let Ok(project_dirs) = fs::read_dir(&tmp_dir) {
            for project_entry in project_dirs.flatten() {
                let chats_dir = project_entry.path().join("chats");
                if chats_dir.is_dir() {
                    scan_chats_dir(
                        &chats_dir,
                        today,
                        &mut total_in,
                        &mut total_out,
                        &mut total_cache,
                        &mut model_counts,
                        0,
                    );
                }
            }
        }
    }

    let primary_model = model_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(m, _)| m);

    (total_in, total_out, total_cache, primary_model)
}

fn scan_chats_dir(
    dir: &Path,
    today: chrono::NaiveDate,
    total_in: &mut u64,
    total_out: &mut u64,
    total_cache: &mut u64,
    model_counts: &mut HashMap<String, u64>,
    depth: u8,
) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth == 0 {
                scan_chats_dir(
                    &path,
                    today,
                    total_in,
                    total_out,
                    total_cache,
                    model_counts,
                    depth + 1,
                );
            }
            continue;
        }

        let Some(ext) = path.extension().and_then(|e| e.to_str()) else { continue };
        if ext != "jsonl" && ext != "json" {
            continue;
        }

        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() > 20 * 1024 * 1024 {
            continue;
        }

        let Ok(content) = fs::read_to_string(&path) else { continue };

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(rec) = serde_json::from_str::<GeminiChatRecord>(line) else {
                continue;
            };

            let msg_date = rec
                .timestamp
                .as_ref()
                .or(rec.start_time.as_ref())
                .or(rec.last_updated.as_ref())
                .and_then(parse_date_val);

            if let Some(d) = msg_date {
                if d == today {
                    if let Some(tokens) = rec.tokens {
                        let i = tokens.input.unwrap_or(0);
                        let o = tokens.output.unwrap_or(0);
                        let c = tokens.cached.unwrap_or(0);
                        let th = tokens.thoughts.unwrap_or(0);
                        let tl = tokens.tool.unwrap_or(0);

                        *total_in += i;
                        *total_out += o + th + tl;
                        *total_cache += c;

                        if let Some(model) = rec.model {
                            *model_counts.entry(model).or_insert(0) += 1;
                        }
                    }
                }
            }
        }
    }
}


