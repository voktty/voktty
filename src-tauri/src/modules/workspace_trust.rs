use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::modules::workspace::WorkspaceRegistry;

const FORMAT_VERSION: u32 = 1;
const MAX_TRUSTED_ROOTS: usize = 256;
const MAX_STORE_BYTES: u64 = 256 * 1024;

// Serializes read-modify-write cycles so two concurrent approvals never drop each other.
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
struct TrustedRootsFile {
    version: u32,
    roots: Vec<String>,
}

pub fn default_store_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".voktty").join("trusted-roots.json"))
}

pub(crate) fn parse_roots(raw: &str) -> Vec<PathBuf> {
    let Ok(file) = serde_json::from_str::<TrustedRootsFile>(raw) else {
        return Vec::new();
    };
    if file.version != FORMAT_VERSION {
        return Vec::new();
    }
    let mut roots = Vec::new();
    for root in file.roots {
        push_root(&mut roots, PathBuf::from(root));
    }
    roots
}

pub(crate) fn render_roots(roots: &[PathBuf]) -> String {
    let file = TrustedRootsFile {
        version: FORMAT_VERSION,
        roots: roots
            .iter()
            .map(|root| root.to_string_lossy().into_owned())
            .collect(),
    };
    serde_json::to_string_pretty(&file).unwrap_or_default()
}

// Most recent last. Re-trusting a root moves it to the end, and overflow drops the oldest.
pub(crate) fn push_root(roots: &mut Vec<PathBuf>, root: PathBuf) {
    roots.retain(|existing| existing != &root);
    roots.push(root);
    if roots.len() > MAX_TRUSTED_ROOTS {
        let overflow = roots.len() - MAX_TRUSTED_ROOTS;
        roots.drain(..overflow);
    }
}

// A drive or filesystem root would authorize the whole machine.
pub(crate) fn is_trustable_root(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::Normal(_)))
}

fn read_roots(store: &Path) -> Vec<PathBuf> {
    let Ok(metadata) = std::fs::metadata(store) else {
        return Vec::new();
    };
    if !metadata.is_file() || metadata.len() > MAX_STORE_BYTES {
        return Vec::new();
    }
    std::fs::read_to_string(store)
        .map(|raw| parse_roots(&raw))
        .unwrap_or_default()
}

fn write_roots(store: &Path, roots: &[PathBuf]) -> io::Result<()> {
    if let Some(parent) = store.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let staging = store.with_extension("json.tmp");
    std::fs::write(&staging, render_roots(roots))?;
    std::fs::rename(&staging, store).inspect_err(|_| {
        let _ = std::fs::remove_file(&staging);
    })
}

/// Authorizes every root the user approved in an earlier session. Entries that no longer
/// exist, are not directories or would cover a whole drive are skipped.
pub fn load_into(registry: &WorkspaceRegistry, store: &Path) -> usize {
    let mut loaded = 0;
    for root in read_roots(store) {
        let Ok(canonical) = std::fs::canonicalize(&root) else {
            continue;
        };
        if !canonical.is_dir() || !is_trustable_root(&canonical) {
            continue;
        }
        if registry.authorize(&canonical).is_ok() {
            loaded += 1;
        }
    }
    loaded
}

/// Authorizes `path` for this run and records it so later sessions start with it authorized.
pub fn remember(registry: &WorkspaceRegistry, store: &Path, path: &Path) -> io::Result<PathBuf> {
    let canonical = std::fs::canonicalize(path)?;
    if !canonical.is_dir() || !is_trustable_root(&canonical) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "only an existing folder below a drive root can be trusted",
        ));
    }
    registry.authorize(&canonical)?;
    let _guard = STORE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut roots = read_roots(store);
    push_root(&mut roots, canonical.clone());
    write_roots(store, &roots)?;
    Ok(canonical)
}

/// User-approved authorization that survives restarts. A store failure still leaves the
/// root authorized for the current run.
pub fn authorize_and_remember(registry: &WorkspaceRegistry, path: &Path) -> io::Result<PathBuf> {
    match default_store_path() {
        Some(store) => remember(registry, &store, path),
        None => registry.authorize(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tempdir(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "voktty-trust-{label}-{nanos}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create tempdir");
        fs::canonicalize(&dir).expect("canonicalize tempdir")
    }

    #[test]
    fn render_and_parse_round_trip_in_order() {
        let roots = vec![PathBuf::from("/srv/a"), PathBuf::from("/srv/b")];
        assert_eq!(parse_roots(&render_roots(&roots)), roots);
    }

    #[test]
    fn parse_rejects_corrupt_and_unknown_versions() {
        assert!(parse_roots("not json").is_empty());
        assert!(parse_roots(r#"{"version":99,"roots":["/srv/a"]}"#).is_empty());
        assert!(parse_roots(r#"{"version":1}"#).is_empty());
    }

    #[test]
    fn push_root_deduplicates_and_keeps_the_latest_last() {
        let mut roots = vec![PathBuf::from("/a"), PathBuf::from("/b")];
        push_root(&mut roots, PathBuf::from("/a"));
        assert_eq!(roots, vec![PathBuf::from("/b"), PathBuf::from("/a")]);
    }

    #[test]
    fn push_root_drops_the_oldest_beyond_the_cap() {
        let mut roots = Vec::new();
        for index in 0..(MAX_TRUSTED_ROOTS + 5) {
            push_root(&mut roots, PathBuf::from(format!("/root/{index}")));
        }
        assert_eq!(roots.len(), MAX_TRUSTED_ROOTS);
        assert_eq!(roots[0], PathBuf::from("/root/5"));
        assert_eq!(
            roots.last(),
            Some(&PathBuf::from(format!("/root/{}", MAX_TRUSTED_ROOTS + 4)))
        );
    }

    #[test]
    fn a_filesystem_root_is_never_trustable() {
        assert!(!is_trustable_root(Path::new("/")));
        #[cfg(windows)]
        {
            assert!(!is_trustable_root(Path::new(r"C:\")));
            assert!(!is_trustable_root(Path::new(r"\\?\C:\")));
        }
        assert!(is_trustable_root(&std::env::temp_dir()));
    }

    #[test]
    fn remembered_roots_are_authorized_by_a_new_registry() {
        let root = tempdir("persist");
        let store = root.join("store").join("trusted-roots.json");
        let project = root.join("project");
        let nested = project.join("src");
        fs::create_dir_all(&nested).expect("project dirs");

        let first = WorkspaceRegistry::default();
        let canonical = remember(&first, &store, &project).expect("remember");
        assert!(first.is_authorized(&canonical));

        let second = WorkspaceRegistry::default();
        assert!(!second.is_authorized(&canonical));
        assert_eq!(load_into(&second, &store), 1);
        assert!(second.is_authorized(&canonical));
        assert!(second.is_authorized(&fs::canonicalize(&nested).expect("nested")));
        assert!(!second.is_authorized(&root));
    }

    #[test]
    fn remembering_the_same_root_twice_stores_it_once() {
        let root = tempdir("twice");
        let store = root.join("trusted-roots.json");
        let project = root.join("project");
        fs::create_dir_all(&project).expect("project");

        let registry = WorkspaceRegistry::default();
        remember(&registry, &store, &project).expect("first");
        remember(&registry, &store, &project).expect("second");
        assert_eq!(read_roots(&store).len(), 1);
    }

    #[test]
    fn loading_skips_missing_folders_and_files() {
        let root = tempdir("stale");
        let store = root.join("trusted-roots.json");
        let kept = root.join("kept");
        let file = root.join("plain.txt");
        fs::create_dir_all(&kept).expect("kept");
        fs::write(&file, "x").expect("file");
        let roots = vec![
            root.join("gone"),
            fs::canonicalize(&file).expect("file canonical"),
            fs::canonicalize(&kept).expect("kept canonical"),
        ];
        fs::write(&store, render_roots(&roots)).expect("store");

        let registry = WorkspaceRegistry::default();
        assert_eq!(load_into(&registry, &store), 1);
        assert!(registry.is_authorized(&fs::canonicalize(&kept).expect("kept")));
        assert!(!registry.is_authorized(&root.join("gone")));
    }

    #[test]
    fn remember_rejects_files_and_missing_paths() {
        let root = tempdir("reject");
        let store = root.join("trusted-roots.json");
        let file = root.join("plain.txt");
        fs::write(&file, "x").expect("file");

        let registry = WorkspaceRegistry::default();
        assert!(remember(&registry, &store, &file).is_err());
        assert!(remember(&registry, &store, &root.join("missing")).is_err());
        assert!(!store.exists());
    }

    #[test]
    fn an_oversized_store_is_ignored() {
        let root = tempdir("big");
        let store = root.join("trusted-roots.json");
        fs::write(&store, vec![b' '; (MAX_STORE_BYTES + 1) as usize]).expect("store");
        assert!(read_roots(&store).is_empty());
    }
}
