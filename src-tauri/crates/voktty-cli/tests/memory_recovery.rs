#![cfg(target_os = "linux")]

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Arc;
use voktty_memory_local::{
    DiscoveryControl, InitializationPreview, LocalMemoryStore, LocalMemoryWorkspace, MemoryPolicy,
    MemoryReadAccess, MemoryWriteAccess, ReadControl,
};

struct FixtureAccess(PathBuf);
impl MemoryReadAccess for FixtureAccess {
    fn allows_metadata(&self, _path: &Path) -> bool {
        true
    }
    fn allows_read(&self, path: &Path) -> bool {
        path.starts_with(&self.0) || path.ends_with(".voktty/kit.json")
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
            || self
                .0
                .ancestors()
                .any(|ancestor| path == ancestor.join(".voktty"))
    }
}
impl MemoryWriteAccess for FixtureAccess {
    fn allows_create(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
            && !(path == self.0.join(".voktty/kit.json") && self.0.join(".voktty/INIT.md").exists())
    }
    fn allows_replace(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
}

struct Fixture {
    _owned: tempfile::TempDir,
    _private: tempfile::TempDir,
    root: PathBuf,
    data: PathBuf,
    originals: BTreeMap<String, Vec<u8>>,
    backups: BTreeMap<String, String>,
    _guard: std::sync::MutexGuard<'static, ()>,
}

static FIXTURE_PUBLICATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

impl Fixture {
    fn blank() -> Self {
        // A CLI fork must not inherit another fixture's live nonblocking store lock.
        let guard = FIXTURE_PUBLICATION
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let owned = tempfile::tempdir_in("/dev/shm").unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::set_permissions(private.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let root = owned.path().join("project");
        fs::create_dir(&root).unwrap();
        Self {
            root,
            data: private.path().join("data"),
            _owned: owned,
            _private: private,
            originals: BTreeMap::new(),
            backups: BTreeMap::new(),
            _guard: guard,
        }
    }

    fn parent(&self) -> PathBuf {
        self.data.join("app.voktty.voktty")
    }
    fn state_path(&self) -> PathBuf {
        self.parent().join("project-memory/memory-local.json")
    }
    fn intent_path(&self) -> PathBuf {
        self.parent().join("project-memory/memory-deployment.json")
    }

    fn store(&self) -> Arc<LocalMemoryStore> {
        let control = ReadControl::default();
        LocalMemoryStore::prepare_application_parent(&self.parent(), &control).unwrap();
        let store = Arc::new(LocalMemoryStore::create_private(&self.parent(), &control).unwrap());
        store.initialize().unwrap();
        store
    }

    fn interrupted() -> Self {
        let mut f = Self::blank();
        fs::create_dir_all(f.root.join(".voktty/sessions")).unwrap();
        fs::write(
            f.root.join(".voktty/sessions/kept.json"),
            "reserved conversation",
        )
        .unwrap();
        f.originals = BTreeMap::from([
            (".voktty/.gitignore".into(), b"*\r\n".to_vec()),
            (
                "AGENTS.md".into(),
                "Owner rules é\r\n\x1b]52;sentinel\x07\u{202e}Keep original\r\n"
                    .as_bytes()
                    .to_vec(),
            ),
            ("CLAUDE.md".into(), b"Claude owner rules\r\n".to_vec()),
        ]);
        for (name, bytes) in &f.originals {
            fs::write(f.root.join(name), bytes).unwrap();
            fs::set_permissions(f.root.join(name), fs::Permissions::from_mode(0o640)).unwrap();
        }
        let store = f.store();
        let access = Arc::new(FixtureAccess(f.root.clone()));
        let workspace =
            LocalMemoryWorkspace::open(&store, &f.root, access.as_ref(), &ReadControl::default())
                .unwrap();
        let snapshot = store
            .set_policy(0, workspace.project_key(), MemoryPolicy::Never)
            .unwrap();
        store
            .trust_instructions(
                snapshot.revision(),
                workspace.project_key(),
                &"b".repeat(64),
            )
            .unwrap();
        let preview = InitializationPreview::prepare(
            &workspace,
            &workspace,
            json!({"project_name":"CLI recovery fixture","created_at":"2025-11-02"})
                .as_object()
                .unwrap(),
            voktty_workspace_kit::RootLinks {
                agents: true,
                claude: true,
            },
            &DiscoveryControl::default(),
        )
        .unwrap()
        .into_owned(store.clone(), access.clone(), access.clone())
        .unwrap();
        let failure = preview
            .publish(access.as_ref(), &DiscoveryControl::default())
            .unwrap_err();
        assert_eq!(failure.possible_recovery_files.len(), 3);
        let intent: Value = serde_json::from_slice(&fs::read(f.intent_path()).unwrap()).unwrap();
        for (index, file) in intent["files"].as_array().unwrap().iter().enumerate() {
            if file["original"].is_null() {
                continue;
            }
            let target = file["path"].as_str().unwrap();
            let prefix = if target.starts_with(".voktty/") {
                ".voktty/"
            } else {
                ""
            };
            let backup = format!(
                "{prefix}.voktty-migration-{}-{index}",
                intent["transaction"].as_str().unwrap()
            );
            assert_eq!(fs::read(f.root.join(&backup)).unwrap(), f.originals[target]);
            f.backups.insert(target.into(), backup);
            fs::remove_file(f.root.join(target)).unwrap();
        }
        assert_eq!(f.backups.len(), 3);
        f
    }

    fn run(&self, args: &[&str], json: bool) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_voktty-cli"));
        command
            .current_dir(&self.root)
            .env("XDG_DATA_HOME", &self.data)
            .env("VOKTTY_CONTROL_ADDR", "invalid-fixture")
            .env_remove("VOKTTY_CONTROL_TOKEN")
            .stdin(Stdio::null())
            .arg("memory")
            .args(args);
        if json {
            command.arg("--json");
        }
        command.output().unwrap()
    }
    fn preview(&self) -> Value {
        result(&self.run(&["recover", "--preview"], true))
    }
    fn restore(&self, digest: &str) -> Output {
        self.run(&["recover", "--accept-review", digest], true)
    }
}

fn result(output: &Output) -> Value {
    assert!(output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], true);
    value["result"].clone()
}
fn error(output: &Output, code: &str) {
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let value: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(value["error"]["code"], code, "{value}");
}
fn tree(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut files = BTreeMap::new();
    for entry in fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files.extend(tree(&path));
        } else {
            files.insert(path.clone(), fs::read(path).unwrap());
        }
    }
    files
}

#[test]
fn native_review_and_exact_acceptance_restore_original_objects_without_finishing_initialization() {
    let f = Fixture::interrupted();
    let before = tree(&f.root);
    let preferences = fs::read(f.state_path()).unwrap();
    let intent = fs::read(f.intent_path()).unwrap();
    let metadata: BTreeMap<_, _> = f
        .backups
        .iter()
        .map(|(target, backup)| {
            let m = fs::metadata(f.root.join(backup)).unwrap();
            (target.clone(), (m.ino(), m.mode(), m.uid(), m.gid()))
        })
        .collect();
    let review = f.preview();
    assert_eq!(PathBuf::from(review["root"].as_str().unwrap()), f.root);
    let entries: BTreeMap<_, _> = review["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            (
                entry["target"].as_str().unwrap().to_owned(),
                entry["text"].as_str().unwrap().as_bytes().to_vec(),
            )
        })
        .collect();
    assert_eq!(entries, f.originals);
    assert_eq!(tree(&f.root), before);
    assert_eq!(fs::read(f.state_path()).unwrap(), preferences);
    assert_eq!(fs::read(f.intent_path()).unwrap(), intent);
    assert_eq!(f.preview()["reviewDigest"], review["reviewDigest"]);
    let restored = result(&f.restore(review["reviewDigest"].as_str().unwrap()));
    assert_eq!(restored["originalsRestored"], true);
    for flag in [
        "initializationCompleted",
        "policyChanged",
        "trustChanged",
        "contextActivated",
        "capturesActivated",
    ] {
        assert_eq!(review[flag], false);
        assert_eq!(restored[flag], false);
    }
    for (target, original) in &f.originals {
        let path = f.root.join(target);
        let m = fs::metadata(&path).unwrap();
        assert_eq!(fs::read(path).unwrap(), *original);
        assert_eq!((m.ino(), m.mode(), m.uid(), m.gid()), metadata[target]);
        assert!(!f.root.join(&f.backups[target]).exists());
    }
    assert!(!f.root.join(".voktty/kit.json").exists());
    assert_eq!(fs::read(f.state_path()).unwrap(), preferences);
    assert_eq!(fs::read(f.intent_path()).unwrap(), intent);
    let preview = result(&f.run(
        &[
            "init",
            "--preview",
            "--project",
            ".",
            "--set",
            "project_name=CLI recovery fixture",
            "--set",
            "created_at=2025-11-02",
            "--link-agents",
            "--link-claude",
        ],
        true,
    ));
    assert_eq!(preview["isResuming"], true);
    assert!(preview["publicationBlocker"].is_null());
    assert!(!f.root.join(".voktty/kit.json").exists());
    result(&f.run(
        &[
            "init",
            "--yes",
            "--project",
            ".",
            "--set",
            "project_name=CLI recovery fixture",
            "--set",
            "created_at=2025-11-02",
            "--link-agents",
            "--link-claude",
            "--accept-plan",
            preview["planDigest"].as_str().unwrap(),
        ],
        true,
    ));
    assert!(f.root.join(".voktty/kit.json").is_file());
    assert!(!f.intent_path().exists());
    assert_eq!(fs::read(f.state_path()).unwrap(), preferences);
    assert_eq!(
        fs::read(f.root.join(".voktty/sessions/kept.json")).unwrap(),
        b"reserved conversation"
    );
}

#[test]
fn wrong_or_stale_digest_cannot_restore_and_requires_a_fresh_matching_review() {
    for change_preferences in [false, true] {
        let f = Fixture::interrupted();
        let review = f.preview();
        if change_preferences {
            let store = f.store();
            store
                .set_policy(
                    store.load().unwrap().revision(),
                    &"a".repeat(64),
                    MemoryPolicy::Manual,
                )
                .unwrap();
        }
        let before = tree(&f.root);
        let state = fs::read(f.state_path()).unwrap();
        let digest = if change_preferences {
            review["reviewDigest"].as_str().unwrap().to_owned()
        } else {
            "0".repeat(64)
        };
        error(&f.restore(&digest), "memory_changed");
        assert_eq!(tree(&f.root), before);
        assert_eq!(fs::read(f.state_path()).unwrap(), state);
        let fresh = f.preview();
        result(&f.restore(fresh["reviewDigest"].as_str().unwrap()));
    }
}

#[test]
fn malformed_requests_and_missing_state_never_initialize_private_settings() {
    let f = Fixture::blank();
    for args in [
        vec!["recover"],
        vec!["recover", "--yes"],
        vec!["recover", "--force"],
        vec!["recover", "--preview", "--accept-review", &"a".repeat(64)],
        vec!["recover", "--accept-review", "bad"],
        vec!["recover", "--preview", "--project", "-unsafe"],
    ] {
        let output = f.run(&args, true);
        assert_eq!(output.status.code(), Some(2));
        error(&output, "usage");
    }
    error(
        &f.run(&["recover", "--preview"], true),
        "memory_recovery_unavailable",
    );
    assert!(!f.data.exists());
    assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
    f.store();
    let state = fs::read(f.state_path()).unwrap();
    error(
        &f.run(&["recover", "--preview"], true),
        "memory_recovery_unavailable",
    );
    assert_eq!(fs::read(f.state_path()).unwrap(), state);
    assert!(!f.intent_path().exists());
}

#[test]
fn human_preview_escapes_controls_and_json_preserves_complete_literal_originals() {
    let f = Fixture::interrupted();
    let output = f.run(&["recover", "--preview"], false);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains('\x1b'));
    assert!(!text.contains('\u{202e}'));
    assert!(text.contains("\\u{1b}"));
    assert!(text.contains("\\u{202e}"));
    assert!(text.contains("--accept-review"));
    assert_eq!(f.preview()["entries"].as_array().unwrap().len(), 3);
}

#[test]
fn replaced_roots_and_linked_backups_never_reuse_a_review_or_disclose_content() {
    for replace_root in [false, true] {
        let f = Fixture::interrupted();
        let review = f.preview();
        if replace_root {
            let old = f.root.with_file_name("old");
            fs::rename(&f.root, &old).unwrap();
            fs::create_dir(&f.root).unwrap();
        } else {
            let backup = f.root.join(f.backups.values().next().unwrap());
            fs::remove_file(&backup).unwrap();
            let secret = f.root.join(".env");
            fs::write(&secret, "PRIVATE SENTINEL").unwrap();
            symlink(secret, backup).unwrap();
        }
        let state = fs::read(f.state_path()).unwrap();
        let output = f.restore(review["reviewDigest"].as_str().unwrap());
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&output.stderr).contains("PRIVATE SENTINEL"));
        assert_eq!(fs::read(f.state_path()).unwrap(), state);
        assert!(!f.root.join(".voktty/kit.json").exists());
    }
}

#[test]
fn corrupt_preferences_or_intents_are_preserved_without_repair_or_project_writes() {
    for (name, code) in [
        ("memory-local.json", "memory_invalid_state"),
        ("memory-deployment.json", "memory_invalid_recovery"),
    ] {
        let f = Fixture::interrupted();
        let path = f.parent().join("project-memory").join(name);
        fs::write(&path, b"CORRUPT PRIVATE SENTINEL").unwrap();
        let before = tree(&f.root);
        let output = f.run(&["recover", "--preview"], true);
        error(&output, code);
        assert!(!String::from_utf8_lossy(&output.stderr).contains("PRIVATE SENTINEL"));
        assert_eq!(fs::read(path).unwrap(), b"CORRUPT PRIVATE SENTINEL");
        assert_eq!(tree(&f.root), before);
    }
}
