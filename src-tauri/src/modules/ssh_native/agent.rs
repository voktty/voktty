//! The system SSH agent, reached the same way OpenSSH reaches it.

use std::time::Duration;

use russh::keys::agent::client::AgentClient;

use super::types::{SshErrorCode, SshNativeError};

/// The agent is optional, so a missing one must fail fast instead of holding
/// up the whole authentication chain.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

#[cfg(windows)]
const OPENSSH_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

/// A concrete stream per platform rather than a boxed one: russh's `Signer`
/// impl only proves `Send` for a concrete transport, and the whole connect
/// future has to stay `Send` for the Tauri command that drives it.
#[cfg(unix)]
pub type SystemAgent = AgentClient<tokio::net::UnixStream>;

#[cfg(windows)]
pub type SystemAgent = AgentClient<tokio::net::windows::named_pipe::NamedPipeClient>;

fn unavailable(detail: impl std::fmt::Display) -> SshNativeError {
    SshNativeError::new(
        SshErrorCode::AuthFailed,
        format!("no SSH agent available: {detail}"),
    )
}

pub async fn connect() -> Result<SystemAgent, SshNativeError> {
    match tokio::time::timeout(CONNECT_TIMEOUT, connect_inner()).await {
        Ok(result) => result,
        Err(_) => Err(unavailable("connection timed out")),
    }
}

#[cfg(unix)]
async fn connect_inner() -> Result<SystemAgent, SshNativeError> {
    AgentClient::connect_env().await.map_err(unavailable)
}

/// `connect_named_pipe` retries a busy pipe forever, so the caller's timeout is
/// what bounds it.
#[cfg(windows)]
async fn connect_inner() -> Result<SystemAgent, SshNativeError> {
    let pipe = std::env::var("SSH_AUTH_SOCK").unwrap_or_else(|_| OPENSSH_PIPE.to_string());
    AgentClient::connect_named_pipe(pipe)
        .await
        .map_err(unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unavailable_agent_is_an_auth_failure_not_a_crash() {
        let error = unavailable("no such file");
        assert_eq!(error.code, SshErrorCode::AuthFailed);
        assert!(error.message.contains("no such file"));
        assert!(error.prompt.is_none());
    }

    #[tokio::test]
    async fn connecting_without_an_agent_returns_an_error_within_the_timeout() {
        // A bare test process has no agent socket configured, so this must
        // resolve rather than hang.
        let started = std::time::Instant::now();
        let result = tokio::time::timeout(CONNECT_TIMEOUT * 3, connect()).await;
        assert!(result.is_ok(), "connect() must not outlive its own timeout");
        assert!(started.elapsed() < CONNECT_TIMEOUT * 3);
    }
}
