pub mod coordinator;
pub mod cost_engine;
pub mod providers;
pub mod types;

use std::sync::{Arc, OnceLock};

use coordinator::QuotaCoordinator;
pub use types::{ProviderQuota, QuotaOverview};

fn coordinator() -> &'static Arc<QuotaCoordinator> {
    static INSTANCE: OnceLock<Arc<QuotaCoordinator>> = OnceLock::new();
    INSTANCE.get_or_init(QuotaCoordinator::new)
}

#[tauri::command]
pub async fn get_quota_overview() -> Result<QuotaOverview, String> {
    tauri::async_runtime::spawn_blocking(|| coordinator().get_overview())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_quota_provider(provider_id: String) -> Result<ProviderQuota, String> {
    tauri::async_runtime::spawn_blocking(move || coordinator().refresh_provider(&provider_id))
        .await
        .map_err(|e| e.to_string())
}
