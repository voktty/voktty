use super::*;
use serde_json::json;
use std::sync::atomic::AtomicUsize;
use std::sync::{mpsc, Condvar};
use std::time::{Duration, Instant};
use voktty_remote_protocol::{
    METHOD_HANDSHAKE, METHOD_MEMORY_MANAGE, METHOD_STAT, PROTOCOL_VERSION,
};

#[derive(Default)]
struct Gate {
    released: Mutex<bool>,
    changed: Condvar,
}

impl Gate {
    fn wait(&self) {
        let (_held, timeout) = self
            .changed
            .wait_timeout_while(
                self.released.lock().unwrap(),
                Duration::from_secs(15),
                |value| !*value,
            )
            .unwrap();
        assert!(!timeout.timed_out(), "test gate was not released");
    }
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.changed.notify_all();
    }
}

struct Release(Arc<Gate>);
impl Drop for Release {
    fn drop(&mut self) {
        self.0.release();
    }
}

#[derive(Default)]
struct Observed {
    calls: Mutex<Vec<(String, PathBuf)>>,
    controls: Mutex<Vec<DiscoveryControl>>,
    resets: AtomicUsize,
    drops: AtomicUsize,
}

struct Fake {
    observed: Arc<Observed>,
    gate: Arc<Gate>,
    started: mpsc::Sender<String>,
}
impl Processor for Fake {
    fn reset(&mut self) {
        self.observed.resets.fetch_add(1, Ordering::SeqCst);
    }
    fn process(
        &mut self,
        root: &Path,
        request: RemoteRequest,
        control: &DiscoveryControl,
    ) -> RemoteResponse {
        self.observed
            .calls
            .lock()
            .unwrap()
            .push((request.id.clone(), root.into()));
        self.observed.controls.lock().unwrap().push(control.clone());
        let _ = self.started.send(request.id.clone());
        if request.id == "blocked" {
            self.gate.wait();
        }
        assert_ne!(request.id, "panic", "test processor failure");
        RemoteResponse::success(
            request.id,
            json!({"schema":1,"ok":true,"result":{"root":root}}),
        )
    }
}
impl Drop for Fake {
    fn drop(&mut self) {
        self.observed.drops.fetch_add(1, Ordering::SeqCst);
    }
}

fn fixture(gate: Arc<Gate>) -> (MemoryHost, Arc<Observed>, mpsc::Receiver<String>) {
    let observed = Arc::new(Observed::default());
    let (started, events) = mpsc::channel();
    (
        MemoryHost::new(Box::new(Fake {
            observed: observed.clone(),
            gate,
            started,
        })),
        observed,
        events,
    )
}

fn request(id: &str, operation: &str) -> RemoteRequest {
    RemoteRequest {
        id: id.into(),
        protocol: PROTOCOL_VERSION,
        method: METHOD_MEMORY_MANAGE.into(),
        params: json!({"operation":operation}),
    }
}

fn responses() -> (FrameSink, mpsc::Receiver<RemoteResponse>) {
    let (sender, receiver) = mpsc::channel();
    (
        Arc::new(move |frame| {
            let Frame::Response(response) = frame else {
                return Err(std::io::Error::other("expected response"));
            };
            sender
                .send(response)
                .map_err(|_| std::io::Error::other("test receiver closed"))
        }),
        receiver,
    )
}

fn empty(shared: &Shared) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !shared.pending.lock().unwrap().is_empty() {
        assert!(Instant::now() < deadline, "memory work did not settle");
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn unused_or_invalid_requests_start_no_worker() {
    let (sink, _) = responses();
    let (mut host, observed, _) = fixture(Arc::new(Gate::default()));
    assert!(host.worker.is_none());
    assert_eq!(
        host.submit(None, request("no-root", "open"), sink.clone())
            .unwrap()
            .error
            .unwrap()
            .code,
        "handshake_required"
    );
    let mut oversized = request("oversized", "open");
    oversized.params["extra"] = json!("x".repeat(MAX_REQUEST_BYTES));
    assert_eq!(
        host.submit(Some("/srv/project".into()), oversized, sink)
            .unwrap()
            .error
            .unwrap()
            .code,
        "limit"
    );
    assert!(host.worker.is_none());
    assert!(observed.calls.lock().unwrap().is_empty());
    drop(host);
    assert_eq!(observed.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn memory_work_does_not_block_an_authenticated_filesystem_request_on_the_protocol_owner() {
    let gate = Arc::new(Gate::default());
    let (sink, output) = responses();
    let (host, _, started) = fixture(gate.clone());
    let mut server = crate::RemoteServer::new();
    server.memory = host;
    let release = Release(gate);
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("note.txt"), "hello").unwrap();
    assert!(
        server
            .handle(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: "auth".into(),
                method: METHOD_HANDSHAKE.into(),
                params: json!({"workspaceRoot":project.path()})
            })
            .ok
    );
    assert!(server
        .start_memory(request("blocked", "open"), sink)
        .is_none());
    assert_eq!(
        started.recv_timeout(Duration::from_secs(3)).unwrap(),
        "blocked"
    );
    let reply = server.handle(RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: "stat".into(),
        method: METHOD_STAT.into(),
        params: json!({"path":"note.txt"}),
    });
    assert!(reply.ok);
    assert_eq!(reply.result.unwrap()["size"], 5);
    assert!(output.try_recv().is_err());
    drop(release);
    assert!(output.recv_timeout(Duration::from_secs(3)).unwrap().ok);
}

#[test]
fn running_queued_and_sending_work_stays_charged_after_reset_until_actual_settlement() {
    let output_gate = Arc::new(Gate::default());
    let (output_started, observed_output) = mpsc::channel();
    let (delivered, output) = mpsc::channel();
    let blocked_output = output_gate.clone();
    let sink: FrameSink = Arc::new(move |frame| {
        let Frame::Response(response) = frame else {
            panic!("expected response");
        };
        if response.id == "first" {
            output_started.send(()).unwrap();
            blocked_output.wait();
        }
        delivered
            .send(response)
            .map_err(|_| std::io::Error::other("test receiver closed"))
    });
    let (mut host, observed, _) = fixture(Arc::new(Gate::default()));
    let release = Release(output_gate);
    assert!(host
        .submit(
            Some("/srv/original".into()),
            request("first", "open"),
            sink.clone()
        )
        .is_none());
    observed_output
        .recv_timeout(Duration::from_secs(3))
        .unwrap();
    for index in 1..MAX_PENDING {
        assert!(host
            .submit(
                Some("/srv/original".into()),
                request(&format!("queued-{index}"), "open"),
                sink.clone()
            )
            .is_none());
    }
    assert_eq!(host.shared.pending.lock().unwrap().len(), MAX_PENDING);
    host.reset();
    assert_eq!(host.shared.pending.lock().unwrap().len(), MAX_PENDING);
    assert_eq!(
        host.submit(
            Some("/srv/new".into()),
            request("overflow", "open"),
            sink.clone()
        )
        .unwrap()
        .error
        .unwrap()
        .code,
        "busy"
    );
    drop(release);
    assert!(output.recv_timeout(Duration::from_secs(3)).unwrap().ok);
    for _ in 1..MAX_PENDING {
        assert_eq!(
            output
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .error
                .unwrap()
                .code,
            "cancelled"
        );
    }
    empty(&host.shared);
    assert!(host
        .submit(
            Some("/srv/new".into()),
            request("replacement", "open"),
            sink
        )
        .is_none());
    assert!(output.recv_timeout(Duration::from_secs(3)).unwrap().ok);
    empty(&host.shared);
    assert_eq!(
        *observed.calls.lock().unwrap(),
        vec![
            ("first".into(), "/srv/original".into()),
            ("replacement".into(), "/srv/new".into())
        ]
    );
}

#[test]
fn rehandshake_cancels_original_control_and_rejects_old_results_and_queued_reads() {
    let gate = Arc::new(Gate::default());
    let (sink, output) = responses();
    let (mut host, observed, started) = fixture(gate.clone());
    let release = Release(gate);
    assert!(host
        .submit(
            Some("/srv/original".into()),
            request("blocked", "open"),
            sink.clone()
        )
        .is_none());
    started.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(host
        .submit(
            Some("/srv/original".into()),
            request("obsolete", "open"),
            sink.clone()
        )
        .is_none());
    host.reset();
    assert!(matches!(
        observed.controls.lock().unwrap()[0].read_control(),
        Err(voktty_memory_local::ReadError::Cancelled)
    ));
    assert!(host
        .submit(
            Some("/srv/replacement".into()),
            request("new", "open"),
            sink
        )
        .is_none());
    drop(release);
    for _ in 0..2 {
        assert_eq!(
            output
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .error
                .unwrap()
                .code,
            "cancelled"
        );
    }
    let current = output.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(current.id, "new");
    assert_eq!(
        current.result.unwrap()["result"]["root"],
        "/srv/replacement"
    );
    empty(&host.shared);
    assert_eq!(observed.calls.lock().unwrap().len(), 2);
    assert!(observed.resets.load(Ordering::SeqCst) > 0);
}

#[test]
fn shutdown_waits_for_cancelled_running_work_and_drains_queued_work_without_execution() {
    let gate = Arc::new(Gate::default());
    let (sink, _output) = responses();
    let (mut host, observed, started) = fixture(gate.clone());
    let release = Release(gate);
    let shared = host.shared.clone();
    assert!(host
        .submit(
            Some("/srv/project".into()),
            request("blocked", "open"),
            sink.clone()
        )
        .is_none());
    started.recv_timeout(Duration::from_secs(3)).unwrap();
    for index in 1..MAX_PENDING {
        assert!(host
            .submit(
                Some("/srv/project".into()),
                request(&index.to_string(), "open"),
                sink.clone()
            )
            .is_none());
    }
    let (done, completion) = mpsc::channel();
    let closer = std::thread::spawn(move || {
        drop(host);
        done.send(()).unwrap();
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while !shared.closed.load(Ordering::Acquire) {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    assert!(completion.recv_timeout(Duration::from_millis(20)).is_err());
    assert_eq!(shared.pending.lock().unwrap().len(), MAX_PENDING);
    assert_eq!(observed.drops.load(Ordering::SeqCst), 0);
    drop(release);
    completion.recv_timeout(Duration::from_secs(3)).unwrap();
    closer.join().unwrap();
    assert!(shared.pending.lock().unwrap().is_empty());
    assert_eq!(observed.calls.lock().unwrap().len(), 1);
    assert_eq!(observed.drops.load(Ordering::SeqCst), 1);
}

#[test]
fn worker_panic_keeps_a_failure_barrier_until_the_helper_is_replaced() {
    let (sink, output) = responses();
    let (mut host, observed, _) = fixture(Arc::new(Gate::default()));
    assert!(host
        .submit(
            Some("/srv/project".into()),
            request("panic", "open"),
            sink.clone()
        )
        .is_none());
    assert_eq!(
        output
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .error
            .unwrap()
            .code,
        "unavailable"
    );
    empty(&host.shared);
    host.reset();
    assert_eq!(
        host.submit(Some("/srv/project".into()), request("retry", "open"), sink)
            .unwrap()
            .error
            .unwrap()
            .code,
        "unavailable"
    );
    assert_eq!(observed.calls.lock().unwrap().len(), 1);
}

#[test]
fn failed_output_cancels_queued_work_without_recycling_the_worker() {
    let gate = Arc::new(Gate::default());
    let (started_output, observed_output) = mpsc::channel();
    let blocked_output = gate.clone();
    let sink: FrameSink = Arc::new(move |_| {
        started_output.send(()).unwrap();
        blocked_output.wait();
        Err(std::io::Error::other("test output failed"))
    });
    let (mut host, observed, _) = fixture(Arc::new(Gate::default()));
    let release = Release(gate);
    assert!(host
        .submit(
            Some("/srv/project".into()),
            request("first", "open"),
            sink.clone()
        )
        .is_none());
    observed_output
        .recv_timeout(Duration::from_secs(3))
        .unwrap();
    for index in 1..MAX_PENDING {
        assert!(host
            .submit(
                Some("/srv/project".into()),
                request(&index.to_string(), "open"),
                sink.clone()
            )
            .is_none());
    }
    drop(release);
    empty(&host.shared);
    assert_eq!(
        host.submit(Some("/srv/project".into()), request("retry", "open"), sink)
            .unwrap()
            .error
            .unwrap()
            .code,
        "unavailable"
    );
    assert_eq!(observed.calls.lock().unwrap().len(), 1);
}

#[test]
fn queued_inspection_uses_its_original_five_second_deadline_and_starts_no_late_reads() {
    let gate = Arc::new(Gate::default());
    let (sink, output) = responses();
    let (mut host, observed, started) = fixture(gate.clone());
    let release = Release(gate);
    assert!(host
        .submit(
            Some("/srv/project".into()),
            request("blocked", "open"),
            sink.clone()
        )
        .is_none());
    started.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(host
        .submit(
            Some("/srv/project".into()),
            request("expired", "inspect"),
            sink
        )
        .is_none());
    std::thread::sleep(Duration::from_millis(5100));
    drop(release);
    assert!(output.recv_timeout(Duration::from_secs(3)).unwrap().ok);
    let expired = output.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(expired.id, "expired");
    assert_eq!(expired.error.unwrap().code, "timeout");
    empty(&host.shared);
    assert_eq!(observed.calls.lock().unwrap().len(), 1);
}
