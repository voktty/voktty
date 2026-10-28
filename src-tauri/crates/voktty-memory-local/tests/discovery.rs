use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use voktty_memory_local::{
    DiscoveryControl, DiscoveryPurpose, LocalMemoryStore, LocalMemoryWorkspace, MemoryReadAccess,
    ReadControl, ReadError,
};
use voktty_workspace_kit::{parse_kit_config, render_template};

struct Access {
    root: PathBuf,
    requested: PathBuf,
    above: bool,
    denied: Mutex<BTreeSet<PathBuf>>,
    reads: Mutex<Vec<PathBuf>>,
    metadata: Mutex<Vec<PathBuf>>,
}
impl MemoryReadAccess for Access {
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.root) && self.allows_metadata(path)
    }
    fn allows_metadata(&self, path: &Path) -> bool {
        self.metadata.lock().unwrap().push(path.to_path_buf());
        if self.denied.lock().unwrap().contains(path) {
            return false;
        }
        path.starts_with(&self.root)
            || path.starts_with(&self.requested)
            || (self.above
                && (self.root.ancestors().any(|p| p == path)
                    || (path.file_name() == Some(std::ffi::OsStr::new(".voktty"))
                        && path
                            .parent()
                            .is_some_and(|p| self.root.ancestors().any(|a| a == p)))))
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.lock().unwrap().push(path.to_path_buf());
        path.starts_with(&self.root) && !self.denied.lock().unwrap().contains(path)
    }
}
struct Fixture {
    project: tempfile::TempDir,
    _state: tempfile::TempDir,
    store: LocalMemoryStore,
    access: Access,
}
fn fixture(above: bool) -> Fixture {
    let project = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }
    let store = LocalMemoryStore::open(state.path()).unwrap();
    store.initialize().unwrap();
    let root = fs::canonicalize(project.path()).unwrap();
    let access = Access {
        root,
        requested: project.path().to_path_buf(),
        above,
        denied: Mutex::new(BTreeSet::new()),
        reads: Mutex::new(Vec::new()),
        metadata: Mutex::new(Vec::new()),
    };
    Fixture {
        project,
        _state: state,
        store,
        access,
    }
}
fn config() -> String {
    let files = render_template(
        json!({"project_name":"Discovery fixture","created_at":"2026-10-28"})
            .as_object()
            .unwrap(),
    )
    .unwrap();
    let mut value: Value = serde_json::from_str(
        &files
            .iter()
            .find(|f| f.path == ".voktty/kit.json")
            .unwrap()
            .text,
    )
    .unwrap();
    value.as_object_mut().unwrap().remove("values");
    let text = value.to_string();
    assert!(parse_kit_config(&text).is_ok());
    text
}
fn kit(path: &Path) {
    fs::create_dir_all(path.join(".voktty")).unwrap();
    fs::write(path.join(".voktty/kit.json"), config()).unwrap();
}
fn open(f: &Fixture) -> LocalMemoryWorkspace<'_> {
    LocalMemoryWorkspace::open(
        &f.store,
        f.project.path(),
        &f.access,
        &ReadControl::default(),
    )
    .unwrap()
}

#[test]
fn verified_empty_tree_can_initialize_only_after_complete_ancestry() {
    let f = fixture(true);
    let observed = open(&f)
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(observed.facts["ancestors"][0]["state"], "absent");
    assert_eq!(observed.facts["descendants"]["stop"], "complete");
    assert_eq!(observed.scope.descendants_complete, Some(true));
    assert_eq!(
        observed.scope.initialization,
        if observed.scope.ancestry_complete {
            "clear"
        } else {
            "blocked"
        }
    );
    assert!(!f.project.path().join(".voktty").exists());
    // Host ancestors may contain their own protected kit. Their contents are never read.
    assert!(f
        .access
        .reads
        .lock()
        .unwrap()
        .iter()
        .all(|p| p.starts_with(&f.access.root)));
}

#[test]
fn authorization_boundary_never_proves_absence_even_with_a_valid_local_kit() {
    let f = fixture(false);
    kit(f.project.path());
    fs::create_dir_all(f.project.path().join("child/src")).unwrap();
    let workspace = LocalMemoryWorkspace::open(
        &f.store,
        &f.project.path().join("child/src"),
        &f.access,
        &ReadControl::default(),
    )
    .unwrap();
    let observed = workspace
        .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(observed.facts["stop"], "authorization");
    assert!(!observed.scope.ancestry_complete);
    assert_eq!(observed.scope.state, "incomplete");
    assert_eq!(
        observed.scope.root_key.as_deref(),
        Some(open(&f).project_key())
    );
    assert_eq!(observed.facts["ancestors"].as_array().unwrap().len(), 3);
    assert!(observed.facts["descendants"].is_null());
    assert!(!observed.blocked_paths.is_empty());
}

#[test]
fn cold_discovery_does_not_enumerate_children_or_read_project_content() {
    let f = fixture(false);
    kit(f.project.path());
    fs::create_dir(f.project.path().join("not-a-scan-target")).unwrap();
    fs::write(
        f.project.path().join(".voktty/PROJECT.md"),
        "never read this factual text",
    )
    .unwrap();
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
        .unwrap();
    assert!(result.facts["descendants"].is_null());
    assert!(!f
        .access
        .metadata
        .lock()
        .unwrap()
        .iter()
        .any(|p| p.file_name() == Some(std::ffi::OsStr::new("not-a-scan-target"))));
    assert!(f
        .access
        .reads
        .lock()
        .unwrap()
        .iter()
        .all(|p| p.file_name() == Some(std::ffi::OsStr::new("kit.json"))));
}

#[test]
fn explicit_scan_lists_sibling_kits_including_ignored_and_unverified_git_folders() {
    let f = fixture(false);
    for path in ["pepe", "juan", "carlos", ".git/hidden-workspace"] {
        kit(&f.project.path().join(path));
    }
    fs::write(f.project.path().join(".gitignore"), "*\n").unwrap();
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(result.scope.descendant_kits.len(), 4);
    assert!(result.scope.root_key.is_none());
    assert_eq!(result.scope.initialization, "blocked");
    assert_eq!(result.facts["descendants"]["stop"], "complete");
    assert!(result
        .directories
        .iter()
        .any(|d| d.path.ends_with("hidden-workspace") && d.state == "valid"));
}

#[test]
fn parent_and_descendant_kits_are_ambiguous_without_silent_selection() {
    let f = fixture(false);
    kit(f.project.path());
    kit(&f.project.path().join("child"));
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Manage, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(result.scope.state, "ambiguous");
    assert_eq!(result.scope.ancestor_kits.len(), 1);
    assert_eq!(result.scope.descendant_kits.len(), 1);
    assert_eq!(result.scope.initialization, "not_requested");
}

#[test]
fn reserved_runtime_data_stays_reserved_without_reading_its_contents() {
    let f = fixture(false);
    let root = f.project.path().join(".voktty");
    fs::create_dir_all(root.join("sessions/private")).unwrap();
    fs::write(root.join("tasks.json"), "secret task text").unwrap();
    fs::write(root.join(".gitignore"), "*\n").unwrap();
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(result.facts["ancestors"][0]["state"], "reserved");
    assert!(f.access.reads.lock().unwrap().is_empty());
    assert_eq!(
        fs::read_to_string(root.join("tasks.json")).unwrap(),
        "secret task text"
    );
}

#[test]
fn partial_invalid_and_denied_markers_are_not_absence() {
    let f = fixture(false);
    let root = f.project.path().join(".voktty");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("INIT.md"), "incomplete deployment").unwrap();
    let workspace = open(&f);
    assert_eq!(
        workspace
            .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
            .unwrap()
            .scope
            .state,
        "partial"
    );
    fs::write(root.join("kit.json"), "{invalid").unwrap();
    assert_eq!(
        workspace
            .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
            .unwrap()
            .scope
            .state,
        "invalid"
    );
    *f.access.denied.lock().unwrap() = BTreeSet::from([f.access.root.join(".voktty/kit.json")]);
    let denied = workspace
        .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(denied.scope.state, "denied");
    assert_eq!(denied.facts["stop"], "authorization");
}

#[cfg(unix)]
#[test]
fn directory_links_stop_the_scan_without_following_targets_or_inventing_keys() {
    let f = fixture(false);
    let outside = tempfile::tempdir().unwrap();
    kit(outside.path());
    let link = f.project.path().join("linked");
    std::os::unix::fs::symlink(outside.path(), &link).unwrap();
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(result.facts["descendants"]["stop"], "link");
    assert_eq!(result.scope.descendants_complete, Some(false));
    assert!(result.scope.descendant_kits.is_empty());
    assert_eq!(result.scope.initialization, "blocked");
    assert!(result.blocked_paths.contains(&f.access.root.join("linked")));
    assert!(f.access.reads.lock().unwrap().is_empty());
}

#[test]
fn entry_depth_and_finding_limits_block_incomplete_initialization() {
    let f = fixture(false);
    for n in 0..20001 {
        fs::write(f.project.path().join(format!("entry-{n}")), "").unwrap();
    }
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(result.facts["descendants"]["entries"], 20000);
    assert_eq!(result.facts["descendants"]["stop"], "entry_limit");
    assert_eq!(result.scope.initialization, "blocked");
    let f = fixture(false);
    let mut path = f.project.path().to_path_buf();
    for _ in 0..65 {
        path.push("d");
        fs::create_dir(&path).unwrap();
    }
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(result.facts["descendants"]["depth"], 64);
    assert_eq!(result.facts["descendants"]["stop"], "depth");
    assert_eq!(result.scope.initialization, "blocked");
    let f = fixture(false);
    let text = config();
    assert!(text.len() * 1025 < 1024 * 1024);
    for n in 0..1025 {
        let path = f.project.path().join(format!("kit-{n}"));
        fs::create_dir_all(path.join(".voktty")).unwrap();
        fs::write(path.join(".voktty/kit.json"), &text).unwrap();
    }
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(result.scope.descendant_kits.len(), 1024);
    assert_eq!(result.facts["descendants"]["stop"], "entry_limit");
    assert_eq!(result.scope.initialization, "blocked");
}

#[test]
fn configuration_byte_budget_never_turns_unread_metadata_into_absence() {
    let f = fixture(false);
    let mut text = config();
    text.extend(std::iter::repeat_n(' ', 256 * 1024 - text.len()));
    for n in 0..5 {
        let path = f.project.path().join(format!("kit-{n}"));
        fs::create_dir_all(path.join(".voktty")).unwrap();
        fs::write(path.join(".voktty/kit.json"), &text).unwrap();
    }
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(result.facts["descendants"]["stop"], "error");
    assert_eq!(result.scope.descendants_complete, Some(false));
    assert_eq!(result.scope.initialization, "blocked");
    assert_eq!(
        f.access
            .reads
            .lock()
            .unwrap()
            .iter()
            .collect::<BTreeSet<_>>()
            .len(),
        4
    );
}

#[test]
fn cancelled_expired_and_replaced_installations_return_no_usable_scope() {
    let f = fixture(false);
    let workspace = open(&f);
    let cancelled = DiscoveryControl::default();
    cancelled.cancel();
    assert!(matches!(
        workspace.observe_scope(DiscoveryPurpose::Initialize, &cancelled),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        workspace.observe_scope(
            DiscoveryPurpose::Discover,
            &DiscoveryControl::new(Duration::ZERO)
        ),
        Err(ReadError::Timeout)
    ));
    fs::remove_file(f._state.path().join("memory-local.json")).unwrap();
    f.store.initialize().unwrap();
    assert!(matches!(
        workspace.observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default()),
        Err(ReadError::StaleInstallation)
    ));
}

#[cfg(unix)]
#[test]
fn mutation_during_metadata_enumeration_cannot_yield_a_complete_scan() {
    use std::sync::atomic::{AtomicBool, Ordering};
    struct Mutating<'a> {
        inner: &'a Access,
        changed: AtomicBool,
    }
    impl MemoryReadAccess for Mutating<'_> {
        fn allows_enumeration(&self, path: &Path) -> bool {
            self.inner.allows_enumeration(path)
        }
        fn allows_metadata(&self, path: &Path) -> bool {
            if path.file_name() == Some(std::ffi::OsStr::new("trigger"))
                && !self.changed.swap(true, Ordering::AcqRel)
            {
                fs::write(self.inner.root.join("changed-during-scan"), "").unwrap();
            }
            self.inner.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            self.inner.allows_read(path)
        }
    }
    let f = fixture(false);
    fs::write(f.project.path().join("trigger"), "").unwrap();
    fs::File::open(f.project.path())
        .unwrap()
        .set_modified(std::time::UNIX_EPOCH)
        .unwrap();
    let access = Mutating {
        inner: &f.access,
        changed: AtomicBool::new(false),
    };
    let workspace =
        LocalMemoryWorkspace::open(&f.store, f.project.path(), &access, &ReadControl::default())
            .unwrap();
    let result = workspace
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert!(access.changed.load(Ordering::Acquire));
    assert_eq!(result.facts["descendants"]["stop"], "error");
    assert_eq!(result.scope.initialization, "blocked");
}

#[test]
fn a_kit_created_between_ancestry_and_descendant_phases_cannot_be_clear() {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    struct Appearing<'a> {
        inner: &'a Access,
        target: PathBuf,
        install: PathBuf,
        armed: AtomicBool,
        calls: AtomicUsize,
    }
    impl MemoryReadAccess for Appearing<'_> {
        fn allows_enumeration(&self, path: &Path) -> bool {
            self.inner.allows_enumeration(path)
        }
        fn allows_metadata(&self, path: &Path) -> bool {
            if self.armed.load(Ordering::Acquire)
                && path == self.target
                && self.calls.fetch_add(1, Ordering::AcqRel) == 2
            {
                kit(&self.install);
            }
            self.inner.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            self.inner.allows_read(path)
        }
    }
    for ancestor in [false, true] {
        let f = fixture(true);
        let target = if ancestor {
            f.project.path().join("work")
        } else {
            f.project.path().to_path_buf()
        };
        fs::create_dir_all(&target).unwrap();
        let target = fs::canonicalize(target).unwrap();
        let access = Appearing {
            inner: &f.access,
            target: target.clone(),
            install: f.access.root.clone(),
            armed: AtomicBool::new(false),
            calls: AtomicUsize::new(0),
        };
        let workspace =
            LocalMemoryWorkspace::open(&f.store, &target, &access, &ReadControl::default())
                .unwrap();
        access.armed.store(true, Ordering::Release);
        let result = workspace
            .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
            .unwrap();
        assert!(access.calls.load(Ordering::Acquire) >= 3);
        assert_eq!(result.scope.initialization, "blocked");
        if !ancestor {
            assert_eq!(result.facts["descendants"]["stop"], "error");
        } else if !result.facts["ancestors"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["state"] == "denied")
        {
            assert_eq!(result.facts["stop"], "error");
            assert!(result.facts["ancestors"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["state"] == "unavailable"));
        }
    }
}

#[test]
fn metadata_authority_does_not_implicitly_authorize_enumeration() {
    struct MetadataOnly<'a>(&'a Access);
    impl MemoryReadAccess for MetadataOnly<'_> {
        fn allows_metadata(&self, path: &Path) -> bool {
            self.0.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            self.0.allows_read(path)
        }
    }
    let f = fixture(false);
    let access = MetadataOnly(&f.access);
    let workspace =
        LocalMemoryWorkspace::open(&f.store, f.project.path(), &access, &ReadControl::default())
            .unwrap();
    let observed = workspace
        .observe_scope(DiscoveryPurpose::Initialize, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(observed.facts["descendants"]["stop"], "authorization");
    assert_eq!(observed.scope.descendants_complete, Some(false));
    assert_eq!(observed.scope.initialization, "blocked");
}

#[test]
fn denying_child_metadata_or_cancelling_mid_scan_never_completes() {
    struct Interrupted<'a> {
        inner: &'a Access,
        control: DiscoveryControl,
        cancel: bool,
    }
    impl MemoryReadAccess for Interrupted<'_> {
        fn allows_enumeration(&self, path: &Path) -> bool {
            self.inner.allows_enumeration(path)
        }
        fn allows_metadata(&self, path: &Path) -> bool {
            if path.file_name() == Some(std::ffi::OsStr::new("trigger")) {
                if self.cancel {
                    self.control.cancel();
                } else {
                    return false;
                }
            }
            self.inner.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            self.inner.allows_read(path)
        }
    }
    for cancel in [false, true] {
        let f = fixture(false);
        fs::write(f.project.path().join("trigger"), "").unwrap();
        let control = DiscoveryControl::default();
        let access = Interrupted {
            inner: &f.access,
            control: control.clone(),
            cancel,
        };
        let workspace = LocalMemoryWorkspace::open(
            &f.store,
            f.project.path(),
            &access,
            &ReadControl::default(),
        )
        .unwrap();
        let result = workspace.observe_scope(DiscoveryPurpose::Initialize, &control);
        if cancel {
            assert!(matches!(result, Err(ReadError::Cancelled)));
        } else {
            let result = result.unwrap();
            assert_eq!(result.facts["descendants"]["stop"], "authorization");
            assert_eq!(result.scope.initialization, "blocked");
        }
    }
}

#[test]
fn preference_revocation_during_discovery_discards_the_observation() {
    use std::sync::atomic::{AtomicBool, Ordering};
    struct Revoking<'a> {
        inner: &'a Access,
        store: &'a LocalMemoryStore,
        key: String,
        changed: AtomicBool,
    }
    impl MemoryReadAccess for Revoking<'_> {
        fn allows_enumeration(&self, path: &Path) -> bool {
            self.inner.allows_enumeration(path)
        }
        fn allows_metadata(&self, path: &Path) -> bool {
            self.inner.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            if !self.changed.swap(true, Ordering::AcqRel) {
                self.store
                    .set_policy(0, &self.key, voktty_memory_local::MemoryPolicy::Never)
                    .unwrap();
            }
            self.inner.allows_read(path)
        }
    }
    let f = fixture(false);
    kit(f.project.path());
    let key = open(&f).project_key().to_owned();
    let access = Revoking {
        inner: &f.access,
        store: &f.store,
        key,
        changed: AtomicBool::new(false),
    };
    let workspace =
        LocalMemoryWorkspace::open(&f.store, f.project.path(), &access, &ReadControl::default())
            .unwrap();
    assert!(matches!(
        workspace.observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default()),
        Err(ReadError::Store(voktty_memory_local::StoreError::Conflict))
    ));
}

#[cfg(unix)]
#[test]
fn ancestry_records_stay_in_the_execution_filesystem() {
    use std::os::unix::fs::MetadataExt;
    let f = fixture(true);
    let device = fs::metadata(&f.access.root).unwrap().dev();
    let result = open(&f)
        .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
        .unwrap();
    for directory in &result.directories {
        assert_eq!(fs::metadata(&directory.path).unwrap().dev(), device);
    }
    if result.scope.ancestry_complete {
        let mut expected = f.access.root.clone();
        while let Some(parent) = expected.parent() {
            if fs::metadata(parent).unwrap().dev() != device {
                break;
            }
            expected = parent.to_path_buf();
        }
        assert_eq!(result.directories.last().unwrap().path, expected);
    }
}
