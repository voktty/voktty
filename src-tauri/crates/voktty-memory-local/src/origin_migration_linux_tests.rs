use super::*;
use std::os::unix::fs::{symlink, PermissionsExt};

fn fixture() -> (tempfile::TempDir, LocalMemoryStore) {
    let base = tempfile::tempdir().unwrap();
    fs::set_permissions(base.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let parent = base.path().join("dev.voktty");
    let control = ReadControl::default();
    LocalMemoryStore::prepare_application_parent(&parent, &control).unwrap();
    let store = LocalMemoryStore::create_private(&parent, &control).unwrap();
    store.initialize().unwrap();
    store
        .set_policy(0, &"a".repeat(64), MemoryPolicy::Never)
        .unwrap();
    store
        .set_policy(1, &"b".repeat(64), MemoryPolicy::Always)
        .unwrap();
    store
        .trust_instructions(2, &"b".repeat(64), &"c".repeat(64))
        .unwrap();
    (base, store)
}

#[test]
fn exchange_preserves_exact_store_objects_and_blocks_old_writers() {
    let (base, old) = fixture();
    let control = ReadControl::default();
    let source = base.path().join("dev.voktty/project-memory");
    fs::write(
        source.join("memory-deployment.json"),
        b"opaque interrupted journal\r\n",
    )
    .unwrap();
    fs::set_permissions(
        source.join("memory-deployment.json"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let state = fs::read(source.join("memory-local.json")).unwrap();
    let identity = old.load().unwrap().installation_id().to_owned();
    let source_inode = fs::metadata(&source).unwrap().ino();
    let state_inode = fs::metadata(source.join("memory-local.json"))
        .unwrap()
        .ino();
    let source_metadata = fs::metadata(&source).unwrap();
    let state_metadata = fs::metadata(source.join("memory-local.json")).unwrap();
    let state_file = crate::regular_file(&source.join("memory-local.json"), false, false).unwrap();
    assert_eq!(
        unsafe {
            libc::fsetxattr(
                state_file.as_raw_fd(),
                c"user.voktty-origin".as_ptr(),
                b"kept".as_ptr().cast(),
                4,
                0,
            )
        },
        0
    );
    let review = OriginMigrationReview::prepare(base.path(), &control).unwrap();
    assert_eq!(
        review.summary(),
        &OriginMigrationSummary {
            projects: 2,
            manual: 0,
            always: 1,
            never: 1,
            stored_trust: 1,
            recovery_journal: true,
            pending_reservation: false
        }
    );
    assert!(!base.path().join(MEMORY_APPLICATION_ID).exists());
    assert!(matches!(
        crate::resolve_memory_application_parent(base.path(), &control),
        Err(crate::MemoryOriginError::LegacyStateRequiresReview)
    ));
    let digest = review.digest().to_owned();
    review.accept(&digest, &control).unwrap();
    let canonical = crate::resolve_memory_application_parent(base.path(), &control).unwrap();
    let moved = canonical.join(NAME);
    for (original, path) in [
        (source_metadata, moved.clone()),
        (state_metadata, moved.join("memory-local.json")),
    ] {
        let metadata = fs::metadata(path).unwrap();
        assert_eq!(
            (metadata.mode(), metadata.uid(), metadata.gid()),
            (original.mode(), original.uid(), original.gid())
        );
    }
    let moved_file = crate::regular_file(&moved.join("memory-local.json"), false, false).unwrap();
    let mut attribute = [0u8; 4];
    assert_eq!(
        unsafe {
            libc::fgetxattr(
                moved_file.as_raw_fd(),
                c"user.voktty-origin".as_ptr(),
                attribute.as_mut_ptr().cast(),
                attribute.len(),
            )
        },
        4
    );
    assert_eq!(&attribute, b"kept");
    assert_eq!(fs::metadata(&moved).unwrap().ino(), source_inode);
    assert_eq!(
        fs::metadata(moved.join("memory-local.json")).unwrap().ino(),
        state_inode
    );
    assert_eq!(fs::read(moved.join("memory-local.json")).unwrap(), state);
    assert_eq!(
        fs::read(moved.join("memory-deployment.json")).unwrap(),
        b"opaque interrupted journal\r\n"
    );
    let current = LocalMemoryStore::open_private(&canonical, &control).unwrap();
    assert_eq!(current.load().unwrap().installation_id(), identity);
    assert!(old.initialize().is_err());
    assert!(old
        .set_policy(3, &"a".repeat(64), MemoryPolicy::Manual)
        .is_err());
    assert!(LocalMemoryStore::create_private(&base.path().join("dev.voktty"), &control).is_err());
    assert!(source.is_file());
    current
        .set_policy(3, &"a".repeat(64), MemoryPolicy::Never)
        .unwrap();
    assert!(crate::resolve_memory_application_parent(base.path(), &control).is_ok());
}

#[test]
fn stale_acceptance_wrong_digest_and_existing_destination_preserve_both_origins() {
    for change in [
        "digest",
        "preferences",
        "journal",
        "unknown",
        "destination",
        "replaced-root",
        "expired",
    ] {
        let (base, old) = fixture();
        let control = ReadControl::default();
        let mut review = OriginMigrationReview::prepare(base.path(), &control).unwrap();
        let mut digest = review.digest().to_owned();
        let source = base.path().join("dev.voktty/project-memory");
        match change {
            "digest" => digest = "0".repeat(64),
            "preferences" => {
                old.set_policy(3, &"a".repeat(64), MemoryPolicy::Manual)
                    .unwrap();
            }
            "journal" => {
                fs::write(source.join("memory-deployment.json"), b"later journal").unwrap()
            }
            "unknown" => fs::write(source.join("unreviewed"), b"keep").unwrap(),
            "destination" => {
                let target = base.path().join(MEMORY_APPLICATION_ID);
                LocalMemoryStore::prepare_application_parent(&target, &control).unwrap();
                let foreign = LocalMemoryStore::create_private(&target, &control).unwrap();
                foreign.initialize().unwrap();
            }
            "replaced-root" => {
                fs::rename(&source, source.with_extension("kept")).unwrap();
                fs::create_dir(&source).unwrap();
                fs::set_permissions(&source, fs::Permissions::from_mode(0o700)).unwrap();
            }
            "expired" => review.created = Instant::now() - Duration::from_secs(121),
            _ => unreachable!(),
        }
        let before = fs::read(source.join("memory-local.json")).ok();
        let failure = review.accept(&digest, &control).unwrap_err();
        assert!(!failure.moved, "{change}");
        assert!(!failure.reservation_created, "{change}");
        assert!(!failure.application_parent_may_exist, "{change}");
        assert_eq!(fs::read(source.join("memory-local.json")).ok(), before);
        assert!(source.is_dir());
    }
}

#[test]
fn both_locks_are_required_and_no_lock_is_held_while_reviewing() {
    let (base, old) = fixture();
    let control = ReadControl::default();
    let review = OriginMigrationReview::prepare(base.path(), &control).unwrap();
    let digest = review.digest().to_owned();
    let lock = old.try_lock_deployment().unwrap();
    assert!(matches!(
        OriginMigrationReview::prepare(base.path(), &control),
        Err(ReadError::Store(StoreError::Busy))
    ));
    let failure = review.accept(&digest, &control).unwrap_err();
    assert!(matches!(failure.error, ReadError::Store(StoreError::Busy)));
    assert!(!failure.application_parent_may_exist);
    drop(lock);
    let review = OriginMigrationReview::prepare(base.path(), &control).unwrap();
    let digest = review.digest().to_owned();
    let preferences = old.lock().unwrap();
    assert!(matches!(
        review.accept(&digest, &control).unwrap_err().error,
        ReadError::Store(StoreError::Busy)
    ));
    drop(preferences);
}

#[test]
fn cancellation_and_unsafe_inventory_do_not_create_the_destination() {
    for change in [
        "cancel",
        "unknown",
        "hardlink",
        "symlink",
        "broad-mode",
        "oversized",
        "corrupt",
    ] {
        let (base, _old) = fixture();
        let source = base.path().join("dev.voktty/project-memory");
        let state = source.join("memory-local.json");
        let control = ReadControl::default();
        match change {
            "cancel" => control.cancel(),
            "unknown" => fs::write(source.join("unreviewed"), b"kept").unwrap(),
            "hardlink" => fs::hard_link(&state, base.path().join("extra-link")).unwrap(),
            "symlink" => {
                fs::rename(&state, base.path().join("kept-state")).unwrap();
                symlink(base.path().join("kept-state"), &state).unwrap();
            }
            "broad-mode" => fs::set_permissions(&state, fs::Permissions::from_mode(0o666)).unwrap(),
            "oversized" => fs::write(&state, vec![b'x'; crate::MAX_BYTES as usize + 1]).unwrap(),
            "corrupt" => fs::write(&state, b"preserve corrupt state").unwrap(),
            _ => unreachable!(),
        }
        let before = fs::read(&state).unwrap();
        assert!(
            OriginMigrationReview::prepare(base.path(), &control).is_err(),
            "{change}"
        );
        assert_eq!(fs::read(state).unwrap(), before);
        assert!(!base.path().join(MEMORY_APPLICATION_ID).exists());
    }
    let (base, _old) = fixture();
    let control = ReadControl::default();
    let review = OriginMigrationReview::prepare(base.path(), &control).unwrap();
    let digest = review.digest().to_owned();
    control.cancel();
    let failure = review.accept(&digest, &control).unwrap_err();
    assert_eq!(failure.error, ReadError::Cancelled);
    assert!(
        !failure.application_parent_may_exist && !failure.reservation_created && !failure.moved
    );
    assert!(!base.path().join(MEMORY_APPLICATION_ID).exists());
}

#[test]
fn complete_pending_reservation_can_be_reviewed_and_resumed() {
    let (base, _old) = fixture();
    let control = ReadControl::default();
    let review = OriginMigrationReview::prepare(base.path(), &control).unwrap();
    let parent = base.path().join(MEMORY_APPLICATION_ID);
    LocalMemoryStore::prepare_application_parent(&parent, &control).unwrap();
    let destination = Directory::open_root(&parent, &control).unwrap();
    let mut created = false;
    reserve(
        &destination,
        &expected(&review.capture.store, &review.capture.legacy, &destination).unwrap(),
        &control,
        &mut created,
    )
    .unwrap();
    assert!(created);
    let fresh = OriginMigrationReview::prepare(base.path(), &control).unwrap();
    assert!(fresh.summary().pending_reservation);
    assert_ne!(review.digest(), fresh.digest());
    let digest = fresh.digest().to_owned();
    fresh.accept(&digest, &control).unwrap();
    assert!(is_migrated(base.path(), &control).unwrap());
}

#[test]
fn reservation_cleanup_preserves_a_replacement_entry() {
    let (base, _old) = fixture();
    let root = Directory::open_root(base.path(), &ReadControl::default()).unwrap();
    let path = base.path().join("owned-staging");
    let kept = base.path().join("kept-staging");
    fs::write(&path, b"owned marker staging").unwrap();
    let file = File::open(&path).unwrap();
    let owned = file.metadata().unwrap();
    let reservation = Reservation {
        parent: root.file.try_clone().unwrap(),
        name: CString::new("owned-staging").unwrap(),
        file,
    };
    fs::rename(&path, &kept).unwrap();
    fs::write(&path, b"foreign replacement").unwrap();
    assert!(!own_entry(&root.file, c"owned-staging", &owned));
    drop(reservation);
    assert_eq!(fs::read(path).unwrap(), b"foreign replacement");
    assert_eq!(fs::read(kept).unwrap(), b"owned marker staging");
}

#[test]
fn unsafe_or_forged_markers_never_enable_canonical_state() {
    for change in [
        "bytes",
        "symlink",
        "hardlink",
        "permissions",
        "canonical-replaced",
    ] {
        let (base, _old) = fixture();
        let control = ReadControl::default();
        let review = OriginMigrationReview::prepare(base.path(), &control).unwrap();
        let digest = review.digest().to_owned();
        review.accept(&digest, &control).unwrap();
        let marker = base.path().join("dev.voktty/project-memory");
        match change {
            "bytes" => fs::write(&marker, b"foreign bytes").unwrap(),
            "permissions" => {
                fs::set_permissions(&marker, fs::Permissions::from_mode(0o666)).unwrap()
            }
            "hardlink" => fs::hard_link(&marker, base.path().join("extra-link")).unwrap(),
            "symlink" => {
                fs::rename(&marker, marker.with_extension("kept")).unwrap();
                symlink(marker.with_extension("kept"), &marker).unwrap();
            }
            "canonical-replaced" => {
                let canonical = base.path().join(MEMORY_APPLICATION_ID).join(NAME);
                fs::rename(&canonical, canonical.with_extension("kept")).unwrap();
                fs::create_dir(&canonical).unwrap();
                fs::set_permissions(&canonical, fs::Permissions::from_mode(0o700)).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            matches!(
                crate::resolve_memory_application_parent(base.path(), &control),
                Err(crate::MemoryOriginError::LegacyStateRequiresReview)
            ),
            "{change}"
        );
    }
}
