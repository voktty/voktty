use super::*;
use crate::{MemoryPolicy, ReadControl};
use std::fs;
use std::sync::{mpsc, Condvar, Mutex};
use tokio::runtime::{Builder, Runtime};
use voktty_workspace_kit::render_template;

struct Access {
    root: PathBuf,
    retired: AtomicBool,
    instruction_reads: AtomicUsize,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        !self.retired.load(Ordering::Acquire)
            && (path.starts_with(&self.root)
                || self
                    .root
                    .ancestors()
                    .any(|parent| path == parent || path.starts_with(parent.join(".voktty"))))
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        !self.retired.load(Ordering::Acquire) && path.starts_with(&self.root)
    }
    fn allows_read(&self, path: &Path) -> bool {
        if path.ends_with(".voktty/INIT.md") {
            self.instruction_reads.fetch_add(1, Ordering::AcqRel);
        }
        self.allows_metadata(path)
            && (path.starts_with(&self.root)
                || self
                    .root
                    .ancestors()
                    .any(|parent| path == parent.join(".voktty/kit.json")))
    }
}
struct Fixture {
    project: tempfile::TempDir,
    state: tempfile::TempDir,
    store: Arc<LocalMemoryStore>,
    access: Arc<Access>,
}
fn populate(root: &Path) {
    let values = json!({"project_name":"Context binding", "created_at":"2026-10-30"});
    for file in render_template(values.as_object().unwrap()).unwrap() {
        if file.path.starts_with(".voktty/") {
            let path = root.join(file.path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, file.text).unwrap();
        }
    }
}
fn fixture() -> Fixture {
    use std::os::unix::fs::PermissionsExt;
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let state = tempfile::tempdir().unwrap();
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = Arc::new(LocalMemoryStore::open(state.path()).unwrap());
    store.initialize().unwrap();
    populate(project.path());
    fs::create_dir(project.path().join("src")).unwrap();
    let access = Arc::new(Access {
        root: project.path().into(),
        retired: AtomicBool::new(false),
        instruction_reads: AtomicUsize::new(0),
    });
    Fixture {
        project,
        state,
        store,
        access,
    }
}
fn workers() -> MemoryWorkers {
    MemoryWorkers {
        active: Arc::new(AtomicUsize::new(0)),
    }
}
fn runtime() -> Runtime {
    Builder::new_current_thread().enable_time().build().unwrap()
}
async fn review(f: &Fixture, workers: &MemoryWorkers) -> MemoryTrustReview {
    workers
        .review_trust(
            f.store.clone(),
            f.project.path().join("src"),
            f.access.clone(),
            None,
            DiscoveryControl::default(),
        )
        .unwrap()
        .finish()
        .await
        .unwrap()
}
async fn trust(f: &Fixture, workers: &MemoryWorkers) {
    workers
        .accept_trust(review(f, workers).await, DiscoveryControl::default())
        .unwrap()
        .finish()
        .await
        .unwrap();
}
fn policy(f: &Fixture, policy: MemoryPolicy) {
    let workspace = LocalMemoryWorkspace::open(
        &f.store,
        f.project.path(),
        f.access.as_ref(),
        &ReadControl::default(),
    )
    .unwrap();
    workspace
        .set_policy(
            f.store.load().unwrap().revision(),
            policy,
            &ReadControl::default(),
        )
        .unwrap();
}
async fn bind(
    f: &Fixture,
    workers: &MemoryWorkers,
    choice: MemorySessionUse,
) -> MemoryContextSession {
    workers
        .bind_context_session(
            review(f, workers).await,
            choice,
            DiscoveryControl::default(),
        )
        .unwrap()
        .finish()
        .await
        .unwrap()
}
async fn read(
    workers: &MemoryWorkers,
    session: &MemoryContextSession,
) -> Result<MemoryContextResult, MemoryTrustError> {
    workers
        .session_context(session, DiscoveryControl::default())?
        .finish()
        .await
}
fn bytes(f: &Fixture) -> Vec<u8> {
    fs::read(f.state.path().join("memory-local.json")).unwrap()
}

#[test]
fn native_context_applies_manual_always_never_and_explicit_session_disable_without_writes() {
    for (local, choice, expected) in [
        (
            MemoryPolicy::Manual,
            MemorySessionUse::Inherit,
            "KIT_MEMORY_CONSENT_REQUIRED",
        ),
        (
            MemoryPolicy::Manual,
            MemorySessionUse::Enabled,
            "KIT_MEMORY_READY",
        ),
        (
            MemoryPolicy::Always,
            MemorySessionUse::Inherit,
            "KIT_MEMORY_READY",
        ),
        (
            MemoryPolicy::Always,
            MemorySessionUse::Disabled,
            "KIT_MEMORY_SESSION_DISABLED",
        ),
        (
            MemoryPolicy::Never,
            MemorySessionUse::Enabled,
            "KIT_MEMORY_POLICY_NEVER",
        ),
    ] {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            trust(&f, &workers).await;
            policy(&f, local);
            let before = bytes(&f);
            let session = bind(&f, &workers, choice).await;
            assert_eq!(session.root(), f.project.path());
            f.access.instruction_reads.store(0, Ordering::Release);
            let result = read(&workers, &session).await.unwrap();
            assert_eq!(result.decision.reason, expected);
            assert!(!result.decision.capture_allowed);
            assert_eq!(result.packet.is_some(), expected == "KIT_MEMORY_READY");
            if let Some(packet) = result.packet {
                assert!(packet.bytes <= 24 * 1024);
                assert_eq!(packet.bytes, packet.text.len());
                assert!(packet.text.contains("Context binding"));
                assert!(packet.text.contains(".voktty/INIT.md"));
                assert_eq!(packet.content_state, "initial");
            } else {
                assert_eq!(f.access.instruction_reads.load(Ordering::Acquire), 0);
            }
            assert_eq!(bytes(&f), before);
            assert_eq!(workers.active.load(Ordering::Acquire), 0);
        });
    }
}

#[test]
fn binding_and_reading_never_trust_unaccepted_instructions() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let before = bytes(&f);
        let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
        let result = read(&workers, &session).await.unwrap();
        assert_eq!(result.decision.reason, "KIT_MEMORY_TRUST_REQUIRED");
        assert!(result.packet.is_none());
        assert_eq!(bytes(&f), before);
    });
}

#[test]
fn current_factual_edits_are_read_but_new_instructions_require_rebinding() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        trust(&f, &workers).await;
        let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
        fs::write(
            f.project.path().join(".voktty/PROJECT.md"),
            "Current project facts",
        )
        .unwrap();
        fs::write(
            f.project.path().join(".voktty/CONTEXT.md"),
            "Current work facts",
        )
        .unwrap();
        let packet = read(&workers, &session).await.unwrap().packet.unwrap();
        assert!(packet.text.contains("Current work facts"));
        assert_eq!(packet.content_state, "available");
        fs::write(
            f.project.path().join(".voktty/INIT.md"),
            "Changed instructions",
        )
        .unwrap();
        let result = read(&workers, &session).await.unwrap();
        assert_eq!(result.decision.reason, "KIT_MEMORY_INSTRUCTIONS_CHANGED");
        assert!(result.packet.is_none());
        trust(&f, &workers).await;
        let result = read(&workers, &session).await.unwrap();
        assert_eq!(result.decision.reason, "KIT_MEMORY_INSTRUCTIONS_CHANGED");
        assert!(result.packet.is_none());
        let replacement = bind(&f, &workers, MemorySessionUse::Enabled).await;
        assert!(read(&workers, &replacement).await.unwrap().packet.is_some());
    });
}

#[test]
fn policy_and_trust_revocation_are_rechecked_on_each_context_read() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        trust(&f, &workers).await;
        let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
        assert!(read(&workers, &session).await.unwrap().packet.is_some());
        policy(&f, MemoryPolicy::Never);
        assert_eq!(
            read(&workers, &session).await.unwrap().decision.reason,
            "KIT_MEMORY_POLICY_NEVER"
        );
        policy(&f, MemoryPolicy::Manual);
        let workspace = LocalMemoryWorkspace::open(
            &f.store,
            f.project.path(),
            f.access.as_ref(),
            &ReadControl::default(),
        )
        .unwrap();
        let key = workspace.project_key();
        f.store
            .revoke_trust(f.store.load().unwrap().revision(), key)
            .unwrap();
        assert_eq!(
            read(&workers, &session).await.unwrap().decision.reason,
            "KIT_MEMORY_TRUST_REQUIRED"
        );
    });
}

#[test]
fn changed_review_and_expired_review_cannot_bind_context() {
    for change in 0..3 {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            let mut reviewed = review(&f, &workers).await;
            match change {
                0 => reviewed.expires = Instant::now(),
                1 => fs::write(f.project.path().join(".voktty/INIT.md"), "Changed").unwrap(),
                _ => policy(&f, MemoryPolicy::Never),
            }
            let before = bytes(&f);
            assert!(matches!(
                workers
                    .bind_context_session(
                        reviewed,
                        MemorySessionUse::Enabled,
                        DiscoveryControl::default()
                    )
                    .unwrap()
                    .finish()
                    .await,
                Err(MemoryTrustError::Changed)
            ));
            assert_eq!(bytes(&f), before);
        });
    }
}

#[test]
fn new_nested_kit_or_replaced_execution_root_never_redirects_a_bound_session() {
    for replace in [false, true] {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            trust(&f, &workers).await;
            let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
            if replace {
                fs::rename(
                    f.project.path().join("src"),
                    f.project.path().join("old-src"),
                )
                .unwrap();
                fs::create_dir(f.project.path().join("src")).unwrap();
            } else {
                populate(&f.project.path().join("src"));
            }
            assert!(read(&workers, &session).await.is_err());
        });
    }
}

#[test]
fn retirement_blocks_unconsumed_results_without_retiring_an_independent_binding() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        trust(&f, &workers).await;
        let old = bind(&f, &workers, MemorySessionUse::Enabled).await;
        let replacement = bind(&f, &workers, MemorySessionUse::Enabled).await;
        let job = workers
            .session_context(&old, DiscoveryControl::default())
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while job.job.receiver.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        old.retire();
        assert!(matches!(
            job.finish().await,
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                ReadError::Cancelled
            )))
        ));
        assert!(workers
            .session_context(&old, DiscoveryControl::default())
            .is_err());
        drop(old);
        assert!(read(&workers, &replacement).await.unwrap().packet.is_some());
    });
}

#[test]
fn pending_retired_context_retains_binding_capacity_until_actual_settlement() {
    let f = fixture();
    let runtime = Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let workers = workers();
        trust(&f, &workers).await;
        let budget = Arc::new(AtomicUsize::new(0));
        let session = workers
            .bind_context_with_budget(
                review(&f, &workers).await,
                MemorySessionUse::Enabled,
                DiscoveryControl::default(),
                budget.clone(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let held = gate.clone();
        let (started, observed) = mpsc::channel();
        let blocker = tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            let (locked, timeout) = held
                .1
                .wait_timeout_while(held.0.lock().unwrap(), Duration::from_secs(3), |released| {
                    !*released
                })
                .unwrap();
            assert!(*locked && !timeout.timed_out());
        });
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let job = workers
            .session_context(&session, DiscoveryControl::default())
            .unwrap();
        drop(session);
        assert_eq!(budget.load(Ordering::Acquire), 1);
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        blocker.await.unwrap();
        assert!(job.finish().await.is_err());
        assert_eq!(budget.load(Ordering::Acquire), 0);
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
    });
}

#[test]
fn binding_budget_is_bounded_and_never_evicts_a_live_owner() {
    let budget = Arc::new(AtomicUsize::new(0));
    let mut slots = Vec::new();
    for _ in 0..MAX_SESSIONS {
        slots.push(SessionSlot::acquire(budget.clone()).unwrap());
    }
    assert!(matches!(
        SessionSlot::acquire(budget.clone()),
        Err(ReadError::Limit)
    ));
    slots.pop();
    let slot = SessionSlot::acquire(budget.clone()).unwrap();
    assert_eq!(budget.load(Ordering::Acquire), MAX_SESSIONS);
    drop(slot);
    drop(slots);
    assert_eq!(budget.load(Ordering::Acquire), 0);
}

#[test]
fn changed_authority_installation_and_configuration_prevent_context_preparation() {
    for change in 0..3 {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            trust(&f, &workers).await;
            let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
            match change {
                0 => f.access.retired.store(true, Ordering::Release),
                1 => {
                    fs::remove_file(f.state.path().join("memory-local.json")).unwrap();
                    f.store.initialize().unwrap();
                }
                _ => {
                    let path = f.project.path().join(".voktty/kit.json");
                    let mut config: Value =
                        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                    config["project"] = json!("Changed project");
                    config["values"]["project_name"] = json!("Changed project");
                    fs::write(path, config.to_string()).unwrap();
                }
            }
            assert!(read(&workers, &session).await.is_err());
        });
    }
}

#[test]
fn large_native_documents_produce_a_bounded_utf8_packet_with_instruction_pointers() {
    let f = fixture();
    fs::write(
        f.project.path().join(".voktty/INIT.md"),
        "a".repeat(100 * 1024),
    )
    .unwrap();
    fs::write(
        f.project.path().join(".voktty/PROJECT.md"),
        "é".repeat(60_000),
    )
    .unwrap();
    fs::write(
        f.project.path().join(".voktty/CONTEXT.md"),
        "仕事".repeat(20_000),
    )
    .unwrap();
    runtime().block_on(async {
        let workers = workers();
        trust(&f, &workers).await;
        let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
        let packet = read(&workers, &session).await.unwrap().packet.unwrap();
        assert!(packet.bytes <= 24 * 1024);
        assert_eq!(packet.bytes, packet.text.len());
        assert!(packet
            .text
            .contains(".voktty/INIT.md\",\"mode\":\"pointer\""));
        assert!(packet.text.contains("é"));
        assert!(packet.text.contains("仕事"));
    });
}

#[test]
fn a_late_instruction_symlink_never_reads_an_external_document_into_the_packet() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        trust(&f, &workers).await;
        let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
        let outside = f.state.path().join("external.md");
        fs::write(&outside, "External private fixture").unwrap();
        let target = f.project.path().join(".voktty/INIT.md");
        fs::remove_file(&target).unwrap();
        std::os::unix::fs::symlink(outside, target).unwrap();
        assert!(read(&workers, &session).await.is_err());
    });
}

#[test]
fn read_cancellation_and_expiry_do_not_revoke_a_healthy_binding() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        trust(&f, &workers).await;
        let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
        let cancelled = DiscoveryControl::default();
        cancelled.cancel();
        for control in [cancelled, DiscoveryControl::new(Duration::ZERO)] {
            assert!(workers.session_context(&session, control).is_err());
        }
        assert!(read(&workers, &session).await.unwrap().packet.is_some());
    });
}

#[test]
fn retired_native_authority_rejects_ready_binding_and_context_delivery() {
    for binding in [false, true] {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            trust(&f, &workers).await;
            if binding {
                let job = workers
                    .bind_context_session(
                        review(&f, &workers).await,
                        MemorySessionUse::Enabled,
                        DiscoveryControl::default(),
                    )
                    .unwrap();
                tokio::time::timeout(Duration::from_secs(3), async {
                    while job.job.receiver.is_empty() {
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
                f.access.retired.store(true, Ordering::Release);
                assert!(matches!(
                    job.finish().await,
                    Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                        ReadError::Denied
                    )))
                ));
            } else {
                let session = bind(&f, &workers, MemorySessionUse::Enabled).await;
                let job = workers
                    .session_context(&session, DiscoveryControl::default())
                    .unwrap();
                tokio::time::timeout(Duration::from_secs(3), async {
                    while job.job.receiver.is_empty() {
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
                f.access.retired.store(true, Ordering::Release);
                assert!(matches!(
                    job.finish().await,
                    Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                        ReadError::Denied
                    )))
                ));
            }
        });
    }
}
