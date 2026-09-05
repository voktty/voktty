use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Local};
use serde::Deserialize;
use serde_json::Value;

use crate::dirs_home;
use crate::modules::quota::cost_engine::CostEngine;
use crate::modules::quota::types::*;

const WHAM_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const USER_AGENT: &str = "codex-cli/0.1.0";
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);
const CLAIMS_KEY: &str = "https://api.openai.com/auth";

#[derive(Deserialize, Debug, Clone)]
struct CodexAuthTokens {
    access_token: Option<String>,
    account_id: Option<String>,
    id_token: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
struct CodexAuth {
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    tokens: Option<CodexAuthTokens>,
}

#[derive(Deserialize, Debug)]
struct WhamRateWindow {
    used_percent: Option<f64>,
    reset_at: Option<i64>,
    reset_after_seconds: Option<i64>,
    #[allow(dead_code)]
    limit_window_seconds: Option<i64>,
}

#[derive(Deserialize, Debug)]
struct WhamRateLimit {
    #[allow(dead_code)]
    allowed: Option<bool>,
    #[allow(dead_code)]
    limit_reached: Option<bool>,
    primary_window: Option<WhamRateWindow>,
    secondary_window: Option<WhamRateWindow>,
}

#[derive(Deserialize, Debug)]
struct WhamUsageResponse {
    email: Option<String>,
    plan_type: Option<String>,
    rate_limit: Option<WhamRateLimit>,
}

fn iso_now() -> String {
    format!("{:?}", SystemTime::now())
}

fn codex_auth_path() -> Option<PathBuf> {
    dirs_home().map(|h| PathBuf::from(h).join(".codex").join("auth.json"))
}

fn read_codex_auth() -> Option<CodexAuth> {
    let path = codex_auth_path()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<CodexAuth>(&content).ok()
}

fn decode_id_token_claims(id_token: &str) -> Option<Value> {
    let mut segments = id_token.split('.');
    let (_, payload, _) = (segments.next()?, segments.next()?, segments.next()?);
    let padded = match payload.len() % 4 {
        2 => format!("{}==", payload),
        3 => format!("{}=", payload),
        _ => payload.to_string(),
    };
    let decoded = padded.replace('-', "+").replace('_', "/");
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(decoded).ok()?;
    let val: Value = serde_json::from_slice(&bytes).ok()?;
    val.get(CLAIMS_KEY).cloned()
}

pub fn collect_codex_quota(cost_engine: &CostEngine) -> ProviderQuota {
    let Some(auth) = read_codex_auth() else {
        return fallback_offline_codex(cost_engine, "Codex auth (~/.codex/auth.json) not found", None, None);
    };

    let mut plan_name = None;
    let mut email = None;

    if let Some(ref tok) = auth.tokens {
        if let Some(ref id_tok) = tok.id_token {
            if let Some(claims) = decode_id_token_claims(id_tok) {
                if let Some(plan) = claims.get("chatgpt_plan_type").and_then(Value::as_str) {
                    plan_name = Some(plan.to_string());
                }
            }
        }
    }

    let Some(ref tokens) = auth.tokens else {
        if auth.openai_api_key.is_some() {
            return fallback_offline_codex(cost_engine, "Using API key auth", Some("OpenAI API Key".into()), None);
        }
        return fallback_offline_codex(cost_engine, "No authentication tokens found", plan_name, email);
    };

    let Some(ref access_token) = tokens.access_token else {
        return fallback_offline_codex(cost_engine, "No access token in auth.json", plan_name, email);
    };

    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let mut req = agent
        .get(WHAM_USAGE_URL)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/json");

    if let Some(ref account_id) = tokens.account_id {
        req = req.set("ChatGPT-Account-Id", account_id);
    }

    match req.call() {
        Ok(response) => {
            if response.status() >= 200 && response.status() < 300 {
                let body_str = response.into_string().unwrap_or_default();
                if let Ok(wham) = serde_json::from_str::<WhamUsageResponse>(&body_str) {
                    if let Some(ref em) = wham.email {
                        email = Some(em.clone());
                    }
                    if let Some(ref p) = wham.plan_type {
                        plan_name = Some(p.clone());
                    }
                    return build_quota_from_wham(wham, cost_engine, plan_name, email);
                }
            }
            fallback_offline_codex(cost_engine, "WHAM response parse error", plan_name, email)
        }
        Err(ureq::Error::Status(status, _)) => {
            if status == 401 {
                ProviderQuota {
                    provider_id: "codex".into(),
                    provider_name: "Codex CLI".into(),
                    state: LimitState::Unauthenticated {
                        message: "Codex sign-in expired, please re-authenticate".into(),
                    },
                    windows: vec![],
                    plan_name,
                    account_email: email,
                    cost_today_usd: None,
                    total_input_tokens: None,
                    total_output_tokens: None,
                    updated_at: iso_now(),
                }
            } else if status == 429 {
                let mut quota = fallback_offline_codex(cost_engine, "Rate limit reached", plan_name, email);
                quota.state = LimitState::RateLimited {
                    retry_after_secs: None,
                    message: "Codex rate limit active".into(),
                };
                quota
            } else {
                fallback_offline_codex(cost_engine, &format!("HTTP {status}"), plan_name, email)
            }
        }
        Err(e) => fallback_offline_codex(cost_engine, &format!("Network error: {e}"), plan_name, email),
    }
}

fn format_codex_window_label(plan_type: Option<&str>, window_seconds: Option<i64>, secondary: bool) -> String {
    let is_free = plan_type.is_some_and(|p| p.eq_ignore_ascii_case("free"));
    if let Some(sec) = window_seconds {
        if sec >= 86400 * 20 {
            return if is_free { "Monthly Limit (Free)".into() } else { "Monthly Limit".into() };
        } else if sec >= 86400 * 6 {
            return "Weekly (7d)".into();
        } else if sec >= 86400 {
            return "Daily (24h)".into();
        } else if sec <= 3600 * 6 && sec > 0 {
            return "Session (5h)".into();
        }
    }
    if is_free && !secondary {
        "Monthly Limit (Free)".into()
    } else if secondary {
        "Weekly (7d)".into()
    } else {
        "Session (5h)".into()
    }
}

fn build_quota_from_wham(
    wham: WhamUsageResponse,
    cost_engine: &CostEngine,
    plan_name: Option<String>,
    email: Option<String>,
) -> ProviderQuota {
    let mut windows = Vec::new();
    let mut worst_utilization = 0.0;
    let mut worst_resets_at = None;
    let mut worst_label = String::new();

    if let Some(rl) = wham.rate_limit {
        if let Some(p) = rl.primary_window {
            let used = p.used_percent.unwrap_or(0.0);
            let resets_at = p.reset_at.and_then(|ts| {
                DateTime::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339())
            });
            let label = format_codex_window_label(plan_name.as_deref(), p.limit_window_seconds, false);

            if used > worst_utilization {
                worst_utilization = used;
                worst_resets_at = resets_at.clone();
                worst_label = label.clone();
            }

            windows.push(QuotaWindow {
                id: "codex-primary".into(),
                provider_id: "codex".into(),
                label,
                used_percent: used.clamp(0.0, 100.0),
                remaining_percent: (100.0 - used).clamp(0.0, 100.0),
                resets_at,
                resets_in_seconds: p.reset_after_seconds.and_then(|s| if s >= 0 { Some(s as u64) } else { None }),
                raw_used: None,
                raw_limit: None,
                unit: Some("%".into()),
            });
        }

        if let Some(s) = rl.secondary_window {
            let used = s.used_percent.unwrap_or(0.0);
            let resets_at = s.reset_at.and_then(|ts| {
                DateTime::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339())
            });
            let label = format_codex_window_label(plan_name.as_deref(), s.limit_window_seconds, true);

            if used > worst_utilization {
                worst_utilization = used;
                worst_resets_at = resets_at.clone();
                worst_label = label.clone();
            }

            windows.push(QuotaWindow {
                id: "codex-secondary".into(),
                provider_id: "codex".into(),
                label,
                used_percent: used.clamp(0.0, 100.0),
                remaining_percent: (100.0 - used).clamp(0.0, 100.0),
                resets_at,
                resets_in_seconds: s.reset_after_seconds.and_then(|s| if s >= 0 { Some(s as u64) } else { None }),
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
    let cost = cost_engine.calculate_cost_usd("gpt-4o", in_tokens, out_tokens, cache_tokens);

    ProviderQuota {
        provider_id: "codex".into(),
        provider_name: "Codex CLI".into(),
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

fn fallback_offline_codex(
    cost_engine: &CostEngine,
    reason: &str,
    plan_name: Option<String>,
    email: Option<String>,
) -> ProviderQuota {
    let (in_tokens, out_tokens, cache_tokens) = scan_today_tokens();
    let cost = cost_engine.calculate_cost_usd("gpt-4o", in_tokens, out_tokens, cache_tokens);
    let (offline_primary, offline_secondary) = scan_newest_rollout_rate_limits();

    let mut windows = Vec::new();
    let mut worst_utilization = 0.0;
    let mut worst_resets_at = None;
    let mut worst_label = String::new();

    if let Some((used, reset_ts, window_mins)) = offline_primary {
        let resets_at = reset_ts.and_then(|ts| DateTime::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339()));
        let label = format_codex_window_label(plan_name.as_deref(), window_mins.map(|m| m * 60), false);
        if used > worst_utilization {
            worst_utilization = used;
            worst_resets_at = resets_at.clone();
            worst_label = label.clone();
        }
        windows.push(QuotaWindow {
            id: "codex-primary".into(),
            provider_id: "codex".into(),
            label,
            used_percent: used.clamp(0.0, 100.0),
            remaining_percent: (100.0 - used).clamp(0.0, 100.0),
            resets_at,
            resets_in_seconds: None,
            raw_used: None,
            raw_limit: None,
            unit: Some("%".into()),
        });
    }

    if let Some((used, reset_ts, window_mins)) = offline_secondary {
        let resets_at = reset_ts.and_then(|ts| DateTime::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339()));
        let label = format_codex_window_label(plan_name.as_deref(), window_mins.map(|m| m * 60), true);
        if used > worst_utilization {
            worst_utilization = used;
            worst_resets_at = resets_at.clone();
            worst_label = label.clone();
        }
        windows.push(QuotaWindow {
            id: "codex-secondary".into(),
            provider_id: "codex".into(),
            label,
            used_percent: used.clamp(0.0, 100.0),
            remaining_percent: (100.0 - used).clamp(0.0, 100.0),
            resets_at,
            resets_in_seconds: None,
            raw_used: None,
            raw_limit: None,
            unit: Some("%".into()),
        });
    }

    let has_usage = in_tokens > 0 || out_tokens > 0 || !windows.is_empty();
    let state = if !windows.is_empty() {
        if worst_utilization >= 100.0 {
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
        }
    } else if has_usage {
        LimitState::Healthy
    } else {
        LimitState::Unavailable {
            message: reason.into(),
        }
    };

    if windows.is_empty() && has_usage {
        windows.push(QuotaWindow {
            id: "codex-local-usage".into(),
            provider_id: "codex".into(),
            label: "Tokens (Today)".into(),
            used_percent: 0.0,
            remaining_percent: 100.0,
            resets_at: None,
            resets_in_seconds: None,
            raw_used: Some((in_tokens + out_tokens) as f64),
            raw_limit: None,
            unit: Some("tokens".into()),
        });
    }

    ProviderQuota {
        provider_id: "codex".into(),
        provider_name: "Codex CLI".into(),
        state,
        windows,
        plan_name: plan_name.or(Some("OpenAI Codex".into())),
        account_email: email,
        cost_today_usd: if has_usage { Some(cost) } else { None },
        total_input_tokens: if in_tokens > 0 { Some(in_tokens) } else { None },
        total_output_tokens: if out_tokens > 0 { Some(out_tokens) } else { None },
        updated_at: iso_now(),
    }
}

fn scan_today_tokens() -> (u64, u64, u64) {
    let Some(home) = dirs_home() else {
        return (0, 0, 0);
    };
    let codex_root = PathBuf::from(home).join(".codex");
    if !codex_root.exists() {
        return (0, 0, 0);
    }

    let today = Local::now().date_naive();
    let mut total_in = 0u64;
    let mut total_out = 0u64;
    let mut total_cache = 0u64;

    let sessions_dir = codex_root.join("sessions");
    if sessions_dir.exists() {
        scan_rollout_dirs(&sessions_dir, today, &mut total_in, &mut total_out, &mut total_cache);
    }

    (total_in, total_out, total_cache)
}

fn scan_rollout_dirs(
    dir: &Path,
    today: chrono::NaiveDate,
    total_in: &mut u64,
    total_out: &mut u64,
    total_cache: &mut u64,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            scan_rollout_dirs(&p, today, total_in, total_out, total_cache);
        } else if p.is_file() && p.extension().is_some_and(|e| e == "jsonl") {
            scan_rollout_file(&p, today, total_in, total_out, total_cache);
        }
    }
}

fn scan_rollout_file(
    path: &Path,
    today: chrono::NaiveDate,
    total_in: &mut u64,
    total_out: &mut u64,
    total_cache: &mut u64,
) {
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    let mut last_usage = None;
    let mut touches_today = false;

    for line in content.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if let Some(ts_str) = v.get("timestamp").and_then(Value::as_str) {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                if dt.with_timezone(&Local).date_naive() == today {
                    touches_today = true;
                }
            }
        }

        if v.get("type").and_then(Value::as_str) == Some("event_msg") {
            if let Some(payload) = v.get("payload") {
                if payload.get("type").and_then(Value::as_str) == Some("token_count") {
                    if let Some(info) = payload.pointer("/info/total_token_usage").or_else(|| payload.get("total_token_usage")) {
                        let i = info.get("input_tokens").and_then(Value::as_u64).unwrap_or(0);
                        let o = info.get("output_tokens").and_then(Value::as_u64).unwrap_or(0);
                        let c = info.get("cached_input_tokens").and_then(Value::as_u64).unwrap_or(0);
                        last_usage = Some((i, o, c));
                    }
                }
            }
        }
    }

    if touches_today {
        if let Some((i, o, c)) = last_usage {
            *total_in += i;
            *total_out += o;
            *total_cache += c;
        }
    }
}

type RateLimitWindow = (f64, Option<i64>, Option<i64>);

fn scan_newest_rollout_rate_limits() -> (
    Option<RateLimitWindow>,
    Option<RateLimitWindow>,
) {
    let Some(home) = dirs_home() else {
        return (None, None);
    };
    let sessions_dir = PathBuf::from(home).join(".codex").join("sessions");
    if !sessions_dir.exists() {
        return (None, None);
    }

    // Find the latest rollout file
    let mut files = Vec::new();
    collect_files_recursive(&sessions_dir, &mut files);
    files.sort_by_key(|f| fs::metadata(f).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH));

    for file in files.iter().rev().take(10) {
        if let Ok(content) = fs::read_to_string(file) {
            for line in content.lines().rev() {
                if let Ok(v) = serde_json::from_str::<Value>(line) {
                    if v.get("type").and_then(Value::as_str) == Some("event_msg") {
                        if let Some(payload) = v.get("payload") {
                            if payload.get("type").and_then(Value::as_str) == Some("token_count") {
                                if let Some(rl) = payload.get("rate_limits") {
                                    let primary = rl.get("primary").and_then(|p| {
                                        let used = p.get("used_percent").and_then(Value::as_f64)?;
                                        let reset = p.get("resets_at").and_then(Value::as_i64);
                                        let mins = p.get("window_minutes").and_then(Value::as_i64);
                                        Some((used, reset, mins))
                                    });
                                    let secondary = rl.get("secondary").and_then(|s| {
                                        let used = s.get("used_percent").and_then(Value::as_f64)?;
                                        let reset = s.get("resets_at").and_then(Value::as_i64);
                                        let mins = s.get("window_minutes").and_then(Value::as_i64);
                                        Some((used, reset, mins))
                                    });
                                    if primary.is_some() || secondary.is_some() {
                                        return (primary, secondary);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (None, None)
}

fn collect_files_recursive(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_files_recursive(&p, files);
        } else if p.is_file() && p.extension().is_some_and(|e| e == "jsonl") {
            files.push(p);
        }
    }
}

