#![cfg(any(unix, windows))]

use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use voktty_memory_local::{
    DiscoveryControl, DiscoveryPurpose, MemoryReadAccess, ProjectMemoryWorkspace, ReadControl,
    ReadError,
};
use voktty_workspace_kit::{render_template, PathFact, RootLinks};

// The production reader admits four concurrent reads in this process.
static SERIAL: Mutex<()> = Mutex::new(());

struct Access {
    requested: PathBuf,
    root: PathBuf,
    active: AtomicBool,
    documents: bool,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.active.load(Ordering::Acquire)
            && (path.starts_with(&self.requested) || path.starts_with(&self.root))
    }

    fn allows_read(&self, path: &Path) -> bool {
        self.documents && self.allows_metadata(path)
    }
}

fn access(path: &Path) -> Access {
    Access {
        requested: path.to_owned(),
        root: fs::canonicalize(path).unwrap(),
        active: AtomicBool::new(true),
        documents: true,
    }
}

#[test]
fn project_deployment_observation_needs_no_private_storage_and_writes_nothing() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    fs::write(
        private.path().join("memory-local.json"),
        "unusable private state",
    )
    .unwrap();
    let authority = access(project.path());
    let workspace =
        ProjectMemoryWorkspace::open(project.path(), &authority, &ReadControl::default()).unwrap();
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/kit.json"], PathFact::Absent));
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
    assert_eq!(fs::read_dir(private.path()).unwrap().count(), 1);
    assert_eq!(
        fs::read_to_string(private.path().join("memory-local.json")).unwrap(),
        "unusable private state"
    );
}

#[test]
fn project_observation_preserves_existing_kit_sessions_and_rule_files() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let inputs = json!({"project_name":"Project reader","created_at":"2026-11-03"});
    let files = render_template(inputs.as_object().unwrap()).unwrap();
    for file in &files {
        if !file.path.starts_with(".voktty/") {
            continue;
        }
        let path = project.path().join(&file.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, &file.text).unwrap();
    }
    fs::create_dir_all(project.path().join(".voktty/sessions")).unwrap();
    fs::write(
        project.path().join(".voktty/sessions/owner.json"),
        "session",
    )
    .unwrap();
    fs::write(project.path().join("AGENTS.md"), "owner rules").unwrap();
    let authority = access(project.path());
    let workspace =
        ProjectMemoryWorkspace::open(project.path(), &authority, &ReadControl::default()).unwrap();
    let facts = workspace
        .observe_deployment(
            RootLinks {
                agents: true,
                claude: false,
            },
            &ReadControl::default(),
        )
        .unwrap();
    for file in &files {
        if file.path.starts_with(".voktty/") {
            assert!(matches!(&facts[&file.path], PathFact::File { text } if text == &file.text));
            assert_eq!(
                fs::read_to_string(project.path().join(&file.path)).unwrap(),
                file.text
            );
        }
    }
    assert!(matches!(&facts["AGENTS.md"], PathFact::File { text } if text == "owner rules"));
    assert!(!facts.contains_key(".voktty/sessions/owner.json"));
    assert_eq!(
        fs::read_to_string(project.path().join(".voktty/sessions/owner.json")).unwrap(),
        "session"
    );
    let observed = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    assert_eq!(observed.config["project"], "Project reader");
    assert!(observed.instructions["files"]
        .as_array()
        .unwrap()
        .iter()
        .all(|file| file["path"] != ".voktty/sessions/owner.json"));
    fs::write(
        project.path().join(".voktty/CONTEXT.md"),
        "New project facts\n",
    )
    .unwrap();
    let updated = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    assert_eq!(updated.fingerprint, observed.fingerprint);
    assert!(matches!(updated.context, PathFact::File { text } if text == "New project facts\n"));
    fs::write(
        project.path().join(".voktty/INIT.md"),
        "Updated project guide\n",
    )
    .unwrap();
    let instructions = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    assert_ne!(instructions.fingerprint, observed.fingerprint);
    assert!(matches!(
        workspace.observe_context(
            Some(".voktty/team/roles/../../.env"),
            &ReadControl::default()
        ),
        Err(ReadError::InvalidInput)
    ));
}

#[test]
fn metadata_grants_cannot_read_documents_and_retirement_denies_later_reads() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::create_dir(project.path().join(".voktty")).unwrap();
    fs::write(
        project.path().join(".voktty/PROJECT.md"),
        "private project text",
    )
    .unwrap();
    let mut authority = access(project.path());
    authority.documents = false;
    let workspace =
        ProjectMemoryWorkspace::open(project.path(), &authority, &ReadControl::default()).unwrap();
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/PROJECT.md"], PathFact::Blocked));
    assert!(workspace
        .observe_context(None, &ReadControl::default())
        .is_err());
    authority.active.store(false, Ordering::Release);
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &ReadControl::default()),
        Err(ReadError::Denied)
    ));
}

#[test]
fn cancellation_and_deadline_stop_project_observation() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let workspace =
        ProjectMemoryWorkspace::open(project.path(), &authority, &ReadControl::default()).unwrap();
    let cancelled = ReadControl::default();
    cancelled.cancel();
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &cancelled),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        workspace.observe_context(None, &cancelled),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::new(Duration::ZERO)),
        Err(ReadError::Timeout)
    ));
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &ReadControl::new(Duration::ZERO)),
        Err(ReadError::Timeout)
    ));
    assert!(matches!(
        ProjectMemoryWorkspace::open(project.path(), &authority, &cancelled),
        Err(ReadError::Cancelled)
    ));
}

#[test]
fn project_scope_keys_are_observation_local_and_do_not_create_installation_state() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let workspace =
        ProjectMemoryWorkspace::open(project.path(), &authority, &ReadControl::default()).unwrap();
    let first = workspace
        .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
        .unwrap();
    let second = workspace
        .observe_scope(DiscoveryPurpose::Discover, &DiscoveryControl::default())
        .unwrap();
    assert_eq!(first.scope.state, "incomplete");
    assert!(!first.scope.ancestry_complete);
    assert_ne!(
        first.directories[0].directory_key,
        second.directories[0].directory_key
    );
    assert_eq!(fs::read_dir(project.path()).unwrap().count(), 0);
}

#[test]
fn deployment_reads_keep_the_aggregate_byte_limit() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::create_dir(project.path().join(".voktty")).unwrap();
    for name in [
        "PROJECT.md",
        "CONTEXT.md",
        "INIT.md",
        "RULES.md",
        "INDEX.md",
    ] {
        fs::write(
            project.path().join(".voktty").join(name),
            "x".repeat(256 * 1024),
        )
        .unwrap();
    }
    let authority = access(project.path());
    let workspace =
        ProjectMemoryWorkspace::open(project.path(), &authority, &ReadControl::default()).unwrap();
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &ReadControl::default()),
        Err(ReadError::Limit)
    ));
}

#[test]
fn secret_and_foreign_transport_roots_cannot_use_the_project_reader() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    let authority = access(project.path());
    let protected = project.path().join(".ssh");
    fs::create_dir(&protected).unwrap();
    assert!(matches!(
        ProjectMemoryWorkspace::open(&protected, &authority, &ReadControl::default()),
        Err(ReadError::Denied)
    ));
    for path in ["remote://host/project", r"\\host\share"] {
        assert!(
            ProjectMemoryWorkspace::open(Path::new(path), &authority, &ReadControl::default())
                .is_err()
        );
    }
}

#[cfg(unix)]
#[test]
fn replacing_a_captured_project_or_linking_a_document_never_redirects_reads() {
    let _serial = SERIAL.lock().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let project = parent.path().join("project");
    fs::create_dir(&project).unwrap();
    fs::create_dir(project.join(".voktty")).unwrap();
    let outside = parent.path().join("outside.md");
    fs::write(&outside, "outside text").unwrap();
    std::os::unix::fs::symlink(&outside, project.join(".voktty/PROJECT.md")).unwrap();
    let authority = access(&project);
    let workspace =
        ProjectMemoryWorkspace::open(&project, &authority, &ReadControl::default()).unwrap();
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/PROJECT.md"], PathFact::Blocked));
    fs::rename(&project, parent.path().join("retired")).unwrap();
    fs::create_dir(&project).unwrap();
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &ReadControl::default()),
        Err(ReadError::StaleRoot)
    ));
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::default()),
        Err(ReadError::StaleRoot)
    ));
}

#[test]
fn context_reads_keep_the_aggregate_byte_limit_before_parsing() {
    let _serial = SERIAL.lock().unwrap();
    let project = tempfile::tempdir().unwrap();
    for name in [
        "INIT.md",
        "RULES.md",
        "INDEX.md",
        "README.md",
        "kit.schema.json",
        "PROJECT.md",
        "CONTEXT.md",
        "plans/README.md",
        "continuity/README.md",
    ] {
        let path = project.path().join(".voktty").join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "x".repeat(256 * 1024)).unwrap();
    }
    let authority = access(project.path());
    let workspace =
        ProjectMemoryWorkspace::open(project.path(), &authority, &ReadControl::default()).unwrap();
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::default()),
        Err(ReadError::Limit)
    ));
}
