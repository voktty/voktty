#![cfg(unix)]

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Map, Value};
use voktty_memory_local::{
    LocalMemoryStore, LocalMemoryWorkspace, MemoryPolicy, MemoryReadAccess, ReadControl, ReadError,
    StoreError,
};
use voktty_workspace_kit::{
    build_memory_context, memory_project_key, prepare_deployment, render_template, PathFact,
    RootLinks,
};

struct Access {
    root: PathBuf,
    denied: Mutex<BTreeSet<PathBuf>>,
    reads: AtomicUsize,
    revoke_root: AtomicBool,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        !self.revoke_root.load(Ordering::Acquire) && path.starts_with(&self.root)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.fetch_add(1, Ordering::Relaxed);
        path.starts_with(&self.root) && !self.denied.lock().unwrap().contains(path)
    }
}

struct Fixture {
    project: tempfile::TempDir,
    _state: tempfile::TempDir,
    store: LocalMemoryStore,
    access: Access,
}

fn inputs() -> Map<String, Value> {
    json!({"project_name":"Native reader","created_at":"2026-10-28"})
        .as_object()
        .unwrap()
        .clone()
}

fn fixture(populated: bool) -> Fixture {
    let project = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    fs::set_permissions(state.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let store = LocalMemoryStore::open(state.path()).unwrap();
    store.initialize().unwrap();
    let root = fs::canonicalize(project.path()).unwrap();
    if populated {
        for file in render_template(&inputs())
            .unwrap()
            .into_iter()
            .filter(|file| file.path.starts_with(".voktty/"))
        {
            let path = root.join(file.path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, file.text).unwrap();
        }
    }
    Fixture {
        project,
        _state: state,
        store,
        access: Access {
            root,
            denied: Mutex::new(BTreeSet::new()),
            reads: AtomicUsize::new(0),
            revoke_root: AtomicBool::new(false),
        },
    }
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

fn file_text(fact: &PathFact) -> &str {
    match fact {
        PathFact::File { text } => text,
        _ => panic!("expected file observation"),
    }
}

#[test]
fn native_identity_uses_installation_filesystem_and_actual_canonical_root() {
    let f = fixture(true);
    fs::create_dir(f.project.path().join("child")).unwrap();
    let requested = f.project.path().join("child/..");
    let workspace =
        LocalMemoryWorkspace::open(&f.store, &requested, &f.access, &ReadControl::default())
            .unwrap();
    assert_eq!(
        workspace.identity()["canonicalRoot"],
        f.access.root.to_str().unwrap()
    );
    assert_eq!(
        workspace.identity()["machineId"],
        f.store.load().unwrap().installation_id()
    );
    assert!(workspace.identity()["filesystemId"]
        .as_str()
        .unwrap()
        .starts_with("unix-device:"));
    assert_eq!(
        memory_project_key(&workspace.identity().to_string()).unwrap(),
        workspace.project_key()
    );
    let other = fixture(true);
    assert_ne!(workspace.project_key(), open(&other).project_key());
}

#[test]
fn explicit_authorization_and_existing_local_identity_are_required() {
    let f = fixture(false);
    let foreign = tempfile::tempdir().unwrap();
    assert!(matches!(
        LocalMemoryWorkspace::open(&f.store, foreign.path(), &f.access, &ReadControl::default()),
        Err(ReadError::Denied)
    ));
    assert!(matches!(
        LocalMemoryWorkspace::open(
            &f.store,
            Path::new("relative"),
            &f.access,
            &ReadControl::default()
        ),
        Err(ReadError::InvalidInput)
    ));
    fs::remove_file(f._state.path().join("memory-local.json")).unwrap();
    assert!(matches!(
        LocalMemoryWorkspace::open(
            &f.store,
            f.project.path(),
            &f.access,
            &ReadControl::default()
        ),
        Err(ReadError::Store(StoreError::Missing))
    ));
    assert!(!f._state.path().join("memory-local.json").exists());
}

#[test]
fn real_empty_directory_observations_feed_the_shared_deployment_preparation() {
    let f = fixture(false);
    let facts = open(&f)
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(facts.values().all(|fact| matches!(fact, PathFact::Absent)));
    assert!(!facts.contains_key("AGENTS.md"));
    assert!(!facts.contains_key("CLAUDE.md"));
    assert!(facts.contains_key(".voktty/kit.lock.json"));
    let files = render_template(&inputs()).unwrap();
    let prepared = prepare_deployment("1.1.0", &files, &facts, RootLinks::default()).unwrap();
    assert!(prepared.plan.can_publish);
    assert!(!f.project.path().join(".voktty").exists());
}

#[test]
fn deployment_observes_only_selected_links_and_preserves_exact_bytes() {
    let f = fixture(true);
    fs::write(f.project.path().join("AGENTS.md"), "User rules\r\n😀\r\n").unwrap();
    fs::write(
        f.project.path().join("CLAUDE.md"),
        "private unselected rules",
    )
    .unwrap();
    f.access
        .denied
        .lock()
        .unwrap()
        .insert(f.access.root.join("CLAUDE.md"));
    let facts = open(&f)
        .observe_deployment(
            RootLinks {
                agents: true,
                claude: false,
            },
            &ReadControl::default(),
        )
        .unwrap();
    assert_eq!(file_text(&facts["AGENTS.md"]), "User rules\r\n😀\r\n");
    assert!(!facts.contains_key("CLAUDE.md"));
    assert!(!facts
        .keys()
        .any(|path| path.contains("sessions") || path.contains("tasks")));
}

#[test]
fn context_uses_actual_bytes_and_native_preferences_without_starting_a_session() {
    let f = fixture(true);
    let workspace = open(&f);
    let first = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    f.store
        .set_policy(0, workspace.project_key(), MemoryPolicy::Always)
        .unwrap();
    f.store
        .trust_instructions(1, workspace.project_key(), &first.fingerprint.digest)
        .unwrap();
    let observed = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    assert_eq!(observed.local_preferences.revision(), 2);
    assert_eq!(observed.fingerprint.digest, first.fingerprint.digest);
    let preference = observed
        .local_preferences
        .project(workspace.project_key())
        .unwrap();
    let source = json!({"schema":1,"identity":observed.identity,"config":observed.config,"instructions":observed.instructions,
        "project":{"kind":"file","text":file_text(&observed.project)},"context":{"kind":"file","text":file_text(&observed.context)},"activePlan":null,
        "use":{"schema":1,"projectKey":observed.project_key,"sessionId":"test-session","kitState":"ready","instructionDigest":observed.fingerprint.digest,
        "localPolicy":{"projectKey":preference.project_key,"mode":preference.policy},"trust":{"projectKey":preference.project_key,"instructionDigest":preference.instruction_digest},"session":null,"capabilities":{"context":true,"capture":true}}});
    // The fixture supplies ready/capabilities; no production scope or adapter is inferred.
    let packet = build_memory_context(&source.to_string()).unwrap();
    assert!(packet.decision.context_allowed);
    assert!(!packet.decision.capture_allowed);
    assert!(packet.packet.unwrap().bytes <= 24 * 1024);
    fs::write(f.project.path().join(".voktty/INIT.md"), "changed\r\n").unwrap();
    let changed = workspace
        .observe_context(None, &ReadControl::default())
        .unwrap();
    assert_ne!(changed.fingerprint.digest, first.fingerprint.digest);
    assert_eq!(
        changed
            .local_preferences
            .project(workspace.project_key())
            .unwrap()
            .instruction_digest
            .as_deref(),
        Some(first.fingerprint.digest.as_str())
    );
}

#[test]
fn custom_roles_are_bounded_and_traversal_is_rejected_before_reading() {
    let f = fixture(true);
    fs::write(
        f.project.path().join(".voktty/team/roles/my-role.md"),
        "Custom role\r\n",
    )
    .unwrap();
    let workspace = open(&f);
    let assigned = workspace
        .observe_context(
            Some(".voktty/team/roles/my-role.md"),
            &ReadControl::default(),
        )
        .unwrap();
    assert!(assigned.instructions["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["path"] == ".voktty/team/roles/my-role.md"));
    let count = f.access.reads.load(Ordering::Relaxed);
    for role in [
        "../secret.md",
        ".voktty/team/roles/../other.md",
        ".voktty/team/roles/Upper.md",
        ".voktty/team/roles/.md",
    ] {
        assert!(matches!(
            workspace.observe_context(Some(role), &ReadControl::default()),
            Err(ReadError::InvalidInput)
        ));
    }
    assert_eq!(f.access.reads.load(Ordering::Relaxed), count);
    assert_ne!(
        assigned.fingerprint.digest,
        workspace
            .observe_context(None, &ReadControl::default())
            .unwrap()
            .fingerprint
            .digest
    );
}

#[test]
fn denied_files_are_blocked_and_cannot_produce_a_partial_trusted_fingerprint() {
    let f = fixture(true);
    f.access
        .denied
        .lock()
        .unwrap()
        .insert(f.access.root.join(".voktty/INIT.md"));
    let workspace = open(&f);
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/INIT.md"], PathFact::Blocked));
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::default()),
        Err(ReadError::Contract(_))
    ));
    f.access.revoke_root.store(true, Ordering::Release);
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &ReadControl::default()),
        Err(ReadError::Denied)
    ));
}

#[test]
fn symlinked_directories_and_files_and_hardlinks_never_expose_outside_content() {
    let f = fixture(false);
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("INIT.md"), "outside secret").unwrap();
    symlink(outside.path(), f.project.path().join(".voktty")).unwrap();
    let workspace = open(&f);
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/INIT.md"], PathFact::Blocked));
    fs::remove_file(f.project.path().join(".voktty")).unwrap();
    fs::create_dir(f.project.path().join(".voktty")).unwrap();
    let target = f.project.path().join(".voktty/INIT.md");
    symlink(outside.path().join("INIT.md"), &target).unwrap();
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/INIT.md"], PathFact::Blocked));
    fs::remove_file(&target).unwrap();
    fs::hard_link(outside.path().join("INIT.md"), &target).unwrap();
    let facts = workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
    assert!(matches!(facts[".voktty/INIT.md"], PathFact::Blocked));
}

#[test]
fn special_invalid_and_oversized_files_are_blocked_without_blocking_on_a_fifo() {
    use std::os::unix::ffi::OsStrExt;
    let f = fixture(false);
    fs::create_dir(f.project.path().join(".voktty")).unwrap();
    let path = f.project.path().join(".voktty/INIT.md");
    let fifo = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    let workspace = open(&f);
    for bytes in [
        None,
        Some(vec![b'x'; 256 * 1024 + 1]),
        Some(vec![0xff]),
        Some(b"nul\0text".to_vec()),
    ] {
        if let Some(bytes) = bytes {
            fs::remove_file(&path).unwrap();
            fs::write(&path, bytes).unwrap();
        }
        let facts = workspace
            .observe_deployment(RootLinks::default(), &ReadControl::default())
            .unwrap();
        assert!(matches!(facts[".voktty/INIT.md"], PathFact::Blocked));
    }
}

#[test]
fn replacement_of_root_or_installation_invalidates_an_existing_binding() {
    let f = fixture(true);
    let workspace = open(&f);
    let moved = f.project.path().with_extension("moved");
    fs::rename(f.project.path(), &moved).unwrap();
    fs::create_dir(f.project.path()).unwrap();
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &ReadControl::default()),
        Err(ReadError::StaleRoot)
    ));
    fs::remove_dir(f.project.path()).unwrap();
    fs::rename(&moved, f.project.path()).unwrap();
    fs::remove_file(f._state.path().join("memory-local.json")).unwrap();
    f.store.initialize().unwrap();
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &ReadControl::default()),
        Err(ReadError::StaleInstallation)
    ));
}

#[test]
fn cancelled_and_expired_requests_do_not_return_partial_observations() {
    let f = fixture(true);
    let workspace = open(&f);
    let cancelled = ReadControl::default();
    cancelled.cancel();
    let count = f.access.reads.load(Ordering::Relaxed);
    assert!(matches!(
        workspace.observe_deployment(RootLinks::default(), &cancelled),
        Err(ReadError::Cancelled)
    ));
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::new(Duration::ZERO)),
        Err(ReadError::Timeout)
    ));
    assert_eq!(f.access.reads.load(Ordering::Relaxed), count);
}

#[test]
fn aggregate_limit_returns_no_partial_preview() {
    let f = fixture(true);
    for name in [
        "INIT.md",
        "RULES.md",
        "PROJECT.md",
        "CONTEXT.md",
        "README.md",
    ] {
        fs::write(
            f.project.path().join(".voktty").join(name),
            vec![b'x'; 256 * 1024],
        )
        .unwrap();
    }
    assert!(matches!(
        open(&f).observe_deployment(RootLinks::default(), &ReadControl::default()),
        Err(ReadError::Limit)
    ));
}

#[test]
fn concurrent_native_batches_are_limited_to_four_without_waiting() {
    use std::sync::{mpsc, Condvar};
    struct BlockingAccess<'a> {
        inner: &'a Access,
        ready: mpsc::Sender<()>,
        release: &'a (Mutex<usize>, Condvar),
        waits: AtomicUsize,
    }
    impl MemoryReadAccess for BlockingAccess<'_> {
        fn allows_metadata(&self, path: &Path) -> bool {
            self.inner.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            let ticket = self.waits.fetch_add(1, Ordering::Relaxed);
            if ticket < 4 {
                self.ready.send(()).unwrap();
                let (released, signal) = self.release;
                drop(
                    signal
                        .wait_timeout_while(
                            released.lock().unwrap(),
                            Duration::from_secs(3),
                            |released| *released <= ticket,
                        )
                        .unwrap(),
                );
            }
            self.inner.allows_read(path)
        }
    }
    let f = fixture(false);
    let (sender, receiver) = mpsc::channel();
    let release = (Mutex::new(0), Condvar::new());
    let access = BlockingAccess {
        inner: &f.access,
        ready: sender,
        release: &release,
        waits: AtomicUsize::new(0),
    };
    let workspace =
        LocalMemoryWorkspace::open(&f.store, f.project.path(), &access, &ReadControl::default())
            .unwrap();
    std::thread::scope(|scope| {
        let mut workers = Vec::new();
        let mut ready = true;
        for _ in 0..4 {
            workers.push(scope.spawn(|| {
                workspace.observe_deployment(RootLinks::default(), &ReadControl::default())
            }));
            if receiver.recv_timeout(Duration::from_secs(3)).is_err() {
                ready = false;
                break;
            }
        }
        let busy = ready
            && matches!(
                workspace.observe_deployment(RootLinks::default(), &ReadControl::default()),
                Err(ReadError::Busy)
            );
        for (index, worker) in workers.into_iter().enumerate() {
            // Serialize preference rechecks so store contention cannot mask the
            // independent invariant of four concurrent filesystem batches.
            *release.0.lock().unwrap() = index + 1;
            release.1.notify_all();
            worker.join().unwrap().unwrap();
        }
        assert!(ready && busy);
    });
    workspace
        .observe_deployment(RootLinks::default(), &ReadControl::default())
        .unwrap();
}

#[test]
fn a_policy_change_during_gathering_rejects_the_whole_observation() {
    struct MutatingAccess<'a> {
        inner: &'a Access,
        store: &'a LocalMemoryStore,
        key: String,
        changed: AtomicBool,
    }
    impl MemoryReadAccess for MutatingAccess<'_> {
        fn allows_metadata(&self, path: &Path) -> bool {
            self.inner.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            if !self.changed.swap(true, Ordering::AcqRel) {
                self.store
                    .set_policy(0, &self.key, MemoryPolicy::Never)
                    .unwrap();
            }
            self.inner.allows_read(path)
        }
    }
    let f = fixture(true);
    let key = open(&f).project_key().to_owned();
    let access = MutatingAccess {
        inner: &f.access,
        store: &f.store,
        key,
        changed: AtomicBool::new(false),
    };
    let workspace =
        LocalMemoryWorkspace::open(&f.store, f.project.path(), &access, &ReadControl::default())
            .unwrap();
    assert!(matches!(
        workspace.observe_context(None, &ReadControl::default()),
        Err(ReadError::Store(StoreError::Conflict))
    ));
    assert_eq!(
        f.store
            .load()
            .unwrap()
            .project(workspace.project_key())
            .unwrap()
            .policy,
        MemoryPolicy::Never
    );
}

#[test]
fn swapping_the_bound_root_for_an_outside_link_during_read_discards_all_facts() {
    struct SwappingAccess<'a> {
        inner: &'a Access,
        moved: PathBuf,
        outside: PathBuf,
        swapped: AtomicBool,
    }
    impl MemoryReadAccess for SwappingAccess<'_> {
        fn allows_metadata(&self, path: &Path) -> bool {
            self.inner.allows_metadata(path)
        }
        fn allows_read(&self, path: &Path) -> bool {
            if !self.swapped.swap(true, Ordering::AcqRel) {
                fs::rename(&self.inner.root, &self.moved).unwrap();
                symlink(&self.outside, &self.inner.root).unwrap();
            }
            self.inner.allows_read(path)
        }
    }
    let f = fixture(true);
    let owner = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir(outside.path().join(".voktty")).unwrap();
    fs::write(outside.path().join(".voktty/INIT.md"), "outside secret").unwrap();
    let access = SwappingAccess {
        inner: &f.access,
        moved: owner.path().join("original"),
        outside: outside.path().to_path_buf(),
        swapped: AtomicBool::new(false),
    };
    let workspace =
        LocalMemoryWorkspace::open(&f.store, f.project.path(), &access, &ReadControl::default())
            .unwrap();
    let result = workspace.observe_deployment(RootLinks::default(), &ReadControl::default());
    fs::remove_file(f.project.path()).unwrap();
    fs::rename(&access.moved, f.project.path()).unwrap();
    assert!(matches!(result, Err(ReadError::StaleRoot)));
    assert_eq!(
        fs::read_to_string(outside.path().join(".voktty/INIT.md")).unwrap(),
        "outside secret"
    );
}
