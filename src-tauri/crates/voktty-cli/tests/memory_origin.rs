#![cfg(target_os = "linux")]

use serde_json::Value;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use voktty_memory_local::{LocalMemoryStore, ReadControl};

struct Fixture {
    _owned: tempfile::TempDir,
    project: PathBuf,
    data: PathBuf,
    bin: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let owned = tempfile::tempdir().unwrap();
        fs::set_permissions(owned.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let project = owned.path().join("project");
        let bin = owned.path().join("bin");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&bin).unwrap();
        let agent = bin.join("codex");
        fs::write(&agent, "#!/bin/sh\nprintf 'fixture-agent-started'\n").unwrap();
        fs::set_permissions(agent, fs::Permissions::from_mode(0o700)).unwrap();
        let fixture = Self {
            data: owned.path().join("data"),
            project,
            bin,
            _owned: owned,
        };
        result(&fixture.run(&["init", "--yes", "--project", ".", "--json"]));
        result(&fixture.run(&["use", "--manual", "--json"]));
        fixture
    }

    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_voktty-cli"))
            .current_dir(&self.project)
            .env("XDG_DATA_HOME", &self.data)
            .env("PATH", &self.bin)
            .env("VOKTTY_CONTROL_ADDR", "invalid-fixture")
            .env_remove("VOKTTY_CONTROL_TOKEN")
            .stdin(Stdio::null())
            .arg("memory")
            .args(args)
            .output()
            .unwrap()
    }

    fn canonical(&self) -> PathBuf {
        self.data.join("app.voktty.voktty")
    }

    fn legacy(&self) -> PathBuf {
        self.data.join("dev.voktty")
    }
}

fn result(output: &Output) -> Value {
    assert!(output.status.success(), "{:?}", output);
    serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"].clone()
}

#[test]
fn cli_uses_the_desktop_store_and_preserves_its_installation_policy_and_trust() {
    let f = Fixture::new();
    let store = LocalMemoryStore::open_private(&f.canonical(), &ReadControl::default()).unwrap();
    let initial = store.load().unwrap();
    result(&f.run(&["use", "--never", "--json"]));
    let review = result(&f.run(&["trust", "--preview", "--json"]));
    result(&f.run(&[
        "trust",
        "--accept-review",
        review["reviewDigest"].as_str().unwrap(),
        "--json",
    ]));
    let snapshot = store.load().unwrap();
    assert_eq!(snapshot.installation_id(), initial.installation_id());
    assert_eq!(snapshot.revision(), initial.revision() + 2);
    let state_path = f.canonical().join("project-memory/memory-local.json");
    let before = fs::read(&state_path).unwrap();
    let status = result(&f.run(&["status", "--json"]));
    assert!(status["policy"]["mode"].is_null());
    assert_eq!(status["trust"], "not_checked");
    let launch = f.run(&["run", "--session", "codex"]);
    assert_eq!(launch.status.code(), Some(5));
    assert!(String::from_utf8_lossy(&launch.stderr).contains("Never"));
    assert!(launch.stdout.is_empty());
    assert_eq!(fs::read(state_path).unwrap(), before);
    assert!(!f.legacy().exists());
}

#[test]
fn legacy_state_blocks_all_private_commands_without_reading_merging_or_starting_an_agent() {
    for mode in [
        "legacy-only",
        "both",
        "corrupt",
        "linked-parent",
        "linked-store",
        "file-parent",
        "empty-store",
        "file-store",
    ] {
        let f = Fixture::new();
        result(&f.run(&["use", "--never", "--json"]));
        let state_path = f.canonical().join("project-memory/memory-local.json");
        let original = fs::read(&state_path).unwrap();
        match mode {
            "legacy-only" => fs::rename(f.canonical(), f.legacy()).unwrap(),
            "linked-parent" => symlink(f.canonical(), f.legacy()).unwrap(),
            "file-parent" => fs::write(f.legacy(), "legacy sentinel").unwrap(),
            _ => {
                fs::create_dir(f.legacy()).unwrap();
                if mode == "linked-store" {
                    symlink(
                        "/unavailable-origin-fixture",
                        f.legacy().join("project-memory"),
                    )
                    .unwrap();
                } else if mode == "file-store" {
                    fs::write(f.legacy().join("project-memory"), "legacy sentinel").unwrap();
                } else {
                    fs::create_dir(f.legacy().join("project-memory")).unwrap();
                    if mode != "empty-store" {
                        fs::write(
                            f.legacy().join("project-memory/memory-local.json"),
                            if mode == "corrupt" {
                                b"legacy sentinel".as_slice()
                            } else {
                                &original
                            },
                        )
                        .unwrap();
                    }
                }
            }
        }
        let legacy_state = f.legacy().join("project-memory/memory-local.json");
        let legacy_before = fs::read(&legacy_state).ok();
        for args in [
            vec!["use", "--always", "--json"],
            vec!["trust", "--preview", "--json"],
            vec!["run", "--session", "codex"],
            vec!["run", "codex"],
        ] {
            let output = f.run(&args);
            assert_eq!(output.status.code(), Some(5), "{mode}: {output:?}");
            assert!(output.stdout.is_empty());
            let text = String::from_utf8(output.stderr).unwrap();
            assert!(
                text.contains(if args[0] == "run" {
                    "legacy CLI memory state"
                } else {
                    "memory_legacy_state_requires_review"
                }),
                "{mode}: {args:?}: {text}"
            );
            assert!(!text.contains("sentinel"));
        }
        result(&f.run(&["init", "--preview", "--project", ".", "--json"]));
        let status = result(&f.run(&["status", "--json"]));
        assert_eq!(status["scope"]["state"], "ready");
        assert_eq!(status["policy"]["state"], "not_checked");
        let recovery = f.run(&["recover", "--preview", "--json"]);
        assert_eq!(recovery.status.code(), Some(3));
        assert_eq!(
            serde_json::from_slice::<Value>(&recovery.stderr).unwrap()["error"]["code"],
            "memory_unavailable"
        );
        if mode == "legacy-only" {
            assert!(!f.canonical().exists());
            assert_eq!(
                fs::read(f.legacy().join("project-memory/memory-local.json")).unwrap(),
                original
            );
        } else {
            assert_eq!(fs::read(state_path).unwrap(), original);
        }
        let output = f.run(&["run", "--no-memory", "codex"]);
        assert!(output.status.success(), "{output:?}");
        assert_eq!(output.stdout, b"fixture-agent-started");
        let measurement = f.run(&["measure", "--json"]);
        assert!(matches!(measurement.status.code(), Some(0 | 5)));
        let measured: Value = serde_json::from_slice(&measurement.stdout).unwrap();
        assert!(measured["result"]["measurements"].is_array());
        assert!(!String::from_utf8_lossy(&measurement.stderr).contains("legacy_state"));
        assert_eq!(fs::read(legacy_state).ok(), legacy_before);
    }
}

#[test]
fn unrelated_legacy_application_directory_does_not_block_memory() {
    let f = Fixture::new();
    fs::create_dir(f.legacy()).unwrap();
    fs::write(f.legacy().join("unrelated.json"), "unrelated fixture").unwrap();
    assert_eq!(
        result(&f.run(&["status", "--json"]))["policy"]["mode"],
        Value::Null
    );
    result(&f.run(&["use", "--never", "--json"]));
    assert_eq!(
        fs::read(f.legacy().join("unrelated.json")).unwrap(),
        b"unrelated fixture"
    );
}
