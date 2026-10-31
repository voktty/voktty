use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use voktty_memory_local::{
    inspect_local_memory_scope, resolve_local_memory_directory, DiscoveryControl, MemoryReadAccess,
    ReadControl, ReadError,
};
use voktty_workspace_kit::render_template;

struct Access {
    root: PathBuf,
    reads: Mutex<Vec<PathBuf>>,
}

impl MemoryReadAccess for Access {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.root.ancestors().any(|p| p == path)
            || self.root.ancestors().any(|p| {
                path == p.join(".voktty") || path.parent() == Some(p.join(".voktty").as_path())
            })
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        path == self.root
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.reads.lock().unwrap().push(path.to_owned());
        self.root
            .ancestors()
            .any(|p| path == p.join(".voktty/kit.json"))
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.root.ancestors().any(|p| path == p.join(".voktty"))
    }
}

#[test]
fn inspection_without_private_state_never_creates_a_kit_or_stable_keys() {
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let access = Access {
        root: root.clone(),
        reads: Mutex::new(Vec::new()),
    };
    let first = inspect_local_memory_scope(&root, &access, &DiscoveryControl::default()).unwrap();
    let second = inspect_local_memory_scope(&root, &access, &DiscoveryControl::default()).unwrap();
    assert_eq!(first.scope.state, "absent");
    assert!(first.scope.ancestry_complete);
    assert_eq!(first.scope.descendants_complete, None);
    assert_ne!(
        first.directories[0].directory_key,
        second.directories[0].directory_key
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    assert!(access.reads.lock().unwrap().is_empty());
}

#[test]
fn inspection_reads_only_config_and_uses_the_shared_scope_validator() {
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    std::fs::create_dir(root.join(".voktty")).unwrap();
    let config = render_template(
        json!({"project_name":"Fixture","created_at":"2026-10-31"})
            .as_object()
            .unwrap(),
    )
    .unwrap()
    .into_iter()
    .find(|f| f.path == ".voktty/kit.json")
    .unwrap()
    .text;
    std::fs::write(root.join(".voktty/kit.json"), config).unwrap();
    std::fs::write(root.join(".voktty/INIT.md"), "DO NOT READ IN STATUS").unwrap();
    let access = Access {
        root: root.clone(),
        reads: Mutex::new(Vec::new()),
    };
    let result = inspect_local_memory_scope(&root, &access, &DiscoveryControl::default()).unwrap();
    assert_eq!(result.scope.state, "ready");
    assert!(access
        .reads
        .lock()
        .unwrap()
        .iter()
        .all(|p| p.ends_with(".voktty/kit.json")));
    std::fs::write(root.join(".voktty/kit.json"), "invalid fixture").unwrap();
    let result = inspect_local_memory_scope(&root, &access, &DiscoveryControl::default()).unwrap();
    assert_eq!(result.scope.state, "invalid");
}

#[test]
fn cancellation_and_denial_precede_filesystem_discovery() {
    let dir = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(dir.path()).unwrap();
    let access = Access {
        root: root.join("other"),
        reads: Mutex::new(Vec::new()),
    };
    assert!(matches!(
        inspect_local_memory_scope(&root, &access, &DiscoveryControl::default()),
        Err(ReadError::Denied)
    ));
    let control = DiscoveryControl::default();
    control.cancel();
    assert!(matches!(
        inspect_local_memory_scope(&root, &access, &control),
        Err(ReadError::Cancelled)
    ));
    assert_eq!(
        resolve_local_memory_directory(&root, &ReadControl::new(Duration::ZERO)),
        Err(ReadError::Timeout)
    );
    assert!(access.reads.lock().unwrap().is_empty());
}

#[test]
fn namespace_and_secret_targets_are_not_reinterpreted_as_local_directories() {
    for target in [
        "remote://host/project",
        "//host/share",
        r"\\host\share",
        "/fixture/.ssh/project",
    ] {
        assert!(
            resolve_local_memory_directory(Path::new(target), &ReadControl::default()).is_err()
        );
    }
}

#[cfg(unix)]
#[test]
fn canonical_secret_root_is_rejected_after_resolution() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join(".ssh")).unwrap();
    let link = dir.path().join("ordinary");
    std::os::unix::fs::symlink(dir.path().join(".ssh"), &link).unwrap();
    assert_eq!(
        resolve_local_memory_directory(&link, &ReadControl::default()),
        Err(ReadError::Denied)
    );
}
