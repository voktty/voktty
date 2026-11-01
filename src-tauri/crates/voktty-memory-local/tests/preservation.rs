use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use voktty_memory_local::{
    DiscoveryControl, LocalMemoryStore, LocalMemoryWorkspace, MemoryReadAccess, ReadControl,
    ReadError,
};
use voktty_workspace_kit::{render_template, PathFact};

struct Access {
    root: PathBuf,
    denied: Mutex<Option<PathBuf>>,
    enumerated: Mutex<BTreeSet<PathBuf>>,
    reads: Mutex<BTreeSet<PathBuf>>,
    mutate: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.denied.lock().unwrap().as_deref() != Some(path)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.allows_metadata(path) && (path.starts_with(&self.root) || self.root.starts_with(path))
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.enumerated.lock().unwrap().insert(path.to_owned());
        self.allows_metadata(path)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.lock().unwrap().insert(path.to_owned());
        if path == self.root.join(".voktty/PROJECT.md") {
            if let Some(mutate) = self.mutate.lock().unwrap().take() {
                mutate();
            }
        }
        self.allows_metadata(path)
    }
}

struct Fixture {
    project: tempfile::TempDir,
    _state: tempfile::TempDir,
    store: LocalMemoryStore,
    access: Access,
}

impl Fixture {
    fn new() -> Self {
        let project = tempfile::tempdir().unwrap();
        let state = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(state.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let store = LocalMemoryStore::open(state.path()).unwrap();
        store.initialize().unwrap();
        let root = std::fs::canonicalize(project.path()).unwrap();
        for file in render_template(
            serde_json::json!({"project_name":"Inventory", "created_at":"2026-11-01"})
                .as_object()
                .unwrap(),
        )
        .unwrap()
        {
            if file.path.starts_with(".voktty/") {
                let path = root.join(file.path);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, file.text).unwrap();
            }
        }
        Self {
            project,
            _state: state,
            store,
            access: Access {
                root,
                denied: Mutex::new(None),
                reads: Mutex::new(BTreeSet::new()),
                enumerated: Mutex::new(BTreeSet::new()),
                mutate: Mutex::new(None),
            },
        }
    }

    fn open(&self) -> LocalMemoryWorkspace<'_> {
        LocalMemoryWorkspace::open(
            &self.store,
            self.project.path(),
            &self.access,
            &ReadControl::default(),
        )
        .unwrap()
    }

    fn write(&self, path: &str, text: &str) {
        let path = self.access.root.join(".voktty").join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
}

#[test]
fn captures_actual_factual_bytes_without_reading_bases_or_reserved_state() {
    let fixture = Fixture::new();
    for path in [
        "plans/work.md",
        "domains/model.md",
        "continuity/handoffs/legacy.md",
        "archive/2026-01/nested/README.md",
    ] {
        fixture.write(path, "# Exact\r\n[T-1 open] é\r\n");
    }
    fixture.write("state/secret.md", "unread");
    fixture.write("mailbox/secret.md", "unread");
    let workspace = fixture.open();
    let baseline = workspace
        .observe_preservation(&DiscoveryControl::default())
        .unwrap();
    for path in [
        "plans/work.md",
        "domains/model.md",
        "continuity/handoffs/legacy.md",
        "archive/2026-01/nested/README.md",
    ] {
        assert!(matches!(&baseline.sources()[path], PathFact::File {text}
            if text == "# Exact\r\n[T-1 open] é\r\n"));
    }
    assert!(!baseline.sources().contains_key("state/secret.md"));
    assert!(!baseline.sources().contains_key("INIT.md"));
    assert!(serde_json::to_value(baseline.snapshot()).unwrap()["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == "plans/work.md"));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(baseline.config()).unwrap()["schema"],
        1
    );
    workspace
        .validate_preservation_binding(&baseline, &ReadControl::default())
        .unwrap();
    let reads = fixture.access.reads.lock().unwrap();
    assert!(!reads.iter().any(|path| path.ends_with("INIT.md")
        || path.starts_with(fixture.access.root.join(".voktty/state"))
        || path.starts_with(fixture.access.root.join(".voktty/mailbox"))));
}

#[test]
fn missing_and_denied_factual_inputs_never_publish_a_partial_baseline() {
    for path in [
        "PROJECT.md",
        "plans/INDEX.md",
        "archive/LOG.md",
        "domains/model.md",
    ] {
        let fixture = Fixture::new();
        fixture.write("domains/model.md", "model");
        *fixture.access.denied.lock().unwrap() =
            Some(fixture.access.root.join(".voktty").join(path));
        assert!(fixture
            .open()
            .observe_preservation(&DiscoveryControl::default())
            .is_err());
    }
    let fixture = Fixture::new();
    std::fs::remove_file(fixture.access.root.join(".voktty/archive/LOG.md")).unwrap();
    assert!(fixture
        .open()
        .observe_preservation(&DiscoveryControl::default())
        .is_err());
}

#[test]
fn nested_live_layouts_and_invalid_archive_months_are_explicitly_unsupported() {
    for path in [
        "plans/nested/work.md",
        "archive/2026-13/work.md",
        "archive/aééxx/x.md",
        "archive/2026-01-01/work.md",
    ] {
        let fixture = Fixture::new();
        fixture.write(path, "work");
        assert!(matches!(
            fixture
                .open()
                .observe_preservation(&DiscoveryControl::default()),
            Err(ReadError::Unsupported)
        ));
    }
}

#[test]
fn file_count_and_aggregate_byte_limits_fail_without_partial_evidence() {
    for large in [false, true] {
        let fixture = Fixture::new();
        for index in 0..if large { 17 } else { 129 } {
            fixture.write(
                &format!("domains/card-{index}.md"),
                &"x".repeat(if large { 256 * 1024 } else { 1 }),
            );
        }
        assert!(matches!(
            fixture
                .open()
                .observe_preservation(&DiscoveryControl::default()),
            Err(ReadError::Limit)
        ));
    }
}

#[test]
fn mutations_to_read_files_and_enumerated_membership_retire_capture() {
    for membership in [false, true] {
        let fixture = Fixture::new();
        let root = fixture.access.root.clone();
        *fixture.access.mutate.lock().unwrap() = Some(Box::new(move || {
            let path = if membership {
                "plans/new.md"
            } else {
                "CONTEXT.md"
            };
            std::fs::write(root.join(".voktty").join(path), "changed").unwrap();
        }));
        assert!(matches!(
            fixture
                .open()
                .observe_preservation(&DiscoveryControl::default()),
            Err(ReadError::StaleRoot)
        ));
    }
}

#[test]
fn baselines_cannot_bind_to_another_root_or_installation() {
    let fixture = Fixture::new();
    let workspace = fixture.open();
    let baseline = workspace
        .observe_preservation(&DiscoveryControl::default())
        .unwrap();
    let other = Fixture::new();
    assert_eq!(
        other
            .open()
            .validate_preservation_binding(&baseline, &ReadControl::default()),
        Err(ReadError::StaleRoot)
    );
    let same_installation = LocalMemoryWorkspace::open(
        &fixture.store,
        &other.access.root,
        &other.access,
        &ReadControl::default(),
    )
    .unwrap();
    assert_eq!(
        same_installation.validate_preservation_binding(&baseline, &ReadControl::default()),
        Err(ReadError::StaleRoot)
    );
    std::fs::remove_file(fixture._state.path().join("memory-local.json")).unwrap();
    fixture.store.initialize().unwrap();
    assert_eq!(
        workspace.validate_preservation_binding(&baseline, &ReadControl::default()),
        Err(ReadError::StaleInstallation)
    );
}

#[test]
fn cancelled_and_expired_capture_does_not_read_documents() {
    let fixture = Fixture::new();
    let workspace = fixture.open();
    let cancelled = DiscoveryControl::default();
    cancelled.cancel();
    for control in [cancelled, DiscoveryControl::new(std::time::Duration::ZERO)] {
        assert!(matches!(
            workspace.observe_preservation(&control),
            Err(ReadError::Cancelled | ReadError::Timeout)
        ));
    }
    assert!(fixture.access.reads.lock().unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn symlinked_optional_directories_and_documents_never_read_the_target() {
    for directory in [false, true] {
        let fixture = Fixture::new();
        let target = tempfile::tempdir().unwrap();
        std::fs::write(target.path().join("outside.md"), "outside").unwrap();
        let (from, to) = if directory {
            std::fs::remove_dir_all(fixture.access.root.join(".voktty/domains")).unwrap();
            (
                target.path().to_owned(),
                fixture.access.root.join(".voktty/domains"),
            )
        } else {
            (
                target.path().join("outside.md"),
                fixture.access.root.join(".voktty/plans/link.md"),
            )
        };
        std::os::unix::fs::symlink(from, to).unwrap();
        assert!(fixture
            .open()
            .observe_preservation(&DiscoveryControl::default())
            .is_err());
        assert!(!fixture
            .access
            .reads
            .lock()
            .unwrap()
            .iter()
            .any(|path| path.starts_with(target.path())));
    }
}

#[test]
fn enumeration_is_independent_authority_and_is_rechecked_before_publication() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct EnumerationAccess<'a> {
        access: &'a Access,
        calls: AtomicUsize,
        allow_first: bool,
    }
    impl MemoryReadAccess for EnumerationAccess<'_> {
        fn allows_metadata(&self, path: &Path) -> bool {
            self.access.allows_metadata(path)
        }
        fn allows_workspace_root(&self, path: &Path) -> bool {
            self.access.allows_workspace_root(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            self.access.allows_read(path)
        }
        fn allows_enumeration(&self, path: &Path) -> bool {
            if path == self.access.root.join(".voktty/domains") {
                return self.calls.fetch_add(1, Ordering::SeqCst) == 0 && self.allow_first;
            }
            self.access.allows_enumeration(path)
        }
    }
    for allow_first in [false, true] {
        let fixture = Fixture::new();
        let access = EnumerationAccess {
            access: &fixture.access,
            calls: AtomicUsize::new(0),
            allow_first,
        };
        let workspace = LocalMemoryWorkspace::open(
            &fixture.store,
            &fixture.access.root,
            &access,
            &ReadControl::default(),
        )
        .unwrap();
        assert!(matches!(
            workspace.observe_preservation(&DiscoveryControl::default()),
            Err(ReadError::Denied)
        ));
    }
}

#[test]
fn changed_configuration_or_replaced_kit_cannot_publish_old_facts() {
    for replace in [false, true] {
        let fixture = Fixture::new();
        let root = fixture.access.root.clone();
        *fixture.access.mutate.lock().unwrap() = Some(Box::new(move || {
            let kit = root.join(".voktty");
            if replace {
                std::fs::rename(&kit, root.join("previous-kit")).unwrap();
                std::fs::create_dir(&kit).unwrap();
                std::fs::copy(root.join("previous-kit/kit.json"), kit.join("kit.json")).unwrap();
            } else {
                let path = kit.join("kit.json");
                let mut text = std::fs::read_to_string(&path).unwrap();
                text.push('\n');
                std::fs::write(path, text).unwrap();
            }
        }));
        assert!(fixture
            .open()
            .observe_preservation(&DiscoveryControl::default())
            .is_err());
    }
}

#[test]
fn execution_subdirectories_must_first_resolve_the_actual_memory_root() {
    let fixture = Fixture::new();
    let child = fixture.access.root.join("child");
    std::fs::create_dir(&child).unwrap();
    let workspace = LocalMemoryWorkspace::open(
        &fixture.store,
        &child,
        &fixture.access,
        &ReadControl::default(),
    )
    .unwrap();
    assert!(matches!(
        workspace.observe_preservation(&DiscoveryControl::default()),
        Err(ReadError::Unavailable)
    ));
}

#[test]
fn oversized_or_uninspectable_documents_fail_without_positive_snapshot() {
    for text in ["x".repeat(256 * 1024 + 1), "```unclosed\n[T-1 open]".into()] {
        let fixture = Fixture::new();
        fixture.write("plans/work.md", &text);
        assert!(fixture
            .open()
            .observe_preservation(&DiscoveryControl::default())
            .is_err());
    }
}

#[test]
fn expanded_factual_channels_capture_real_bytes_and_retain_open_obligations() {
    use voktty_workspace_kit::compare_memory_preservation;
    for path in [
        "architecture/auth.md",
        "rituals/SCHEDULE.md",
        "external/review.md",
    ] {
        let fixture = Fixture::new();
        fixture.write(path, "# Exact\r\n[T-71]\r\n");
        let workspace = fixture.open();
        let before = workspace
            .observe_preservation(&DiscoveryControl::default())
            .unwrap();
        assert!(
            matches!(before.sources().get(path), Some(PathFact::File { text })
            if text == "# Exact\r\n[T-71]\r\n")
        );
        fixture.write(path, "# Current\n");
        let after = workspace
            .observe_preservation(&DiscoveryControl::default())
            .unwrap();
        let loss = compare_memory_preservation(before.snapshot(), after.snapshot());
        assert_eq!(loss.missing_live_items, vec!["T-71"]);
        assert_eq!(loss.missing_items, vec!["T-71"]);
    }
}

#[test]
fn expanded_factual_channels_require_independent_enumeration_and_read_authority() {
    for path in [
        "architecture/auth.md",
        "rituals/SCHEDULE.md",
        "external/review.md",
    ] {
        for directory in [false, true] {
            let fixture = Fixture::new();
            fixture.write(path, "[D-71]\n");
            let target = if directory {
                path.split('/').next().unwrap()
            } else {
                path
            };
            *fixture.access.denied.lock().unwrap() =
                Some(fixture.access.root.join(".voktty").join(target));
            assert!(fixture
                .open()
                .observe_preservation(&DiscoveryControl::default())
                .is_err());
        }
    }
}

#[test]
fn new_factual_membership_after_enumeration_retires_expanded_capture() {
    for directory in ["architecture", "rituals", "external"] {
        let fixture = Fixture::new();
        let target = fixture
            .access
            .root
            .join(".voktty")
            .join(directory)
            .join("new.md");
        *fixture.access.mutate.lock().unwrap() = Some(Box::new(move || {
            std::fs::write(target, "[Q-71]\n").unwrap();
        }));
        let result = fixture
            .open()
            .observe_preservation(&DiscoveryControl::default());
        assert!(
            matches!(&result, Err(ReadError::StaleRoot)),
            "{directory}: {:?}",
            result.err()
        );
    }
}
