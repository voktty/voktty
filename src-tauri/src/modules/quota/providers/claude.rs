use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::dirs_home;
use crate::modules::quota::cost_engine::CostEngine;
use crate::modules::quota::types::*;

const OAUTH_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const USER_AGENT: &str = "claude-code/2.1.0";
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ClaudeCredentials {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    account: Option<ClaudeAccountInfo>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ClaudeAccountInfo {
    email: Option<String>,
    plan_type: Option<String>,
}

#[derive(Deserialize, Debug)]
struct UsageWindow {
    utilization: Option<f64>,
    resets_at: Option<String>,
}

#[derive(Deserialize, Debug)]
struct UsageResponse {
    five_hour: Option<UsageWindow>,
    seven_day: Option<UsageWindow>,
    seven_day_opus: Option<UsageWindow>,
    seven_day_sonnet: Option<UsageWindow>,
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

fn read_credentials() -> Option<ClaudeCredentials> {
    if let Some(home) = dirs_home() {
        let p1 = PathBuf::from(&home).join(".claude").join(".credentials.json");
        if p1.exists() {
            if let Ok(content) = fs::read_to_string(&p1) {
                if let Ok(c) = serde_json::from_str::<ClaudeCredentials>(&content) {
                    return Some(c);
                }
            }
        }

        let p2 = PathBuf::from(&home).join(".claude.json");
        if p2.exists() {
            if let Ok(content) = fs::read_to_string(&p2) {
                if let Ok(val) = serde_json::from_str::<Value>(&content) {
                    let oauth = val.get("claudeAiOauth").unwrap_or(&val);
                    let access = oauth.get("accessToken").and_then(Value::as_str).map(String::from);
                    let refresh = oauth.get("refreshToken").and_then(Value::as_str).map(String::from);
                    let exp = oauth.get("expiresAt").and_then(Value::as_u64);
                    if access.is_some() || refresh.is_some() {
                        return Some(ClaudeCredentials {
                            access_token: access,
                            refresh_token: refresh,
                            expires_at: exp,
                            account: None,
                        });
                    }
                }
            }
        }
    }
    None
}


fn refresh_token_if_needed(creds: &mut ClaudeCredentials) -> bool {
    let expires_at = creds.expires_at.unwrap_or(0);
    let now = now_epoch_ms();
    // Refresh if within 5 minutes of expiring
    if expires_at > 0 && expires_at > now + 300_000 {
        return true; // Still valid
    }

    let Some(ref refresh) = creds.refresh_token else {
        return false;
    };

    let body = json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "client_id": OAUTH_CLIENT_ID,
    });

    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let body_str = serde_json::to_string(&body).unwrap_or_default();
    let Ok(resp) = agent
        .post(OAUTH_TOKEN_URL)
        .set("Content-Type", "application/json")
        .set("User-Agent", USER_AGENT)
        .send_string(&body_str)
    else {
        return false;
    };

    if resp.status() >= 200 && resp.status() < 300 {
        let resp_str = resp.into_string().unwrap_or_default();
        if let Ok(val) = serde_json::from_str::<Value>(&resp_str) {
            if let Some(tok) = val.get("access_token").and_then(|v| v.as_str()) {
                creds.access_token = Some(tok.to_string());
                if let Some(exp) = val.get("expires_in").and_then(|v| v.as_u64()) {
                    creds.expires_at = Some(now + exp * 1000);
                }
                // Save back to file
                if let Some(path) = claude_creds_path() {
                    if let Ok(existing) = fs::read_to_string(&path) {
                        if let Ok(mut map) = serde_json::from_str::<Value>(&existing) {
                            map["access_token"] = json!(tok);
                            if let Some(exp) = creds.expires_at {
                                map["expires_at"] = json!(exp);
                            }
                            let _ = fs::write(path, map.to_string());
                        }
                    }
                }
                return true;
            }
        }
    }
    false
}

pub fn collect_claude_quota(cost_engine: &CostEngine) -> ProviderQuota {
    let mut creds = match read_credentials() {
        Some(c) => c,
        None => {
            // Attempt fallback to local transcript scanning
            return fallback_local_transcripts(cost_engine, "Claude credentials not found");
        }
    };

    refresh_token_if_needed(&mut creds);

    let Some(ref token) = creds.access_token else {
        return fallback_local_transcripts(cost_engine, "No access token");
    };

    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let resp = agent
        .get(OAUTH_USAGE_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", OAUTH_BETA)
        .set("User-Agent", USER_AGENT)
        .call();

    match resp {
        Ok(response) => {
            if response.status() >= 200 && response.status() < 300 {
                let body_str = response.into_string().unwrap_or_default();
                if let Ok(usage) = serde_json::from_str::<UsageResponse>(&body_str) {
                    return build_quota_from_usage(usage, &creds, cost_engine);
                }
            }
            fallback_local_transcripts(cost_engine, "HTTP response parse error")
        }
        Err(ureq::Error::Status(status, response)) => {
            if status == 429 {
                let mut quota = fallback_local_transcripts(cost_engine, "Rate limit active");
                quota.state = LimitState::RateLimited {
                    retry_after_secs: response.header("retry-after").and_then(|h| h.parse().ok()),
                    message: "Claude API rate limit reached".into(),
                };
                quota
            } else if status == 401 {
                ProviderQuota {
                    provider_id: "claude".into(),
                    provider_name: "Claude Code".into(),
                    state: LimitState::Unauthenticated {
                        message: "Claude sign-in expired, please re-authenticate".into(),
                    },
                    windows: vec![],
                    plan_name: creds.account.and_then(|a| a.plan_type),
                    account_email: None,
                    cost_today_usd: None,
                    total_input_tokens: None,
                    total_output_tokens: None,
                    updated_at: iso_now(),
                }
            } else {
                fallback_local_transcripts(cost_engine, &format!("HTTP {status}"))
            }
        }
        Err(e) => fallback_local_transcripts(cost_engine, &format!("Network error: {e}")),
    }
}

fn build_quota_from_usage(
    usage: UsageResponse,
    creds: &ClaudeCredentials,
    cost_engine: &CostEngine,
) -> ProviderQuota {
    let mut windows = Vec::new();
    let mut worst_utilization = 0.0;
    let mut worst_resets_at = None;
    let mut worst_label = String::new();

    if let Some(five_h) = usage.five_hour {
        let util = five_h.utilization.unwrap_or(0.0) * 100.0;
        if util > worst_utilization {
            worst_utilization = util;
            worst_resets_at = five_h.resets_at.clone();
            worst_label = "Session (5h)".into();
        }
        windows.push(QuotaWindow {
            id: "claude-session-5h".into(),
            provider_id: "claude".into(),
            label: "Session (5h)".into(),
            used_percent: util.clamp(0.0, 100.0),
            remaining_percent: (100.0 - util).clamp(0.0, 100.0),
            resets_at: five_h.resets_at,
            resets_in_seconds: None,
            raw_used: None,
            raw_limit: None,
            unit: Some("%".into()),
        });
    }

    if let Some(seven_d) = usage.seven_day {
        let util = seven_d.utilization.unwrap_or(0.0) * 100.0;
        if util > worst_utilization {
            worst_utilization = util;
            worst_resets_at = seven_d.resets_at.clone();
            worst_label = "Weekly (All Models)".into();
        }
        windows.push(QuotaWindow {
            id: "claude-weekly-all".into(),
            provider_id: "claude".into(),
            label: "Weekly (All Models)".into(),
            used_percent: util.clamp(0.0, 100.0),
            remaining_percent: (100.0 - util).clamp(0.0, 100.0),
            resets_at: seven_d.resets_at,
            resets_in_seconds: None,
            raw_used: None,
            raw_limit: None,
            unit: Some("%".into()),
        });
    }

    if let Some(opus) = usage.seven_day_opus {
        let util = opus.utilization.unwrap_or(0.0) * 100.0;
        windows.push(QuotaWindow {
            id: "claude-weekly-opus".into(),
            provider_id: "claude".into(),
            label: "Weekly (Opus)".into(),
            used_percent: util.clamp(0.0, 100.0),
            remaining_percent: (100.0 - util).clamp(0.0, 100.0),
            resets_at: opus.resets_at,
            resets_in_seconds: None,
            raw_used: None,
            raw_limit: None,
            unit: Some("%".into()),
        });
    }

    if let Some(sonnet) = usage.seven_day_sonnet {
        let util = sonnet.utilization.unwrap_or(0.0) * 100.0;
        windows.push(QuotaWindow {
            id: "claude-weekly-sonnet".into(),
            provider_id: "claude".into(),
            label: "Weekly (Sonnet)".into(),
            used_percent: util.clamp(0.0, 100.0),
            remaining_percent: (100.0 - util).clamp(0.0, 100.0),
            resets_at: sonnet.resets_at,
            resets_in_seconds: None,
            raw_used: None,
            raw_limit: None,
            unit: Some("%".into()),
        });
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

    // Scan today's local token usage for cost estimation
    let (in_tokens, out_tokens, cache_tokens) = scan_today_tokens();
    let cost =
        cost_engine.calculate_cost_usd("claude-3-7-sonnet", in_tokens, out_tokens, cache_tokens);

    ProviderQuota {
        provider_id: "claude".into(),
        provider_name: "Claude Code".into(),
        state,
        windows,
        plan_name: creds.account.as_ref().and_then(|a| a.plan_type.clone()),
        account_email: creds.account.as_ref().and_then(|a| a.email.clone()),
        cost_today_usd: Some(cost),
        total_input_tokens: Some(in_tokens),
        total_output_tokens: Some(out_tokens),
        updated_at: iso_now(),
    }
}

fn fallback_local_transcripts(cost_engine: &CostEngine, fallback_reason: &str) -> ProviderQuota {
    let (in_tokens, out_tokens, cache_tokens) = scan_today_tokens();
    let cost =
        cost_engine.calculate_cost_usd("claude-3-7-sonnet", in_tokens, out_tokens, cache_tokens);

    let has_usage = in_tokens > 0 || out_tokens > 0;
    let state = if has_usage {
        LimitState::Healthy
    } else {
        LimitState::Unavailable {
            message: fallback_reason.into(),
        }
    };

    let mut windows = Vec::new();
    if has_usage {
        windows.push(QuotaWindow {
            id: "claude-local-today".into(),
            provider_id: "claude".into(),
            label: "Local Tokens (Today)".into(),
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
        provider_id: "claude".into(),
        provider_name: "Claude Code".into(),
        state,
        windows,
        plan_name: None,
        account_email: None,
        cost_today_usd: if has_usage { Some(cost) } else { None },
        total_input_tokens: if in_tokens > 0 { Some(in_tokens) } else { None },
        total_output_tokens: if out_tokens > 0 {
            Some(out_tokens)
        } else {
            None
        },
        updated_at: iso_now(),
    }
}

fn claude_creds_path() -> Option<PathBuf> {
    dirs_home().map(|h| PathBuf::from(h).join(".claude").join(".credentials.json"))
}

fn scan_today_tokens() -> (u64, u64, u64) {
    let Some(home) = dirs_home() else {
        return (0, 0, 0);
    };
    let projects_dir = PathBuf::from(home).join(".claude").join("projects");
    if !projects_dir.exists() {
        return (0, 0, 0);
    }

    let today = chrono::Local::now().date_naive();
    let mut total_in = 0u64;
    let mut total_out = 0u64;
    let mut total_cache = 0u64;

    if let Ok(entries) = fs::read_dir(projects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_jsonl_dir(&path, today, &mut total_in, &mut total_out, &mut total_cache);
            }
        }
    }

    (total_in, total_out, total_cache)
}

fn scan_jsonl_dir(
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
        if p.is_file() && p.extension().is_some_and(|ext| ext == "jsonl") {
            if let Ok(content) = fs::read_to_string(&p) {
                for line in content.lines() {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        if let Some(ts_str) = v.get("timestamp").and_then(Value::as_str) {
                            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                                if dt.with_timezone(&chrono::Local).date_naive() != today {
                                    continue;
                                }
                            }
                        }

                        if let Some(usage) = v.get("usage") {
                            if let Some(i) = usage.get("input_tokens").and_then(|n| n.as_u64()) {
                                *total_in += i;
                            }
                            if let Some(o) = usage.get("output_tokens").and_then(|n| n.as_u64()) {
                                *total_out += o;
                            }
                            if let Some(c) = usage
                                .get("cache_read_input_tokens")
                                .and_then(|n| n.as_u64())
                            {
                                *total_cache += c;
                            }
                        }
                    }
                }
            }
        }
    }
}

