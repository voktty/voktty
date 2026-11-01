use serde_json::{json, Value};
use std::fs;
use std::path::Path;
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

fn kit(root: &Path) {
    fs::create_dir_all(root.join(".voktty")).unwrap();
    let files = render_template(
        json!({"project_name":"CLI fixture","created_at":"2026-10-31"})
            .as_object()
            .unwrap(),
    )
    .unwrap();
    let config = files
        .into_iter()
        .find(|f| f.path == ".voktty/kit.json")
        .unwrap();
    fs::write(root.join(config.path), config.text).unwrap();
    fs::write(root.join(".voktty/INIT.md"), "PRIVATE INSTRUCTION SENTINEL").unwrap();
}

#[test]
fn status_works_without_desktop_tty_or_private_state_and_creates_nothing() {
    let root = tempfile::tempdir().unwrap();
    let output = cli(root.path(), &["memory", "status", "--json"]);
    assert!(output.status.success());
    let value = result(&output);
    assert_eq!(value["scope"]["state"], "absent");
    assert_eq!(value["scope"]["ancestryComplete"], true);
    assert_eq!(value["scope"]["descendantsChecked"], false);
    assert_eq!(
        value["capabilities"]["contextDelivery"],
        cfg!(target_os = "linux")
    );
    assert_eq!(
        value["capabilities"]["initialPromptLaunch"]["codexVersions"],
        json!(["0.165.0"])
    );
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn status_from_a_child_resolves_the_parent_kit_without_printing_instructions() {
    let root = tempfile::tempdir().unwrap();
    kit(root.path());
    fs::create_dir(root.path().join("child space")).unwrap();
    let output = cli(
        root.path(),
        &["memory", "status", "--project", "child space", "--json"],
    );
    assert!(output.status.success());
    let value = result(&output);
    assert_eq!(value["scope"]["state"], "ready");
    assert_eq!(value["scope"]["ancestorKits"].as_array().unwrap().len(), 1);
    assert_eq!(
        fs::canonicalize(value["root"].as_str().unwrap()).unwrap(),
        fs::canonicalize(root.path()).unwrap()
    );
    assert!(!String::from_utf8(output.stdout)
        .unwrap()
        .contains("SENTINEL"));
    assert!(!root.path().join("child space/.voktty").exists());
    assert!(!root.path().join("absent-private-data").exists());
}

#[test]
fn relative_parent_project_is_resolved_as_a_native_path() {
    let root = tempfile::tempdir().unwrap();
    kit(root.path());
    fs::create_dir(root.path().join("child")).unwrap();
    let output = cli(
        &root.path().join("child"),
        &["memory", "status", "--project", "..", "--json"],
    );
    assert!(output.status.success());
    assert_eq!(result(&output)["scope"]["state"], "ready");
}

#[test]
fn nested_kits_report_conflict_and_a_nonzero_exit() {
    let root = tempfile::tempdir().unwrap();
    kit(root.path());
    let child = root.path().join("nested");
    kit(&child);
    let output = cli(&child, &["memory", "status", "--json"]);
    assert_eq!(output.status.code(), Some(5));
    let value = result(&output);
    assert_eq!(value["scope"]["state"], "ambiguous");
    assert!(value["root"].is_null());
    assert_eq!(value["scope"]["ancestorKits"].as_array().unwrap().len(), 2);
    assert_eq!(value["policy"]["state"], "not_checked");
}

#[test]
fn runtime_sessions_are_reserved_and_invalid_markers_are_not_absence() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir_all(root.path().join(".voktty/sessions")).unwrap();
    fs::write(root.path().join(".voktty/sessions/raw.bin"), [0, 255]).unwrap();
    let output = cli(root.path(), &["memory", "status", "--json"]);
    assert!(output.status.success());
    assert_eq!(result(&output)["scope"]["state"], "reserved");
    fs::write(root.path().join(".voktty/kit.json"), "invalid fixture").unwrap();
    let output = cli(root.path(), &["memory", "status", "--json"]);
    assert_eq!(output.status.code(), Some(5));
    assert_eq!(result(&output)["scope"]["state"], "invalid");
    assert_eq!(
        fs::read(root.path().join(".voktty/sessions/raw.bin")).unwrap(),
        [0, 255]
    );
}

#[test]
fn unknown_commands_and_bad_options_fail_before_control_or_project_io() {
    let root = tempfile::tempdir().unwrap();
    for args in [
        vec!["memory", "init", "--json"],
        vec!["memory", "status", "--project", "--json"],
        vec![
            "memory",
            "status",
            "--project",
            ".",
            "--project",
            ".",
            "--json",
        ],
        vec!["memory", "status", "--yes", "--json"],
    ] {
        let output = cli(root.path(), &args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        let error: Value = serde_json::from_slice(&output.stderr).unwrap();
        assert_eq!(error["error"]["code"], "usage");
    }
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn unresolved_remote_namespace_never_becomes_a_local_lookup() {
    let root = tempfile::tempdir().unwrap();
    let output = cli(
        root.path(),
        &[
            "memory",
            "status",
            "--project",
            "remote://fixture/project",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(3));
    assert!(output.stdout.is_empty());
    let error: Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "memory_unsupported");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn linked_marker_is_an_incomplete_observation_without_following_it() {
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    kit(other.path());
    std::os::unix::fs::symlink(other.path().join(".voktty"), root.path().join(".voktty")).unwrap();
    let output = cli(root.path(), &["memory", "status", "--json"]);
    assert_eq!(output.status.code(), Some(5));
    let value = result(&output);
    assert_eq!(value["scope"]["ancestryComplete"], false);
    assert_ne!(value["scope"]["state"], "absent");
    assert!(fs::symlink_metadata(root.path().join(".voktty"))
        .unwrap()
        .file_type()
        .is_symlink());
}
