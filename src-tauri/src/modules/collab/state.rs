use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use voktty_collab_protocol::{Participant, MAX_PTY_DATA_BYTES};

use super::auth::GeneratedCredentials;
use super::files::CitationFiles;
use super::quick_tunnel::{verified_executable, CloudflaredTunnel};
use super::server::{LoopbackServer, TerminalInput};
use super::session::HostedSession;

const INVITATION_TTL: Duration = Duration::from_secs(15 * 60);

struct HostedRuntime {
    session: Arc<HostedSession>,
    _server: LoopbackServer,
    tunnel: Option<CloudflaredTunnel>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedInvite {
    pub session_id: String,
    pub invite_code: String,
    pub loopback_url: String,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedTunnel {
    pub public_url: String,
    pub connection_url: String,
}

#[derive(Default)]
pub struct CollabState {
    sessions: RwLock<HashMap<u32, HostedRuntime>>,
    active_sessions: AtomicUsize,
}

impl CollabState {
    pub fn start_host(
        &self,
        pty_id: u32,
        cols: u16,
        rows: u16,
        terminal_input: TerminalInput,
    ) -> Result<HostedInvite, String> {
        self.start_host_with_files(pty_id, cols, rows, terminal_input, None)
    }

    pub(super) fn start_host_with_files(
        &self,
        pty_id: u32,
        cols: u16,
        rows: u16,
        terminal_input: TerminalInput,
        citation_files: Option<Arc<CitationFiles>>,
    ) -> Result<HostedInvite, String> {
        if cols == 0 || rows == 0 {
            return Err("terminal dimensions must be positive".to_string());
        }
        if self.sessions.read().unwrap().contains_key(&pty_id) {
            return Err("terminal is already shared".to_string());
        }

        let credentials = GeneratedCredentials::generate().map_err(|error| error.to_string())?;
        let session = Arc::new(HostedSession::new(
            credentials.session_id.clone(),
            pty_id,
            cols,
            rows,
            credentials.authenticator,
            Instant::now() + INVITATION_TTL,
        ));
        let server =
            LoopbackServer::start_with_files(session.clone(), terminal_input, citation_files)
                .map_err(|error| error.to_string())?;
        let loopback_url = format!(
            "ws://{}/v1/session/{}",
            server.address(),
            credentials.session_id
        );
        let expires_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .saturating_add(INVITATION_TTL)
            .as_millis() as u64;
        let invite = HostedInvite {
            session_id: credentials.session_id,
            invite_code: credentials.invite_code,
            loopback_url,
            expires_at_ms,
        };

        let mut sessions = self.sessions.write().unwrap();
        if sessions.contains_key(&pty_id) {
            drop(sessions);
            drop(server);
            return Err("terminal is already shared".to_string());
        }
        sessions.insert(
            pty_id,
            HostedRuntime {
                session,
                _server: server,
                tunnel: None,
            },
        );
        self.active_sessions.fetch_add(1, Ordering::Release);
        Ok(invite)
    }

    pub fn stop_host(&self, pty_id: u32, reason: &str) -> bool {
        let runtime = self.sessions.write().unwrap().remove(&pty_id);
        let Some(runtime) = runtime else {
            return false;
        };
        self.active_sessions.fetch_sub(1, Ordering::AcqRel);
        runtime.session.close(reason);
        drop(runtime);
        true
    }

    pub fn publish_pty_output(&self, pty_id: u32, data: &[u8]) {
        if data.is_empty() || self.active_sessions.load(Ordering::Relaxed) == 0 {
            return;
        }
        let session = self
            .sessions
            .read()
            .unwrap()
            .get(&pty_id)
            .map(|runtime| runtime.session.clone());
        let Some(session) = session else {
            return;
        };
        for chunk in data.chunks(MAX_PTY_DATA_BYTES) {
            if session.publish_output(chunk).is_err() {
                break;
            }
        }
    }

    pub fn resize_terminal(&self, pty_id: u32, cols: u16, rows: u16) {
        if self.active_sessions.load(Ordering::Relaxed) == 0 {
            return;
        }
        let session = self
            .sessions
            .read()
            .unwrap()
            .get(&pty_id)
            .map(|runtime| runtime.session.clone());
        if let Some(session) = session {
            let _ = session.publish_resize(cols, rows);
        }
    }

    pub fn output_sequence(&self, pty_id: u32) -> Result<u64, String> {
        self.with_session(pty_id, |session| {
            session
                .output_sequence()
                .map_err(|error| format!("snapshot barrier rejected: {error:?}"))
        })
    }

    pub fn snapshot_required(&self, pty_id: u32) -> Result<bool, String> {
        self.with_session(pty_id, |session| {
            session
                .snapshot_required()
                .map_err(|error| format!("snapshot status unavailable: {error:?}"))
        })
    }

    pub fn set_snapshot(
        &self,
        pty_id: u32,
        sequence: u64,
        cols: u16,
        rows: u16,
        data: &[u8],
    ) -> Result<(), String> {
        self.with_session(pty_id, |session| {
            session
                .set_snapshot(sequence, cols, rows, data)
                .map_err(|error| format!("terminal snapshot rejected: {error:?}"))
        })
    }

    pub fn terminal_exited(&self, pty_id: u32, code: i32) {
        let runtime = self.sessions.write().unwrap().remove(&pty_id);
        let Some(runtime) = runtime else {
            return;
        };
        self.active_sessions.fetch_sub(1, Ordering::AcqRel);
        let _ = runtime.session.publish_terminal_exit(code);
        runtime.session.close("terminal_exit");
        drop(runtime);
    }

    pub fn publish_host(
        &self,
        pty_id: u32,
        custom_path: Option<&str>,
    ) -> Result<PublishedTunnel, String> {
        let executable = verified_executable(custom_path)?;
        let (address, session_id) = {
            let sessions = self.sessions.read().unwrap();
            let runtime = sessions
                .get(&pty_id)
                .ok_or_else(|| "terminal is not shared".to_string())?;
            if runtime.tunnel.is_some() {
                return Err("terminal already has a public tunnel".to_string());
            }
            (
                runtime._server.address(),
                runtime.session.session_id.clone(),
            )
        };
        let local_url = format!("http://{address}");
        let tunnel = CloudflaredTunnel::start(&executable, &local_url)?;
        let public_url = tunnel.public_url().to_string();
        let connection_url = format!(
            "wss://{}/v1/session/{session_id}",
            public_url.trim_start_matches("https://")
        );

        let mut sessions = self.sessions.write().unwrap();
        let runtime = sessions
            .get_mut(&pty_id)
            .ok_or_else(|| "terminal stopped while publishing the tunnel".to_string())?;
        if runtime.tunnel.is_some() {
            return Err("terminal already has a public tunnel".to_string());
        }
        runtime.tunnel = Some(tunnel);
        Ok(PublishedTunnel {
            public_url,
            connection_url,
        })
    }

    pub fn unpublish_host(&self, pty_id: u32) -> Result<bool, String> {
        let tunnel = self
            .sessions
            .write()
            .unwrap()
            .get_mut(&pty_id)
            .ok_or_else(|| "terminal is not shared".to_string())?
            .tunnel
            .take();
        let stopped = tunnel.is_some();
        drop(tunnel);
        Ok(stopped)
    }

    pub fn participants(&self, pty_id: u32) -> Result<Vec<Participant>, String> {
        self.with_session(pty_id, |session| Ok(session.participants()))
    }

    pub fn grant_control(&self, pty_id: u32, participant_id: &str) -> Result<(), String> {
        self.with_session(pty_id, |session| {
            session
                .set_controller(participant_id)
                .map_err(|error| format!("control grant rejected: {error:?}"))
        })
    }

    pub fn revoke_control(&self, pty_id: u32, participant_id: &str) -> Result<(), String> {
        self.with_session(pty_id, |session| {
            session
                .set_observer(participant_id)
                .map_err(|error| format!("control revocation rejected: {error:?}"))
        })
    }

    pub fn remove_participant(&self, pty_id: u32, participant_id: &str) -> Result<(), String> {
        self.with_session(pty_id, |session| {
            session
                .remove_participant(participant_id)
                .map_err(|error| format!("participant removal rejected: {error:?}"))
        })
    }

    pub fn ban_participant(&self, pty_id: u32, participant_id: &str) -> Result<(), String> {
        self.with_session(pty_id, |session| {
            session
                .ban_participant(participant_id)
                .map_err(|error| format!("participant ban rejected: {error:?}"))
        })
    }

    pub fn stop_all(&self, reason: &str) -> usize {
        let runtimes: Vec<HostedRuntime> = {
            let mut sessions = self.sessions.write().unwrap();
            sessions.drain().map(|(_, runtime)| runtime).collect()
        };
        self.active_sessions.store(0, Ordering::Release);
        let count = runtimes.len();
        for runtime in &runtimes {
            runtime.session.close(reason);
        }
        drop(runtimes);
        count
    }

    fn with_session<T>(
        &self,
        pty_id: u32,
        operation: impl FnOnce(&HostedSession) -> Result<T, String>,
    ) -> Result<T, String> {
        let session = self
            .sessions
            .read()
            .unwrap()
            .get(&pty_id)
            .map(|runtime| runtime.session.clone())
            .ok_or_else(|| "terminal is not shared".to_string())?;
        operation(&session)
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.active_sessions.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_pty_can_only_have_one_hosted_session() {
        let state = CollabState::default();
        let invite = state
            .start_host(4, 80, 24, Arc::new(|_, _| Ok(())))
            .expect("start host");

        assert!(invite.loopback_url.starts_with("ws://127.0.0.1:"));
        assert_eq!(state.active_count(), 1);
        assert!(state
            .start_host(4, 80, 24, Arc::new(|_, _| Ok(())))
            .is_err());
        assert!(state.stop_host(4, "host_stopped"));
        assert_eq!(state.active_count(), 0);
        assert!(!state.stop_host(4, "host_stopped"));
    }

    #[test]
    fn stop_all_revokes_every_hosted_terminal() {
        let state = CollabState::default();
        state
            .start_host(1, 80, 24, Arc::new(|_, _| Ok(())))
            .expect("first host");
        state
            .start_host(2, 120, 40, Arc::new(|_, _| Ok(())))
            .expect("second host");

        assert_eq!(state.stop_all("app_exit"), 2);
        assert_eq!(state.active_count(), 0);
    }
}
