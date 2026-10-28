#![cfg(target_os = "linux")]

use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use voktty_memory_local::{
    DiscoveryControl, InitializationPreview, LocalMemoryStore, LocalMemoryWorkspace, MemoryPolicy,
    MemoryReadAccess, MemoryWriteAccess, PublicationError, ReadControl, ReadError,
};
use voktty_workspace_kit::{parse_kit_config, RootLinks};

struct Access {
    root: PathBuf,
    mode: AtomicUsize,
    first_calls: AtomicUsize,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
            || self.root.ancestors().any(|p| p == path)
            || (path.file_name().is_some_and(|name| name == ".voktty")
                && path
                    .parent()
                    .is_some_and(|p| self.root.ancestors().any(|a| a == p)))
    }
    fn allows_read(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }
}
impl MemoryWriteAccess for Access {
    fn allows_create(&self, path: &Path) -> bool {
        if !path.starts_with(&self.root) {
            return false;
        }
        match self.mode.load(Ordering::SeqCst) {
            1 if path.ends_with("RULES.md") && self.root.join(".voktty/INIT.md").exists() => false,
            2 if path.ends_with("INIT.md") => {
                if self.first_calls.fetch_add(1, Ordering::SeqCst) == 2 {
                    fs::write(path, "foreign racing bytes").unwrap();
                }
                true
            }
            3 if path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with(".voktty-stage-")) =>
            {
                self.mode.store(0, Ordering::SeqCst);
                fs::rename(self.root.join(".voktty"), self.root.join("saved-kit")).unwrap();
                std::os::unix::fs::symlink(self.root.join("outside"), self.root.join(".voktty"))
                    .unwrap();
                true
            }
            4 => false,
            5 if path.ends_with("RULES.md") && self.root.join(".voktty/INIT.md").exists() => {
                self.mode.store(0, Ordering::SeqCst);
                fs::write(
                    self.root.join(".voktty/INIT.md"),
                    "edited during deployment",
                )
                .unwrap();
                true
            }
            _ => true,
        }
    }
}
struct Fixture {
    _project: tempfile::TempDir,
    state: tempfile::TempDir,
    store: LocalMemoryStore,
    access: Access,
}
fn fixture() -> Fixture {
    // This real device boundary allows complete ancestry without reading host
    // kit contents or pretending an authorization boundary proves absence.
    let project = tempfile::tempdir_in("/dev/shm").unwrap();
    let state = tempfile::tempdir().unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = LocalMemoryStore::open(state.path()).unwrap();
    store.initialize().unwrap();
    let access = Access {
        root: fs::canonicalize(project.path()).unwrap(),
        mode: AtomicUsize::new(0),
        first_calls: AtomicUsize::new(0),
    };
    Fixture {
        _project: project,
        state,
        store,
        access,
    }
}
fn open<'a>(f: &'a Fixture, path: &Path) -> LocalMemoryWorkspace<'a> {
    LocalMemoryWorkspace::open(&f.store, path, &f.access, &ReadControl::default()).unwrap()
}
fn preview<'w, 's>(
    origin: &'w LocalMemoryWorkspace<'s>,
    destination: &'w LocalMemoryWorkspace<'s>,
    links: RootLinks,
) -> Result<InitializationPreview<'w, 's>, PublicationError> {
    InitializationPreview::prepare(
        origin,
        destination,
        json!({"project_name":"Native publication","created_at":"2026-10-28"})
            .as_object()
            .unwrap(),
        links,
        &DiscoveryControl::default(),
    )
}

#[test]
fn publishes_exact_reviewed_bytes_with_marker_last_and_second_run_changes_nothing() {
    let f = fixture();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    assert!(!first.is_resuming());
    assert_eq!(first.publication_blocker(), None);
    let expected = first.deployment().plan.entries.clone();
    assert_eq!(expected.last().unwrap().path, ".voktty/kit.json");
    assert!(!f.access.root.join(".voktty").exists());
    let preferences = fs::read(f.state.path().join("memory-local.json")).unwrap();
    let report = first
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.created.last().unwrap(), ".voktty/kit.json");
    assert_eq!(report.created.len(), expected.len());
    for entry in &expected {
        assert_eq!(
            fs::read_to_string(f.access.root.join(&entry.path)).unwrap(),
            entry.proposed
        );
    }
    assert!(!f.access.root.join("AGENTS.md").exists());
    assert!(!f.access.root.join("CLAUDE.md").exists());
    assert!(!f.state.path().join("memory-deployment.json").exists());
    assert_eq!(
        fs::read(f.state.path().join("memory-local.json")).unwrap(),
        preferences
    );
    let stat: Vec<_> = expected
        .iter()
        .map(|entry| {
            fs::metadata(f.access.root.join(&entry.path))
                .unwrap()
                .modified()
                .unwrap()
        })
        .collect();
    let second = preview(&workspace, &workspace, RootLinks::default())
        .unwrap()
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap();
    assert!(second.created.is_empty());
    assert_eq!(second.skipped.len(), expected.len());
    for (entry, modified) in expected.iter().zip(stat) {
        assert_eq!(
            fs::metadata(f.access.root.join(&entry.path))
                .unwrap()
                .modified()
                .unwrap(),
            modified
        );
    }
}

#[test]
fn interrupted_publication_has_no_valid_marker_and_can_resume_after_reopening_native_objects() {
    let f = fixture();
    let workspace = open(&f, &f.access.root);
    let first = preview(
        &workspace,
        &workspace,
        RootLinks {
            agents: true,
            claude: true,
        },
    )
    .unwrap();
    f.access.mode.store(1, Ordering::SeqCst);
    let failure = first
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
    assert!(!failure.created.is_empty());
    assert!(!f.access.root.join(".voktty/kit.json").exists());
    assert!(f.state.path().join("memory-deployment.json").exists());
    let legacy: serde_json::Value =
        serde_json::from_slice(&fs::read(f.state.path().join("memory-deployment.json")).unwrap())
            .unwrap();
    assert_eq!(legacy["schema"], 1);
    assert!(legacy.get("transaction").is_none());
    assert!(legacy["files"]
        .as_array()
        .unwrap()
        .iter()
        .all(|entry| entry.get("original").is_none()));
    drop(workspace);
    let store = LocalMemoryStore::open(f.state.path()).unwrap();
    let reopened =
        LocalMemoryWorkspace::open(&store, &f.access.root, &f.access, &ReadControl::default())
            .unwrap();
    f.access.mode.store(0, Ordering::SeqCst);
    let next = preview(
        &reopened,
        &reopened,
        RootLinks {
            agents: true,
            claude: true,
        },
    )
    .unwrap();
    assert!(next.is_resuming());
    let report = next
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap();
    assert!(report.skipped.contains(&".voktty/INIT.md".to_owned()));
    assert_eq!(report.created.last().unwrap(), ".voktty/kit.json");
    assert!(
        parse_kit_config(&fs::read_to_string(f.access.root.join(".voktty/kit.json")).unwrap())
            .is_ok()
    );
    assert!(f.access.root.join("AGENTS.md").is_file());
    assert!(f.access.root.join("CLAUDE.md").is_file());
    assert!(!f.state.path().join("memory-deployment.json").exists());
}

#[test]
fn external_partial_layout_has_no_implicit_resume_authority() {
    let f = fixture();
    fs::create_dir(f.access.root.join(".voktty")).unwrap();
    fs::write(f.access.root.join(".voktty/unknown.md"), "owned elsewhere").unwrap();
    let workspace = open(&f, &f.access.root);
    assert!(matches!(
        preview(&workspace, &workspace, RootLinks::default()),
        Err(PublicationError::Scope)
    ));
    assert!(!f.state.path().join("memory-deployment.json").exists());
    assert_eq!(
        fs::read_to_string(f.access.root.join(".voktty/unknown.md")).unwrap(),
        "owned elsewhere"
    );
}

#[test]
fn write_permission_is_independent_and_stale_preview_never_overwrites_new_bytes() {
    let f = fixture();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.access.mode.store(4, Ordering::SeqCst);
    assert_eq!(
        first
            .publish(&f.access, &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::Read(ReadError::Denied)
    );
    assert!(!f.access.root.join(".voktty").exists());
    assert!(!f.state.path().join("memory-deployment.json").exists());
    f.access.mode.store(0, Ordering::SeqCst);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    fs::create_dir(f.access.root.join(".voktty")).unwrap();
    fs::write(f.access.root.join(".voktty/INIT.md"), "new foreign bytes").unwrap();
    assert_eq!(
        first
            .publish(&f.access, &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::StalePreview
    );
    assert_eq!(
        fs::read_to_string(f.access.root.join(".voktty/INIT.md")).unwrap(),
        "new foreign bytes"
    );
}

#[test]
fn file_created_during_publication_wins_without_clobber_or_blind_rollback() {
    let f = fixture();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.access.mode.store(2, Ordering::SeqCst);
    let failure = first
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::Conflict);
    assert_eq!(
        fs::read_to_string(f.access.root.join(".voktty/INIT.md")).unwrap(),
        "foreign racing bytes"
    );
    assert!(!f.access.root.join(".voktty/kit.json").exists());
    assert!(f.state.path().join("memory-deployment.json").exists());
    assert!(matches!(
        preview(&workspace, &workspace, RootLinks::default()),
        Err(PublicationError::Conflict)
    ));
}

#[test]
fn replacing_intermediate_directory_with_symlink_never_writes_through_it() {
    let f = fixture();
    fs::create_dir(f.access.root.join("outside")).unwrap();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.access.mode.store(3, Ordering::SeqCst);
    assert!(first
        .publish(&f.access, &DiscoveryControl::default())
        .is_err());
    assert_eq!(
        fs::read_dir(f.access.root.join("outside")).unwrap().count(),
        0
    );
    assert!(!f.access.root.join("saved-kit/kit.json").exists());
}

#[test]
fn scope_changes_in_origin_or_destination_block_publication_under_exclusion() {
    for origin_kit in [false, true] {
        let f = fixture();
        fs::create_dir(f.access.root.join("source")).unwrap();
        fs::create_dir(f.access.root.join("target")).unwrap();
        let origin = open(&f, &f.access.root.join("source"));
        let target = open(&f, &f.access.root.join("target"));
        let first = preview(&origin, &target, RootLinks::default()).unwrap();
        let marker = first
            .deployment()
            .plan
            .entries
            .last()
            .unwrap()
            .proposed
            .clone();
        let collision = if origin_kit {
            f.access.root.join("source/.voktty")
        } else {
            f.access.root.join("target/child/.voktty")
        };
        fs::create_dir_all(&collision).unwrap();
        fs::write(collision.join("kit.json"), marker).unwrap();
        assert_eq!(
            first
                .publish(&f.access, &DiscoveryControl::default())
                .unwrap_err()
                .error,
            PublicationError::Scope
        );
        assert!(!f.access.root.join("target/.voktty").exists());
    }
}

#[test]
fn revision_change_cancellation_and_native_lock_contention_do_not_start_project_writes() {
    let f = fixture();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.store
        .set_policy(0, workspace.project_key(), MemoryPolicy::Never)
        .unwrap();
    assert_eq!(
        first
            .publish(&f.access, &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::StalePreview
    );
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    let control = DiscoveryControl::default();
    control.cancel();
    assert_eq!(
        first.publish(&f.access, &control).unwrap_err().error,
        PublicationError::Read(ReadError::Cancelled)
    );
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    let _lock = f.store.try_lock_deployment().unwrap();
    assert_eq!(
        first
            .publish(&f.access, &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::Store(voktty_memory_local::StoreError::Busy)
    );
    assert!(!f.access.root.join(".voktty").exists());
}

#[test]
fn known_migration_requires_replacement_permission_in_addition_to_creation() {
    let f = fixture();
    fs::create_dir(f.access.root.join(".voktty")).unwrap();
    fs::write(f.access.root.join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(f.access.root.join(".voktty/tasks.json"), "reserved bytes").unwrap();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    assert_eq!(first.publication_blocker(), None);
    assert_eq!(
        first
            .publish(&f.access, &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::Read(ReadError::Denied)
    );
    assert_eq!(
        fs::read_to_string(f.access.root.join(".voktty/.gitignore")).unwrap(),
        "*\n"
    );
    assert_eq!(
        fs::read_to_string(f.access.root.join(".voktty/tasks.json")).unwrap(),
        "reserved bytes"
    );
    assert!(!f.state.path().join("memory-deployment.json").exists());
}

#[test]
fn changed_minimum_prevents_valid_marker_and_preserves_the_edit_and_partial_files() {
    let f = fixture();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.access.mode.store(5, Ordering::SeqCst);
    let failure = first
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::Conflict);
    assert!(!failure.created.is_empty());
    assert!(!f.access.root.join(".voktty/kit.json").exists());
    assert_eq!(
        fs::read_to_string(f.access.root.join(".voktty/INIT.md")).unwrap(),
        "edited during deployment"
    );
    assert!(f.access.root.join(".voktty/RULES.md").is_file());
    assert!(f.state.path().join("memory-deployment.json").is_file());
}

#[test]
fn reserved_runtime_bytes_survive_initialization_without_ignore_migration() {
    let f = fixture();
    fs::create_dir_all(f.access.root.join(".voktty/sessions")).unwrap();
    fs::create_dir_all(f.access.root.join(".voktty/state")).unwrap();
    let reserved = [
        "sessions/private.json",
        "state/private",
        "tasks.json",
        "tools.json",
    ];
    for name in reserved {
        fs::write(f.access.root.join(".voktty").join(name), b"private\xff\0").unwrap();
    }
    let workspace = open(&f, &f.access.root);
    preview(&workspace, &workspace, RootLinks::default())
        .unwrap()
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap();
    for name in reserved {
        assert_eq!(
            fs::read(f.access.root.join(".voktty").join(name)).unwrap(),
            b"private\xff\0"
        );
    }
}

#[test]
fn recovery_intent_is_not_reset_or_reassigned_to_a_different_preview() {
    let f = fixture();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.access.mode.store(1, Ordering::SeqCst);
    first
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    f.access.mode.store(0, Ordering::SeqCst);
    let intent_path = f.state.path().join("memory-deployment.json");
    let intent = fs::read(&intent_path).unwrap();
    assert!(matches!(
        InitializationPreview::prepare(
            &workspace,
            &workspace,
            json!({"project_name":"Different intent","created_at":"2026-10-28"})
                .as_object()
                .unwrap(),
            RootLinks::default(),
            &DiscoveryControl::default()
        ),
        Err(PublicationError::Conflict)
    ));
    assert!(matches!(
        preview(
            &workspace,
            &workspace,
            RootLinks {
                agents: true,
                claude: false
            }
        ),
        Err(PublicationError::PendingIntent)
    ));
    assert_eq!(fs::read(&intent_path).unwrap(), intent);
    for invalid in [
        b"{".to_vec(),
        vec![b' '; 2 * 1024 * 1024 + 1],
        br#"{"schema":2}"#.to_vec(),
    ] {
        fs::write(&intent_path, &invalid).unwrap();
        assert!(matches!(
            preview(&workspace, &workspace, RootLinks::default()),
            Err(PublicationError::InvalidIntent)
        ));
        assert_eq!(fs::read(&intent_path).unwrap(), invalid);
    }
    assert!(!f.access.root.join(".voktty/kit.json").exists());
}

#[test]
fn captured_origin_replacement_or_installation_change_invalidates_acceptance() {
    for replace_origin in [false, true] {
        let f = fixture();
        fs::create_dir(f.access.root.join("source")).unwrap();
        fs::create_dir(f.access.root.join("target")).unwrap();
        let origin = open(&f, &f.access.root.join("source"));
        let target = open(&f, &f.access.root.join("target"));
        let first = preview(&origin, &target, RootLinks::default()).unwrap();
        if replace_origin {
            fs::rename(
                f.access.root.join("source"),
                f.access.root.join("old-source"),
            )
            .unwrap();
            fs::create_dir(f.access.root.join("source")).unwrap();
        } else {
            let path = f.state.path().join("memory-local.json");
            let mut value: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            value["installationId"] = json!("00000000-0000-4000-8000-000000000000");
            fs::write(path, value.to_string()).unwrap();
        }
        let failure = first
            .publish(&f.access, &DiscoveryControl::default())
            .unwrap_err();
        assert_eq!(
            failure.error,
            if replace_origin {
                PublicationError::Read(ReadError::StaleRoot)
            } else {
                PublicationError::StalePreview
            }
        );
        assert!(!f.access.root.join("target/.voktty").exists());
        assert!(!f.state.path().join("memory-deployment.json").exists());
    }
}

struct MigrationAccess<'a>(&'a Access);
impl MemoryWriteAccess for MigrationAccess<'_> {
    fn allows_create(&self, path: &Path) -> bool {
        self.0.allows_create(path)
    }
    fn allows_replace(&self, path: &Path) -> bool {
        if !path.starts_with(&self.0.root) || self.0.mode.load(Ordering::SeqCst) == 6 {
            return false;
        }
        let mode = self.0.mode.load(Ordering::SeqCst);
        if matches!(mode, 8 | 9 | 11) && path.ends_with("AGENTS.md") {
            let call = self.0.first_calls.fetch_add(1, Ordering::SeqCst);
            if call == if mode == 9 { 1 } else { 2 } {
                if mode != 11 {
                    fs::rename(path, self.0.root.join("prior-agent-file")).unwrap();
                }
                fs::write(path, "foreign replacement").unwrap();
            }
        }
        true
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        let mode = self.0.mode.load(Ordering::SeqCst);
        if !path.starts_with(&self.0.root) || mode == 7 {
            return false;
        }
        if mode == 12 && path.exists() {
            return false;
        }
        if mode == 10 && path.exists() {
            self.0.mode.store(0, Ordering::SeqCst);
            fs::write(path, "foreign recovery edit").unwrap();
        }
        true
    }
}

#[test]
fn migrates_private_ignore_and_root_rules_preserving_reserved_bytes_metadata_and_idempotence() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let f = fixture();
    fs::create_dir_all(f.access.root.join(".voktty/sessions")).unwrap();
    fs::create_dir_all(f.access.root.join(".voktty/tasks")).unwrap();
    fs::write(f.access.root.join(".voktty/.gitignore"), "*\r\n").unwrap();
    for path in [
        "sessions/private",
        "tasks/private",
        "tasks.json",
        "tools.json",
    ] {
        fs::write(f.access.root.join(".voktty").join(path), b"reserved\xff\0").unwrap();
    }
    let original = "# Owner rules\r\nPreserve café and bytes.\r\n";
    fs::write(f.access.root.join("AGENTS.md"), original).unwrap();
    fs::write(f.access.root.join("CLAUDE.md"), "# Local Claude\r\n").unwrap();
    fs::set_permissions(
        f.access.root.join("AGENTS.md"),
        fs::Permissions::from_mode(0o640),
    )
    .unwrap();
    let native =
        std::ffi::CString::new(f.access.root.join("AGENTS.md").as_os_str().as_bytes()).unwrap();
    let attribute = b"user.voktty-fixture\0";
    assert_eq!(
        unsafe {
            libc::setxattr(
                native.as_ptr(),
                attribute.as_ptr().cast(),
                b"exact attribute".as_ptr().cast(),
                15,
                0,
            )
        },
        0
    );
    let acl_name = b"system.posix_acl_access\0";
    let mut acl = 2u32.to_le_bytes().to_vec();
    let named_uid = if unsafe { libc::geteuid() } == 1 {
        2u32
    } else {
        1u32
    };
    for (tag, permissions, uid) in [
        (1u16, 6u16, u32::MAX),
        (2, 4, named_uid),
        (4, 0, u32::MAX),
        (16, 4, u32::MAX),
        (32, 0, u32::MAX),
    ] {
        acl.extend_from_slice(&tag.to_le_bytes());
        acl.extend_from_slice(&permissions.to_le_bytes());
        acl.extend_from_slice(&uid.to_le_bytes());
    }
    assert_eq!(
        unsafe {
            libc::setxattr(
                native.as_ptr(),
                acl_name.as_ptr().cast(),
                acl.as_ptr().cast(),
                acl.len(),
                0,
            )
        },
        0
    );
    let before = fs::metadata(f.access.root.join("AGENTS.md")).unwrap();
    let workspace = open(&f, &f.access.root);
    let links = RootLinks {
        agents: true,
        claude: true,
    };
    let first = preview(&workspace, &workspace, links).unwrap();
    assert_eq!(first.publication_blocker(), None);
    let proposals: Vec<_> = first
        .deployment()
        .plan
        .entries
        .iter()
        .map(|entry| (entry.path.clone(), entry.proposed.clone()))
        .collect();
    let report = first
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.migrated.len(), 3);
    assert_eq!(report.cleaned.len(), 3);
    for (path, proposed) in proposals {
        assert_eq!(
            fs::read_to_string(f.access.root.join(path)).unwrap(),
            proposed
        );
    }
    assert!(fs::read_to_string(f.access.root.join("AGENTS.md"))
        .unwrap()
        .starts_with(original));
    let after = fs::metadata(f.access.root.join("AGENTS.md")).unwrap();
    assert_eq!(
        (after.mode(), after.uid(), after.gid()),
        (before.mode(), before.uid(), before.gid())
    );
    let mut bytes = [0u8; 16];
    assert_eq!(
        unsafe {
            libc::getxattr(
                native.as_ptr(),
                attribute.as_ptr().cast(),
                bytes.as_mut_ptr().cast(),
                bytes.len(),
            )
        },
        15
    );
    assert_eq!(&bytes[..15], b"exact attribute");
    let mut actual_acl = vec![0u8; acl.len()];
    assert_eq!(
        unsafe {
            libc::getxattr(
                native.as_ptr(),
                acl_name.as_ptr().cast(),
                actual_acl.as_mut_ptr().cast(),
                actual_acl.len(),
            )
        },
        acl.len() as isize
    );
    assert_eq!(actual_acl, acl);
    for path in [
        "sessions/private",
        "tasks/private",
        "tasks.json",
        "tools.json",
    ] {
        assert_eq!(
            fs::read(f.access.root.join(".voktty").join(path)).unwrap(),
            b"reserved\xff\0"
        );
    }
    assert!(!f.state.path().join("memory-deployment.json").exists());
    let second = preview(&workspace, &workspace, links)
        .unwrap()
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap();
    assert!(second.created.is_empty() && second.migrated.is_empty());
    for directory in [&f.access.root, &f.access.root.join(".voktty")] {
        assert!(fs::read_dir(directory).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".voktty-migration-")));
    }
}

#[test]
fn claude_link_can_depend_on_existing_unselected_agents_without_editing_it() {
    let f = fixture();
    fs::write(f.access.root.join("AGENTS.md"), "existing agent rules\r\n").unwrap();
    fs::write(f.access.root.join("CLAUDE.md"), "existing claude rules\r\n").unwrap();
    let workspace = open(&f, &f.access.root);
    let first = preview(
        &workspace,
        &workspace,
        RootLinks {
            agents: false,
            claude: true,
        },
    )
    .unwrap();
    assert!(first
        .deployment()
        .plan
        .entries
        .iter()
        .all(|entry| entry.path != "AGENTS.md"));
    let report = first
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.migrated, vec!["CLAUDE.md"]);
    assert_eq!(
        fs::read_to_string(f.access.root.join("AGENTS.md")).unwrap(),
        "existing agent rules\r\n"
    );
    assert!(fs::read_to_string(f.access.root.join("CLAUDE.md"))
        .unwrap()
        .contains("@AGENTS.md"));
}

#[test]
fn displaced_foreign_version_is_preserved_and_blocks_automatic_recovery() {
    for mode in [8, 11] {
        let f = fixture();
        fs::write(f.access.root.join("AGENTS.md"), "original rules").unwrap();
        let workspace = open(&f, &f.access.root);
        let links = RootLinks {
            agents: true,
            claude: false,
        };
        let first = preview(&workspace, &workspace, links).unwrap();
        f.access.mode.store(mode, Ordering::SeqCst);
        let failure = first
            .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
            .unwrap_err();
        let PublicationError::RecoveryRequired(paths) = &failure.error else {
            panic!("unexpected {:?}", failure.error)
        };
        assert_eq!(paths.len(), 1);
        assert_eq!(
            fs::read_to_string(f.access.root.join(&paths[0])).unwrap(),
            "foreign replacement"
        );
        assert!(!f.access.root.join(".voktty/kit.json").exists());
        f.access.mode.store(0, Ordering::SeqCst);
        assert!(matches!(
            preview(&workspace, &workspace, links),
            Err(PublicationError::RecoveryRequired(_))
        ));
        assert!(f.state.path().join("memory-deployment.json").exists());
    }
}

#[test]
fn last_byte_check_detects_replacement_before_exchange_without_touching_it() {
    let f = fixture();
    fs::write(f.access.root.join("AGENTS.md"), "original rules").unwrap();
    let workspace = open(&f, &f.access.root);
    let first = preview(
        &workspace,
        &workspace,
        RootLinks {
            agents: true,
            claude: false,
        },
    )
    .unwrap();
    f.access.mode.store(9, Ordering::SeqCst);
    let failure = first
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::Conflict);
    assert_eq!(
        fs::read_to_string(f.access.root.join("AGENTS.md")).unwrap(),
        "foreign replacement"
    );
    assert!(!f.access.root.join(".voktty/kit.json").exists());
}

#[test]
fn interruption_after_exchange_has_reviewable_backup_and_resumes_without_remigrating() {
    let f = fixture();
    fs::create_dir(f.access.root.join(".voktty")).unwrap();
    fs::write(f.access.root.join(".voktty/.gitignore"), "*\n").unwrap();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.access.mode.store(1, Ordering::SeqCst);
    let failure = first
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap_err();
    assert!(!f.access.root.join(".voktty/kit.json").exists());
    assert_eq!(failure.migrated, vec![".voktty/.gitignore"]);
    let record: serde_json::Value =
        serde_json::from_slice(&fs::read(f.state.path().join("memory-deployment.json")).unwrap())
            .unwrap();
    assert_eq!(record["schema"], 2);
    assert!(record["transaction"].is_string());
    let backup = failure.possible_recovery_files.first().unwrap();
    assert_eq!(
        fs::read_to_string(f.access.root.join(backup)).unwrap(),
        "*\n"
    );
    f.access.mode.store(0, Ordering::SeqCst);
    let next = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    assert!(next.is_resuming());
    assert_eq!(next.recovery_files().len(), 1);
    assert_eq!(next.recovery_files()[0].text, "*\n");
    let report = next
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap();
    assert!(report.migrated.is_empty());
    assert!(!f.access.root.join(backup).exists());
    assert!(f.access.root.join(".voktty/kit.json").exists());
}

#[test]
fn cleanup_denial_preserves_displaced_original_and_late_cleanup_edit_is_not_deleted() {
    for mode in [7, 10, 12] {
        let f = fixture();
        fs::write(f.access.root.join("AGENTS.md"), "original rules").unwrap();
        let workspace = open(&f, &f.access.root);
        let first = preview(
            &workspace,
            &workspace,
            RootLinks {
                agents: true,
                claude: false,
            },
        )
        .unwrap();
        f.access.mode.store(mode, Ordering::SeqCst);
        let failure = first
            .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
            .unwrap_err();
        if mode == 7 {
            assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
            assert_eq!(
                fs::read_to_string(f.access.root.join("AGENTS.md")).unwrap(),
                "original rules"
            );
            assert!(!f.state.path().join("memory-deployment.json").exists());
        } else if mode == 12 {
            assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
            let backup = failure.possible_recovery_files.first().unwrap();
            assert_eq!(
                fs::read_to_string(f.access.root.join(backup)).unwrap(),
                "original rules"
            );
            assert!(f.access.root.join(".voktty/kit.json").exists());
            f.access.mode.store(0, Ordering::SeqCst);
            let retry = preview(
                &workspace,
                &workspace,
                RootLinks {
                    agents: true,
                    claude: false,
                },
            )
            .unwrap();
            assert_eq!(retry.recovery_files().len(), 1);
            let report = retry
                .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
                .unwrap();
            assert!(report.created.is_empty() && report.migrated.is_empty());
            assert_eq!(report.cleaned.len(), 1);
            assert!(!f.access.root.join(backup).exists());
            assert!(!f.state.path().join("memory-deployment.json").exists());
        } else {
            assert!(matches!(
                failure.error,
                PublicationError::RecoveryRequired(_)
            ));
            let backup = failure.possible_recovery_files.first().unwrap();
            assert_eq!(
                fs::read_to_string(f.access.root.join(backup)).unwrap(),
                "foreign recovery edit"
            );
            assert!(f.state.path().join("memory-deployment.json").exists());
        }
    }
}

#[test]
fn existing_root_block_preserves_every_byte_outside_its_markers() {
    let f = fixture();
    let prefix = "# User café\r\nKeep prefix\r\n";
    let suffix = "\r\n尾 Keep suffix\r\n";
    fs::write(f.access.root.join("AGENTS.md"), format!("{prefix}<!-- voktty-workspace-kit:start -->\r\nold block\r\n<!-- voktty-workspace-kit:end -->{suffix}")).unwrap();
    let workspace = open(&f, &f.access.root);
    preview(
        &workspace,
        &workspace,
        RootLinks {
            agents: true,
            claude: false,
        },
    )
    .unwrap()
    .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
    .unwrap();
    let actual = fs::read_to_string(f.access.root.join("AGENTS.md")).unwrap();
    assert!(actual.starts_with(prefix));
    assert!(actual.ends_with(suffix));
    assert!(!actual.contains("old block"));
}

#[test]
fn recorded_proposal_stage_before_exchange_is_reviewed_and_can_be_retried() {
    let f = fixture();
    fs::create_dir(f.access.root.join(".voktty")).unwrap();
    fs::write(f.access.root.join(".voktty/.gitignore"), "*\n").unwrap();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.access.mode.store(1, Ordering::SeqCst);
    let failure = first
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap_err();
    // Model the on-disk state of a stop after writing the pre-recorded staging
    // entry but before the atomic exchange. No project data is rolled back by IO.
    let proposal = fs::read(f.access.root.join(".voktty/.gitignore")).unwrap();
    let backup = failure.possible_recovery_files.first().unwrap();
    fs::write(f.access.root.join(backup), &proposal).unwrap();
    fs::write(f.access.root.join(".voktty/.gitignore"), "*\n").unwrap();
    f.access.mode.store(0, Ordering::SeqCst);
    let next = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    assert_eq!(next.recovery_files().len(), 1);
    assert_eq!(next.recovery_files()[0].text.as_bytes(), proposal);
    let report = next
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.migrated, vec![".voktty/.gitignore"]);
    assert_eq!(
        fs::read(f.access.root.join(".voktty/.gitignore")).unwrap(),
        proposal
    );
    assert!(!f.access.root.join(backup).exists());
}

#[test]
fn privileged_modes_and_excessive_attributes_fail_before_replacing_user_file() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::PermissionsExt;
    for excessive_attrs in [false, true] {
        let f = fixture();
        let path = f.access.root.join("AGENTS.md");
        fs::write(&path, "original rules").unwrap();
        if excessive_attrs {
            let native = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
            let value = vec![b'x'; 40000];
            for name in [b"user.fixture-a\0", b"user.fixture-b\0"] {
                assert_eq!(
                    unsafe {
                        libc::setxattr(
                            native.as_ptr(),
                            name.as_ptr().cast(),
                            value.as_ptr().cast(),
                            value.len(),
                            0,
                        )
                    },
                    0
                );
            }
        } else {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o4600)).unwrap();
        }
        let workspace = open(&f, &f.access.root);
        let first = preview(
            &workspace,
            &workspace,
            RootLinks {
                agents: true,
                claude: false,
            },
        )
        .unwrap();
        let failure = first
            .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
            .unwrap_err();
        assert_eq!(
            failure.error,
            PublicationError::Read(if excessive_attrs {
                ReadError::Limit
            } else {
                ReadError::Unsupported
            })
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "original rules");
        assert!(!f.access.root.join(".voktty/kit.json").exists());
    }
}

#[test]
fn invalid_transaction_identity_cannot_choose_recovery_paths_and_unknown_versions_are_preserved() {
    let f = fixture();
    fs::create_dir(f.access.root.join(".voktty")).unwrap();
    fs::write(f.access.root.join(".voktty/.gitignore"), "*\n").unwrap();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    f.access.mode.store(1, Ordering::SeqCst);
    first
        .publish(&MigrationAccess(&f.access), &DiscoveryControl::default())
        .unwrap_err();
    f.access.mode.store(0, Ordering::SeqCst);
    let path = f.state.path().join("memory-deployment.json");
    let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for (field, value) in [
        ("transaction", json!("../../unrelated")),
        ("schema", json!(3)),
        ("schema", json!(1)),
    ] {
        let mut bad = saved.clone();
        bad[field] = value;
        let bytes = serde_json::to_vec(&bad).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(matches!(
            preview(&workspace, &workspace, RootLinks::default()),
            Err(PublicationError::InvalidIntent)
        ));
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    for original in ["\0".to_owned(), "x".repeat(256 * 1024 + 1)] {
        let mut bad = saved.clone();
        let ignore = bad["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|file| file["path"] == ".voktty/.gitignore")
            .unwrap();
        ignore["original"] = json!(original);
        let bytes = serde_json::to_vec(&bad).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(matches!(
            preview(&workspace, &workspace, RootLinks::default()),
            Err(PublicationError::InvalidIntent)
        ));
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    assert!(!f.access.root.join(".voktty/kit.json").exists());
}
