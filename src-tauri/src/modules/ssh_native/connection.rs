//! Opening a native SSH session, including the jump host chain.

use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::ssh_key;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use super::auth;
use super::host_trust::{self, PresentedKey, TrustDecision};
use super::known_hosts::{self, KnownHostEntry};
use super::types::{
    HostKeyApproval, SshCredential, SshErrorCode, SshNativeError, SshNativeHop, SshNativeTarget,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
const KEEPALIVE_MAX: usize = 3;
/// A chain deeper than this is a configuration mistake, and every hop costs a
/// live session.
const MAX_HOPS: usize = 8;

/// The first hop rides a socket; the rest ride a channel on the hop before it.
/// One enum keeps `open_hop` single, rather than one copy per transport.
enum HopStream {
    Tcp(tokio::net::TcpStream),
    Tunnelled(Box<russh::ChannelStream<client::Msg>>),
}

impl AsyncRead for HopStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_read(cx, buf),
            Self::Tunnelled(s) => Pin::new(s.as_mut()).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for HopStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_write(cx, buf),
            Self::Tunnelled(s) => Pin::new(s.as_mut()).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_flush(cx),
            Self::Tunnelled(s) => Pin::new(s.as_mut()).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(s) => Pin::new(s).poll_shutdown(cx),
            Self::Tunnelled(s) => Pin::new(s.as_mut()).poll_shutdown(cx),
        }
    }
}

#[derive(Default)]
struct GateOutcome {
    rejection: Option<SshNativeError>,
    /// The `known_hosts` line to append, set only when the user asked to
    /// remember. Written after the session is up, never from the callback.
    remember_line: Option<String>,
}

pub struct NativeHandler {
    entries: Arc<Vec<KnownHostEntry>>,
    host: String,
    port: u16,
    approval: HostKeyApproval,
    outcome: Arc<Mutex<GateOutcome>>,
}

impl client::Handler for NativeHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        self.verify_server_key(server_public_key)
    }
}

impl NativeHandler {
    /// Synchronous on purpose. A `MutexGuard` alive inside the `async fn` body
    /// makes its future non-Send, which Tauri's command future then rejects.
    fn verify_server_key(
        &self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, russh::Error> {
        let openssh = server_public_key
            .to_openssh()
            .map_err(|_| russh::Error::Inconsistent)?;
        let mut fields = openssh.split_whitespace();
        let (Some(key_type), Some(key_base64)) = (fields.next(), fields.next()) else {
            return Err(russh::Error::Inconsistent);
        };
        let fingerprint = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();

        let decision = host_trust::decide(
            &self.entries,
            &self.host,
            self.port,
            &PresentedKey {
                key_type,
                key_base64,
                fingerprint: &fingerprint,
            },
            &self.approval,
        );

        let mut outcome = self.outcome.lock().unwrap_or_else(|e| e.into_inner());
        match decision {
            TrustDecision::Accept { remember } => {
                if remember {
                    outcome.remember_line = Some(known_hosts::entry_line(
                        &self.host, self.port, key_type, key_base64,
                    ));
                }
                Ok(true)
            }
            TrustDecision::Reject(error) => {
                outcome.rejection = Some(error);
                Ok(false)
            }
        }
    }
}

/// Every hop of a chain, destination last. Earlier hops are held because
/// dropping one closes the channel carrying the next.
pub struct NativeChain {
    hops: Vec<Arc<Handle<NativeHandler>>>,
}

/// Only the shape: a live SSH handle has nothing safe or useful to print.
impl std::fmt::Debug for NativeChain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeChain")
            .field("hops", &self.hops.len())
            .finish()
    }
}

impl NativeChain {
    pub fn destination(&self) -> Arc<Handle<NativeHandler>> {
        Arc::clone(self.hops.last().expect("a chain always has a destination"))
    }

    pub fn depth(&self) -> usize {
        self.hops.len()
    }
}

/// russh's default list excludes the SHA-1 key exchanges. Old appliances still
/// need them, so they are offered only when the connection opts in, and always
/// last so a modern server never picks one.
fn preferred(legacy_algorithms: bool) -> russh::Preferred {
    if !legacy_algorithms {
        return russh::Preferred::DEFAULT;
    }
    let mut kex = russh::Preferred::DEFAULT.kex.to_vec();
    kex.extend_from_slice(&[
        russh::kex::DH_GEX_SHA1,
        russh::kex::DH_G14_SHA1,
        russh::kex::DH_G1_SHA1,
    ]);
    russh::Preferred {
        kex: std::borrow::Cow::Owned(kex),
        ..russh::Preferred::DEFAULT
    }
}

fn client_config(legacy_algorithms: bool) -> Arc<client::Config> {
    Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: KEEPALIVE_MAX,
        nodelay: true,
        preferred: preferred(legacy_algorithms),
        ..client::Config::default()
    })
}

/// Synchronous accessors so no lock guard ever exists inside an async body,
/// where it would strip the `Send` the Tauri command future needs.
fn take_rejection(outcome: &Arc<Mutex<GateOutcome>>) -> Option<SshNativeError> {
    outcome
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .rejection
        .take()
}

fn take_remember_line(outcome: &Arc<Mutex<GateOutcome>>) -> Option<String> {
    outcome
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remember_line
        .take()
}

fn unreachable(hop: &SshNativeHop, detail: impl std::fmt::Display) -> SshNativeError {
    SshNativeError::new(
        SshErrorCode::Unreachable,
        format!("cannot reach {}:{}: {detail}", hop.host, hop.port()),
    )
}

/// Takes its inputs by value: a borrow crossing this async boundary would make
/// the enclosing Tauri command future fail its higher-ranked `Send` bound.
async fn open_hop(
    stream: HopStream,
    hop: SshNativeHop,
    entries: Arc<Vec<KnownHostEntry>>,
    approval: HostKeyApproval,
    credentials: Arc<Vec<SshCredential>>,
    legacy_algorithms: bool,
) -> Result<(Handle<NativeHandler>, Option<String>), SshNativeError> {
    let outcome = Arc::new(Mutex::new(GateOutcome::default()));
    let handler = NativeHandler {
        entries,
        host: hop.host.clone(),
        port: hop.port(),
        approval,
        outcome: Arc::clone(&outcome),
    };

    let connecting = client::connect_stream(client_config(legacy_algorithms), stream, handler);
    let handle = match tokio::time::timeout(CONNECT_TIMEOUT, connecting).await {
        Err(_) => {
            return Err(SshNativeError::new(
                SshErrorCode::Timeout,
                format!("handshake with {} timed out", hop.host),
            ))
        }
        // A refused key surfaces here as a generic transport error, so the
        // precise reason recorded by the gate wins over it.
        Ok(Err(error)) => {
            let recorded = take_rejection(&outcome);
            return Err(recorded.unwrap_or_else(|| unreachable(&hop, error)));
        }
        Ok(Ok(handle)) => handle,
    };

    let mut handle = handle;
    let user = hop.user.clone().unwrap_or_else(default_user);
    auth::authenticate(&mut handle, &user, &credentials).await?;

    Ok((handle, take_remember_line(&outcome)))
}

fn default_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

/// Open the full chain. `approval` applies only to the destination: a jump host
/// key still has to be known, because the user was never shown it.
pub async fn connect(
    target: SshNativeTarget,
    credentials: Vec<SshCredential>,
    approval: HostKeyApproval,
) -> Result<(NativeChain, Option<String>), SshNativeError> {
    if target.destination.host.trim().is_empty() {
        return Err(SshNativeError::new(
            SshErrorCode::Config,
            "no destination host",
        ));
    }
    if target.jumps.len() + 1 > MAX_HOPS {
        return Err(SshNativeError::new(
            SshErrorCode::Config,
            format!("more than {MAX_HOPS} hops requested"),
        ));
    }

    let entries = Arc::new(load_known_hosts());
    let credentials = Arc::new(credentials);
    let legacy_algorithms = target.legacy_algorithms;
    let mut hops: Vec<Arc<Handle<NativeHandler>>> = Vec::new();
    let mut remember_line = None;

    let chain: Vec<SshNativeHop> = target
        .jumps
        .into_iter()
        .chain(std::iter::once(target.destination))
        .collect();
    let last = chain.len() - 1;

    for (index, hop) in chain.into_iter().enumerate() {
        let stream = match hops.last() {
            None => HopStream::Tcp(
                tokio::net::TcpStream::connect((hop.host.as_str(), hop.port()))
                    .await
                    .map_err(|e| unreachable(&hop, e))?,
            ),
            Some(previous) => HopStream::Tunnelled(Box::new(
                previous
                    .channel_open_direct_tcpip(hop.host.as_str(), hop.port() as u32, "127.0.0.1", 0)
                    .await
                    .map_err(|e| unreachable(&hop, e))?
                    .into_stream(),
            )),
        };

        let hop_approval = if index == last {
            approval.clone()
        } else {
            HostKeyApproval::None
        };
        let (handle, remember) = open_hop(
            stream,
            hop,
            Arc::clone(&entries),
            hop_approval,
            Arc::clone(&credentials),
            legacy_algorithms,
        )
        .await?;
        if index == last {
            remember_line = remember;
        }
        hops.push(Arc::new(handle));
    }

    Ok((NativeChain { hops }, remember_line))
}

fn known_hosts_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".ssh").join("known_hosts"))
}

fn load_known_hosts() -> Vec<KnownHostEntry> {
    known_hosts_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|content| known_hosts::parse(&content))
        .unwrap_or_default()
}

/// Append a line the user explicitly accepted. Never called for a key the user
/// did not see.
pub fn remember_host_key(line: &str) -> Result<(), SshNativeError> {
    use std::io::Write;

    let path = known_hosts_path().ok_or_else(|| {
        SshNativeError::new(SshErrorCode::Config, "no home directory for known_hosts")
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            SshNativeError::new(SshErrorCode::Config, format!("create {parent:?}: {e}"))
        })?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| SshNativeError::new(SshErrorCode::Config, format!("open {path:?}: {e}")))?;
    writeln!(file, "{line}")
        .map_err(|e| SshNativeError::new(SshErrorCode::Config, format!("write {path:?}: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hop(host: &str) -> SshNativeHop {
        SshNativeHop {
            host: host.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn the_handshake_future_is_send() {
        fn assert_send<T: Send>(_: &T) {}
        let handler = NativeHandler {
            entries: Arc::new(Vec::new()),
            host: "example.com".into(),
            port: 22,
            approval: HostKeyApproval::None,
            outcome: Arc::new(Mutex::new(GateOutcome::default())),
        };
        let (stream, _peer) = tokio::io::duplex(64);
        let future = client::connect_stream(client_config(false), stream, handler);
        assert_send(&future);
    }

    /// Locks the bound the Tauri command depends on: the moment this future
    /// stops being `Send`, `ssh_native_connect` stops compiling for a reason
    /// that is far harder to read than this line.
    #[test]
    fn the_connect_future_stays_send() {
        fn assert_send<T: Send>(_: &T) {}
        let future = connect(
            SshNativeTarget::default(),
            Vec::new(),
            HostKeyApproval::None,
        );
        assert_send(&future);
    }

    #[tokio::test]
    async fn an_empty_destination_is_a_configuration_error() {
        let target = SshNativeTarget::default();
        let error = connect(target, Vec::new(), HostKeyApproval::None)
            .await
            .expect_err("empty host is refused");
        assert_eq!(error.code, SshErrorCode::Config);
    }

    #[tokio::test]
    async fn too_many_hops_is_refused_before_any_socket_is_opened() {
        let target = SshNativeTarget {
            destination: hop("dest"),
            jumps: (0..MAX_HOPS).map(|i| hop(&format!("j{i}"))).collect(),
            legacy_algorithms: false,
        };
        let error = connect(target, Vec::new(), HostKeyApproval::None)
            .await
            .expect_err("an over-long chain is refused");
        assert_eq!(error.code, SshErrorCode::Config);
    }

    #[tokio::test]
    async fn an_unresolvable_host_reports_unreachable() {
        let target = SshNativeTarget {
            destination: SshNativeHop {
                host: "host.invalid".into(),
                port: Some(22),
                ..Default::default()
            },
            ..Default::default()
        };
        let error = connect(target, Vec::new(), HostKeyApproval::None)
            .await
            .expect_err("an unresolvable host fails");
        assert_eq!(error.code, SshErrorCode::Unreachable);
    }

    #[test]
    fn sha1_key_exchanges_are_offered_only_on_request_and_only_last() {
        let default = preferred(false);
        assert!(!default.kex.contains(&russh::kex::DH_G14_SHA1));

        let legacy = preferred(true);
        assert!(legacy.kex.contains(&russh::kex::DH_G14_SHA1));
        assert!(legacy.kex.contains(&russh::kex::DH_G1_SHA1));
        assert_eq!(legacy.kex[0], default.kex[0]);
        assert_eq!(legacy.kex.len(), default.kex.len() + 3);
    }

    #[test]
    fn known_hosts_lives_under_the_user_ssh_directory() {
        let path = known_hosts_path().expect("home directory resolves");
        assert!(path.ends_with("known_hosts"));
        assert!(path.parent().expect("parent").ends_with(".ssh"));
    }
}
