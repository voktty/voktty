#![cfg(target_os = "linux")]

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use voktty_workspace_kit::{prepare_deployment, render_template, resource, PathFact, RootLinks};

struct Fixture {
    _dir: tempfile::TempDir,
    project: PathBuf,
    data: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let project = dir.path().join("project space");
        fs::create_dir(&project).unwrap();
        let data = dir.path().join("private-data");
        Self {
            _dir: dir,
            project,
            data,
        }
    }
    fn init(&self, extra: &[&str]) -> Output {
        self.invoke(extra, true)
    }
    fn invoke(&self, extra: &[&str], json: bool) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_voktty-cli"));
        command
            .current_dir(&self.project)
            .env("XDG_DATA_HOME", &self.data)
            .env("VOKTTY_CONTROL_ADDR", "invalid-fixture-endpoint")
            .env_remove("VOKTTY_CONTROL_TOKEN")
            .args(["memory", "init", "--project"])
            .arg(&self.project)
            .args([
                "--set",
                "project_name=CLI fixture",
                "--set",
                "created_at=2026-10-31",
            ])
            .args(extra)
            .stdin(Stdio::null());
        if json {
            command.arg("--json");
        }
        command.output().unwrap()
    }
}
fn result(output: &Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
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

#[test]
fn noninteractive_missing_consent_is_usage_before_any_state_or_project_write() {
    let f = Fixture::new();
    let output = f.init(&[]);
    assert_eq!(output.status.code(), Some(2));
    error(&output, "usage");
    assert_eq!(fs::read_dir(&f.project).unwrap().count(), 0);
    assert!(!f.data.exists());
}

#[test]
fn preview_is_read_only_for_the_project_and_explicit_creation_matches_the_shared_plan() {
    let f = Fixture::new();
    let preview = result(&f.init(&["--preview"]));
    assert_eq!(preview["planDigest"].as_str().unwrap().len(), 64);
    assert_eq!(fs::read_dir(&f.project).unwrap().count(), 0);
    let published = result(&f.init(&[
        "--yes",
        "--accept-plan",
        preview["planDigest"].as_str().unwrap(),
    ]));
    assert_eq!(published["contextActivated"], false);
    assert_eq!(published["capturesActivated"], false);
    assert_eq!(published["policyChanged"], false);
    let files = render_template(
        json!({"project_name":"CLI fixture","created_at":"2026-10-31"})
            .as_object()
            .unwrap(),
    )
    .unwrap();
    let facts: BTreeMap<_, _> = files
        .iter()
        .map(|file| (file.path.clone(), PathFact::Absent))
        .chain([(".voktty/kit.lock.json".into(), PathFact::Absent)])
        .collect();
    let manifest: Value = serde_json::from_str(resource("manifest.json").unwrap()).unwrap();
    let expected = prepare_deployment(
        manifest["version"].as_str().unwrap(),
        &files,
        &facts,
        RootLinks::default(),
    )
    .unwrap();
    for entry in &expected.plan.entries {
        assert_eq!(
            fs::read_to_string(f.project.join(&entry.path)).unwrap(),
            entry.proposed
        );
    }
    assert_eq!(
        published["created"].as_array().unwrap().len(),
        expected.plan.entries.len()
    );
    assert!(!f.project.join("AGENTS.md").exists());
    assert!(!f.project.join("CLAUDE.md").exists());
    let private: Value = serde_json::from_slice(
        &fs::read(f.data.join("dev.voktty/project-memory/memory-local.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(private["projects"], json!([]));
    let again = result(&f.init(&["--yes"]));
    assert_eq!(again["created"], json!([]));
    assert_eq!(
        again["skipped"].as_array().unwrap().len(),
        expected.plan.entries.len()
    );
}

#[test]
fn descendant_and_ancestor_kits_block_initialization_without_project_changes() {
    for parent_first in [true, false] {
        let f = Fixture::new();
        let child = f.project.join("nested");
        fs::create_dir(&child).unwrap();
        let other = Fixture {
            _dir: tempfile::tempdir().unwrap(),
            project: child.clone(),
            data: f.data.clone(),
        };
        let (first, second) = if parent_first {
            (&f, &other)
        } else {
            (&other, &f)
        };
        result(&first.init(&["--yes"]));
        error(&second.init(&["--yes"]), "memory_scope_conflict");
        assert!(!second.project.join(".voktty").exists());
        assert!(first.project.join(".voktty/kit.json").exists());
    }
}

#[test]
fn private_ignore_migration_requires_exact_review_and_preserves_reserved_binary_data() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join(".voktty/sessions")).unwrap();
    fs::write(f.project.join(".voktty/.gitignore"), "*\r\n").unwrap();
    fs::write(f.project.join(".voktty/sessions/kept.bin"), [0, 255, 7]).unwrap();
    error(&f.init(&["--yes"]), "memory_review_required");
    assert!(!f.project.join(".voktty/INIT.md").exists());
    assert_eq!(
        fs::read(f.project.join(".voktty/.gitignore")).unwrap(),
        b"*\r\n"
    );
    let review = result(&f.init(&["--preview"]));
    let report = result(&f.init(&[
        "--yes",
        "--accept-plan",
        review["planDigest"].as_str().unwrap(),
    ]));
    assert_eq!(report["migrated"], json!([".voktty/.gitignore"]));
    assert_eq!(
        fs::read(f.project.join(".voktty/sessions/kept.bin")).unwrap(),
        [0, 255, 7]
    );
}

#[test]
fn opt_in_root_links_preserve_existing_rules_and_refuse_stale_acceptance() {
    let f = Fixture::new();
    fs::write(
        f.project.join("AGENTS.md"),
        "Existing rules\r\nReglas propias\r\n",
    )
    .unwrap();
    fs::write(f.project.join("CLAUDE.md"), "Claude rules\n").unwrap();
    let flags = ["--link-agents", "--link-claude"];
    error(
        &f.init(&[flags[0], flags[1], "--yes"]),
        "memory_review_required",
    );
    let initial = result(&f.init(&[flags[0], flags[1], "--preview"]));
    fs::write(f.project.join("AGENTS.md"), "Changed owner rules\r\n").unwrap();
    error(
        &f.init(&[
            flags[0],
            flags[1],
            "--yes",
            "--accept-plan",
            initial["planDigest"].as_str().unwrap(),
        ]),
        "memory_changed",
    );
    assert!(!f.project.join(".voktty").exists());
    let fresh = result(&f.init(&[flags[0], flags[1], "--preview"]));
    result(&f.init(&[
        flags[0],
        flags[1],
        "--yes",
        "--accept-plan",
        fresh["planDigest"].as_str().unwrap(),
    ]));
    assert!(fs::read_to_string(f.project.join("AGENTS.md"))
        .unwrap()
        .starts_with("Changed owner rules\r\n"));
    assert!(fs::read_to_string(f.project.join("CLAUDE.md"))
        .unwrap()
        .starts_with("Claude rules\n"));
    assert!(fs::read_to_string(f.project.join("CLAUDE.md"))
        .unwrap()
        .contains("@AGENTS.md"));
}

#[test]
fn a_replaced_root_cannot_reuse_the_same_review_digest() {
    let f = Fixture::new();
    let preview = result(&f.init(&["--preview"]));
    let original = f.project.with_extension("old");
    fs::rename(&f.project, &original).unwrap();
    fs::create_dir(&f.project).unwrap();
    error(
        &f.init(&[
            "--yes",
            "--accept-plan",
            preview["planDigest"].as_str().unwrap(),
        ]),
        "memory_changed",
    );
    assert_eq!(fs::read_dir(&f.project).unwrap().count(), 0);
    assert_eq!(fs::read_dir(original).unwrap().count(), 0);
}

#[test]
fn unknown_conflicts_and_links_cannot_be_overwritten_by_yes_or_a_digest() {
    let f = Fixture::new();
    fs::create_dir(f.project.join(".voktty")).unwrap();
    fs::write(f.project.join(".voktty/INIT.md"), "Foreign instructions").unwrap();
    error(
        &f.init(&["--yes", "--accept-plan", &"0".repeat(64)]),
        "memory_file_conflict",
    );
    assert_eq!(
        fs::read_to_string(f.project.join(".voktty/INIT.md")).unwrap(),
        "Foreign instructions"
    );
    assert!(!f.project.join(".voktty/kit.json").exists());
    let linked = Fixture::new();
    std::os::unix::fs::symlink(&f.project, linked.project.join(".voktty")).unwrap();
    assert!(!linked.init(&["--yes"]).status.success());
    assert!(fs::symlink_metadata(linked.project.join(".voktty"))
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn invalid_values_and_conflicting_flags_do_not_initialize_private_state() {
    for flags in [
        vec!["--yes", "--preview"],
        vec!["--yes", "--set", "kit_version=999"],
        vec!["--yes", "--set", "language=not valid"],
        vec!["--accept-plan", "bad"],
    ] {
        let f = Fixture::new();
        let output = f.init(&flags);
        assert_eq!(output.status.code(), Some(2));
        error(&output, "usage");
        assert!(!f.data.exists());
    }
}

#[test]
fn human_preview_escapes_terminal_and_direction_controls_in_repository_text() {
    let f = Fixture::new();
    fs::write(
        f.project.join("AGENTS.md"),
        "Owner rule\n\u{1b}]52;bad\u{7}\u{202e}spoof\r\n",
    )
    .unwrap();
    let output = f.invoke(&["--preview", "--link-agents"], false);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains('\u{1b}'));
    assert!(!text.contains('\u{202e}'));
    assert!(text.contains("\\u{1b}"));
    assert!(text.contains("\\u{202e}"));
    assert!(!f.project.join(".voktty").exists());
}
