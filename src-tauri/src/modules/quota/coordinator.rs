use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use crate::modules::quota::cost_engine::CostEngine;
use crate::modules::quota::providers::{claude, codex, gemini, voktty_agent};
use crate::modules::quota::types::*;

const CACHE_TTL_STANDARD: Duration = Duration::from_secs(120);
const CACHE_TTL_SHORT: Duration = Duration::from_secs(30);

struct CacheEntry {
    quota: ProviderQuota,
    fetched_at: Instant,
}

pub struct QuotaCoordinator {
    cost_engine: CostEngine,
    cache: Mutex<HashMap<String, CacheEntry>>,
    flight_guard: Mutex<()>,
}

impl Default for QuotaCoordinator {
    fn default() -> Self {
        Self {
            cost_engine: CostEngine::new(),
            cache: Mutex::new(HashMap::new()),
            flight_guard: Mutex::new(()),
        }
    }
}

impl QuotaCoordinator {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn get_overview(&self) -> QuotaOverview {
        let _guard = self.flight_guard.lock().unwrap();

        let providers = vec![
            self.get_or_fetch_provider("claude"),
            self.get_or_fetch_provider("gemini"),
            self.get_or_fetch_provider("codex"),
            self.get_or_fetch_provider("voktty"),
        ];

        let mut overall_state = LimitState::Healthy;
        let mut total_cost = 0.0;
        let mut active_count = 0;

        for p in &providers {
            if p.state.is_danger() || (p.state.is_warning() && !overall_state.is_danger()) {
                overall_state = p.state.clone();
            }

            if let Some(c) = p.cost_today_usd {
                total_cost += c;
            }

            if !matches!(p.state, LimitState::Unavailable { .. }) {
                active_count += 1;
            }
        }

        QuotaOverview {
            providers,
            overall_state,
            total_cost_today_usd: (total_cost * 1000.0).round() / 1000.0,
            total_active_providers: active_count,
            updated_at: format!("{:?}", SystemTime::now()),
        }
    }

    pub fn refresh_provider(&self, provider_id: &str) -> ProviderQuota {
        let _guard = self.flight_guard.lock().unwrap();
        self.fetch_and_cache(provider_id)
    }

    fn get_or_fetch_provider(&self, provider_id: &str) -> ProviderQuota {
        let now = Instant::now();
        if let Ok(cache) = self.cache.lock() {
            if let Some(entry) = cache.get(provider_id) {
                let ttl = if entry.quota.state.is_warning() || entry.quota.state.is_danger() {
                    CACHE_TTL_SHORT
                } else {
                    CACHE_TTL_STANDARD
                };
                if now.duration_since(entry.fetched_at) < ttl {
                    return entry.quota.clone();
                }
            }
        }

        self.fetch_and_cache(provider_id)
    }

    fn fetch_and_cache(&self, provider_id: &str) -> ProviderQuota {
        let quota = match provider_id {
            "claude" => claude::collect_claude_quota(&self.cost_engine),
            "gemini" => gemini::collect_gemini_quota(&self.cost_engine),
            "codex" => codex::collect_codex_quota(&self.cost_engine),
            "voktty" => voktty_agent::collect_voktty_quota(&self.cost_engine),
            _ => ProviderQuota {
                provider_id: provider_id.into(),
                provider_name: provider_id.into(),
                state: LimitState::Unavailable {
                    message: format!("Unknown provider: {provider_id}"),
                },
                windows: vec![],
                plan_name: None,
                account_email: None,
                cost_today_usd: None,
                total_input_tokens: None,
                total_output_tokens: None,
                updated_at: format!("{:?}", SystemTime::now()),
            },
        };

        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(
                provider_id.to_string(),
                CacheEntry {
                    quota: quota.clone(),
                    fetched_at: Instant::now(),
                },
            );
        }

        quota
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cost_engine_calculation() {
        let engine = CostEngine::new();
        // 1M input of claude-3-7-sonnet should be $3.00, 1M output should be $15.00
        let cost = engine.calculate_cost_usd("claude-3-7-sonnet", 1_000_000, 1_000_000, 0);
        assert!((cost - 18.0).abs() < 0.001);
    }

    #[test]
    fn test_quota_coordinator_overview() {
        let coordinator = QuotaCoordinator::new();
        let overview = coordinator.get_overview();
        assert_eq!(overview.providers.len(), 4);
        assert!(overview.providers.iter().any(|p| p.provider_id == "voktty"));
        assert!(overview.providers.iter().any(|p| p.provider_id == "claude"));
        assert!(overview.providers.iter().any(|p| p.provider_id == "gemini"));
        assert!(overview.providers.iter().any(|p| p.provider_id == "codex"));
    }

    #[test]
    fn test_limit_state_flags() {
        let healthy = LimitState::Healthy;
        assert!(!healthy.is_danger());
        assert!(!healthy.is_warning());

        let approaching = LimitState::Approaching {
            used_percent: 85.0,
            label: "5h window".into(),
            resets_at: None,
        };
        assert!(!approaching.is_danger());
        assert!(approaching.is_warning());

        let reached = LimitState::Reached {
            used_percent: 100.0,
            resets_at: None,
        };
        assert!(reached.is_danger());
    }
}
