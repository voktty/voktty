#![cfg(target_os = "linux")]

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use voktty_memory_local::{LocalMemoryStore, LocalMemoryWorkspace, MemoryReadAccess, ReadControl};
use voktty_workspace_kit::render_template;

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
        let data = owned.path().join("data");
        Self {
            _owned: owned,
            project,
            data,
        }
    }
    fn run(&self, cwd: &Path, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_voktty-cli"))
            .current_dir(cwd)
            .env("XDG_DATA_HOME", &self.data)
            .env("VOKTTY_CONTROL_ADDR", "invalid-fixture")
            .env_remove("VOKTTY_CONTROL_TOKEN")
            .args(args)
            .arg("--json")
            .stdin(Stdio::null())
            .output()
            .unwrap()
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
        ));
    }
    fn store_path(&self) -> PathBuf {
        self.data
            .join("app.voktty.voktty/project-memory/memory-local.json")
    }
    fn use_mode(&self, mode: &str) -> Output {
        self.run(&self.project, &["memory", "use", mode])
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
fn populate(root: &Path) {
    fs::create_dir_all(root).unwrap();
    for file in render_template(
        json!({"project_name":"Imported fixture","created_at":"2026-10-31"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    {
        if file.path.starts_with(".voktty/") {
            let path = root.join(file.path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, file.text).unwrap();
        }
    }
}

#[test]
fn explicit_modes_persist_without_model_trust_capture_or_project_writes() {
    let f = Fixture::new();
    f.init();
    let before = contents(&f.project);
    for mode in ["always", "never", "manual"] {
        let value = result(&f.use_mode(&format!("--{mode}")));
        assert_eq!(value["mode"], mode);
        assert_eq!(value["scope"], "project-on-this-machine");
        assert_eq!(value["policyStored"], true);
        assert_eq!(value["trust"], "not_accepted");
        assert_eq!(value["contextActivated"], false);
        assert_eq!(value["capturesActivated"], false);
        let status = result(&f.run(&f.project, &["memory", "status"]));
        assert_eq!(status["policy"]["mode"], mode);
    }
    assert_eq!(contents(&f.project), before);
    let state: Value = serde_json::from_slice(&fs::read(f.store_path()).unwrap()).unwrap();
    assert_eq!(state["projects"].as_array().unwrap().len(), 1);
    assert_eq!(state["revision"], 3);
    assert!(state["projects"][0]["instructionDigest"].is_null());
}

#[test]
fn preview_does_not_store_the_requested_policy() {
    for initialized in [true, false] {
        let f = Fixture::new();
        if initialized {
            f.init();
        } else {
            populate(&f.project);
        }
        let before = fs::read(f.store_path()).ok();
        let value = result(&f.run(&f.project, &["memory", "use", "--always", "--preview"]));
        assert_eq!(value["previousMode"], "manual");
        assert_eq!(value["mode"], "always");
        assert_eq!(value["policyStored"], false);
        if let Some(before) = before {
            assert_eq!(fs::read(f.store_path()).unwrap(), before);
        } else {
            let state: Value = serde_json::from_slice(&fs::read(f.store_path()).unwrap()).unwrap();
            assert_eq!(state["projects"], json!([]));
        }
    }
}

#[test]
fn session_and_invalid_choices_never_become_global_policy_or_initialize_state() {
    let f = Fixture::new();
    for args in [
        vec!["memory", "use", "--session"],
        vec!["memory", "use"],
        vec!["memory", "use", "--always", "--never"],
        vec!["memory", "use", "--always", "--always"],
        vec!["memory", "use", "--always", "--project"],
        vec!["memory", "use", "--always", "--unknown"],
    ] {
        let output = f.run(&f.project, &args);
        assert_eq!(output.status.code(), Some(2));
        error(&output, "usage");
    }
    assert!(!f.data.exists());
    assert_eq!(fs::read_dir(&f.project).unwrap().count(), 0);
}

#[test]
fn invalid_or_missing_scopes_fail_before_private_state_creation() {
    for state in ["absent", "reserved", "invalid", "ambiguous"] {
        let f = Fixture::new();
        let child = f.project.join("child");
        fs::create_dir(&child).unwrap();
        match state {
            "reserved" => {
                fs::create_dir_all(f.project.join(".voktty/sessions")).unwrap();
            }
            "invalid" => {
                fs::create_dir(f.project.join(".voktty")).unwrap();
                fs::write(f.project.join(".voktty/kit.json"), "invalid fixture").unwrap();
            }
            "ambiguous" => {
                populate(&f.project);
                populate(&child);
            }
            _ => {}
        }
        let before = contents(&f.project);
        error(
            &f.run(&child, &["memory", "use", "--never"]),
            "memory_scope_unavailable",
        );
        assert!(!f.data.exists());
        assert_eq!(contents(&f.project), before);
    }
}

#[test]
fn child_selection_resolves_parent_and_same_named_projects_do_not_share_policy() {
    let f = Fixture::new();
    f.init();
    let child = f.project.join("child");
    fs::create_dir(&child).unwrap();
    let value = result(&f.run(&child, &["memory", "use", "--never"]));
    assert_eq!(
        PathBuf::from(value["root"].as_str().unwrap()),
        fs::canonicalize(&f.project).unwrap()
    );
    let other = f.project.parent().unwrap().join("other/project");
    populate(&other);
    assert_eq!(other.file_name(), f.project.file_name());
    let status = result(&f.run(&other, &["memory", "status"]));
    assert_eq!(status["policy"]["mode"], "manual");
    let own = result(&f.run(&child, &["memory", "status"]));
    assert_eq!(own["policy"]["mode"], "never");
    result(&f.run(
        &f.project,
        &[
            "memory",
            "use",
            "--always",
            "--project",
            other.to_str().unwrap(),
        ],
    ));
    assert_eq!(
        result(&f.run(&other, &["memory", "status"]))["policy"]["mode"],
        "always"
    );
    assert_eq!(
        result(&f.run(&child, &["memory", "status"]))["policy"]["mode"],
        "never"
    );
}

#[test]
fn imported_ready_kit_can_store_policy_without_creating_a_desktop_connection() {
    let f = Fixture::new();
    populate(&f.project);
    let before = contents(&f.project);
    result(&f.use_mode("--always"));
    assert_eq!(contents(&f.project), before);
    assert!(f.store_path().exists());
}

#[test]
fn policy_reads_no_instruction_content_and_never_accepts_a_new_digest() {
    let f = Fixture::new();
    f.init();
    fs::remove_file(f.project.join(".voktty/INIT.md")).unwrap();
    let secret = f.project.parent().unwrap().join(".env");
    fs::write(&secret, "PRIVATE SENTINEL").unwrap();
    std::os::unix::fs::symlink(&secret, f.project.join(".voktty/INIT.md")).unwrap();
    let output = f.use_mode("--always");
    let value = result(&output);
    assert_eq!(value["trust"], "not_accepted");
    assert!(!String::from_utf8(output.stdout)
        .unwrap()
        .contains("SENTINEL"));
}

#[test]
fn policy_preserves_an_accepted_digest_without_retrusting_changed_instructions() {
    struct Access {
        root: PathBuf,
    }
    impl MemoryReadAccess for Access {
        fn allows_metadata(&self, p: &Path) -> bool {
            p.starts_with(&self.root)
        }
        fn allows_read(&self, p: &Path) -> bool {
            self.allows_metadata(p)
        }
    }
    let f = Fixture::new();
    f.init();
    result(&f.use_mode("--always"));
    let control = ReadControl::default();
    let store =
        LocalMemoryStore::open_private(&f.data.join("app.voktty.voktty"), &control).unwrap();
    let access = Access {
        root: fs::canonicalize(&f.project).unwrap(),
    };
    let workspace = LocalMemoryWorkspace::open(&store, &access.root, &access, &control).unwrap();
    let observed = workspace.observe_context(None, &control).unwrap();
    let before = store.load().unwrap();
    store
        .trust_instructions(
            before.revision(),
            workspace.project_key(),
            &observed.fingerprint.digest,
        )
        .unwrap();
    fs::write(
        f.project.join(".voktty/INIT.md"),
        "Changed after explicit native trust",
    )
    .unwrap();
    for flag in ["--never", "--manual", "--always"] {
        let value = result(&f.use_mode(flag));
        assert_eq!(value["trust"], "stored_not_checked");
        assert_eq!(
            store
                .load()
                .unwrap()
                .project(workspace.project_key())
                .unwrap()
                .instruction_digest
                .as_ref(),
            Some(&observed.fingerprint.digest)
        );
    }
}

#[test]
fn a_replaced_project_cannot_inherit_persisted_always() {
    let f = Fixture::new();
    f.init();
    result(&f.use_mode("--always"));
    let original = f.project.with_extension("original");
    fs::rename(&f.project, &original).unwrap();
    populate(&f.project);
    let value = result(&f.run(&f.project, &["memory", "status"]));
    assert_eq!(value["policy"]["mode"], "manual");
    let value = result(&f.use_mode("--manual"));
    assert_eq!(value["trust"], "not_accepted");
    assert!(original.join(".voktty/kit.json").exists());
}
