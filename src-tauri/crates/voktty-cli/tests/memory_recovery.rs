#![cfg(target_os = "linux")]

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Arc;
use voktty_memory_local::{
    DiscoveryControl, MemoryReadAccess, MemoryWriteAccess, OwnedProjectInitializationPreview,
    ProjectInitializationRequest, PROJECT_INITIALIZATION_RECORD,
};

struct Access(PathBuf);
impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        path == self.0
    }
    fn allows_read(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.0)
    }
}
impl MemoryWriteAccess for Access {
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
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
struct Fixture {
    _owned: tempfile::TempDir,
    root: PathBuf,
    data: PathBuf,
    originals: BTreeMap<String, Vec<u8>>,
    backups: BTreeMap<String, String>,
    _guard: std::sync::MutexGuard<'static, ()>,
}
impl Fixture {
    fn blank() -> Self {
        let guard = SERIAL
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let owned = tempfile::tempdir().unwrap();
        let root = owned.path().join("project");
        fs::create_dir(&root).unwrap();
        Self {
            root,
            data: owned.path().join("data"),
            _owned: owned,
            originals: BTreeMap::new(),
            backups: BTreeMap::new(),
            _guard: guard,
        }
    }
    fn interrupted(missing: bool) -> Self {
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
        let access = Arc::new(Access(f.root.clone()));
        let review = OwnedProjectInitializationPreview::prepare_at_project_root(
            ProjectInitializationRequest {
                origin: f.root.clone(),
                origin_access: access.clone(),
                destination: f.root.clone(),
                destination_access: access.clone(),
                inputs: json!({"project_name":"CLI recovery fixture","created_at":"2026-11-05"})
                    .as_object()
                    .unwrap()
                    .clone(),
                links: voktty_workspace_kit::RootLinks {
                    agents: true,
                    claude: true,
                },
            },
            &DiscoveryControl::default(),
        )
        .unwrap();
        let digest = review.acceptance_digest();
        let failure = review
            .publish(&digest, access.as_ref(), &DiscoveryControl::default())
            .unwrap_err();
        assert!(failure
            .created
            .contains(&PROJECT_INITIALIZATION_RECORD.to_owned()));
        let record: Value =
            serde_json::from_slice(&fs::read(f.root.join(PROJECT_INITIALIZATION_RECORD)).unwrap())
                .unwrap();
        for file in record["files"].as_array().unwrap() {
            if let Some(backup) = file["backup"].as_str() {
                let target = file["path"].as_str().unwrap();
                assert_eq!(fs::read(f.root.join(backup)).unwrap(), f.originals[target]);
                f.backups.insert(target.into(), backup.into());
                if missing {
                    fs::remove_file(f.root.join(target)).unwrap();
                }
            }
        }
        assert_eq!(f.backups.len(), 3);
        fs::write(
            f.root.join(".voktty/CONTEXT.md"),
            "Project context written after interruption",
        )
        .unwrap();
        f
    }
    fn run(&self, args: &[&str], as_json: bool) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_voktty-cli"));
        command
            .current_dir(&self.root)
            .env("XDG_DATA_HOME", &self.data)
            .env("VOKTTY_CONTROL_ADDR", "invalid-fixture")
            .env_remove("VOKTTY_CONTROL_TOKEN")
            .stdin(Stdio::null())
            .arg("memory")
            .args(args);
        if as_json {
            command.arg("--json");
        }
        command.output().unwrap()
    }
    fn preview(&self) -> Value {
        result(&self.run(&["recover", "--preview"], true))
    }
    fn recover(&self, digest: &str) -> Output {
        self.run(&["recover", "--accept-review", digest], true)
    }
    fn seed_global(&self) {
        for parent in ["app.voktty.voktty", "dev.voktty"] {
            let directory = self.data.join(parent).join("project-memory");
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("memory-local.json"),
                "CORRUPT PRIVATE SENTINEL",
            )
            .unwrap();
            fs::write(
                directory.join("memory-deployment.json"),
                "OLD GLOBAL JOURNAL SENTINEL",
            )
            .unwrap();
        }
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
fn native_review_restores_originals_and_completes_initialization_without_global_state() {
    let f = Fixture::interrupted(true);
    let before = tree(&f.root);
    let metadata: BTreeMap<_, _> = f
        .backups
        .iter()
        .map(|(target, backup)| {
            let m = fs::metadata(f.root.join(backup)).unwrap();
            (target.clone(), (m.mode(), m.uid(), m.gid()))
        })
        .collect();
    let review = f.preview();
    assert_eq!(review["schema"], 2);
    assert_eq!(PathBuf::from(review["root"].as_str().unwrap()), f.root);
    assert_eq!(review["restorations"].as_array().unwrap().len(), 3);
    for entry in review["restorations"].as_array().unwrap() {
        assert_eq!(
            entry["text"].as_str().unwrap().as_bytes(),
            f.originals[entry["target"].as_str().unwrap()]
        );
    }
    assert_eq!(review["deployment"]["canPublish"], true);
    assert_eq!(review["recordCleanup"], PROJECT_INITIALIZATION_RECORD);
    assert_eq!(tree(&f.root), before);
    assert!(!f.data.exists());
    assert_eq!(f.preview()["reviewDigest"], review["reviewDigest"]);
    let recovered = result(&f.recover(review["reviewDigest"].as_str().unwrap()));
    assert_eq!(recovered["schema"], 2);
    assert_eq!(recovered["originalsRestored"], true);
    assert_eq!(recovered["initializationCompleted"], true);
    for flag in [
        "policyChanged",
        "trustChanged",
        "contextActivated",
        "capturesActivated",
    ] {
        assert_eq!(review[flag], false);
        assert_eq!(recovered[flag], false);
    }
    for (target, original) in &f.originals {
        let path = f.root.join(target);
        let m = fs::metadata(&path).unwrap();
        if target != ".voktty/.gitignore" {
            assert!(fs::read_to_string(&path)
                .unwrap()
                .starts_with(std::str::from_utf8(original).unwrap()));
        }
        assert_eq!((m.mode(), m.uid(), m.gid()), metadata[target]);
        assert!(!f.root.join(&f.backups[target]).exists());
    }
    assert!(f.root.join(".voktty/kit.json").is_file());
    assert!(!f.root.join(PROJECT_INITIALIZATION_RECORD).exists());
    assert!(!f.data.exists());
    assert_eq!(
        fs::read(f.root.join(".voktty/sessions/kept.json")).unwrap(),
        b"reserved conversation"
    );
    assert_eq!(
        fs::read_to_string(f.root.join(".voktty/CONTEXT.md")).unwrap(),
        "Project context written after interruption"
    );
    let ready = result(&f.run(&["init", "--preview"], true));
    assert!(ready["deployment"]["entries"]
        .as_array()
        .unwrap()
        .iter()
        .all(|entry| entry["action"] == "skip"));
}

#[test]
fn unusable_or_corrupt_global_origins_never_block_or_change_project_recovery() {
    for mode in ["corrupt", "file-data", "linked-parents"] {
        let f = Fixture::interrupted(false);
        if mode == "file-data" {
            fs::write(&f.data, "not a data directory").unwrap();
        } else {
            f.seed_global();
        }
        if mode == "linked-parents" {
            fs::rename(f.data.join("app.voktty.voktty"), f.data.join("saved")).unwrap();
            symlink(
                "/unavailable-origin-fixture",
                f.data.join("app.voktty.voktty"),
            )
            .unwrap();
        }
        let sentinel = if mode == "file-data" {
            fs::read(&f.data).unwrap()
        } else {
            fs::read(f.data.join("dev.voktty/project-memory/memory-local.json")).unwrap()
        };
        let review = f.preview();
        let recovered = result(&f.recover(review["reviewDigest"].as_str().unwrap()));
        assert_eq!(recovered["originalsRestored"], false);
        assert_eq!(recovered["initializationCompleted"], true);
        let after = if mode == "file-data" {
            fs::read(&f.data).unwrap()
        } else {
            fs::read(f.data.join("dev.voktty/project-memory/memory-local.json")).unwrap()
        };
        assert_eq!(sentinel, after);
        if mode == "corrupt" {
            for parent in ["app.voktty.voktty", "dev.voktty"] {
                let directory = f.data.join(parent).join("project-memory");
                assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
                assert_eq!(
                    fs::read(directory.join("memory-local.json")).unwrap(),
                    b"CORRUPT PRIVATE SENTINEL"
                );
                assert_eq!(
                    fs::read(directory.join("memory-deployment.json")).unwrap(),
                    b"OLD GLOBAL JOURNAL SENTINEL"
                );
            }
        }
    }
}

#[test]
fn acceptance_tracks_project_changes_and_ignores_old_global_preferences() {
    let f = Fixture::interrupted(false);
    f.seed_global();
    let review = f.preview();
    let before = tree(&f.root);
    error(&f.recover(&"0".repeat(64)), "memory_changed");
    assert_eq!(tree(&f.root), before);
    fs::write(f.root.join(".voktty/CONTEXT.md"), "newer context").unwrap();
    error(
        &f.recover(review["reviewDigest"].as_str().unwrap()),
        "memory_changed",
    );
    let fresh = f.preview();
    let globals = f
        .data
        .join("app.voktty.voktty/project-memory/memory-local.json");
    fs::write(&globals, "new private sentinel").unwrap();
    assert_eq!(f.preview()["reviewDigest"], fresh["reviewDigest"]);
    result(&f.recover(fresh["reviewDigest"].as_str().unwrap()));
    assert_eq!(fs::read(globals).unwrap(), b"new private sentinel");
    assert_eq!(
        fs::read_to_string(f.root.join(".voktty/CONTEXT.md")).unwrap(),
        "newer context"
    );
}

#[test]
fn malformed_requests_and_missing_project_records_never_open_global_journals() {
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
        "memory_unavailable",
    );
    assert!(!f.data.exists());
    assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
    f.seed_global();
    let globals = tree(&f.data);
    error(
        &f.run(&["recover", "--preview"], true),
        "memory_unavailable",
    );
    assert_eq!(tree(&f.data), globals);
    assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
}

#[test]
fn human_preview_escapes_controls_and_json_keeps_complete_originals() {
    let f = Fixture::interrupted(true);
    let output = f.run(&["recover", "--preview"], false);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains('\x1b'));
    assert!(!text.contains('\u{202e}'));
    assert!(text.contains("\\u{1b}"));
    assert!(text.contains("\\u{202e}"));
    assert!(text.contains("--accept-review"));
    assert_eq!(f.preview()["restorations"].as_array().unwrap().len(), 3);
}

#[test]
fn changed_roots_linked_backups_and_unknown_data_never_disclose_or_overwrite_bytes() {
    for mode in ["root", "linked-backup", "foreign-backup", "invalid-record"] {
        let f = Fixture::interrupted(true);
        f.seed_global();
        let review = f.preview();
        let changed = match mode {
            "root" => {
                let old = f.root.with_file_name("old");
                fs::rename(&f.root, &old).unwrap();
                fs::create_dir(&f.root).unwrap();
                old.join(PROJECT_INITIALIZATION_RECORD)
            }
            "linked-backup" => {
                let backup = f.root.join(f.backups.values().next().unwrap());
                fs::remove_file(&backup).unwrap();
                let secret = f.root.join(".env");
                fs::write(&secret, "PRIVATE SENTINEL").unwrap();
                symlink(secret, &backup).unwrap();
                backup
            }
            "foreign-backup" => {
                let path = f.root.join(f.backups.values().next().unwrap());
                fs::write(&path, "PRIVATE SENTINEL").unwrap();
                path
            }
            _ => {
                let path = f.root.join(PROJECT_INITIALIZATION_RECORD);
                fs::write(&path, "PRIVATE SENTINEL").unwrap();
                path
            }
        };
        let globals = tree(&f.data);
        let before = fs::read(&changed).unwrap();
        let output = f.recover(review["reviewDigest"].as_str().unwrap());
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&output.stderr).contains("PRIVATE SENTINEL"));
        assert_eq!(fs::read(changed).unwrap(), before);
        assert_eq!(tree(&f.data), globals);
        assert!(!f.root.join(".voktty/kit.json").exists());
    }
}

#[test]
fn a_live_record_lock_blocks_the_cli_without_changing_files() {
    let f = Fixture::interrupted(false);
    let before = tree(&f.root);
    let file = fs::File::open(f.root.join(PROJECT_INITIALIZATION_RECORD)).unwrap();
    file.try_lock().unwrap();
    error(&f.run(&["recover", "--preview"], true), "memory_busy");
    assert_eq!(tree(&f.root), before);
    drop(file);
    let review = f.preview();
    result(&f.recover(review["reviewDigest"].as_str().unwrap()));
}
