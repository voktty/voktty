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

#[test]
fn acceptance_digest_is_stable_across_fresh_migration_transaction_ids() {
    let f = fixture();
    fs::create_dir(f.project.path().join(".voktty")).unwrap();
    fs::write(f.project.path().join(".voktty/.gitignore"), "*\n").unwrap();
    let first = owned(&f);
    let second = owned(&f);
    assert_ne!(first.intent.transaction, second.intent.transaction);
    assert_eq!(first.acceptance_digest(), second.acceptance_digest());
    assert_eq!(first.acceptance_digest().len(), 64);
    fs::write(f.project.path().join(".voktty/.gitignore"), "*\r\n").unwrap();
    assert_ne!(first.acceptance_digest(), owned(&f).acceptance_digest());
}

#[test]
fn acceptance_digest_changes_with_native_root_or_preference_revision() {
    let f = fixture();
    let first = owned(&f).acceptance_digest();
    let workspace = LocalMemoryWorkspace::open(
        &f.store,
        f.project.path(),
        f.origin.as_ref(),
        &ReadControl::default(),
    )
    .unwrap();
    f.store
        .set_policy(0, workspace.project_key(), MemoryPolicy::Never)
        .unwrap();
    let changed = owned(&f).acceptance_digest();
    assert_ne!(first, changed);
    let saved = f.project.path().with_extension("digest-saved");
    fs::rename(f.project.path(), &saved).unwrap();
    fs::create_dir(f.project.path()).unwrap();
    assert_ne!(changed, owned(&f).acceptance_digest());
    fs::remove_dir(f.project.path()).unwrap();
    fs::rename(saved, f.project.path()).unwrap();
}

#[test]
fn recovery_review_retains_exact_originals_without_restoring_or_rewriting_intent() {
    for edit_backup in [false, true] {
        let f = fixture();
        fs::create_dir(f.project.path().join(".voktty")).unwrap();
        fs::write(f.project.path().join(".voktty/.gitignore"), "*\r\n").unwrap();
        f.destination.interrupt.store(true, Ordering::Release);
        let failure = owned(&f)
            .publish(f.destination.as_ref(), &DiscoveryControl::default())
            .unwrap_err();
        let backup = failure.possible_recovery_files[0].clone();
        let target = f.project.path().join(".voktty/.gitignore");
        fs::remove_file(&target).unwrap();
        let intent_before = fs::read(f.state.path().join(INTENT)).unwrap();
        let (origin, destination) = borrowed(&f);
        let review = OwnedRecoveryReview::prepare(
            &origin,
            &destination,
            f.store.clone(),
            f.origin.clone(),
            f.destination.clone(),
            &DiscoveryControl::default(),
        )
        .unwrap();
        assert_eq!(
            review.entries(),
            &[RecoveryRestore {
                target: ".voktty/.gitignore".into(),
                backup: backup.clone(),
                text: "*\r\n".into()
            }]
        );
        assert_eq!(review.acceptance_digest().len(), 64);
        review.revalidate(&DiscoveryControl::default()).unwrap();
        assert!(!target.exists());
        assert_eq!(
            fs::read(f.state.path().join(INTENT)).unwrap(),
            intent_before
        );
        if edit_backup {
            fs::write(f.project.path().join(&backup), "foreign original").unwrap();
        } else {
            fs::write(&target, "foreign target").unwrap();
        }
        assert!(review.revalidate(&DiscoveryControl::default()).is_err());
        assert_eq!(
            fs::read(f.state.path().join(INTENT)).unwrap(),
            intent_before
        );
        assert_eq!(
            fs::read(f.project.path().join(backup)).unwrap(),
            if edit_backup {
                b"foreign original".as_slice()
            } else {
                b"*\r\n".as_slice()
            }
        );
    }
}

#[test]
fn recovery_acceptance_changes_when_the_reviewed_restore_inventory_changes() {
    let f = fixture();
    fs::create_dir(f.project.path().join(".voktty")).unwrap();
    fs::write(f.project.path().join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(f.project.path().join("AGENTS.md"), "Original owner rules\n").unwrap();
    f.destination.interrupt.store(true, Ordering::Release);
    let (origin, destination) = borrowed(&f);
    let first = InitializationPreview::prepare(
        &origin,
        &destination,
        json!({"project_name":"Owned review","created_at":"2026-10-29"})
            .as_object()
            .unwrap(),
        RootLinks {
            agents: true,
            claude: false,
        },
        &DiscoveryControl::default(),
    )
    .unwrap();
    first
        .publish(f.destination.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    let intent = load_intent(&f.store).unwrap().unwrap();
    let agents_index = intent
        .files
        .iter()
        .position(|file| file.path == "AGENTS.md")
        .unwrap();
    let agents_backup = f.project.path().join(intent.backup(agents_index).unwrap());
    let agents_target = f.project.path().join("AGENTS.md");
    fs::rename(&agents_target, &agents_backup).unwrap();
    fs::remove_file(f.project.path().join(".voktty/.gitignore")).unwrap();
    let review = || {
        OwnedRecoveryReview::prepare(
            &origin,
            &destination,
            f.store.clone(),
            f.origin.clone(),
            f.destination.clone(),
            &DiscoveryControl::default(),
        )
        .unwrap()
    };
    let both = review();
    assert_eq!(both.entries().len(), 2);
    fs::rename(&agents_backup, &agents_target).unwrap();
    let remaining = review();
    assert_eq!(remaining.entries().len(), 1);
    assert_ne!(both.acceptance_digest(), remaining.acceptance_digest());
    assert!(both.revalidate(&DiscoveryControl::default()).is_err());
    remaining.revalidate(&DiscoveryControl::default()).unwrap();
    f.origin.retired.store(true, Ordering::Release);
    assert!(remaining.revalidate(&DiscoveryControl::default()).is_err());
    assert_eq!(fs::read(&agents_target).unwrap(), b"Original owner rules\n");
}

#[test]
fn explicit_restore_moves_original_identity_and_keeps_intent_for_a_new_publication() {
    use std::os::unix::fs::MetadataExt;
    struct RestoreOnly<'a>(&'a Access);
    impl MemoryWriteAccess for RestoreOnly<'_> {
        fn allows_create(&self, path: &Path) -> bool {
            self.0.allows_create(path)
        }
        fn allows_remove_staging(&self, path: &Path) -> bool {
            self.0.allows_remove_staging(path)
        }
    }
    let f = fixture();
    fs::create_dir(f.project.path().join(".voktty")).unwrap();
    fs::write(f.project.path().join(".voktty/.gitignore"), "*\r\n").unwrap();
    f.destination.interrupt.store(true, Ordering::Release);
    let failure = owned(&f)
        .publish(f.destination.as_ref(), &DiscoveryControl::default())
        .unwrap_err();
    let backup = &failure.possible_recovery_files[0];
    let before = fs::metadata(f.project.path().join(backup)).unwrap();
    let target = f.project.path().join(".voktty/.gitignore");
    fs::remove_file(&target).unwrap();
    let intent_before = fs::read(f.state.path().join(INTENT)).unwrap();
    let (origin, destination) = borrowed(&f);
    let review = OwnedRecoveryReview::prepare(
        &origin,
        &destination,
        f.store.clone(),
        f.origin.clone(),
        f.destination.clone(),
        &DiscoveryControl::default(),
    )
    .unwrap();
    let digest = review.acceptance_digest();
    let report = review
        .restore(
            &digest,
            &RestoreOnly(&f.destination),
            &DiscoveryControl::default(),
        )
        .unwrap();
    assert_eq!(report.created, vec![".voktty/.gitignore"]);
    assert_eq!(report.cleaned, vec![backup.clone()]);
    assert_eq!(fs::read(&target).unwrap(), b"*\r\n");
    let after = fs::metadata(&target).unwrap();
    assert_eq!(
        (before.dev(), before.ino(), before.mode()),
        (after.dev(), after.ino(), after.mode())
    );
    assert_eq!(
        fs::read(f.state.path().join(INTENT)).unwrap(),
        intent_before
    );
    assert!(!f.project.path().join(".voktty/kit.json").exists());
    f.destination.interrupt.store(false, Ordering::Release);
    owned(&f)
        .publish(f.destination.as_ref(), &DiscoveryControl::default())
        .unwrap();
    assert!(f.project.path().join(".voktty/kit.json").exists());
    assert!(!f.state.path().join(INTENT).exists());
}

#[test]
fn restoration_refusals_preserve_originals_foreign_targets_and_private_intent() {
    struct Writes<'a> {
        access: &'a Access,
        mode: usize,
        race: AtomicBool,
    }
    impl MemoryWriteAccess for Writes<'_> {
        fn allows_create(&self, path: &Path) -> bool {
            if self.race.swap(false, Ordering::SeqCst) {
                fs::write(path, "foreign target").unwrap();
            }
            self.mode != 1 && self.access.allows_create(path)
        }
        fn allows_remove_staging(&self, path: &Path) -> bool {
            self.mode != 2 && self.access.allows_remove_staging(path)
        }
    }
    for mode in 0..7 {
        let f = fixture();
        fs::create_dir(f.project.path().join(".voktty")).unwrap();
        fs::write(f.project.path().join(".voktty/.gitignore"), "*\n").unwrap();
        f.destination.interrupt.store(true, Ordering::Release);
        let failure = owned(&f)
            .publish(f.destination.as_ref(), &DiscoveryControl::default())
            .unwrap_err();
        let backup = f.project.path().join(&failure.possible_recovery_files[0]);
        let target = f.project.path().join(".voktty/.gitignore");
        fs::remove_file(&target).unwrap();
        let (origin, destination) = borrowed(&f);
        let review = OwnedRecoveryReview::prepare(
            &origin,
            &destination,
            f.store.clone(),
            f.origin.clone(),
            f.destination.clone(),
            &DiscoveryControl::default(),
        )
        .unwrap();
        let digest = if mode == 0 {
            "wrong digest".into()
        } else {
            review.acceptance_digest()
        };
        let intent_before = fs::read(f.state.path().join(INTENT)).unwrap();
        if mode == 3 {
            fs::write(&target, "foreign target").unwrap();
        }
        if mode == 4 {
            fs::write(&backup, "edited original").unwrap();
        }
        let control = DiscoveryControl::default();
        if mode == 5 {
            control.cancel();
        }
        let failure = review
            .restore(
                &digest,
                &Writes {
                    access: &f.destination,
                    mode,
                    race: AtomicBool::new(mode == 6),
                },
                &control,
            )
            .unwrap_err();
        assert!(failure.created.is_empty() && failure.cleaned.is_empty());
        assert_eq!(
            fs::read(f.state.path().join(INTENT)).unwrap(),
            intent_before
        );
        assert_eq!(
            fs::read(&backup).unwrap(),
            if mode == 4 {
                b"edited original".as_slice()
            } else {
                b"*\n".as_slice()
            }
        );
        if matches!(mode, 3 | 6) {
            assert_eq!(fs::read(&target).unwrap(), b"foreign target");
        } else {
            assert!(!target.exists());
        }
        assert!(!f.project.path().join(".voktty/kit.json").exists());
    }
}
