use super::*;
use std::fs;
use voktty_memory_local::ReadControl;
use voktty_workspace_kit::render_template;

#[path = "../../../test_support/memory_parent.rs"]
mod memory_parent;

fn private_parent() -> tempfile::TempDir {
    memory_parent::memory_parent()
}

fn kit(root: &Path) {
    fs::create_dir(root.join(".voktty")).unwrap();
    let config = render_template(
        json!({"project_name":"Policy fixture","created_at":"2026-10-31"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    .into_iter()
    .find(|file| file.path == ".voktty/kit.json")
    .unwrap();
    fs::write(root.join(config.path), config.text).unwrap();
}

#[test]
fn no_private_state_and_no_private_origin_remain_distinct() {
    let project = tempfile::tempdir().unwrap();
    kit(project.path());
    let missing = project.path().join("absent-private-state");
    let result = status(project.path(), Some(&missing)).unwrap();
    assert_eq!(
        result["policy"],
        json!({"state":"uninitialized","mode":"manual"})
    );
    assert_eq!(result["trust"], "not_accepted");
    assert!(!missing.exists());
    let result = status(project.path(), None).unwrap();
    assert_eq!(result["policy"], json!({"state":"unavailable","mode":null}));
    assert_eq!(result["trust"], "not_checked");
}

#[test]
fn status_uses_native_root_bound_preferences_without_claiming_current_trust() {
    let project = tempfile::tempdir().unwrap();
    kit(project.path());
    let parent = private_parent();
    let control = ReadControl::default();
    let store = LocalMemoryStore::create_private(parent.path(), &control).unwrap();
    let initial = store.initialize().unwrap();
    let root = resolve_local_memory_directory(project.path(), &control).unwrap();
    let access = MarkerAccess { root: root.clone() };
    let workspace = LocalMemoryWorkspace::open(&store, &root, &access, &control).unwrap();
    let chosen = workspace
        .set_policy(initial.revision(), MemoryPolicy::Always, &control)
        .unwrap();
    let trusted = store
        .trust_instructions(chosen.revision(), workspace.project_key(), &"a".repeat(64))
        .unwrap();
    fs::write(
        root.join(".voktty/INIT.md"),
        "changed instructions, never read by status",
    )
    .unwrap();
    let result = status(&root, Some(parent.path())).unwrap();
    assert_eq!(
        result["policy"],
        json!({"state":"observed","mode":"always"})
    );
    assert_eq!(result["trust"], "stored_not_checked");
    assert_eq!(
        result["capabilities"]["contextDelivery"],
        cfg!(target_os = "linux")
    );
    assert_eq!(
        result["capabilities"]["initialPromptLaunch"]["codexVersions"],
        json!(["0.165.0"])
    );
    assert_eq!(
        result["capabilities"]["initialPromptLaunch"]["claudeVersions"],
        json!(["2.1.312"])
    );
    assert_eq!(store.load().unwrap(), trusted);
    workspace
        .set_policy(trusted.revision(), MemoryPolicy::Never, &control)
        .unwrap();
    assert_eq!(
        status(&root, Some(parent.path())).unwrap()["policy"]["mode"],
        "never"
    );
}

#[test]
fn corrupted_private_state_fails_without_repair_or_content_in_errors() {
    let project = tempfile::tempdir().unwrap();
    kit(project.path());
    let parent = private_parent();
    let store = LocalMemoryStore::create_private(parent.path(), &ReadControl::default()).unwrap();
    store.initialize().unwrap();
    let path = parent.path().join("project-memory/memory-local.json");
    let bytes = b"PRIVATE MALFORMED STATE";
    fs::write(&path, bytes).unwrap();
    let error = status(project.path(), Some(parent.path())).unwrap_err();
    assert_eq!(error.code, "memory_invalid_state");
    assert!(!error.message.contains("PRIVATE"));
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn marker_authority_grants_no_instruction_or_sibling_content() {
    let project = tempfile::tempdir().unwrap();
    let access = MarkerAccess {
        root: fs::canonicalize(project.path()).unwrap(),
    };
    assert!(access.allows_read(&access.root.join(".voktty/kit.json")));
    for target in [".voktty/INIT.md", "AGENTS.md", ".env", ".voktty/PROJECT.md"] {
        assert!(!access.allows_read(&access.root.join(target)));
    }
    assert!(!access.allows_enumeration(&access.root.join(".voktty/sessions")));
    assert!(!access.allows_metadata(&access.root.join("sibling")));
}

#[cfg(unix)]
#[test]
fn non_utf8_subcommands_are_usage_errors_without_io() {
    use std::os::unix::ffi::OsStringExt;
    let error = parse(vec![OsString::from_vec(vec![255])]).unwrap_err();
    assert_eq!(error.code, "usage");
}
