pub mod http_engine;
pub mod sandbox_mock;

use http_engine::{
    cancel_in_flight_request, execute_http_request, stream_http_request, ApiRequestPayload,
    ApiResponsePayload,
};
use sandbox_mock::{
    dispatch_mock_webhook, run_api_scenario, ApiScenarioPayload, ApiScenarioResultPayload,
    ApiWebhookDispatchPayload, ApiWebhookResultPayload,
};
use tauri::ipc::{Channel, Response};

#[tauri::command]
pub async fn api_client_send_request(
    request: ApiRequestPayload,
) -> Result<ApiResponsePayload, String> {
    execute_http_request(request).await
}

#[tauri::command]
pub async fn api_client_stream_request(
    request: ApiRequestPayload,
    on_event: Channel<Response>,
) -> Result<(), String> {
    stream_http_request(request, on_event).await
}

#[tauri::command]
pub fn api_client_cancel_request(request_id: String) -> bool {
    cancel_in_flight_request(&request_id)
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
