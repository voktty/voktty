use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use voktty_memory_local::{
    DiscoveryControl, LocalMemoryStore, LocalMemoryWorkspace, MemoryReadAccess,
    NativeMemoryPreservation, ReadControl, ReadError,
};
use voktty_workspace_kit::{compare_memory_protected, render_template};

type Hook = (PathBuf, Box<dyn FnOnce() + Send>);
struct Access {
    root: PathBuf,
    denied: Arc<Mutex<Option<PathBuf>>>,
    enumeration_denied: Arc<Mutex<Option<PathBuf>>>,
    reads: Mutex<BTreeSet<PathBuf>>,
    enumerated: Mutex<BTreeSet<PathBuf>>,
    hook: Mutex<Option<Hook>>,
}
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.denied.lock().unwrap().as_deref() != Some(path)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.allows_metadata(path) && (path.starts_with(&self.root) || self.root.starts_with(path))
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.enumerated.lock().unwrap().insert(path.into());
        self.allows_metadata(path)
            && self.enumeration_denied.lock().unwrap().as_deref() != Some(path)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.lock().unwrap().insert(path.into());
        let hook = {
            let mut hook = self.hook.lock().unwrap();
            if hook.as_ref().is_some_and(|(trigger, _)| trigger == path) {
                hook.take()
            } else {
                None
            }
        };
        if let Some((_, action)) = hook {
            action();
        }
        self.allows_metadata(path)
    }
}
struct Fixture {
    _project: tempfile::TempDir,
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
            serde_json::json!({"project_name":"Protected", "created_at":"2026-11-01"})
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
            _project: project,
            _state: state,
            store,
            access: Access {
                root,
                denied: Arc::new(Mutex::new(None)),
                enumeration_denied: Arc::new(Mutex::new(None)),
                reads: Mutex::new(BTreeSet::new()),
                enumerated: Mutex::new(BTreeSet::new()),
                hook: Mutex::new(None),
            },
        }
    }
    fn open(&self) -> LocalMemoryWorkspace<'_> {
        LocalMemoryWorkspace::open(
            &self.store,
            &self.access.root,
            &self.access,
            &ReadControl::default(),
        )
        .unwrap()
    }
    fn shared(&self) -> Result<NativeMemoryPreservation, ReadError> {
        self.open()
            .observe_shared_preservation(&DiscoveryControl::default())
    }
    fn write(&self, path: &str, text: &str) {
        let path = self.access.root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
}

#[test]
fn shared_capture_hashes_opaque_instruction_and_configuration_bytes_without_granting_trust() {
    let f = Fixture::new();
    f.write("AGENTS.md", "UNTRUSTED BODY\r\n```unclosed\n");
    f.write(".voktty/team/roles/custom.md", "UNTRUSTED ROLE\n");
    f.write(".voktty/team/agents.json", "{not parsed}");
    f.write(".voktty/capture/custom.md", "UNTRUSTED CAPTURE\n");
    for path in [
        ".voktty/state/private.md",
        ".voktty/sessions/private.md",
        ".voktty/mailbox/inbox/private.md",
        ".voktty/locks/private.md",
        ".voktty/tasks/private.md",
    ] {
        f.write(path, "PRIVATE UNREAD BODY");
    }
    let workspace = f.open();
    let before = workspace
        .observe_shared_preservation(&DiscoveryControl::default())
        .unwrap();
    let protected = serde_json::to_value(before.protected().unwrap()).unwrap();
    let files = protected["files"].as_array().unwrap();
    for path in [
        "AGENTS.md",
        ".voktty/team/agents.json",
        ".voktty/team/roles/custom.md",
        ".voktty/capture/custom.md",
    ] {
        assert!(files
            .iter()
            .any(|file| file["path"] == path && file["kind"] == "file"));
    }
    assert!(files
        .iter()
        .any(|file| file["path"] == "CLAUDE.md" && file["kind"] == "absent"));
    assert!(!protected.to_string().contains("UNTRUSTED"));
    assert!(!before.sources().contains_key("AGENTS.md"));
    assert!(!before.sources().contains_key("team/roles/custom.md"));
    let local = f.store.load().unwrap();
    assert_eq!(local.revision(), 0);
    assert!(local.project(workspace.project_key()).is_none());
    f.write(".voktty/team/roles/custom.md", "changed\r\n");
    f.write("CLAUDE.md", "new instructions");
    let after = workspace
        .observe_shared_preservation(&DiscoveryControl::default())
        .unwrap();
    let report = compare_memory_protected(before.protected().unwrap(), after.protected().unwrap());
    assert_eq!(report.changed_files, vec![".voktty/team/roles/custom.md"]);
    assert_eq!(report.added_files, vec!["CLAUDE.md"]);
    assert!(report.removed_files.is_empty());
    let reads = f.access.reads.lock().unwrap();
    let enumerated = f.access.enumerated.lock().unwrap();
    for name in ["state", "sessions", "mailbox", "locks", "tasks"] {
        let reserved = f.access.root.join(".voktty").join(name);
        assert!(!reads.iter().any(|p| p.starts_with(&reserved)));
        assert!(!enumerated.iter().any(|p| p.starts_with(&reserved)));
    }
}

#[test]
fn factual_only_capture_retains_its_no_instruction_read_contract() {
    let f = Fixture::new();
    *f.access.denied.lock().unwrap() = Some(f.access.root.join(".voktty/INIT.md"));
    let observed = f
        .open()
        .observe_preservation(&DiscoveryControl::default())
        .unwrap();
    assert!(observed.protected().is_none());
    assert!(!f
        .access
        .reads
        .lock()
        .unwrap()
        .contains(&f.access.root.join(".voktty/INIT.md")));
    assert!(f.shared().is_err());
}

#[test]
fn missing_protected_files_remain_verified_absence_and_unavailable_authority_is_never_absence() {
    let f = Fixture::new();
    std::fs::remove_file(f.access.root.join(".voktty/RULES.md")).unwrap();
    let before = f.shared().unwrap();
    let encoded = serde_json::to_value(before.protected().unwrap()).unwrap();
    assert!(encoded["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == ".voktty/RULES.md" && file["kind"] == "absent"));
    *f.access.denied.lock().unwrap() = Some(f.access.root.join(".voktty/RULES.md"));
    assert!(f.shared().is_err());
}

#[test]
fn unknown_shared_entries_cannot_be_silently_omitted() {
    for path in [
        ".voktty/unknown.md",
        ".voktty/unknown.json",
        ".voktty/team/extra.md",
        ".voktty/team/roles/Upper.md",
        ".voktty/team/roles/README.md",
        ".voktty/team/roles/binary.bin",
        ".voktty/capture/nested/extra.md",
        ".voktty/domains/note.txt",
    ] {
        let f = Fixture::new();
        f.write(path, "unqualified");
        assert!(f.shared().is_err(), "{path}");
    }
}

#[test]
fn changed_protected_text_after_its_read_rejects_the_whole_observation() {
    let f = Fixture::new();
    let path = f.access.root.join(".voktty/RULES.md");
    *f.access.hook.lock().unwrap() = Some((
        f.access.root.join("CLAUDE.md"),
        Box::new(move || {
            std::fs::write(path, "rewritten after first read").unwrap();
        }),
    ));
    assert!(matches!(f.shared(), Err(ReadError::StaleRoot)));
}

#[test]
fn new_role_membership_after_enumeration_retires_capture_without_relying_on_timestamps() {
    let f = Fixture::new();
    let path = f.access.root.join(".voktty/team/roles/new.md");
    *f.access.hook.lock().unwrap() = Some((
        f.access.root.join(".voktty/PROJECT.md"),
        Box::new(move || {
            std::fs::write(path, "new role").unwrap();
        }),
    ));
    assert!(matches!(f.shared(), Err(ReadError::StaleRoot)));
}

#[test]
fn shared_factual_and_protected_data_share_file_and_byte_budgets() {
    let f = Fixture::new();
    for n in 0..100 {
        f.write(&format!(".voktty/domains/doc-{n}.md"), "small");
    }
    assert!(f
        .open()
        .observe_preservation(&DiscoveryControl::default())
        .is_ok());
    assert!(matches!(f.shared(), Err(ReadError::Limit)));
    let f = Fixture::new();
    for n in 0..7 {
        f.write(
            &format!(".voktty/domains/doc-{n}.md"),
            &"x".repeat(256 * 1024),
        );
    }
    for n in 0..9 {
        f.write(
            &format!(".voktty/team/roles/role-{n}.md"),
            &"x".repeat(256 * 1024),
        );
    }
    assert!(f
        .open()
        .observe_preservation(&DiscoveryControl::default())
        .is_ok());
    assert!(matches!(f.shared(), Err(ReadError::Limit)));
}

#[test]
fn protected_enumeration_is_independent_from_metadata_and_read_grants() {
    for path in [
        ".voktty",
        ".voktty/capture",
        ".voktty/team",
        ".voktty/team/roles",
    ] {
        let f = Fixture::new();
        *f.access.enumeration_denied.lock().unwrap() = Some(f.access.root.join(path));
        assert!(matches!(f.shared(), Err(ReadError::Denied)), "{path}");
    }
}

#[test]
fn retired_read_enumeration_and_root_authority_cannot_publish_protected_evidence() {
    for target in [".voktty/RULES.md", ".voktty/team/roles", ""] {
        let f = Fixture::new();
        let denied = if target.ends_with("roles") {
            f.access.enumeration_denied.clone()
        } else {
            f.access.denied.clone()
        };
        let path = f.access.root.join(target);
        *f.access.hook.lock().unwrap() = Some((
            f.access.root.join("CLAUDE.md"),
            Box::new(move || {
                *denied.lock().unwrap() = Some(path);
            }),
        ));
        assert!(f.shared().is_err(), "{target}");
    }
}

#[cfg(unix)]
#[test]
fn protected_symlinks_never_follow_outside_targets() {
    for path in [
        "AGENTS.md",
        ".voktty/RULES.md",
        ".voktty/team/roles/link.md",
    ] {
        let f = Fixture::new();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("instructions.md");
        std::fs::write(&target, "PRIVATE OUTSIDE BODY").unwrap();
        let link = f.access.root.join(path);
        if link.exists() {
            std::fs::remove_file(&link).unwrap();
        }
        std::os::unix::fs::symlink(&target, link).unwrap();
        assert!(f.shared().is_err());
        assert!(!f.access.reads.lock().unwrap().contains(&target));
    }
}
