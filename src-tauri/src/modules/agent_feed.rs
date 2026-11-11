//! Local source of the agent message feed: Claude Code sessions on this
//! machine. SSH projects use the remote helper's `agentFeed.poll` instead.

use voktty_agent_feed::{claude_home, poll, FeedRequest, FeedResponse};

#[tauri::command]
pub async fn agent_feed_poll(request: FeedRequest) -> Result<FeedResponse, String> {
    request.validate().map_err(str::to_string)?;
    let home = dirs::home_dir().ok_or_else(|| "home folder not found".to_string())?;
    let config_dir = std::env::var("CLAUDE_CONFIG_DIR").ok();
    tauri::async_runtime::spawn_blocking(move || {
        poll(&claude_home(config_dir.as_deref(), &home), &request)
    })
    .await
    .map_err(|error| format!("agent feed task failed: {error}"))
}
