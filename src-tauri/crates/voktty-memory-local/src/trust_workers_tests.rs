use super::*;
use crate::{MemoryPolicy, ReadControl};
use serde_json::json;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Condvar, Mutex};
use tokio::runtime::{Builder, Runtime};
use voktty_workspace_kit::render_template;

struct Access {
    root: PathBuf,
    retired: AtomicBool,
    metadata_only: AtomicBool,
    incomplete: AtomicBool,
    reads: AtomicUsize,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        !self.retired.load(Ordering::Acquire)
            && (path.starts_with(&self.root)
                || (!self.incomplete.load(Ordering::Acquire)
                    && self
                        .root
                        .ancestors()
                        .any(|parent| path == parent || path.starts_with(parent.join(".voktty")))))
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        !self.retired.load(Ordering::Acquire)
            && if self.metadata_only.load(Ordering::Acquire) {
                path.starts_with(self.root.join("src"))
            } else {
                path.starts_with(&self.root)
            }
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.fetch_add(1, Ordering::Relaxed);
        !self.retired.load(Ordering::Acquire)
            && (self.allows_workspace_root(path)
                || self
                    .root
                    .ancestors()
                    .any(|parent| path == parent.join(".voktty/kit.json")))
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.allows_metadata(path)
    }
}
struct Fixture {
    project: tempfile::TempDir,
    state: tempfile::TempDir,
    store: Arc<LocalMemoryStore>,
    access: Arc<Access>,
}
fn populate(root: &Path) {
    let inputs = json!({"project_name":"Trust review", "created_at":"2026-10-29"});
    for file in render_template(inputs.as_object().unwrap()).unwrap() {
        if !file.path.starts_with(".voktty/") {
            continue;
        }
        let path = root.join(file.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, file.text).unwrap();
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
        root: project.path().to_owned(),
        retired: AtomicBool::new(false),
        metadata_only: AtomicBool::new(false),
        incomplete: AtomicBool::new(false),
        reads: AtomicUsize::new(0),
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
fn start_review(f: &Fixture, workers: &MemoryWorkers) -> MemoryTrustJob<MemoryTrustReview> {
    workers
        .review_trust(
            f.store.clone(),
            f.project.path().join("src"),
            f.access.clone(),
            None,
            DiscoveryControl::default(),
        )
        .unwrap()
}
fn state_bytes(f: &Fixture) -> Vec<u8> {
    fs::read(f.state.path().join("memory-local.json")).unwrap()
}

#[test]
fn review_resolves_parent_without_writes_and_acceptance_preserves_never_policy() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let first = start_review(&f, &workers).finish().await.unwrap();
        let key = first.observation().project_key.clone();
        f.store.set_policy(0, &key, MemoryPolicy::Never).unwrap();
        let before = state_bytes(&f);
        let review = start_review(&f, &workers).finish().await.unwrap();
        assert_eq!(review.root(), f.project.path());
        assert_eq!(review.observation().local_preferences.revision(), 1);
        assert_eq!(state_bytes(&f), before);
        let digest = review.observation().fingerprint.digest.clone();
        let snapshot = workers
            .accept_trust(review, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(snapshot.revision(), 2);
        let preference = snapshot.project(&key).unwrap();
        assert_eq!(preference.policy, MemoryPolicy::Never);
        assert_eq!(
            preference.instruction_digest.as_deref(),
            Some(digest.as_str())
        );
        assert_eq!(fs::read_dir(f.state.path()).unwrap().count(), 2);
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
    });
}

#[test]
fn changed_instructions_links_roles_config_and_preferences_reject_original_acceptance() {
    for change in 0..6 {
        let f = fixture();
        fs::write(
            f.project.path().join(".voktty/team/roles/planner.md"),
            "Assigned custom planner role",
        )
        .unwrap();
        runtime().block_on(async {
            let workers = workers();
            let review = workers
                .review_trust(
                    f.store.clone(),
                    f.project.path().join("src"),
                    f.access.clone(),
                    Some(".voktty/team/roles/planner.md".into()),
                    DiscoveryControl::default(),
                )
                .unwrap()
                .finish()
                .await
                .unwrap();
            match change {
                0 => fs::write(
                    f.project.path().join(".voktty/INIT.md"),
                    "Changed instructions",
                )
                .unwrap(),
                1 => fs::write(f.project.path().join("AGENTS.md"), "Changed root rules").unwrap(),
                2 => fs::write(
                    f.project.path().join(".voktty/team/roles/planner.md"),
                    "Changed role",
                )
                .unwrap(),
                3 => {
                    let path = f.project.path().join(".voktty/kit.json");
                    let mut value: serde_json::Value =
                        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                    value["project"] = json!("Changed project");
                    value["values"]["project_name"] = json!("Changed project");
                    fs::write(path, value.to_string()).unwrap();
                }
                4 => {
                    f.store
                        .set_policy(0, &review.observation().project_key, MemoryPolicy::Never)
                        .unwrap();
                }
                _ => {
                    f.store
                        .set_policy(0, &"b".repeat(64), MemoryPolicy::Always)
                        .unwrap();
                }
            }
            let before = state_bytes(&f);
            let result = workers
                .accept_trust(review, DiscoveryControl::default())
                .unwrap()
                .finish()
                .await;
            assert!(
                matches!(result, Err(MemoryTrustError::Changed)),
                "change {change}: {result:?}"
            );
            assert_eq!(state_bytes(&f), before);
        });
    }
}

#[test]
fn factual_edits_do_not_accept_new_instructions_or_enable_a_manual_session() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let review = start_review(&f, &workers).finish().await.unwrap();
        let key = review.observation().project_key.clone();
        fs::write(
            f.project.path().join(".voktty/CONTEXT.md"),
            "New factual context",
        )
        .unwrap();
        let snapshot = workers
            .accept_trust(review, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(snapshot.project(&key).unwrap().policy, MemoryPolicy::Manual);
        assert_eq!(
            fs::read_to_string(f.project.path().join(".voktty/CONTEXT.md")).unwrap(),
            "New factual context"
        );
        let value = serde_json::to_value(snapshot).unwrap();
        assert!(value.get("session").is_none());
        assert!(value.get("capture").is_none());
    });
}

#[test]
fn metadata_only_ancestor_inspection_and_incomplete_ancestry_never_grant_trust() {
    for metadata_only in [false, true] {
        let f = fixture();
        f.access
            .metadata_only
            .store(metadata_only, Ordering::Release);
        f.access.incomplete.store(!metadata_only, Ordering::Release);
        let before = state_bytes(&f);
        runtime().block_on(async {
            let error = start_review(&f, &workers()).finish().await;
            if metadata_only {
                assert!(matches!(
                    error,
                    Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                        ReadError::Denied
                    )))
                ));
            } else {
                assert!(matches!(error, Err(MemoryTrustError::ScopeUnavailable)));
            }
        });
        assert_eq!(state_bytes(&f), before);
    }
}

#[test]
fn new_nested_kit_blocks_the_original_review_without_writing_trust() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let review = start_review(&f, &workers).finish().await.unwrap();
        populate(&f.project.path().join("src"));
        let before = state_bytes(&f);
        assert!(matches!(
            workers
                .accept_trust(review, DiscoveryControl::default())
                .unwrap()
                .finish()
                .await,
            Err(MemoryTrustError::ScopeUnavailable)
        ));
        assert_eq!(state_bytes(&f), before);
    });
}

#[test]
fn retired_authority_replaced_root_and_new_installation_reject_acceptance() {
    for change in 0..3 {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            let review = start_review(&f, &workers).finish().await.unwrap();
            let moved = f.project.path().join("src-old");
            let expected = match change {
                0 => { f.access.retired.store(true, Ordering::Release); ReadError::Denied }
                1 => {
                    fs::rename(f.project.path().join("src"), &moved).unwrap();
                    fs::create_dir(f.project.path().join("src")).unwrap();
                    ReadError::StaleRoot
                }
                _ => {
                    fs::remove_file(f.state.path().join("memory-local.json")).unwrap();
                    f.store.initialize().unwrap();
                    ReadError::StaleInstallation
                }
            };
            let before = state_bytes(&f);
            assert!(matches!(workers.accept_trust(review, DiscoveryControl::default())
                .unwrap().finish().await, Err(MemoryTrustError::Worker(MemoryWorkError::Read(actual))) if actual == expected));
            assert_eq!(state_bytes(&f), before);
        });
    }
}

#[test]
fn expired_review_and_queued_cancellation_do_not_mutate_preferences() {
    let f = fixture();
    let runtime = Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let workers = workers();
        let mut review = start_review(&f, &workers).finish().await.unwrap();
        review.expires = Instant::now();
        let before = state_bytes(&f);
        assert!(matches!(
            workers
                .accept_trust(review, DiscoveryControl::default())
                .unwrap()
                .finish()
                .await,
            Err(MemoryTrustError::Changed)
        ));
        let review = start_review(&f, &workers).finish().await.unwrap();
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
            .accept_trust(review, DiscoveryControl::default())
            .unwrap();
        drop(job);
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        blocker.await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while workers.active.load(Ordering::Acquire) != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(state_bytes(&f), before);
    });
}

#[test]
fn ready_review_holds_shared_capacity_and_retired_delivery_is_rejected() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let control = DiscoveryControl::default();
        let job = workers
            .review_trust(
                f.store.clone(),
                f.project.path().join("src"),
                f.access.clone(),
                None,
                control.clone(),
            )
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while job.job.receiver.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        let mut occupied = Vec::new();
        for _ in 0..3 {
            occupied.push(
                workers
                    .spawn(Control::Read(ReadControl::default()), || Ok(()))
                    .unwrap(),
            );
        }
        assert!(matches!(
            workers.review_trust(
                f.store.clone(),
                f.project.path().join("src"),
                f.access.clone(),
                None,
                DiscoveryControl::default()
            ),
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                ReadError::Busy
            )))
        ));
        control.cancel();
        assert!(matches!(
            job.finish().await,
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(
                ReadError::Cancelled
            )))
        ));
        for job in occupied {
            job.finish().await.unwrap();
        }
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
        assert_eq!(f.store.load().unwrap().revision(), 0);
    });
}

#[test]
fn missing_runtime_invalid_role_and_cancelled_requests_do_not_enter_io() {
    let f = fixture();
    let workers = workers();
    assert!(matches!(
        workers.review_trust(
            f.store.clone(),
            f.project.path().join("src"),
            f.access.clone(),
            None,
            DiscoveryControl::default()
        ),
        Err(MemoryTrustError::Worker(
            MemoryWorkError::RuntimeUnavailable
        ))
    ));
    for (path, role, control, expected) in [
        (
            PathBuf::from("relative"),
            None,
            DiscoveryControl::default(),
            ReadError::InvalidInput,
        ),
        (
            f.project.path().join("src"),
            Some("x".repeat(257)),
            DiscoveryControl::default(),
            ReadError::Limit,
        ),
        (
            f.project.path().join("src"),
            None,
            DiscoveryControl::new(Duration::ZERO),
            ReadError::Timeout,
        ),
    ] {
        assert!(
            matches!(workers.review_trust(f.store.clone(), path, f.access.clone(), role, control),
            Err(MemoryTrustError::Worker(MemoryWorkError::Read(actual))) if actual == expected)
        );
    }
    assert_eq!(f.access.reads.load(Ordering::Acquire), 0);
    assert_eq!(f.store.load().unwrap().revision(), 0);
}
