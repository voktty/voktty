#![cfg(target_os = "linux")]

use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

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
        Self {
            project,
            data: owned.path().join("data"),
            _owned: owned,
        }
    }
    fn run(&self, cwd: &Path, args: &[&str], json: bool) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_voktty-cli"));
        command
            .current_dir(cwd)
            .env("XDG_DATA_HOME", &self.data)
            .env("VOKTTY_CONTROL_ADDR", "invalid-fixture")
            .env_remove("VOKTTY_CONTROL_TOKEN")
            .stdin(Stdio::null())
            .args(args);
        if json {
            command.arg("--json");
        }
        command.output().unwrap()
    }
    fn init(&self) {
        result(&self.run(
            &self.project,
            &[
                "memory",
                "init",
                "--yes",
                "--project",
                ".",
                "--set",
                "created_at=2026-10-31",
            ],
            true,
        ));
    }
    fn trust(&self, args: &[&str]) -> Output {
        self.run(
            &self.project,
            &[vec!["memory", "trust"], args.to_vec()].concat(),
            true,
        )
    }
    fn state(&self) -> Vec<u8> {
        fs::read(
            self.data
                .join("app.voktty.voktty/project-memory/memory-local.json"),
        )
        .unwrap()
    }
}
fn result(output: &Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
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
fn contents(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut result = BTreeMap::new();
    for entry in fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            result.extend(contents(&path));
        } else {
            result.insert(path.clone(), fs::read(&path).unwrap());
        }
    }
    result
}

#[test]
fn review_is_literal_and_acceptance_preserves_never_and_all_project_bytes() {
    let f = Fixture::new();
    f.init();
    result(&f.run(&f.project, &["memory", "use", "--never"], true));
    fs::write(f.project.join("AGENTS.md"), "Explicit root instructions").unwrap();
    fs::write(
        f.project.join(".voktty/CONTEXT.md"),
        "FACTUAL PRIVATE SENTINEL",
    )
    .unwrap();
    let before = contents(&f.project);
    let state = f.state();
    let output = f.trust(&["--preview"]);
    let review = result(&output);
    assert!(!String::from_utf8(output.stdout)
        .unwrap()
        .contains("FACTUAL PRIVATE SENTINEL"));
    assert!(review["instructions"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == "AGENTS.md"
            && file["fact"]["text"] == "Explicit root instructions"));
    assert!(review.get("identity").is_none());
    assert!(review.get("localPreferences").is_none());
    assert_eq!(review["trustStored"], false);
    assert_eq!(f.state(), state);
    let accepted = result(&f.trust(&["--accept-review", review["reviewDigest"].as_str().unwrap()]));
    for field in [
        "policyChanged",
        "contextActivated",
        "capturesActivated",
        "projectFilesChanged",
    ] {
        assert_eq!(accepted[field], false);
    }
    assert_eq!(accepted["trustStored"], true);
    let status = result(&f.run(&f.project, &["memory", "status"], true));
    assert_eq!(status["policy"]["mode"], "never");
    assert_eq!(status["trust"], "stored_not_checked");
    assert_eq!(contents(&f.project), before);
    error(
        &f.trust(&["--accept-review", review["reviewDigest"].as_str().unwrap()]),
        "memory_changed",
    );
}

#[test]
fn old_reviews_reject_changed_instructions_config_policy_and_replaced_roots() {
    for change in 0..4 {
        let f = Fixture::new();
        f.init();
        let review = result(&f.trust(&["--preview"]));
        match change {
            0 => fs::write(f.project.join(".voktty/INIT.md"), "Changed instructions").unwrap(),
            1 => {
                let path = f.project.join(".voktty/kit.json");
                let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                value["project"] = "Renamed fixture".into();
                value["values"]["project_name"] = "Renamed fixture".into();
                fs::write(path, value.to_string()).unwrap();
            }
            2 => {
                result(&f.run(&f.project, &["memory", "use", "--always"], true));
            }
            _ => {
                let saved = contents(&f.project);
                fs::rename(&f.project, f.project.with_extension("original")).unwrap();
                fs::create_dir(&f.project).unwrap();
                for (path, bytes) in saved {
                    fs::create_dir_all(path.parent().unwrap()).unwrap();
                    fs::write(path, bytes).unwrap();
                }
            }
        }
        let state = f.state();
        error(
            &f.trust(&["--accept-review", review["reviewDigest"].as_str().unwrap()]),
            "memory_changed",
        );
        assert_eq!(f.state(), state);
    }
}

#[test]
fn factual_updates_remain_outside_instruction_acceptance() {
    let f = Fixture::new();
    f.init();
    let review = result(&f.trust(&["--preview"]));
    for path in [".voktty/CONTEXT.md", ".voktty/PROJECT.md"] {
        fs::write(f.project.join(path), "New factual context").unwrap();
    }
    result(&f.trust(&["--accept-review", review["reviewDigest"].as_str().unwrap()]));
}

#[test]
fn selected_role_and_execution_directory_are_bound_to_the_review() {
    let f = Fixture::new();
    f.init();
    let child = f.project.join("child");
    fs::create_dir(&child).unwrap();
    let role = ".voktty/team/roles/planner.md";
    fs::write(f.project.join(role), "Custom planner instructions").unwrap();
    let review = result(&f.run(
        &child,
        &["memory", "trust", "--preview", "--role", role],
        true,
    ));
    assert_eq!(PathBuf::from(review["root"].as_str().unwrap()), f.project);
    let digest = review["reviewDigest"].as_str().unwrap();
    error(
        &f.trust(&["--role", role, "--accept-review", digest]),
        "memory_changed",
    );
    error(
        &f.run(
            &child,
            &["memory", "trust", "--accept-review", digest],
            true,
        ),
        "memory_changed",
    );
    result(&f.run(
        &child,
        &["memory", "trust", "--role", role, "--accept-review", digest],
        true,
    ));
}

#[test]
fn invalid_requests_and_missing_scopes_do_not_initialize_private_state() {
    let f = Fixture::new();
    for args in [
        vec![],
        vec!["--yes"],
        vec!["--preview", "--preview"],
        vec!["--accept-review", "a"],
        vec!["--preview", "--accept-review", &"a".repeat(64)],
        vec!["--preview", "--role", ".voktty/team/roles/../../.env"],
        vec!["--preview", "--role", ".voktty/team/roles/Upper.md"],
    ] {
        error(&f.trust(&args), "usage");
    }
    error(&f.trust(&["--preview"]), "memory_scope_unavailable");
    assert!(!f.data.exists());
    assert_eq!(fs::read_dir(&f.project).unwrap().count(), 0);
}

#[test]
fn symlinked_instructions_never_disclose_secret_content_or_store_trust() {
    let f = Fixture::new();
    f.init();
    let secret = f.project.parent().unwrap().join(".env");
    fs::write(&secret, "SECRET SENTINEL").unwrap();
    fs::remove_file(f.project.join(".voktty/INIT.md")).unwrap();
    std::os::unix::fs::symlink(secret, f.project.join(".voktty/INIT.md")).unwrap();
    let state = f.state();
    let output = f.trust(&["--preview"]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(!String::from_utf8_lossy(&output.stderr).contains("SENTINEL"));
    assert_eq!(f.state(), state);
}

#[test]
fn human_review_escapes_terminal_controls_without_truncating_instructions() {
    let f = Fixture::new();
    f.init();
    fs::write(
        f.project.join("AGENTS.md"),
        "Before\x1b[2J\u{202e}After\nLast line",
    )
    .unwrap();
    let output = f.run(&f.project, &["memory", "trust", "--preview"], false);
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains('\x1b'));
    assert!(!text.contains('\u{202e}'));
    assert!(text.contains("Before\\u{1b}[2J\\u{202e}After\nLast line"));
}
