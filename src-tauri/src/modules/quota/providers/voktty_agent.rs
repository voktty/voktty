use std::time::SystemTime;

use crate::modules::quota::cost_engine::CostEngine;
use crate::modules::quota::types::*;

fn iso_now() -> String {
    format!("{:?}", SystemTime::now())
}

pub fn collect_voktty_quota(_cost_engine: &CostEngine) -> ProviderQuota {
    // Voktty native AI agent provides unlimited direct API / local orchestration
    let windows = vec![QuotaWindow {
        id: "voktty-agent-native".into(),
        provider_id: "voktty".into(),
        label: "Local Core Agent".into(),
        used_percent: 0.0,
        remaining_percent: 100.0,
        resets_at: None,
        resets_in_seconds: None,
        raw_used: None,
        raw_limit: None,
        unit: Some("status".into()),
    }];

    ProviderQuota {
        provider_id: "voktty".into(),
        provider_name: "Voktty Native AI".into(),
        state: LimitState::Healthy,
        windows,
        plan_name: Some("Unlimited Local Engine".into()),
        account_email: None,
        cost_today_usd: Some(0.0),
        total_input_tokens: None,
        total_output_tokens: None,
        updated_at: iso_now(),
    }
}
