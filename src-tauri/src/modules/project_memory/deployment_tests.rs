use super::*;
use std::sync::{mpsc, Condvar, Mutex};
use std::time::Duration;
use voktty_memory_local::{
    MemoryDeploymentWorkError, MemoryWriteAccess, PublicationError, StoreError,
};
use voktty_workspace_kit::RootLinks;

struct Fixture {
    _project: tempfile::TempDir,
    _state: tempfile::TempDir,
    root: PathBuf,
    registry: WorkspaceRegistry,
    store: Arc<LocalMemoryStore>,
}
fn fixture() -> Fixture {
    let project = project();
    let registry = WorkspaceRegistry::default();
    let root = registry.authorize(project.path()).unwrap();
    // The fixture crosses a real device boundary. Only this private test
    // registry grants its boundary metadata; production capture grants nothing.
    registry.authorize("/dev").unwrap();
    let (state, store) = store();
    Fixture {
        _project: project,
        _state: state,
        root,
        registry,
        store,
    }
}
fn request(f: &Fixture) -> NativeMemoryPreviewRequest {
    NativeMemoryPreviewRequest {
        destination: f.root.clone(),
        environment: WorkspaceEnv::Local,
        store: f.store.clone(),
        inputs: json!({"project_name":"Owned native review", "created_at":"2026-10-29"})
            .as_object()
            .unwrap()
            .clone(),
        links: RootLinks::default(),
        control: DiscoveryControl::default(),
    }
}
fn select(f: &Fixture) -> (NativeMemorySelection, NativeMemorySelectionReceipt) {
    let mut owner = NativeMemorySelection::default();
    let receipt = owner
        .select(&f.registry, f.root.clone(), &WorkspaceEnv::Local)
        .unwrap();
    (owner, receipt)
}
async fn prepare(
    owner: &mut NativeMemorySelection,
    selection: &NativeMemorySelectionReceipt,
    f: &Fixture,
) -> NativeMemoryPreviewReceipt {
    let prepared = owner
        .prepare_preview(selection, &f.registry, request(f))
        .unwrap()
        .finish()
        .await
        .unwrap();
    owner.accept_preview(selection, prepared).unwrap()
}
fn is_cancelled<T>(result: &Result<T, MemoryDeploymentWorkError>) -> bool {
    matches!(
        result,
        Err(MemoryDeploymentWorkError::Worker(MemoryWorkError::Read(
            ReadError::Cancelled
        )))
    )
}

struct Gate {
    released: Mutex<bool>,
    wake: Condvar,
}
impl Gate {
    fn new() -> Self {
        Self {
            released: Mutex::new(false),
            wake: Condvar::new(),
        }
    }
    fn wait(&self) {
        let (held, timeout) = self
            .wake
            .wait_timeout_while(
                self.released.lock().unwrap(),
                Duration::from_secs(3),
                |released| !*released,
            )
            .unwrap();
        drop(held);
        assert!(
            !timeout.timed_out(),
            "native publication test gate was not released"
        );
    }
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.wake.notify_all();
    }
}
struct Release(Arc<Gate>);
impl Drop for Release {
    fn drop(&mut self) {
        self.0.release();
    }
}

struct WriteAccess {
    root: PathBuf,
    deny: AtomicBool,
    gate: Mutex<Option<(Arc<Gate>, mpsc::Sender<()>)>>,
}
fn writer(f: &Fixture) -> Arc<WriteAccess> {
    Arc::new(WriteAccess {
        root: f.root.clone(),
        deny: AtomicBool::new(false),
        gate: Mutex::new(None),
    })
}
impl MemoryWriteAccess for WriteAccess {
    fn allows_create(&self, path: &Path) -> bool {
        if !path.starts_with(&self.root) {
            return false;
        }
        if path.ends_with("RULES.md") && self.root.join(".voktty/INIT.md").exists() {
            let gate = self.gate.lock().unwrap().take();
            if let Some((gate, started)) = gate {
                started.send(()).unwrap();
                gate.wait();
            }
            if self.deny.load(Ordering::Acquire) {
                return false;
            }
        }
        true
    }
}

#[test]
fn accepted_review_publishes_exact_bytes_once_without_changing_preferences() {
    let f = fixture();
    let before = fs::read(f._state.path().join("memory-local.json")).unwrap();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(&mut owner, &selected, &f).await;
        let expected = owner
            .preview(&selected, &receipt)
            .unwrap()
            .deployment()
            .plan
            .entries
            .clone();
        assert!(!f.root.join(".voktty").exists());
        let job = owner
            .publish_preview(&selected, &receipt, writer(&f), DiscoveryControl::default())
            .unwrap();
        assert!(is_cancelled(&owner.publish_preview(
            &selected,
            &receipt,
            writer(&f),
            DiscoveryControl::default()
        )));
        assert!(is_cancelled(&owner.preview(&selected, &receipt)));
        let report = job.finish().await.unwrap();
        assert_eq!(report.created.len(), expected.len());
        assert_eq!(report.created.last().unwrap(), ".voktty/kit.json");
        for entry in expected {
            assert_eq!(
                fs::read_to_string(f.root.join(entry.path)).unwrap(),
                entry.proposed
            );
        }
        assert!(owner.is_preview_current(&selected, &receipt));
        let next = prepare(&mut owner, &selected, &f).await;
        assert!(!owner.is_preview_current(&selected, &receipt));
        assert!(owner.is_preview_current(&selected, &next));
    });
    assert_eq!(
        fs::read(f._state.path().join("memory-local.json")).unwrap(),
        before
    );
}

#[test]
fn completed_old_preview_cannot_replace_a_new_ready_review() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let old = owner
            .prepare_preview(&selected, &f.registry, request(&f))
            .unwrap()
            .finish()
            .await
            .unwrap();
        let current = prepare(&mut owner, &selected, &f).await;
        assert!(is_cancelled(&owner.accept_preview(&selected, old)));
        assert!(owner.preview(&selected, &current).is_ok());
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn replacing_an_opening_review_retires_its_worker_result() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let old = owner
            .prepare_preview(&selected, &f.registry, request(&f))
            .unwrap();
        let current = prepare(&mut owner, &selected, &f).await;
        assert!(is_cancelled(&old.finish().await));
        assert!(owner.preview(&selected, &current).is_ok());
    });
}

#[test]
fn an_opening_receipt_can_cancel_only_its_own_request_and_cannot_publish() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let job = owner
            .prepare_preview(&selected, &f.registry, request(&f))
            .unwrap();
        let receipt = job.receipt();
        assert!(owner.is_preview_current(&selected, &receipt));
        assert!(is_cancelled(&owner.preview(&selected, &receipt)));
        assert!(is_cancelled(&owner.publish_preview(
            &selected,
            &receipt,
            writer(&f),
            DiscoveryControl::default()
        )));
        assert!(owner.cancel_preview(&selected, &receipt));
        assert!(is_cancelled(&job.finish().await));
        let current = prepare(&mut owner, &selected, &f).await;
        assert!(!owner.cancel_preview(&selected, &receipt));
        assert!(owner.preview(&selected, &current).is_ok());
    });
}

#[test]
fn failed_destination_or_inputs_retire_only_the_current_review_without_granting_paths() {
    let f = fixture();
    let outside = tempfile::tempdir().unwrap();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        for kind in 0..3 {
            let previous = prepare(&mut owner, &selected, &f).await;
            let mut input = request(&f);
            match kind {
                0 => input.destination = outside.path().to_owned(),
                1 => {
                    input.environment = WorkspaceEnv::Wsl {
                        distro: "unavailable".into(),
                    }
                }
                _ => {
                    input.inputs.insert("project_name".into(), json!(false));
                }
            }
            assert!(owner
                .prepare_preview(&selected, &f.registry, input)
                .is_err());
            assert!(is_cancelled(&owner.preview(&selected, &previous)));
            assert!(owner.is_current(&selected));
        }
    });
    assert!(!f.registry.is_authorized(outside.path()));
    assert!(!f.registry.is_authorized(Path::new("/")));
    assert!(!f.root.join(".voktty").exists());
}

#[test]
fn another_selection_cannot_borrow_publish_or_cancel_a_same_path_review() {
    let f = fixture();
    runtime().block_on(async {
        let (mut a, selected_a) = select(&f);
        let (mut b, selected_b) = select(&f);
        let receipt_a = prepare(&mut a, &selected_a, &f).await;
        let receipt_b = prepare(&mut b, &selected_b, &f).await;
        assert!(is_cancelled(&a.preview(&selected_a, &receipt_b)));
        assert!(is_cancelled(&a.publish_preview(
            &selected_a,
            &receipt_b,
            writer(&f),
            DiscoveryControl::default()
        )));
        assert!(!a.cancel_preview(&selected_a, &receipt_b));
        assert!(a.preview(&selected_a, &receipt_a).is_ok());
        assert!(b.preview(&selected_b, &receipt_b).is_ok());
        assert!(b.cancel_preview(&selected_b, &receipt_b));
        assert!(!b.cancel_preview(&selected_b, &receipt_b));
        assert!(a.preview(&selected_a, &receipt_a).is_ok());
    });
}

#[test]
fn selection_round_trip_and_failed_selection_never_revive_a_review() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, old_selection) = select(&f);
        let previous = prepare(&mut owner, &old_selection, &f).await;
        let current = owner
            .select(&f.registry, f.root.clone(), &WorkspaceEnv::Local)
            .unwrap();
        assert!(is_cancelled(&owner.preview(&current, &previous)));
        let receipt = prepare(&mut owner, &current, &f).await;
        assert!(is_cancelled(&owner.publish_preview(
            &old_selection,
            &receipt,
            writer(&f),
            DiscoveryControl::default()
        )));
        assert!(!owner.cancel_preview(&old_selection, &receipt));
        assert!(owner.preview(&current, &receipt).is_ok());
        assert!(owner
            .select(
                &f.registry,
                f.root.clone(),
                &WorkspaceEnv::Wsl {
                    distro: "unavailable".into()
                }
            )
            .is_err());
        assert!(is_cancelled(&owner.preview(&current, &receipt)));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn dropping_the_owner_retires_opening_delivery_even_when_worker_and_receipt_survive() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let job = owner
            .prepare_preview(&selected, &f.registry, request(&f))
            .unwrap();
        drop(owner);
        assert!(is_cancelled(&job.finish().await));
        assert!(!f.root.join(".voktty").exists());
    });
}

#[test]
fn selection_retirement_cancels_publication_without_releasing_its_physical_lock_early() {
    let f = fixture();
    let runtime = runtime();
    let gate = Arc::new(Gate::new());
    let release = Release(gate.clone());
    runtime.block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(&mut owner, &selected, &f).await;
        let write = writer(&f);
        let (started, observed) = mpsc::channel();
        *write.gate.lock().unwrap() = Some((gate, started));
        let job = owner
            .publish_preview(&selected, &receipt, write, DiscoveryControl::default())
            .unwrap();
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        let current = owner
            .select(&f.registry, f.root.clone(), &WorkspaceEnv::Local)
            .unwrap();
        assert!(is_cancelled(&job.finish().await));
        assert!(matches!(
            f.store.try_lock_deployment(),
            Err(StoreError::Busy)
        ));
        drop(release);
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                match f.store.try_lock_deployment() {
                    Ok(lock) => {
                        drop(lock);
                        break;
                    }
                    Err(StoreError::Busy) => tokio::time::sleep(Duration::from_millis(1)).await,
                    Err(error) => panic!("unexpected lock error: {error:?}"),
                }
            }
        })
        .await
        .unwrap();
        assert!(!f.root.join(".voktty/kit.json").exists());
        assert!(f.root.join(".voktty/INIT.md").exists());
        let retry = prepare(&mut owner, &current, &f).await;
        assert!(owner.preview(&current, &retry).unwrap().is_resuming());
    });
}

#[test]
fn publication_failure_preserves_partial_report_and_does_not_restore_acceptance() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let receipt = prepare(&mut owner, &selected, &f).await;
        let write = writer(&f);
        write.deny.store(true, Ordering::Release);
        let error = owner
            .publish_preview(
                &selected,
                &receipt,
                write.clone(),
                DiscoveryControl::default(),
            )
            .unwrap()
            .finish()
            .await
            .unwrap_err();
        let MemoryDeploymentWorkError::Publication(failure) = error else {
            panic!("partial publication report required")
        };
        assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
        assert!(failure.created.iter().any(|path| path == ".voktty/INIT.md"));
        assert!(is_cancelled(&owner.publish_preview(
            &selected,
            &receipt,
            write.clone(),
            DiscoveryControl::default()
        )));
        assert!(!f.root.join(".voktty/kit.json").exists());
        write.deny.store(false, Ordering::Release);
        let retry = prepare(&mut owner, &selected, &f).await;
        assert!(owner.preview(&selected, &retry).unwrap().is_resuming());
        owner
            .publish_preview(&selected, &retry, write, DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(f.root.join(".voktty/kit.json").exists());
    });
}

#[test]
fn rejected_publication_admission_consumes_its_review_without_starting_io() {
    let f = fixture();
    let (mut owner, selected) = select(&f);
    let receipt = runtime().block_on(prepare(&mut owner, &selected, &f));
    assert!(matches!(
        owner.publish_preview(&selected, &receipt, writer(&f), DiscoveryControl::default()),
        Err(MemoryDeploymentWorkError::Worker(
            MemoryWorkError::RuntimeUnavailable
        ))
    ));
    assert!(is_cancelled(&owner.preview(&selected, &receipt)));
    assert!(!f.root.join(".voktty").exists());
    assert!(owner.is_current(&selected));
}

#[test]
fn completed_preparation_deadline_is_not_the_manual_review_deadline() {
    let f = fixture();
    runtime().block_on(async {
        let (mut owner, selected) = select(&f);
        let mut input = request(&f);
        input.control = DiscoveryControl::new(Duration::from_secs(1));
        let prepared = owner
            .prepare_preview(&selected, &f.registry, input)
            .unwrap()
            .finish()
            .await
            .unwrap();
        let receipt = owner.accept_preview(&selected, prepared).unwrap();
        tokio::time::sleep(Duration::from_millis(1100)).await;
        owner
            .publish_preview(&selected, &receipt, writer(&f), DiscoveryControl::default())
            .unwrap()
            .finish()
            .await
            .unwrap();
        assert!(f.root.join(".voktty/kit.json").exists());
    });
}
