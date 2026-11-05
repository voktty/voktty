#![cfg(target_os = "linux")]

use serde_json::Value;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use voktty_memory_local::{LocalMemoryStore, ReadControl};

struct Fixture {
    _owned: tempfile::TempDir,
    project: PathBuf,
    data: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let owned = tempfile::tempdir().unwrap();
        fs::set_permissions(owned.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let project = owned.path().join("project");
        fs::create_dir(&project).unwrap();
        let f = Self {
            project,
            data: owned.path().join("data"),
            _owned: owned,
        };
        result(f.run(&["init", "--yes", "--project", ".", "--json"]));
        result(f.run(&["use", "--never", "--json"]));
        let review = result(f.run(&["trust", "--preview", "--json"]));
        result(f.run(&[
            "trust",
            "--accept-review",
            review["reviewDigest"].as_str().unwrap(),
            "--json",
        ]));
        fs::rename(f.canonical(), f.legacy()).unwrap();
        f
    }
    fn canonical(&self) -> PathBuf {
        self.data.join("app.voktty.voktty")
    }
    fn legacy(&self) -> PathBuf {
        self.data.join("dev.voktty")
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_voktty-cli"))
            .arg("memory")
            .args(args)
            .current_dir(&self.project)
            .env("XDG_DATA_HOME", &self.data)
            .env("VOKTTY_CONTROL_ADDR", "invalid-fixture")
            .env_remove("VOKTTY_CONTROL_TOKEN")
            .stdin(Stdio::null())
            .output()
            .unwrap()
    }
    fn preview(&self) -> Value {
        result(self.run(&["migrate-storage", "--preview", "--json"]))
    }
}
fn result(output: Output) -> Value {
    assert!(output.status.success(), "{output:?}");
    serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"].clone()
}

#[test]
fn reviewed_cli_migration_preserves_identity_never_trust_and_exact_journal_objects() {
    let f = Fixture::new();
    let source = f.legacy().join("project-memory");
    let state = fs::read(source.join("memory-local.json")).unwrap();
    let directory_inode = fs::metadata(&source).unwrap().ino();
    let state_inode = fs::metadata(source.join("memory-local.json"))
        .unwrap()
        .ino();
    let project_marker = fs::read(f.project.join(".voktty/kit.json")).unwrap();
    fs::write(
        source.join("memory-deployment.json"),
        b"opaque recovery bytes\r\n",
    )
    .unwrap();
    fs::set_permissions(
        source.join("memory-deployment.json"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let preview = f.preview();
    assert_eq!(preview["summary"]["never"], 1);
    assert_eq!(preview["summary"]["storedTrust"], 1);
    assert_eq!(preview["summary"]["recoveryJournal"], true);
    assert_eq!(preview["stateMoved"], false);
    assert!(!f.canonical().exists());
    assert_eq!(fs::read(source.join("memory-local.json")).unwrap(), state);
    let digest = preview["reviewDigest"].as_str().unwrap();
    let accepted = result(f.run(&["migrate-storage", "--accept-review", digest, "--json"]));
    assert_eq!(accepted["stateMoved"], true);
    for field in [
        "policyChanged",
        "trustChanged",
        "projectFilesChanged",
        "contextActivated",
        "capturesActivated",
    ] {
        assert_eq!(accepted[field], false);
    }
    let target = f.canonical().join("project-memory");
    assert_eq!(fs::metadata(&target).unwrap().ino(), directory_inode);
    assert_eq!(
        fs::metadata(target.join("memory-local.json"))
            .unwrap()
            .ino(),
        state_inode
    );
    assert_eq!(fs::read(target.join("memory-local.json")).unwrap(), state);
    assert_eq!(
        fs::read(target.join("memory-deployment.json")).unwrap(),
        b"opaque recovery bytes\r\n"
    );
    assert_eq!(
        fs::read(f.project.join(".voktty/kit.json")).unwrap(),
        project_marker
    );
    assert!(source.is_file());
    let status = result(f.run(&["status", "--json"]));
    assert!(status["policy"]["mode"].is_null());
    assert_eq!(status["trust"], "not_checked");
    let policy = result(f.run(&["use", "--manual", "--preview", "--json"]));
    assert_eq!(policy["previousMode"], "never");
    assert_eq!(policy["trust"], "stored_not_checked");
    assert_eq!(fs::read(target.join("memory-local.json")).unwrap(), state);
}

#[test]
fn wrong_or_changed_review_never_moves_storage() {
    for changed in [false, true] {
        let f = Fixture::new();
        let review = f.preview();
        let digest = if changed {
            let store =
                LocalMemoryStore::open_private(&f.legacy(), &ReadControl::default()).unwrap();
            let snapshot = store.load().unwrap();
            store
                .set_policy(
                    snapshot.revision(),
                    &"a".repeat(64),
                    voktty_memory_local::MemoryPolicy::Never,
                )
                .unwrap();
            review["reviewDigest"].as_str().unwrap().to_owned()
        } else {
            "0".repeat(64)
        };
        let output = f.run(&["migrate-storage", "--accept-review", &digest, "--json"]);
        assert_eq!(output.status.code(), Some(5));
        assert!(output.stdout.is_empty());
        assert!(!f.canonical().exists());
        assert!(f.legacy().join("project-memory").is_dir());
    }
}

#[test]
fn two_installations_are_preserved_without_merging() {
    let f = Fixture::new();
    let control = ReadControl::default();
    LocalMemoryStore::prepare_application_parent(&f.canonical(), &control).unwrap();
    let canonical = LocalMemoryStore::create_private(&f.canonical(), &control).unwrap();
    canonical.initialize().unwrap();
    let path = f.canonical().join("project-memory/memory-local.json");
    let before = fs::read(&path).unwrap();
    let old = fs::read(f.legacy().join("project-memory/memory-local.json")).unwrap();
    let output = f.run(&["migrate-storage", "--preview", "--json"]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(fs::read(path).unwrap(), before);
    assert_eq!(
        fs::read(f.legacy().join("project-memory/memory-local.json")).unwrap(),
        old
    );
}

#[test]
fn ambiguous_options_fail_before_any_storage_io() {
    let owned = tempfile::tempdir().unwrap();
    let data = owned.path().join("absent");
    for args in [
        vec![],
        vec!["--yes"],
        vec!["--force"],
        vec!["--preview", "--project", "."],
        vec!["--accept-review", "invalid"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_voktty-cli"))
            .args(["memory", "migrate-storage"])
            .args(args)
            .arg("--json")
            .env("XDG_DATA_HOME", &data)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2), "{output:?}");
        assert!(!data.exists());
    }
}
