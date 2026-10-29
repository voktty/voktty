use super::*;
use crate::{ReadControl, StoreError};
use serde_json::json;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Condvar, Mutex};
use tokio::runtime::{Builder, Runtime};

const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

struct Access {
    root: PathBuf,
    retired: AtomicBool,
    incomplete: AtomicBool,
    instruction_reads: AtomicUsize,
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
        !self.retired.load(Ordering::Acquire) && path.starts_with(&self.root)
    }
    fn allows_read(&self, path: &Path) -> bool {
        if path.file_name().is_none_or(|name| name != "kit.json") {
            self.instruction_reads.fetch_add(1, Ordering::Relaxed);
            return false;
        }
        self.allows_metadata(path)
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
    for file in voktty_workspace_kit::render_template(
        json!({"project_name":"Policy", "created_at":"2026-10-29"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    {
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
        root: project.path().to_owned(),
        retired: AtomicBool::new(false),
        incomplete: AtomicBool::new(false),
        instruction_reads: AtomicUsize::new(0),
    });
    Fixture {
        project,
        state,
        store,
        access,
    }
}
fn runtime() -> Runtime {
    Builder::new_current_thread().enable_time().build().unwrap()
}
fn workers() -> MemoryWorkers {
    MemoryWorkers {
        active: Arc::new(AtomicUsize::new(0)),
    }
}
fn start(
    f: &Fixture,
    workers: &MemoryWorkers,
    policy: MemoryPolicy,
) -> MemoryPolicyJob<MemoryPolicyReview> {
    workers
        .review_policy(
            f.store.clone(),
            f.project.path().join("src"),
            f.access.clone(),
            policy,
            DiscoveryControl::default(),
        )
        .unwrap()
}
fn bytes(f: &Fixture) -> Vec<u8> {
    fs::read(f.state.path().join("memory-local.json")).unwrap()
}

#[test]
fn policy_review_is_noncreating_and_reads_no_instructions_or_factual_documents() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let before = bytes(&f);
        let review = start(&f, &workers, MemoryPolicy::Always)
            .finish()
            .await
            .unwrap();
        assert_eq!(review.root(), f.project.path());
        assert_eq!(review.policy(), MemoryPolicy::Always);
        assert_eq!(review.preference(), None);
        assert_eq!(bytes(&f), before);
        let key = review.project_key().to_owned();
        let preference = workers
            .accept_policy(review, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert_eq!(preference.project_key, key);
        assert_eq!(preference.policy, MemoryPolicy::Always);
        assert_eq!(preference.instruction_digest, None);
        assert_eq!(f.store.load().unwrap().revision(), 1);
        assert_eq!(f.access.instruction_reads.load(Ordering::Acquire), 0);
        assert_eq!(fs::read_dir(f.state.path()).unwrap().count(), 2);
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
    });
}

#[test]
fn all_explicit_policies_preserve_current_root_trust_without_enabling_a_session() {
    let f = fixture();
    let memory = LocalMemoryWorkspace::open(
        &f.store,
        f.project.path(),
        f.access.as_ref(),
        &ReadControl::default(),
    )
    .unwrap();
    memory
        .trust_instructions(0, HASH, &ReadControl::default())
        .unwrap();
    runtime().block_on(async {
        let workers = workers();
        for policy in [
            MemoryPolicy::Always,
            MemoryPolicy::Never,
            MemoryPolicy::Manual,
        ] {
            let review = start(&f, &workers, policy).finish().await.unwrap();
            assert_eq!(
                review.preference().unwrap().instruction_digest.as_deref(),
                Some(HASH)
            );
            let result = workers
                .accept_policy(review, DiscoveryControl::default())
                .unwrap()
                .finish()
                .await
                .unwrap();
            assert_eq!(result.policy, policy);
            assert_eq!(result.instruction_digest.as_deref(), Some(HASH));
        }
        let value = serde_json::to_value(f.store.load().unwrap()).unwrap();
        assert!(value.get("session").is_none());
        assert!(value.get("captures").is_none());
        assert_eq!(f.access.instruction_reads.load(Ordering::Acquire), 0);
    });
}

#[test]
fn concurrent_policy_changes_cannot_be_rebased_over_a_reviewed_choice() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let review = start(&f, &workers, MemoryPolicy::Always)
            .finish()
            .await
            .unwrap();
        f.store
            .set_policy(0, review.project_key(), MemoryPolicy::Never)
            .unwrap();
        let before = bytes(&f);
        assert_eq!(
            workers
                .accept_policy(review, DiscoveryControl::default())
                .unwrap()
                .finish()
                .await,
            Err(MemoryPolicyError::Changed)
        );
        assert_eq!(bytes(&f), before);
    });
}

#[test]
fn absent_reserved_partial_and_incomplete_scopes_cannot_reserve_policy_acceptance() {
    for state in 0..4 {
        let f = fixture();
        match state {
            0 => fs::remove_dir_all(f.project.path().join(".voktty")).unwrap(),
            1 => {
                fs::remove_dir_all(f.project.path().join(".voktty")).unwrap();
                fs::create_dir_all(f.project.path().join(".voktty/sessions")).unwrap();
            }
            2 => fs::remove_file(f.project.path().join(".voktty/kit.json")).unwrap(),
            _ => f.access.incomplete.store(true, Ordering::Release),
        }
        let before = bytes(&f);
        runtime().block_on(async {
            assert!(matches!(
                start(&f, &workers(), MemoryPolicy::Always).finish().await,
                Err(MemoryPolicyError::ScopeUnavailable)
            ));
        });
        assert_eq!(bytes(&f), before);
    }
}

#[test]
fn retired_authority_replaced_origin_and_replaced_installation_cannot_write_policy() {
    for change in 0..3 {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            let review = start(&f, &workers, MemoryPolicy::Always)
                .finish()
                .await
                .unwrap();
            let expected = match change {
                0 => {
                    f.access.retired.store(true, Ordering::Release);
                    ReadError::Denied
                }
                1 => {
                    fs::rename(
                        f.project.path().join("src"),
                        f.project.path().join("old-src"),
                    )
                    .unwrap();
                    fs::create_dir(f.project.path().join("src")).unwrap();
                    ReadError::StaleRoot
                }
                _ => {
                    fs::remove_file(f.state.path().join("memory-local.json")).unwrap();
                    f.store.initialize().unwrap();
                    ReadError::StaleInstallation
                }
            };
            let before = bytes(&f);
            assert_eq!(
                workers
                    .accept_policy(review, DiscoveryControl::default())
                    .unwrap()
                    .finish()
                    .await,
                Err(MemoryPolicyError::Worker(MemoryWorkError::Read(expected)))
            );
            assert_eq!(bytes(&f), before);
        });
    }
}

#[test]
fn scope_changes_and_expiry_consume_the_original_choice_without_mutation() {
    for change in 0..3 {
        let f = fixture();
        runtime().block_on(async {
            let workers = workers();
            let mut review = start(&f, &workers, MemoryPolicy::Always)
                .finish()
                .await
                .unwrap();
            match change {
                0 => populate(&f.project.path().join("src")),
                1 => fs::remove_file(f.project.path().join(".voktty/kit.json")).unwrap(),
                _ => review.expires = Instant::now(),
            }
            let before = bytes(&f);
            let result = workers
                .accept_policy(review, DiscoveryControl::default())
                .unwrap()
                .finish()
                .await;
            assert!(matches!(
                result,
                Err(MemoryPolicyError::ScopeUnavailable | MemoryPolicyError::Changed)
            ));
            assert_eq!(bytes(&f), before);
        });
    }
}

#[test]
fn queued_cancelled_acceptance_retains_capacity_until_settlement_without_writing() {
    let f = fixture();
    let runtime = Builder::new_current_thread()
        .enable_time()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        let workers = workers();
        let review = start(&f, &workers, MemoryPolicy::Always)
            .finish()
            .await
            .unwrap();
        let before = bytes(&f);
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let held = gate.clone();
        let (started, observed) = mpsc::channel();
        let blocker = tokio::task::spawn_blocking(move || {
            started.send(()).unwrap();
            let (released, timeout) = held
                .1
                .wait_timeout_while(held.0.lock().unwrap(), Duration::from_secs(3), |released| {
                    !*released
                })
                .unwrap();
            assert!(*released && !timeout.timed_out());
        });
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let job = workers
            .accept_policy(review, DiscoveryControl::default())
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
        assert_eq!(bytes(&f), before);
    });
}

#[test]
fn retired_completed_delivery_does_not_undo_the_exact_admitted_policy_write() {
    let f = fixture();
    runtime().block_on(async {
        let workers = workers();
        let review = start(&f, &workers, MemoryPolicy::Never)
            .finish()
            .await
            .unwrap();
        let key = review.project_key().to_owned();
        let control = DiscoveryControl::default();
        let job = workers.accept_policy(review, control.clone()).unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while job.job.receiver.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(workers.active.load(Ordering::Acquire), 1);
        let written = bytes(&f);
        control.cancel();
        assert_eq!(
            job.finish().await,
            Err(MemoryPolicyError::Worker(MemoryWorkError::Read(
                ReadError::Cancelled
            )))
        );
        assert_eq!(bytes(&f), written);
        assert_eq!(
            f.store.load().unwrap().project(&key).unwrap().policy,
            MemoryPolicy::Never
        );
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
    });
}

#[test]
fn shared_capacity_runtime_and_invalid_inputs_block_before_policy_io() {
    let f = fixture();
    let workers = workers();
    assert!(matches!(
        workers.review_policy(
            f.store.clone(),
            f.project.path().to_owned(),
            f.access.clone(),
            MemoryPolicy::Always,
            DiscoveryControl::default()
        ),
        Err(MemoryPolicyError::Worker(
            MemoryWorkError::RuntimeUnavailable
        ))
    ));
    runtime().block_on(async {
        let mut occupied = Vec::new();
        for _ in 0..4 {
            occupied.push(
                workers
                    .spawn(Control::Read(ReadControl::default()), || Ok(()))
                    .unwrap(),
            );
        }
        assert!(matches!(
            workers.review_policy(
                f.store.clone(),
                f.project.path().to_owned(),
                f.access.clone(),
                MemoryPolicy::Always,
                DiscoveryControl::default()
            ),
            Err(MemoryPolicyError::Worker(MemoryWorkError::Read(
                ReadError::Busy
            )))
        ));
        for job in occupied {
            job.finish().await.unwrap();
        }
        assert!(matches!(
            workers.review_policy(
                f.store.clone(),
                PathBuf::from("relative"),
                f.access.clone(),
                MemoryPolicy::Always,
                DiscoveryControl::default()
            ),
            Err(MemoryPolicyError::Worker(MemoryWorkError::Read(
                ReadError::InvalidInput
            )))
        ));
        assert!(matches!(
            workers.review_policy(
                f.store.clone(),
                f.project.path().to_owned(),
                f.access.clone(),
                MemoryPolicy::Always,
                DiscoveryControl::new(Duration::ZERO)
            ),
            Err(MemoryPolicyError::Worker(MemoryWorkError::Read(
                ReadError::Timeout
            )))
        ));
        assert_eq!(f.store.load().unwrap().revision(), 0);
        assert_eq!(workers.active.load(Ordering::Acquire), 0);
    });
    fs::remove_file(f.state.path().join("memory-local.json")).unwrap();
    runtime().block_on(async {
        assert!(matches!(
            start(&f, &workers, MemoryPolicy::Never).finish().await,
            Err(MemoryPolicyError::Worker(MemoryWorkError::Read(
                ReadError::Store(StoreError::Missing)
            )))
        ));
    });
    assert!(!f.state.path().join("memory-local.json").exists());
}
