//! A Harness agent CLI running on an SSH host, managed so that it outlives the
//! connection. The host-side supervisor keeps the agent and its output log
//! (see `voktty-remote`'s `agent_proc`); this module streams that log as
//! Harness events, and after a dropped connection reopens a session and
//! resumes from the last output it delivered.
//!
//! Everything that touches the network is behind `AgentSession` and
//! `SessionProvider`, so the reconnect behavior is tested without SSH.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use voktty_remote_protocol::PROC_STREAM_STDERR;

use crate::modules::remote::{ProcEvent, ProcListener, RemoteCallError};

/// How long to keep trying to reconnect, and how often.
#[derive(Debug, Clone)]
pub(crate) struct ReconnectPolicy {
    delays: Vec<Duration>,
    pub(crate) give_up_after: Duration,
}

impl ReconnectPolicy {
    pub(crate) fn standard() -> Self {
        Self {
            delays: [1, 2, 4, 8, 15]
                .into_iter()
                .map(Duration::from_secs)
                .collect(),
            give_up_after: Duration::from_secs(5 * 60),
        }
    }

    /// Delay before the given zero-based attempt; the last delay repeats.
    pub(crate) fn delay(&self, attempt: usize) -> Duration {
        self.delays
            .get(attempt)
            .or_else(|| self.delays.last())
            .copied()
            .unwrap_or_default()
    }

    /// Whether another attempt fits in the total time budget.
    pub(crate) fn allows(&self, elapsed: Duration) -> bool {
        elapsed < self.give_up_after
    }

    #[cfg(test)]
    pub(crate) fn immediate(attempts: usize) -> Self {
        Self {
            delays: vec![Duration::ZERO],
            give_up_after: Duration::from_millis(attempts as u64),
        }
    }
}

/// Splits a byte stream into lines, keeping a partial line until its newline.
#[derive(Default)]
pub(crate) struct LineSplitter {
    pending: Vec<u8>,
}

impl LineSplitter {
    pub(crate) fn push(&mut self, data: &[u8]) -> Vec<String> {
        let mut lines = Vec::new();
        for &byte in data {
            if byte == b'\n' {
                lines.push(Self::decode(&std::mem::take(&mut self.pending)));
            } else {
                self.pending.push(byte);
            }
        }
        lines
    }

    pub(crate) fn finish(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            None
        } else {
            Some(Self::decode(&std::mem::take(&mut self.pending)))
        }
    }

    fn decode(bytes: &[u8]) -> String {
        let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// One live connection to a host, from the agent's point of view.
pub(crate) trait AgentSession: Send + Sync {
    fn spawn(
        &self,
        attach_id: u64,
        params: Value,
        listener: ProcListener,
    ) -> Result<String, RemoteCallError>;
    fn attach(
        &self,
        attach_id: u64,
        proc_id: &str,
        from_offset: u64,
        listener: ProcListener,
    ) -> Result<(), RemoteCallError>;
    fn write(&self, attach_id: u64, data: &[u8]) -> Result<(), String>;
    fn signal(&self, proc_id: &str, signal: &str) -> Result<(), RemoteCallError>;
    fn close(&self, proc_id: &str);
}

pub(crate) trait SessionProvider: Send + Sync {
    fn next_attach_id(&self) -> u64;
    /// Opens a fresh session to the same host and folder.
    fn reconnect(&self) -> Result<Arc<dyn AgentSession>, String>;
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AgentLink {
    Reconnecting,
    Connected,
}

pub(crate) trait AgentEvents: Send + Sync {
    fn stdout(&self, line: String);
    fn stderr(&self, line: String);
    fn link(&self, state: AgentLink);
    /// Final event. `code` is `None` when the agent was killed by a signal or lost.
    fn exit(&self, code: Option<i32>, reason: Option<String>);
}

#[derive(Debug, PartialEq)]
enum Phase {
    Running,
    Reconnecting,
    Finished,
}

struct State {
    session: Arc<dyn AgentSession>,
    attach_id: u64,
    phase: Phase,
    /// Log offset after the last output delivered; a reattach resumes here.
    offset: u64,
}

pub(crate) struct RemoteAgent {
    proc_id: String,
    state: Mutex<State>,
    cancelled: AtomicBool,
    provider: Arc<dyn SessionProvider>,
    policy: ReconnectPolicy,
}

impl RemoteAgent {
    /// Starts the agent on the host and begins streaming its output.
    pub(crate) fn start(
        session: Arc<dyn AgentSession>,
        provider: Arc<dyn SessionProvider>,
        events: Arc<dyn AgentEvents>,
        params: Value,
        policy: ReconnectPolicy,
    ) -> Result<Arc<Self>, RemoteCallError> {
        let attach_id = provider.next_attach_id();
        let (sender, receiver) = mpsc::channel();
        let proc_id = session.spawn(attach_id, params, listener(sender.clone()))?;
        let agent = Arc::new(Self {
            proc_id,
            state: Mutex::new(State {
                session,
                attach_id,
                phase: Phase::Running,
                offset: 0,
            }),
            cancelled: AtomicBool::new(false),
            provider,
            policy,
        });
        let pump = Arc::clone(&agent);
        std::thread::Builder::new()
            .name("voktty-remote-agent".to_string())
            .spawn(move || pump.pump(receiver, sender, events))
            .map_err(|error| RemoteCallError::Transport(error.to_string()))?;
        Ok(agent)
    }

    /// Writes bytes to the agent stdin.
    pub(crate) fn write(&self, data: &[u8]) -> Result<(), String> {
        let (session, attach_id) = {
            let state = self.state.lock().map_err(|_| "agent state is poisoned")?;
            match state.phase {
                Phase::Running => (Arc::clone(&state.session), state.attach_id),
                Phase::Reconnecting => {
                    return Err("The remote agent is reconnecting. Try again in a moment.".into())
                }
                Phase::Finished => return Err("The remote agent has exited.".into()),
            }
        };
        session.write(attach_id, data)
    }

    /// Stops the agent: a polite signal, then a forced one if it lingers.
    /// A host that cannot be reached right now is retried in the background so
    /// the agent does not keep running unattended.
    pub(crate) fn kill(self: &Arc<Self>) {
        self.cancelled.store(true, Ordering::SeqCst);
        let session = {
            let Ok(state) = self.state.lock() else { return };
            if state.phase == Phase::Finished {
                return;
            }
            (state.phase == Phase::Running).then(|| Arc::clone(&state.session))
        };
        let agent = Arc::clone(self);
        let _ = std::thread::Builder::new()
            .name("voktty-remote-agent-kill".to_string())
            .spawn(move || agent.stop_on_host(session));
    }

    fn stop_on_host(&self, live: Option<Arc<dyn AgentSession>>) {
        let session = live.or_else(|| {
            for _ in 0..3 {
                if let Ok(session) = self.provider.reconnect() {
                    return Some(session);
                }
                std::thread::sleep(Duration::from_secs(2));
            }
            None
        });
        let Some(session) = session else { return };
        let _ = session.signal(&self.proc_id, "term");
        for _ in 0..30 {
            if self.is_finished() {
                session.close(&self.proc_id);
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = session.signal(&self.proc_id, "kill");
        std::thread::sleep(Duration::from_millis(500));
        session.close(&self.proc_id);
    }

    fn is_finished(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.phase == Phase::Finished)
            .unwrap_or(true)
    }

    fn finish(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.phase = Phase::Finished;
        }
    }

    fn pump(
        self: Arc<Self>,
        receiver: Receiver<ProcEvent>,
        sender: Sender<ProcEvent>,
        events: Arc<dyn AgentEvents>,
    ) {
        let mut stdout = LineSplitter::default();
        let mut stderr = LineSplitter::default();
        let flush = |stdout: &mut LineSplitter, stderr: &mut LineSplitter| {
            if let Some(line) = stdout.finish() {
                events.stdout(line);
            }
            if let Some(line) = stderr.finish() {
                events.stderr(line);
            }
        };
        while let Ok(event) = receiver.recv() {
            match event {
                ProcEvent::Output {
                    stream,
                    next_offset,
                    data,
                } => {
                    let splitter = if stream == PROC_STREAM_STDERR {
                        &mut stderr
                    } else {
                        &mut stdout
                    };
                    for line in splitter.push(&data) {
                        if stream == PROC_STREAM_STDERR {
                            events.stderr(line);
                        } else {
                            events.stdout(line);
                        }
                    }
                    if let Ok(mut state) = self.state.lock() {
                        state.offset = next_offset;
                    }
                }
                ProcEvent::Exit {
                    code,
                    signal,
                    reason,
                    ..
                } => {
                    flush(&mut stdout, &mut stderr);
                    self.finish();
                    let reason = if reason.is_empty() {
                        signal.map(|signal| format!("signal {signal}"))
                    } else {
                        Some(reason)
                    };
                    events.exit(code, reason);
                    return;
                }
                ProcEvent::Lost => {
                    if self.cancelled.load(Ordering::SeqCst) {
                        flush(&mut stdout, &mut stderr);
                        self.finish();
                        events.exit(None, Some("cancelled".to_string()));
                        return;
                    }
                    events.link(AgentLink::Reconnecting);
                    if let Ok(mut state) = self.state.lock() {
                        state.phase = Phase::Reconnecting;
                    }
                    match self.reattach(&sender) {
                        Ok(()) => events.link(AgentLink::Connected),
                        Err(reason) => {
                            flush(&mut stdout, &mut stderr);
                            self.finish();
                            events.exit(None, Some(reason));
                            return;
                        }
                    }
                }
            }
        }
        // The channel closed without an exit: nothing more can arrive.
        flush(&mut stdout, &mut stderr);
        self.finish();
        events.exit(None, Some("remote agent stream ended".to_string()));
    }

    /// Reopens a session and resumes the log. An error is final.
    fn reattach(&self, sender: &Sender<ProcEvent>) -> Result<(), String> {
        let started = std::time::Instant::now();
        let mut attempt = 0usize;
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                return Err("cancelled".to_string());
            }
            if !self.policy.allows(started.elapsed()) {
                return Err(
                    "The remote host stayed unreachable; the agent may still be running there."
                        .to_string(),
                );
            }
            std::thread::sleep(self.policy.delay(attempt));
            attempt += 1;
            let Ok(session) = self.provider.reconnect() else {
                continue;
            };
            let attach_id = self.provider.next_attach_id();
            let offset = self.state.lock().map(|state| state.offset).unwrap_or(0);
            match session.attach(attach_id, &self.proc_id, offset, listener(sender.clone())) {
                Ok(()) => {
                    if let Ok(mut state) = self.state.lock() {
                        state.session = session;
                        state.attach_id = attach_id;
                        state.phase = Phase::Running;
                    }
                    return Ok(());
                }
                Err(RemoteCallError::Transport(_)) => continue,
                Err(RemoteCallError::Helper { code, message }) => {
                    return Err(format!(
                        "The remote agent cannot be resumed ({code}: {message})."
                    ));
                }
            }
        }
    }
}

fn listener(sender: Sender<ProcEvent>) -> ProcListener {
    let sender = Mutex::new(sender);
    Arc::new(move |event| {
        if let Ok(sender) = sender.lock() {
            let _ = sender.send(event);
        }
    })
}

/// Parameters for `proc.spawn` that stay valid for the life of the agent.
pub(crate) fn spawn_params(
    command: &str,
    args: &[String],
    cwd: &str,
    attach_label: Option<&str>,
) -> Value {
    let mut params = json!({
        "command": command,
        "args": args,
        "cwd": cwd,
    });
    if let Some(label) = attach_label {
        params["label"] = json!(label);
    }
    params
}

// --- SSH bindings ----------------------------------------------------------

use tauri::AppHandle;
use voktty_remote_protocol::{
    METHOD_PROC_ATTACH, METHOD_PROC_CLOSE, METHOD_PROC_KILL, METHOD_PROC_SPAWN,
};

use crate::modules::remote::{RemoteSession, RemoteSshConnection, RemoteState};

/// A helper session reached over the app's SSH transport.
pub(crate) struct SshAgentSession {
    session: Arc<RemoteSession>,
    state: RemoteState,
}

impl SshAgentSession {
    pub(crate) fn new(session: Arc<RemoteSession>, state: RemoteState) -> Self {
        Self { session, state }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, RemoteCallError> {
        self.session
            .call(self.state.request_id("proc"), method, params)
    }
}

impl AgentSession for SshAgentSession {
    fn spawn(
        &self,
        attach_id: u64,
        mut params: Value,
        listener: ProcListener,
    ) -> Result<String, RemoteCallError> {
        params["attachId"] = json!(attach_id);
        self.session
            .register_proc(attach_id, listener)
            .map_err(RemoteCallError::Transport)?;
        match self.call(METHOD_PROC_SPAWN, params) {
            Ok(result) => result["procId"]
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| {
                    self.session.unregister_proc(attach_id);
                    RemoteCallError::Transport("the host did not return a process id".to_string())
                }),
            Err(error) => {
                self.session.unregister_proc(attach_id);
                Err(error)
            }
        }
    }

    fn attach(
        &self,
        attach_id: u64,
        proc_id: &str,
        from_offset: u64,
        listener: ProcListener,
    ) -> Result<(), RemoteCallError> {
        self.session
            .register_proc(attach_id, listener)
            .map_err(RemoteCallError::Transport)?;
        self.call(
            METHOD_PROC_ATTACH,
            json!({ "procId": proc_id, "attachId": attach_id, "fromOffset": from_offset }),
        )
        .map(|_| ())
        .inspect_err(|_| self.session.unregister_proc(attach_id))
    }

    fn write(&self, attach_id: u64, data: &[u8]) -> Result<(), String> {
        self.session.proc_write(attach_id, data)
    }

    fn signal(&self, proc_id: &str, signal: &str) -> Result<(), RemoteCallError> {
        self.call(
            METHOD_PROC_KILL,
            json!({ "procId": proc_id, "signal": signal }),
        )
        .map(|_| ())
    }

    fn close(&self, proc_id: &str) {
        let _ = self.call(
            METHOD_PROC_CLOSE,
            json!({ "procId": proc_id, "force": true }),
        );
    }
}

/// Reopens sessions to one host and project folder after a connection drop.
pub(crate) struct SshSessionProvider {
    pub app: AppHandle,
    pub state: RemoteState,
    pub connection: RemoteSshConnection,
    pub root: String,
}

impl SessionProvider for SshSessionProvider {
    fn next_attach_id(&self) -> u64 {
        self.state.next_attach_id()
    }

    fn reconnect(&self) -> Result<Arc<dyn AgentSession>, String> {
        let (_, session) = self.state.open_blocking(
            self.app.clone(),
            self.connection.clone(),
            Some(self.root.clone()),
        )?;
        Ok(Arc::new(SshAgentSession::new(session, self.state.clone())))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use std::sync::Condvar;

    #[test]
    fn reconnect_schedule_backs_off_and_repeats_the_last_delay() {
        let policy = ReconnectPolicy::standard();
        let delays: Vec<u64> = (0..8).map(|n| policy.delay(n).as_secs()).collect();
        assert_eq!(delays, vec![1, 2, 4, 8, 15, 15, 15, 15]);
        assert!(policy.allows(Duration::from_secs(299)));
        assert!(!policy.allows(Duration::from_secs(300)));
    }

    #[test]
    fn lines_keep_partial_data_until_their_newline_and_tolerate_bad_utf8() {
        let mut splitter = LineSplitter::default();
        assert_eq!(splitter.push(b"{\"a\":1}\r\n{\"b\""), vec!["{\"a\":1}"]);
        assert_eq!(splitter.push(b":2}\n\nrest"), vec!["{\"b\":2}", ""]);
        assert_eq!(splitter.finish().as_deref(), Some("rest"));
        assert_eq!(splitter.finish(), None);
        assert_eq!(splitter.push(&[0xff, b'x', b'\n']), vec!["\u{fffd}x"]);
    }

    // --- fakes -------------------------------------------------------------

    #[derive(Default)]
    struct Log {
        stdout: Vec<String>,
        stderr: Vec<String>,
        links: Vec<AgentLink>,
        exit: Option<(Option<i32>, Option<String>)>,
    }

    #[derive(Default)]
    struct Recorder {
        log: Mutex<Log>,
        changed: Condvar,
    }

    impl Recorder {
        fn wait<T>(&self, mut check: impl FnMut(&Log) -> Option<T>) -> T {
            let mut log = self.log.lock().unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            loop {
                if let Some(found) = check(&log) {
                    return found;
                }
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                assert!(!remaining.is_zero(), "timed out waiting for events");
                log = self.changed.wait_timeout(log, remaining).unwrap().0;
            }
        }
    }

    impl AgentEvents for Recorder {
        fn stdout(&self, line: String) {
            self.log.lock().unwrap().stdout.push(line);
            self.changed.notify_all();
        }
        fn stderr(&self, line: String) {
            self.log.lock().unwrap().stderr.push(line);
            self.changed.notify_all();
        }
        fn link(&self, state: AgentLink) {
            self.log.lock().unwrap().links.push(state);
            self.changed.notify_all();
        }
        fn exit(&self, code: Option<i32>, reason: Option<String>) {
            self.log.lock().unwrap().exit = Some((code, reason));
            self.changed.notify_all();
        }
    }

    #[derive(Default)]
    struct FakeSession {
        listener: Mutex<Option<ProcListener>>,
        attached: Mutex<Vec<(u64, String, u64)>>,
        written: Mutex<Vec<u8>>,
        signals: Mutex<Vec<String>>,
        closed: Mutex<Vec<String>>,
        attach_result: Mutex<Option<RemoteCallError>>,
    }

    impl FakeSession {
        fn emit(&self, event: ProcEvent) {
            let listener = self.listener.lock().unwrap().clone().expect("listener");
            listener(event);
        }
        fn output(&self, stream: u8, data: &[u8], next_offset: u64) {
            self.emit(ProcEvent::Output {
                stream,
                next_offset,
                data: data.to_vec(),
            });
        }
    }

    impl AgentSession for FakeSession {
        fn spawn(
            &self,
            _id: u64,
            _params: Value,
            listener: ProcListener,
        ) -> Result<String, RemoteCallError> {
            *self.listener.lock().unwrap() = Some(listener);
            Ok("0123456789abcdef".to_string())
        }
        fn attach(
            &self,
            attach_id: u64,
            proc_id: &str,
            from_offset: u64,
            listener: ProcListener,
        ) -> Result<(), RemoteCallError> {
            if let Some(error) = self.attach_result.lock().unwrap().clone() {
                return Err(error);
            }
            self.attached
                .lock()
                .unwrap()
                .push((attach_id, proc_id.to_string(), from_offset));
            *self.listener.lock().unwrap() = Some(listener);
            Ok(())
        }
        fn write(&self, _id: u64, data: &[u8]) -> Result<(), String> {
            self.written.lock().unwrap().extend_from_slice(data);
            Ok(())
        }
        fn signal(&self, _proc_id: &str, signal: &str) -> Result<(), RemoteCallError> {
            self.signals.lock().unwrap().push(signal.to_string());
            Ok(())
        }
        fn close(&self, proc_id: &str) {
            self.closed.lock().unwrap().push(proc_id.to_string());
        }
    }

    struct Provider {
        next: AtomicU64,
        sessions: Mutex<Vec<Arc<FakeSession>>>,
        failures: AtomicU64,
    }

    impl Provider {
        fn new(sessions: Vec<Arc<FakeSession>>) -> Arc<Self> {
            Arc::new(Self {
                next: AtomicU64::new(1),
                sessions: Mutex::new(sessions),
                failures: AtomicU64::new(0),
            })
        }
    }

    impl SessionProvider for Provider {
        fn next_attach_id(&self) -> u64 {
            self.next.fetch_add(1, Ordering::SeqCst)
        }
        fn reconnect(&self) -> Result<Arc<dyn AgentSession>, String> {
            if self.failures.load(Ordering::SeqCst) > 0 {
                self.failures.fetch_sub(1, Ordering::SeqCst);
                return Err("unreachable".into());
            }
            let mut sessions = self.sessions.lock().unwrap();
            if sessions.is_empty() {
                return Err("no session".into());
            }
            Ok(sessions.remove(0))
        }
    }

    fn start(
        first: &Arc<FakeSession>,
        provider: &Arc<Provider>,
        recorder: &Arc<Recorder>,
        policy: ReconnectPolicy,
    ) -> Arc<RemoteAgent> {
        RemoteAgent::start(
            first.clone(),
            provider.clone(),
            recorder.clone(),
            json!({}),
            policy,
        )
        .unwrap()
    }

    #[test]
    fn output_becomes_lines_and_the_exit_code_is_reported_once() {
        let first = Arc::new(FakeSession::default());
        let provider = Provider::new(vec![]);
        let recorder = Arc::new(Recorder::default());
        let agent = start(&first, &provider, &recorder, ReconnectPolicy::standard());

        first.output(1, b"{\"id\":1}\n{\"id\"", 15);
        first.output(1, b":2}\n", 19);
        first.output(2, b"warn\npartial", 31);
        first.emit(ProcEvent::Exit {
            code: Some(0),
            signal: None,
            reason: String::new(),
        });
        let exit = recorder.wait(|log| log.exit.clone());
        assert_eq!(exit, (Some(0), None));
        let log = recorder.log.lock().unwrap();
        assert_eq!(log.stdout, vec!["{\"id\":1}", "{\"id\":2}"]);
        assert_eq!(log.stderr, vec!["warn", "partial"]);
        assert!(agent.write(b"x").is_err());
    }

    #[test]
    fn a_lost_connection_resumes_from_the_last_delivered_offset_without_repeating_output() {
        let first = Arc::new(FakeSession::default());
        let second = Arc::new(FakeSession::default());
        let provider = Provider::new(vec![second.clone()]);
        let recorder = Arc::new(Recorder::default());
        let agent = start(
            &first,
            &provider,
            &recorder,
            ReconnectPolicy::immediate(5_000),
        );

        first.output(1, b"one\n", 9);
        first.output(1, b"two\n", 18);
        recorder.wait(|log| (log.stdout.len() == 2).then_some(()));
        first.emit(ProcEvent::Lost);
        recorder.wait(|log| log.links.contains(&AgentLink::Connected).then_some(()));

        assert_eq!(
            *second.attached.lock().unwrap(),
            vec![(2, "0123456789abcdef".to_string(), 18)]
        );
        second.output(1, b"three\n", 29);
        second.emit(ProcEvent::Exit {
            code: Some(0),
            signal: None,
            reason: String::new(),
        });
        recorder.wait(|log| log.exit.clone());
        let log = recorder.log.lock().unwrap();
        assert_eq!(log.stdout, vec!["one", "two", "three"]);
        assert_eq!(
            log.links,
            vec![AgentLink::Reconnecting, AgentLink::Connected]
        );
        drop(log);
        assert!(agent.is_finished());
    }

    #[test]
    fn input_is_refused_while_reconnecting_and_works_again_afterwards() {
        let first = Arc::new(FakeSession::default());
        let second = Arc::new(FakeSession::default());
        let provider = Provider::new(vec![second.clone()]);
        provider.failures.store(1, Ordering::SeqCst);
        let recorder = Arc::new(Recorder::default());
        let agent = start(
            &first,
            &provider,
            &recorder,
            ReconnectPolicy::immediate(5_000),
        );

        agent.write(b"before\n").unwrap();
        assert_eq!(*first.written.lock().unwrap(), b"before\n");
        first.emit(ProcEvent::Lost);
        recorder.wait(|log| log.links.contains(&AgentLink::Connected).then_some(()));
        agent.write(b"after\n").unwrap();
        assert_eq!(*second.written.lock().unwrap(), b"after\n");
    }

    #[test]
    fn a_vanished_process_or_an_exhausted_budget_ends_the_agent_with_a_reason() {
        let first = Arc::new(FakeSession::default());
        let gone = Arc::new(FakeSession::default());
        *gone.attach_result.lock().unwrap() = Some(RemoteCallError::Helper {
            code: "process_not_found".into(),
            message: "no such process".into(),
        });
        let provider = Provider::new(vec![gone]);
        let recorder = Arc::new(Recorder::default());
        start(
            &first,
            &provider,
            &recorder,
            ReconnectPolicy::immediate(5_000),
        );
        first.emit(ProcEvent::Lost);
        let (code, reason) = recorder.wait(|log| log.exit.clone());
        assert_eq!(code, None);
        assert!(reason.unwrap().contains("process_not_found"));

        let first = Arc::new(FakeSession::default());
        let provider = Provider::new(vec![]);
        let recorder = Arc::new(Recorder::default());
        start(&first, &provider, &recorder, ReconnectPolicy::immediate(30));
        first.emit(ProcEvent::Lost);
        let (_, reason) = recorder.wait(|log| log.exit.clone());
        assert!(reason.unwrap().contains("unreachable"));
    }

    #[test]
    fn kill_signals_the_agent_and_closes_it_once_it_exits() {
        let first = Arc::new(FakeSession::default());
        let provider = Provider::new(vec![]);
        let recorder = Arc::new(Recorder::default());
        let agent = start(&first, &provider, &recorder, ReconnectPolicy::standard());

        agent.kill();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while first.signals.lock().unwrap().is_empty() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(*first.signals.lock().unwrap(), vec!["term"]);
        first.emit(ProcEvent::Exit {
            code: None,
            signal: Some(15),
            reason: String::new(),
        });
        let (code, reason) = recorder.wait(|log| log.exit.clone());
        assert_eq!((code, reason.as_deref()), (None, Some("signal 15")));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while first.closed.lock().unwrap().is_empty() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(*first.closed.lock().unwrap(), vec!["0123456789abcdef"]);
    }

    #[test]
    fn spawn_params_carry_only_the_agent_name_arguments_and_folder() {
        let params = spawn_params("codex", &["app-server".into()], "/srv/app", Some("Codex"));
        assert_eq!(
            params,
            json!({ "command": "codex", "args": ["app-server"], "cwd": "/srv/app", "label": "Codex" })
        );
    }
}
