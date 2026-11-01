use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use voktty_workspace_kit::render_template;

fn cli(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_voktty-cli"))
        .current_dir(root)
        .env("XDG_DATA_HOME", root.join("absent-private-data"))
        .env("VOKTTY_CONTROL_ADDR", "invalid-fixture-endpoint")
        .env_remove("VOKTTY_CONTROL_TOKEN")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .unwrap()
}

fn kit(root: &Path) {
    for file in render_template(
        json!({"project_name":"Measure fixture", "created_at":"2026-11-01"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    {
        if !file.path.starts_with(".voktty/") {
            continue;
        }
        let path = root.join(file.path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, file.text).unwrap();
    }
}

fn result(output: &Output) -> Value {
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], true);
    value["result"].clone()
}

fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut files = BTreeMap::new();
    for entry in fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files.extend(snapshot(&path));
        } else {
            files.insert(path.clone(), fs::read(path).unwrap());
        }
    }
    files
}

#[test]
fn measure_works_without_desktop_private_state_or_tty_and_leaves_all_bytes_unchanged() {
    let root = tempfile::tempdir().unwrap();
    kit(root.path());
    fs::create_dir(root.path().join("child space")).unwrap();
    let before = snapshot(root.path());
    let output = cli(
        root.path(),
        &["memory", "measure", "--project", "child space", "--json"],
    );
    assert!(output.status.success());
    let value = result(&output);
    assert_eq!(value["schema"], 1);
    assert_eq!(value["transport"], "local");
    assert_eq!(value["complete"], true);
    assert_eq!(value["exceeded"], false);
    assert_eq!(
        fs::canonicalize(value["root"].as_str().unwrap()).unwrap(),
        fs::canonicalize(root.path()).unwrap()
    );
    assert_eq!(snapshot(root.path()), before);
    assert!(!root.path().join("absent-private-data").exists());
    assert_eq!(
        result(&cli(root.path(), &["memory", "status", "--json"]))["capabilities"]["measurement"],
        true
    );
    let plain = cli(root.path(), &["memory", "measure"]);
    assert!(plain.status.success());
    assert!(String::from_utf8(plain.stdout)
        .unwrap()
        .contains("No files were changed or compacted."));
}

#[test]
fn exceeding_tracking_or_unknown_handoff_age_returns_a_report_and_exit_five() {
    let root = tempfile::tempdir().unwrap();
    kit(root.path());
    fs::write(
        root.path().join(".voktty/plans/TRACKING.md"),
        format!("## Up next\n{}", "- item\n".repeat(4000)),
    )
    .unwrap();
    fs::write(
        root.path().join(".voktty/continuity/handoffs/legacy.md"),
        "PRIVATE BODY MUST NOT BE EMITTED",
    )
    .unwrap();
    let output = cli(root.path(), &["memory", "measure", "--json"]);
    assert_eq!(output.status.code(), Some(5));
    let value = result(&output);
    assert_eq!(value["complete"], false);
    assert_eq!(value["exceeded"], true);
    assert!(value["measurements"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["path"] == "plans/TRACKING.md"
            && m["metric"] == "chars"
            && m["status"] == "exceeded"));
    assert!(!String::from_utf8(output.stdout)
        .unwrap()
        .contains("PRIVATE BODY"));
}

#[test]
fn translated_up_next_heading_is_explicit_and_unknown_does_not_become_zero() {
    let root = tempfile::tempdir().unwrap();
    kit(root.path());
    fs::write(
        root.path().join(".voktty/plans/TRACKING.md"),
        "## Próximo\n- tarea\n",
    )
    .unwrap();
    let output = cli(root.path(), &["memory", "measure", "--json"]);
    assert_eq!(output.status.code(), Some(5));
    assert_eq!(result(&output)["complete"], false);
    let output = cli(
        root.path(),
        &[
            "memory",
            "measure",
            "--up-next-heading",
            "Próximo",
            "--json",
        ],
    );
    assert!(output.status.success());
    assert!(result(&output)["measurements"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["metric"] == "up-next" && m["value"] == 1));
}

#[test]
fn malformed_arguments_and_unsupported_targets_create_nothing() {
    let root = tempfile::tempdir().unwrap();
    for options in [
        vec!["--yes"],
        vec!["--project"],
        vec!["--project", ".", "--project", "."],
        vec!["--up-next-heading", ""],
        vec!["--up-next-heading", "one\ntwo"],
        vec![
            "--up-next-heading",
            "Up next",
            "--up-next-heading",
            "Up next",
        ],
    ] {
        let mut args = vec!["memory", "measure", "--json"];
        args.extend(options);
        let output = cli(root.path(), &args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
    }
    for path in ["remote://fixture/project", "/fixture/.ssh/project"] {
        let output = cli(
            root.path(),
            &["memory", "measure", "--project", path, "--json"],
        );
        assert_eq!(output.status.code(), Some(3));
        assert!(output.stdout.is_empty());
    }
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn absent_or_ambiguous_scope_fails_without_creating_or_selecting_a_kit() {
    let root = tempfile::tempdir().unwrap();
    let output = cli(root.path(), &["memory", "measure", "--json"]);
    assert_eq!(output.status.code(), Some(3));
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    kit(root.path());
    let child = root.path().join("nested");
    fs::create_dir(&child).unwrap();
    kit(&child);
    let before = snapshot(root.path());
    let output = cli(&child, &["memory", "measure", "--json"]);
    assert_eq!(output.status.code(), Some(3));
    assert!(output.stdout.is_empty());
    assert_eq!(snapshot(root.path()), before);
}
