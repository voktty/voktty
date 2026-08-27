pub mod http_engine;
pub mod sandbox_mock;

use http_engine::{execute_http_request, ApiRequestPayload, ApiResponsePayload};
use sandbox_mock::{
    dispatch_mock_webhook, run_api_scenario, ApiScenarioPayload, ApiScenarioResultPayload,
    ApiWebhookDispatchPayload, ApiWebhookResultPayload,
};

#[tauri::command]
pub async fn api_client_send_request(
    request: ApiRequestPayload,
) -> Result<ApiResponsePayload, String> {
    execute_http_request(request).await
}

#[tauri::command]
pub async fn api_client_run_scenario(
    scenario: ApiScenarioPayload,
) -> Result<ApiScenarioResultPayload, String> {
    run_api_scenario(scenario).await
}

#[tauri::command]
pub async fn api_client_dispatch_webhook(
    webhook: ApiWebhookDispatchPayload,
) -> Result<ApiWebhookResultPayload, String> {
    dispatch_mock_webhook(webhook).await
}
