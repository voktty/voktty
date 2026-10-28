#![cfg(windows)]

use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use voktty_memory_local::{
    DiscoveryControl, InitializationPreview, LocalMemoryStore, LocalMemoryWorkspace,
    MemoryReadAccess, MemoryWriteAccess, PublicationError, ReadControl, ReadError,
};
use voktty_workspace_kit::RootLinks;

struct Access {
    root: PathBuf,
    mode: AtomicUsize,
    complete_stage: AtomicBool,
    rename_refused: AtomicBool,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
            || self.root.ancestors().any(|p| p == path)
            || self.root.ancestors().any(|p| path == p.join(".voktty"))
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
        let kit = self.root.join(".voktty");
        let staged = fs::read_dir(&kit).ok().and_then(|mut entries| {
            entries.find_map(|entry| {
                let entry = entry.unwrap();
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".voktty-stage-")
                    .then(|| entry.path())
            })
        });
        if path.ends_with("INIT.md") {
            if let Some(staged) = staged {
                self.complete_stage.store(
                    !path.exists() && fs::read(&staged).is_ok_and(|bytes| !bytes.is_empty()),
                    Ordering::SeqCst,
                );
                let mode = self.mode.load(Ordering::SeqCst);
                if matches!(mode, 2..=5) {
                    self.mode.store(0, Ordering::SeqCst);
                }
                match mode {
                    2 => fs::write(path, "foreign racing bytes").unwrap(),
                    3 => fs::write(kit.join("init.md"), "foreign case alias").unwrap(),
                    4 => fs::hard_link(self.root.join("outside"), path).unwrap(),
                    5 => {
                        self.rename_refused.store(
                            fs::rename(&kit, self.root.join("moved-kit")).is_err(),
                            Ordering::SeqCst,
                        );
                    }
                    6 => return false,
                    _ => {}
                }
            }
        }
        !(self.mode.load(Ordering::SeqCst) == 1
            && path.ends_with("RULES.md")
            && kit.join("INIT.md").exists())
    }
}

struct Fixture {
    _project: tempfile::TempDir,
    state: tempfile::TempDir,
    store: LocalMemoryStore,
    access: Access,
}
fn fixture() -> Fixture {
    let project = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    let store = LocalMemoryStore::open(state.path()).unwrap();
    store.initialize().unwrap();
    let access = Access {
        root: fs::canonicalize(project.path()).unwrap(),
        mode: AtomicUsize::new(0),
        complete_stage: AtomicBool::new(false),
        rename_refused: AtomicBool::new(false),
    };
    Fixture {
        _project: project,
        state,
        store,
        access,
    }
}
fn open(f: &Fixture) -> LocalMemoryWorkspace<'_> {
    LocalMemoryWorkspace::open(&f.store, &f.access.root, &f.access, &ReadControl::default())
        .unwrap()
}
fn preview<'w, 's>(
    workspace: &'w LocalMemoryWorkspace<'s>,
    links: RootLinks,
) -> InitializationPreview<'w, 's> {
    InitializationPreview::prepare(
        workspace,
        workspace,
        json!({"project_name":"Windows publication","created_at":"2026-10-28"})
            .as_object()
            .unwrap(),
        links,
        &DiscoveryControl::default(),
    )
    .unwrap()
}
fn no_staging(root: &Path) {
    assert!(fs::read_dir(root.join(".voktty")).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".voktty-stage-")
    }));
}

#[test]
fn publishes_complete_reviewed_inventory_with_marker_last_and_idempotent_retry() {
    let f = fixture();
    let workspace = open(&f);
    let first = preview(
        &workspace,
        RootLinks {
            agents: true,
            claude: true,
        },
    );
    assert_eq!(first.publication_blocker(), None);
    let expected = first.deployment().plan.entries.clone();
    assert!(!f.access.root.join(".voktty").exists());
    let preferences = fs::read(f.state.path().join("memory-local.json")).unwrap();
    let report = first
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.created.len(), expected.len());
    assert_eq!(report.created.last().unwrap(), ".voktty/kit.json");
    assert!(f.access.complete_stage.load(Ordering::SeqCst));
    let modified: Vec<_> = expected
        .iter()
        .map(|entry| {
            let path = f.access.root.join(&entry.path);
            assert_eq!(fs::read(&path).unwrap(), entry.proposed.as_bytes());
            fs::metadata(path).unwrap().modified().unwrap()
        })
        .collect();
    let second = preview(
        &workspace,
        RootLinks {
            agents: true,
            claude: true,
        },
    )
    .publish(&f.access, &DiscoveryControl::default())
    .unwrap();
    assert!(second.created.is_empty() && second.migrated.is_empty());
    assert_eq!(second.skipped.len(), expected.len());
    for (entry, modified) in expected.iter().zip(modified) {
        assert_eq!(
            fs::metadata(f.access.root.join(&entry.path))
                .unwrap()
                .modified()
                .unwrap(),
            modified
        );
    }
    assert_eq!(
        fs::read(f.state.path().join("memory-local.json")).unwrap(),
        preferences
    );
    assert!(!f.state.path().join("memory-deployment.json").exists());
    no_staging(&f.access.root);
}

#[test]
fn interrupted_creation_keeps_intent_and_resumes_from_a_new_native_preview() {
    let f = fixture();
    let workspace = open(&f);
    let first = preview(&workspace, RootLinks::default());
    f.access.mode.store(1, Ordering::SeqCst);
    let failure = first
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::Read(ReadError::Denied));
    assert!(!failure.created.is_empty());
    assert!(!f.access.root.join(".voktty/kit.json").exists());
    assert!(f.state.path().join("memory-deployment.json").exists());
    no_staging(&f.access.root);
    f.access.mode.store(0, Ordering::SeqCst);
    drop(workspace);
    let reopened = open(&f);
    let next = preview(&reopened, RootLinks::default());
    assert!(next.is_resuming());
    let report = next
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(report.created.last().unwrap(), ".voktty/kit.json");
    assert!(!f.state.path().join("memory-deployment.json").exists());
}

#[test]
fn racing_file_case_alias_and_hardlink_are_never_replaced() {
    for mode in [2, 3, 4] {
        let f = fixture();
        fs::write(f.access.root.join("outside"), "outside bytes").unwrap();
        let workspace = open(&f);
        let first = preview(&workspace, RootLinks::default());
        let proposed_init = first
            .deployment()
            .plan
            .entries
            .iter()
            .find(|entry| entry.path == ".voktty/INIT.md")
            .unwrap()
            .proposed
            .clone();
        f.access.mode.store(mode, Ordering::SeqCst);
        let result = first.publish(&f.access, &DiscoveryControl::default());
        if mode == 3 && result.is_ok() {
            assert_eq!(
                fs::read_to_string(f.access.root.join(".voktty/init.md")).unwrap(),
                "foreign case alias"
            );
            assert_eq!(
                fs::read_to_string(f.access.root.join(".voktty/INIT.md")).unwrap(),
                proposed_init
            );
            assert!(f.access.root.join(".voktty/kit.json").exists());
            no_staging(&f.access.root);
            continue;
        }
        let failure = result.unwrap_err();
        assert_eq!(failure.error, PublicationError::Conflict);
        let expected = match mode {
            2 => "foreign racing bytes",
            3 => "foreign case alias",
            _ => "outside bytes",
        };
        assert_eq!(
            fs::read_to_string(f.access.root.join(".voktty/INIT.md")).unwrap(),
            expected
        );
        assert_eq!(
            fs::read_to_string(f.access.root.join("outside")).unwrap(),
            "outside bytes"
        );
        assert!(!f.access.root.join(".voktty/kit.json").exists());
        no_staging(&f.access.root);
    }
}

#[test]
fn parent_handles_refuse_rename_and_late_denial_only_deletes_own_stage() {
    for mode in [5, 6] {
        let f = fixture();
        let workspace = open(&f);
        let first = preview(&workspace, RootLinks::default());
        f.access.mode.store(mode, Ordering::SeqCst);
        let result = first.publish(&f.access, &DiscoveryControl::default());
        if mode == 5 {
            result.unwrap();
            assert!(f.access.rename_refused.load(Ordering::SeqCst));
            assert!(!f.access.root.join("moved-kit").exists());
        } else {
            assert_eq!(
                result.unwrap_err().error,
                PublicationError::Read(ReadError::Denied)
            );
            assert!(!f.access.root.join(".voktty/INIT.md").exists());
            assert!(!f.access.root.join(".voktty/kit.json").exists());
        }
        no_staging(&f.access.root);
    }
}

#[test]
fn unsupported_migration_is_visible_and_refused_before_any_project_write() {
    let f = fixture();
    fs::write(f.access.root.join("AGENTS.md"), "User rules\r\n").unwrap();
    let workspace = open(&f);
    let first = preview(
        &workspace,
        RootLinks {
            agents: true,
            claude: false,
        },
    );
    assert_eq!(
        first.publication_blocker(),
        Some(PublicationError::MigrationUnsupported)
    );
    let failure = first
        .publish(&f.access, &DiscoveryControl::default())
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::MigrationUnsupported);
    assert!(failure.created.is_empty());
    assert_eq!(
        fs::read(f.access.root.join("AGENTS.md")).unwrap(),
        b"User rules\r\n"
    );
    assert!(!f.access.root.join(".voktty").exists());
    assert!(!f.state.path().join("memory-deployment.json").exists());
}

#[test]
fn cancellation_after_staging_preserves_intent_without_publishing_or_leaking_stage() {
    struct CancelAfterStage<'a> {
        access: &'a Access,
        control: &'a DiscoveryControl,
    }
    impl MemoryWriteAccess for CancelAfterStage<'_> {
        fn allows_create(&self, path: &Path) -> bool {
            let allowed = self.access.allows_create(path);
            if self.access.complete_stage.load(Ordering::SeqCst) {
                self.control.cancel();
            }
            allowed
        }
    }
    let f = fixture();
    let workspace = open(&f);
    let first = preview(&workspace, RootLinks::default());
    let control = DiscoveryControl::default();
    let failure = first
        .publish(
            &CancelAfterStage {
                access: &f.access,
                control: &control,
            },
            &control,
        )
        .unwrap_err();
    assert_eq!(failure.error, PublicationError::Read(ReadError::Cancelled));
    assert!(!f.access.root.join(".voktty/INIT.md").exists());
    assert!(!f.access.root.join(".voktty/kit.json").exists());
    assert!(f.state.path().join("memory-deployment.json").exists());
    no_staging(&f.access.root);
}
