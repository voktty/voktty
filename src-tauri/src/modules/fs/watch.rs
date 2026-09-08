use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};

use super::is_network_path;
use crate::modules::fs::to_canon;
use crate::modules::workspace::{resolve_path, WorkspaceEnv, WorkspaceRegistry};

// Quiet-gap before a batch flushes; MAX_WINDOW caps latency under a long stream.
const DEBOUNCE: Duration = Duration::from_millis(150);
const MAX_WINDOW: Duration = Duration::from_millis(1000);

// Matched on the final path component. Never watched even when expanded: large
// or generated trees where live updates cost more than they're worth.
const SKIP_DIRS: &[&str] = &[
    // VCS
    ".git",
    ".hg",
    ".svn",
    ".jj",
    // JS / web
    "node_modules",
    "bower_components",
    ".pnpm-store",
    ".yarn",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    ".vite",
    ".turbo",
    ".parcel-cache",
    ".angular",
    ".vercel",
    ".netlify",
    ".output",
    ".cache",
    // Rust
    "target",
    // Python
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".nox",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".ipynb_checkpoints",
    ".eggs",
    // JVM / Gradle
    ".gradle",
    // .NET
    "obj",
    // Go / PHP
    "vendor",
    // Elixir
    "_build",
    "deps",
    // Dart / Flutter
    ".dart_tool",
    // Haskell
    "dist-newstyle",
    ".stack-work",
    // Swift / Zig
    ".build",
    "zig-cache",
    "zig-out",
    // CMake (CLion)
    "cmake-build-debug",
    "cmake-build-release",
    // IDE / coverage / infra
    ".idea",
    "coverage",
    ".nyc_output",
    ".terraform",
];

fn is_skipped(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| SKIP_DIRS.contains(&n))
}

#[derive(Default)]
pub struct FsWatchState {
    inner: Mutex<Option<WatchInner>>,
}

struct WatchInner {
    watcher: RecommendedWatcher,
    // Explorer (expanded dirs) and editor (dirs of open files) can request the
    // same dir; unwatch only when the last requester releases it.
    refcounts: HashMap<PathBuf, usize>,
    // Whole-tree watches (git diff/review surfaces): every non-skipped
    // directory under a root, kept current as subdirectories are created or
    // removed. Separate from `refcounts` so a plain `fs_watch_add` directory
    // and a tree root can never fight over the same watch's lifetime.
    tree_roots: HashMap<PathBuf, TreeRoot>,
}

struct TreeRoot {
    watched_dirs: HashSet<PathBuf>,
    refcount: usize,
}

#[derive(Clone, serde::Serialize)]
struct ChangedPayload {
    paths: Vec<String>,
}

fn ensure_started(state: &FsWatchState, app: &AppHandle) -> Result<(), String> {
    let mut guard = state.inner.lock().expect("fs watch state poisoned");
    if guard.is_some() {
        return Ok(());
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    let app = app.clone();
    std::thread::Builder::new()
        .name("voktty-fs-watch".into())
        .spawn(move || drain_loop(rx, app))
        .map_err(|e| e.to_string())?;

    *guard = Some(WatchInner {
        watcher,
        refcounts: HashMap::new(),
        tree_roots: HashMap::new(),
    });
    Ok(())
}

fn drain_loop(rx: mpsc::Receiver<notify::Result<Event>>, app: AppHandle) {
    loop {
        let first = match rx.recv() {
            Ok(ev) => ev,
            Err(_) => return,
        };

        let mut paths: HashSet<String> = HashSet::new();
        maintain_tree_watches(&app, &first);
        collect(&mut paths, first);

        let deadline = Instant::now() + MAX_WINDOW;
        loop {
            let timeout = DEBOUNCE.min(deadline.saturating_duration_since(Instant::now()));
            match rx.recv_timeout(timeout) {
                Ok(ev) => {
                    maintain_tree_watches(&app, &ev);
                    collect(&mut paths, ev);
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if Instant::now() >= deadline {
                break;
            }
        }

        if paths.is_empty() {
            continue;
        }
        let _ = app.emit(
            "fs:changed",
            ChangedPayload {
                paths: paths.into_iter().collect(),
            },
        );
    }
}

/// Keeps every active `fs_watch_add_tree` root current as its subdirectories
/// come and go, so tree coverage never goes stale between the initial walk
/// and whatever gets created next (an agent making a new subdirectory full
/// of files must not go unwatched).
fn maintain_tree_watches(app: &AppHandle, ev: &notify::Result<Event>) {
    let Ok(ev) = ev else { return };
    let is_create = matches!(ev.kind, EventKind::Create(_));
    let is_remove = matches!(ev.kind, EventKind::Remove(_));
    if !is_create && !is_remove {
        return;
    }
    let Some(state) = app.try_state::<FsWatchState>() else {
        return;
    };
    let mut guard = state.inner.lock().expect("fs watch state poisoned");
    let Some(inner) = guard.as_mut() else { return };
    if inner.tree_roots.is_empty() {
        return;
    }

    for path in &ev.paths {
        let Some(parent) = path.parent() else {
            continue;
        };
        let root_key = inner
            .tree_roots
            .iter()
            .find(|(_, root)| root.watched_dirs.contains(parent))
            .map(|(key, _)| key.clone());
        let Some(root_key) = root_key else { continue };

        if is_create {
            if !path.is_dir() || is_skipped(path) {
                continue;
            }
            for dir in walk_watchable_dirs(path) {
                let watched = inner
                    .watcher
                    .watch(&dir, RecursiveMode::NonRecursive)
                    .is_ok();
                if watched {
                    if let Some(root) = inner.tree_roots.get_mut(&root_key) {
                        root.watched_dirs.insert(dir);
                    }
                }
            }
        } else {
            let _ = inner.watcher.unwatch(path);
            if let Some(root) = inner.tree_roots.get_mut(&root_key) {
                root.watched_dirs.remove(path);
            }
        }
    }
}

fn collect(set: &mut HashSet<String>, ev: notify::Result<Event>) {
    let Ok(ev) = ev else { return };
    if matches!(ev.kind, EventKind::Access(_)) {
        return;
    }
    for p in ev.paths {
        set.insert(to_canon(&p));
    }
}

/// Every non-skipped directory under `root` (root included), at any depth —
/// `is_skipped` matches by basename regardless of nesting, so a nested
/// `node_modules`/`target`/etc. is pruned wherever it appears.
fn walk_watchable_dirs(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            found.push(dir);
            continue;
        };
        found.push(dir);
        for entry in entries.flatten() {
            let path = entry.path();
            if is_skipped(&path) {
                continue;
            }
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                stack.push(path);
            }
        }
    }
    found
}

fn add_tree(inner: &mut WatchInner, root: PathBuf) {
    if let Some(existing) = inner.tree_roots.get_mut(&root) {
        existing.refcount += 1;
        return;
    }
    let mut watched = HashSet::new();
    for dir in walk_watchable_dirs(&root) {
        match inner.watcher.watch(&dir, RecursiveMode::NonRecursive) {
            Ok(()) => {
                watched.insert(dir);
            }
            Err(e) => log::debug!("fs_watch_add_tree {} failed: {e}", dir.display()),
        }
    }
    inner.tree_roots.insert(
        root,
        TreeRoot {
            watched_dirs: watched,
            refcount: 1,
        },
    );
}

fn remove_tree(inner: &mut WatchInner, root: &Path) {
    let Some(existing) = inner.tree_roots.get_mut(root) else {
        return;
    };
    if existing.refcount > 1 {
        existing.refcount -= 1;
        return;
    }
    if let Some(entry) = inner.tree_roots.remove(root) {
        for dir in entry.watched_dirs {
            let _ = inner.watcher.unwatch(&dir);
        }
    }
}

fn add_paths(inner: &mut WatchInner, paths: Vec<PathBuf>) {
    for canonical in paths {
        let current = inner.refcounts.get(&canonical).copied().unwrap_or(0);
        if current == 0 {
            match inner.watcher.watch(&canonical, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    inner.refcounts.insert(canonical, 1);
                }
                Err(e) => log::debug!("fs_watch add {} failed: {e}", canonical.display()),
            }
        } else {
            inner.refcounts.insert(canonical, current + 1);
        }
    }
}

fn remove_paths(inner: &mut WatchInner, paths: Vec<PathBuf>) {
    for key in paths {
        let current = inner.refcounts.get(&key).copied().unwrap_or(0);
        if current <= 1 {
            inner.refcounts.remove(&key);
            let _ = inner.watcher.unwatch(&key);
        } else {
            inner.refcounts.insert(key, current - 1);
        }
    }
}

// Canonical keys keep add/remove symmetric regardless of how the path was spelled.
fn prepare_add(
    registry: &WorkspaceRegistry,
    workspace: &WorkspaceEnv,
    paths: Vec<String>,
) -> Vec<PathBuf> {
    paths
        .into_iter()
        .filter_map(|raw| {
            let resolved = resolve_path(&raw, workspace);
            if is_network_path(&resolved) {
                return None;
            }
            let canonical = std::fs::canonicalize(&resolved).ok()?;
            if !canonical.is_dir() || is_skipped(&canonical) || !registry.is_authorized(&canonical)
            {
                return None;
            }
            Some(canonical)
        })
        .collect()
}

#[tauri::command]
pub fn fs_watch_add(
    paths: Vec<String>,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
    state: State<'_, FsWatchState>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let prepared = prepare_add(&registry, &workspace, paths);
    if prepared.is_empty() {
        return Ok(());
    }
    ensure_started(&state, &app)?;
    let mut guard = state.inner.lock().expect("fs watch state poisoned");
    if let Some(inner) = guard.as_mut() {
        add_paths(inner, prepared);
    }
    Ok(())
}

#[tauri::command]
pub fn fs_watch_remove(
    paths: Vec<String>,
    workspace: Option<WorkspaceEnv>,
    state: State<'_, FsWatchState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    // A removed/renamed dir no longer canonicalizes; fall back so the refcount
    // entry is still released.
    let prepared: Vec<PathBuf> = paths
        .into_iter()
        .map(|raw| {
            let resolved = resolve_path(&raw, &workspace);
            if is_network_path(&resolved) {
                return resolved;
            }
            std::fs::canonicalize(&resolved).unwrap_or(resolved)
        })
        .collect();
    let mut guard = state.inner.lock().expect("fs watch state poisoned");
    if let Some(inner) = guard.as_mut() {
        remove_paths(inner, prepared);
    }
    Ok(())
}

/// Watches every non-skipped directory under `root` (recursively, minus
/// `SKIP_DIRS` at any depth), kept current as subdirectories come and go —
/// for git diff/review surfaces that need to know about a change anywhere
/// in a working tree, not just in explorer-expanded rows. Refcounted per
/// root: two consumers watching the same repo share one walk.
#[tauri::command]
pub fn fs_watch_add_tree(
    root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
    state: State<'_, FsWatchState>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let resolved = resolve_path(&root, &workspace);
    if is_network_path(&resolved) {
        return Ok(());
    }
    let Ok(canonical) = std::fs::canonicalize(&resolved) else {
        return Ok(());
    };
    if !canonical.is_dir() || !registry.is_authorized(&canonical) {
        return Ok(());
    }
    ensure_started(&state, &app)?;
    let mut guard = state.inner.lock().expect("fs watch state poisoned");
    if let Some(inner) = guard.as_mut() {
        add_tree(inner, canonical);
    }
    Ok(())
}

#[tauri::command]
pub fn fs_watch_remove_tree(
    root: String,
    workspace: Option<WorkspaceEnv>,
    state: State<'_, FsWatchState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let resolved = resolve_path(&root, &workspace);
    let canonical = if is_network_path(&resolved) {
        resolved
    } else {
        std::fs::canonicalize(&resolved).unwrap_or(resolved)
    };
    let mut guard = state.inner.lock().expect("fs watch state poisoned");
    if let Some(inner) = guard.as_mut() {
        remove_tree(inner, &canonical);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_filter_matches_basename() {
        assert!(is_skipped(Path::new("/a/b/node_modules")));
        assert!(is_skipped(Path::new("/x/target")));
        assert!(is_skipped(Path::new("/p/obj")));
        assert!(!is_skipped(Path::new("/a/src")));
        assert!(!is_skipped(Path::new("/a/node_modules/pkg")));
    }

    #[cfg(windows)]
    #[test]
    fn network_filter_rejects_unc_paths_without_touching_the_share() {
        assert!(is_network_path(Path::new(r"\\server\share\project")));
        assert!(!is_network_path(Path::new(r"C:\project")));
    }

    #[test]
    fn collect_ignores_access_and_dedups() {
        let mut set = HashSet::new();
        collect(
            &mut set,
            Ok(Event {
                kind: EventKind::Access(notify::event::AccessKind::Read),
                paths: vec![PathBuf::from("/a/x")],
                attrs: Default::default(),
            }),
        );
        assert!(set.is_empty());

        let modify = || {
            Ok(Event {
                kind: EventKind::Modify(notify::event::ModifyKind::Any),
                paths: vec![PathBuf::from("/a/x")],
                attrs: Default::default(),
            })
        };
        collect(&mut set, modify());
        collect(&mut set, modify());
        assert_eq!(set.len(), 1);
    }

    fn test_inner() -> WatchInner {
        WatchInner {
            watcher: RecommendedWatcher::new(|_res: notify::Result<Event>| {}, Config::default())
                .expect("create test watcher"),
            refcounts: HashMap::new(),
            tree_roots: HashMap::new(),
        }
    }

    #[test]
    fn walk_watchable_dirs_prunes_skip_dirs_at_any_depth() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        std::fs::create_dir_all(root.join("src/deep")).unwrap();
        std::fs::create_dir_all(root.join("src/node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join("target/debug")).unwrap();

        let found: HashSet<PathBuf> = walk_watchable_dirs(root).into_iter().collect();
        assert!(found.contains(&root.to_path_buf()));
        assert!(found.contains(&root.join("src")));
        assert!(found.contains(&root.join("src/deep")));
        assert!(!found.contains(&root.join("src/node_modules")));
        assert!(!found.contains(&root.join("src/node_modules/pkg")));
        assert!(!found.contains(&root.join("target")));
        assert!(!found.contains(&root.join("target/debug")));
    }

    #[test]
    fn add_tree_shares_one_walk_across_refcounted_consumers() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().to_path_buf();
        std::fs::create_dir_all(root.join("src")).unwrap();

        let mut inner = test_inner();
        add_tree(&mut inner, root.clone());
        add_tree(&mut inner, root.clone());
        assert_eq!(inner.tree_roots.get(&root).unwrap().refcount, 2);
        assert!(inner
            .tree_roots
            .get(&root)
            .unwrap()
            .watched_dirs
            .contains(&root));

        remove_tree(&mut inner, &root);
        assert_eq!(inner.tree_roots.get(&root).unwrap().refcount, 1);
        assert!(inner.tree_roots.contains_key(&root));

        remove_tree(&mut inner, &root);
        assert!(!inner.tree_roots.contains_key(&root));
    }

    #[test]
    fn remove_tree_on_an_unknown_root_is_a_harmless_no_op() {
        let mut inner = test_inner();
        remove_tree(&mut inner, Path::new("/never/added"));
        assert!(inner.tree_roots.is_empty());
    }
}
