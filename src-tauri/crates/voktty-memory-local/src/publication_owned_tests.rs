use super::*;
use crate::{MemoryPolicy, ReadControl};
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

static PUBLICATION: Mutex<()> = Mutex::new(());

struct Access {
    root: PathBuf,
    retired: AtomicBool,
    deny_write: AtomicBool,
    interrupt: AtomicBool,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        !self.retired.load(Ordering::Acquire)
            && (path.starts_with(&self.root)
                || self.root.ancestors().any(|parent| parent == path)
                || (path.file_name().is_some_and(|name| name == ".voktty")
                    && path.parent().is_some_and(|parent| {
                        self.root.ancestors().any(|ancestor| ancestor == parent)
                    })))
    }

    fn allows_read(&self, path: &Path) -> bool {
        !self.retired.load(Ordering::Acquire) && path.starts_with(&self.root)
    }

    fn allows_enumeration(&self, path: &Path) -> bool {
        self.allows_read(path)
    }
}

impl MemoryWriteAccess for Access {
    fn allows_create(&self, path: &Path) -> bool {
        self.allows_read(path)
            && !self.deny_write.load(Ordering::Acquire)
            && !(self.interrupt.load(Ordering::Acquire)
                && path.ends_with("RULES.md")
                && self.root.join(".voktty/INIT.md").exists())
    }

    fn allows_replace(&self, path: &Path) -> bool {
        self.allows_create(path)
    }

    fn allows_remove_staging(&self, path: &Path) -> bool {
        self.allows_create(path)
    }
}

struct Fixture {
    _serial: MutexGuard<'static, ()>,
    project: tempfile::TempDir,
    state: tempfile::TempDir,
    store: Arc<LocalMemoryStore>,
    origin: Arc<Access>,
    destination: Arc<Access>,
}

fn fixture() -> Fixture {
    use std::os::unix::fs::PermissionsExt;
    let serial = PUBLICATION.lock().unwrap();
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let state = tempfile::tempdir().unwrap();
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = Arc::new(LocalMemoryStore::open(state.path()).unwrap());
    store.initialize().unwrap();
    let access = || {
        Arc::new(Access {
            root: project.path().to_owned(),
            retired: AtomicBool::new(false),
            deny_write: AtomicBool::new(false),
            interrupt: AtomicBool::new(false),
        })
    };
    let origin = access();
    let destination = access();
    Fixture {
        _serial: serial,
        project,
        state,
        store,
        origin,
        destination,
    }
}

fn borrowed<'a>(f: &'a Fixture) -> (LocalMemoryWorkspace<'a>, LocalMemoryWorkspace<'a>) {
    (
        LocalMemoryWorkspace::open(
            &f.store,
            f.project.path(),
            f.origin.as_ref(),
            &ReadControl::default(),
        )
        .unwrap(),
        LocalMemoryWorkspace::open(
            &f.store,
            f.project.path(),
            f.destination.as_ref(),
            &ReadControl::default(),
        )
        .unwrap(),
    )
}

fn prepare<'w, 's>(
    origin: &'w LocalMemoryWorkspace<'s>,
    destination: &'w LocalMemoryWorkspace<'s>,
) -> InitializationPreview<'w, 's> {
    InitializationPreview::prepare(
        origin,
        destination,
        json!({"project_name":"Owned review","created_at":"2026-10-29"})
            .as_object()
            .unwrap(),
        RootLinks::default(),
        &DiscoveryControl::default(),
    )
    .unwrap()
}

fn owned(f: &Fixture) -> OwnedInitializationPreview {
    let (origin, destination) = borrowed(f);
    prepare(&origin, &destination)
        .into_owned(f.store.clone(), f.origin.clone(), f.destination.clone())
        .unwrap()
}

#[test]
fn retained_review_moves_exact_state_and_publishes_after_borrows_end() {
    fn assert_send_static<T: Send + 'static>(_: &T) {}
    let f = fixture();
    let review = {
        let (origin, destination) = borrowed(&f);
        let preview = prepare(&origin, &destination);
        let created_at = preview.created_at;
        let intent = preview.intent.clone();
        let revision = preview.revision;
        let review = preview
            .into_owned(f.store.clone(), f.origin.clone(), f.destination.clone())
            .unwrap();
        assert_eq!(review.created_at, created_at);
        assert_eq!(review.intent, intent);
        assert_eq!(review.revision, revision);
        review
    };
    assert_send_static(&review);
    assert!(!review.is_resuming());
    assert!(review.recovery_files().is_empty());
    assert_eq!(review.publication_blocker(), None);
    let expected = review.deployment().plan.entries.clone();
    assert!(!f.project.path().join(".voktty").exists());
    let report = review
        .publish(f.destination.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.created.len(), expected.len());
    assert_eq!(report.created.last().unwrap(), ".voktty/kit.json");
    for entry in expected {
        assert_eq!(
            fs::read_to_string(f.project.path().join(entry.path)).unwrap(),
            entry.proposed
        );
    }
    assert!(!f.state.path().join(INTENT).exists());
}

#[test]
fn equivalent_new_authorities_and_reopened_store_cannot_adopt_review() {
    for mismatch in 0..3 {
        let f = fixture();
        let (origin, destination) = borrowed(&f);
        let store = if mismatch == 0 {
            Arc::new(LocalMemoryStore::open(f.state.path()).unwrap())
        } else {
            f.store.clone()
        };
        let source: Arc<dyn MemoryReadAccess> = if mismatch == 1 {
            f.destination.clone()
        } else {
            f.origin.clone()
        };
        let target: Arc<dyn MemoryReadAccess> = if mismatch == 2 {
            f.origin.clone()
        } else {
            f.destination.clone()
        };
        assert!(matches!(
            prepare(&origin, &destination).into_owned(store, source, target),
            Err(PublicationError::Read(ReadError::Denied))
        ));
        assert!(!f.project.path().join(".voktty").exists());
        assert!(!f.state.path().join(INTENT).exists());
    }
}

#[test]
fn retaining_retired_review_never_substitutes_fresh_read_authority() {
    for retire_origin in [true, false] {
        let f = fixture();
        let (origin, destination) = borrowed(&f);
        let preview = prepare(&origin, &destination);
        if retire_origin {
            &f.origin
        } else {
            &f.destination
        }
        .retired
        .store(true, Ordering::Release);
        let review = preview
            .into_owned(f.store.clone(), f.origin.clone(), f.destination.clone())
            .unwrap();
        let error = review
            .publish(f.destination.as_ref(), &DiscoveryControl::default())
            .unwrap_err();
        assert_eq!(error.error, PublicationError::Read(ReadError::Denied));
        assert!(error.created.is_empty());
        assert!(!f.project.path().join(".voktty").exists());
    }
}

#[test]
fn retained_review_preserves_original_expiration_at_conversion_and_publication() {
    let f = fixture();
    let (origin, destination) = borrowed(&f);
    let mut preview = prepare(&origin, &destination);
    preview.created_at = Instant::now() - PREVIEW_LIFETIME;
    let created_at = preview.created_at;
    let review = preview
        .into_owned(f.store.clone(), f.origin.clone(), f.destination.clone())
        .unwrap();
    assert_eq!(review.created_at, created_at);
    let error = review
        .publish(f.destination.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(error.error, PublicationError::StalePreview);
    assert!(!f.project.path().join(".voktty").exists());
}

#[test]
fn retained_review_rejects_root_replacement_without_reopening_it() {
    let f = fixture();
    let review = owned(&f);
    let saved = f.project.path().with_extension("saved");
    fs::rename(f.project.path(), &saved).unwrap();
    fs::create_dir(f.project.path()).unwrap();
    let error = review
        .publish(f.destination.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(error.error, PublicationError::Read(ReadError::StaleRoot));
    assert!(!f.project.path().join(".voktty").exists());
    assert!(!saved.join(".voktty").exists());
    fs::remove_dir(f.project.path()).unwrap();
    fs::rename(saved, f.project.path()).unwrap();
}

#[test]
fn retained_review_does_not_replan_changed_bytes_or_preferences() {
    for change_preferences in [false, true] {
        let f = fixture();
        let review = owned(&f);
        if change_preferences {
            let workspace = review.destination.borrow();
            f.store
                .set_policy(0, workspace.project_key(), MemoryPolicy::Never)
                .unwrap();
        } else {
            fs::create_dir(f.project.path().join(".voktty")).unwrap();
            fs::write(f.project.path().join(".voktty/INIT.md"), "foreign edit").unwrap();
        }
        let error = review
            .publish(f.destination.as_ref(), &DiscoveryControl::default())
            .unwrap_err();
        assert_eq!(error.error, PublicationError::StalePreview);
        assert!(error.created.is_empty());
        assert!(!f.project.path().join(".voktty/kit.json").exists());
        if !change_preferences {
            assert_eq!(
                fs::read_to_string(f.project.path().join(".voktty/INIT.md")).unwrap(),
                "foreign edit"
            );
        }
    }
}

#[test]
fn retained_review_requires_write_permission_and_observes_cancellation() {
    for cancel in [false, true] {
        let f = fixture();
        let review = owned(&f);
        let control = DiscoveryControl::default();
        if cancel {
            control.cancel();
        } else {
            f.destination.deny_write.store(true, Ordering::Release);
        }
        let error = review
            .publish(f.destination.as_ref(), &control)
            .unwrap_err();
        assert_eq!(
            error.error,
            PublicationError::Read(if cancel {
                ReadError::Cancelled
            } else {
                ReadError::Denied
            })
        );
        assert!(error.created.is_empty());
        assert!(!f.project.path().join(".voktty").exists());
        assert!(!f.state.path().join(INTENT).exists());
    }
}

#[test]
fn retained_partial_review_preserves_recovery_intent_without_new_transaction() {
    let f = fixture();
    fs::create_dir(f.project.path().join(".voktty")).unwrap();
    fs::write(f.project.path().join(".voktty/.gitignore"), "*\r\n").unwrap();
    f.destination.interrupt.store(true, Ordering::Release);
    let failure = owned(&f)
        .publish(f.destination.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    assert!(!failure.created.is_empty());
    assert_eq!(failure.migrated, vec![".voktty/.gitignore"]);
    assert!(!f.project.path().join(".voktty/kit.json").exists());
    let saved: Intent =
        serde_json::from_slice(&fs::read(f.state.path().join(INTENT)).unwrap()).unwrap();
    f.destination.interrupt.store(false, Ordering::Release);
    let review = owned(&f);
    assert!(review.is_resuming());
    assert_eq!(review.intent, saved);
    assert_eq!(review.recovery_files().len(), 1);
    assert_eq!(review.recovery_files()[0].text, "*\r\n");
    review
        .publish(f.destination.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(f.project.path().join(".voktty/kit.json").exists());
    assert!(!f.state.path().join(INTENT).exists());
}
