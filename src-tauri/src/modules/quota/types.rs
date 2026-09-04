use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LimitScope {
    Session5h,
    Weekly,
    Monthly,
    Daily,
    TierBucket(String),
    Custom(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LimitState {
    Healthy,
    Approaching {
        used_percent: f64,
        label: String,
        resets_at: Option<String>,
    },
    Reached {
        used_percent: f64,
        resets_at: Option<String>,
    },
    RateLimited {
        retry_after_secs: Option<u64>,
        message: String,
    },
    Unauthenticated {
        message: String,
    },
    Unavailable {
        message: String,
    },
}

impl LimitState {
    pub fn is_danger(&self) -> bool {
        matches!(
            self,
            LimitState::Reached { .. }
                | LimitState::RateLimited { .. }
                | LimitState::Unauthenticated { .. }
        )
    }

    pub fn is_warning(&self) -> bool {
        matches!(self, LimitState::Approaching { .. })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub used_percent: f64,
    pub remaining_percent: f64,
    pub resets_at: Option<String>,
    pub resets_in_seconds: Option<u64>,
    pub raw_used: Option<f64>,
    pub raw_limit: Option<f64>,
    pub unit: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderQuota {
    pub provider_id: String,
    pub provider_name: String,
    pub state: LimitState,
    pub windows: Vec<QuotaWindow>,
    pub plan_name: Option<String>,
    pub account_email: Option<String>,
    pub cost_today_usd: Option<f64>,
    pub total_input_tokens: Option<u64>,
    pub total_output_tokens: Option<u64>,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuotaOverview {
    pub providers: Vec<ProviderQuota>,
    pub overall_state: LimitState,
    pub total_cost_today_usd: f64,
    pub total_active_providers: usize,
    pub updated_at: String,
}
