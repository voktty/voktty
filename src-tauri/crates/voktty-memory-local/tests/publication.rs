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
fn known_migration_is_visible_but_cannot_enter_create_only_writer() {
    let f = fixture();
    fs::create_dir(f.access.root.join(".voktty")).unwrap();
    fs::write(f.access.root.join(".voktty/.gitignore"), "*\n").unwrap();
    fs::write(f.access.root.join(".voktty/tasks.json"), "reserved bytes").unwrap();
    let workspace = open(&f, &f.access.root);
    let first = preview(&workspace, &workspace, RootLinks::default()).unwrap();
    assert_eq!(
        first.publication_blocker(),
        Some(PublicationError::MigrationUnsupported)
    );
    assert_eq!(
        first
            .publish(&f.access, &DiscoveryControl::default())
            .unwrap_err()
            .error,
        PublicationError::MigrationUnsupported
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
