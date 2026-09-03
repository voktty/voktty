mod search;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};

use base64::Engine;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use search::{run_search, PreparedSearch, RemoteSearchState};
use serde::Deserialize;
use serde_json::{json, Value};
use voktty_remote_protocol::{
    read_frame, write_frame, Frame, RemoteFsChanged, RemoteRequest, RemoteResponse,
    METHOD_CREATE_DIR, METHOD_CREATE_FILE, METHOD_DELETE, METHOD_GREP, METHOD_GREP_CANCEL,
    METHOD_HANDSHAKE, METHOD_LIST_DIR, METHOD_PTY_CLOSE, METHOD_PTY_OPEN, METHOD_PTY_RESIZE,
    METHOD_READ_BINARY_FILE, METHOD_READ_FILE, METHOD_RENAME, METHOD_REPLACE_APPLY,
    METHOD_REPLACE_PREVIEW, METHOD_STAT, METHOD_WATCH_ADD, METHOD_WATCH_REMOVE,
    METHOD_WORKSPACE_EDIT_APPLY, METHOD_WORKSPACE_EDIT_PREVIEW, METHOD_WRITE_FILE,
    PROTOCOL_VERSION,
};
use voktty_workspace_edit::{
    apply_text_edits, apply_transaction, preview_text_edits, preview_transaction, DiskFile,
    ReplaceSpec, ReplaceTarget, WorkspaceEditFs, WorkspaceTextDocumentEdit,
    WorkspaceTextEditTarget,
};

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_BINARY_FILE_BYTES: u64 = 32 * 1024 * 1024;
const HELPER_VERSION: &str = env!("CARGO_PKG_VERSION");
const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);
const WATCH_MAX_WINDOW: Duration = Duration::from_millis(1000);
const MAX_WATCH_PATHS_PER_REQUEST: usize = 256;
const MAX_WATCH_DIRECTORIES: usize = 1024;
const WATCH_SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".jj",
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
    "target",
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
    ".gradle",
    "obj",
    "vendor",
    "_build",
    "deps",
    ".dart_tool",
    "dist-newstyle",
    ".stack-work",
    ".build",
    "zig-cache",
    "zig-out",
    "cmake-build-debug",
    "cmake-build-release",
    ".idea",
    "coverage",
    ".nyc_output",
    ".terraform",
];

struct RemoteServer {
    root: Option<PathBuf>,
    ptys: Arc<Mutex<HashMap<u64, Arc<RemotePty>>>>,
    watcher: Option<RemoteWatch>,
    search: RemoteSearchState,
}

type SharedOutput = Arc<Mutex<BufWriter<io::Stdout>>>;

struct RemotePty {
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
}

struct RemoteWatch {
    watcher: RecommendedWatcher,
    refcounts: HashMap<PathBuf, usize>,
}

impl Drop for RemotePty {
    fn drop(&mut self) {
        if let Ok(mut killer) = self.killer.lock() {
            let _ = killer.kill();
        }
    }
}

impl RemoteServer {
    fn new() -> Self {
        Self {
            root: None,
            ptys: Arc::new(Mutex::new(HashMap::new())),
            watcher: None,
            search: RemoteSearchState::default(),
        }
    }

    fn handle(&mut self, request: RemoteRequest) -> RemoteResponse {
        if request.protocol != PROTOCOL_VERSION {
            return RemoteResponse::failure(
                request.id,
                "protocol_mismatch",
                format!("unsupported protocol version: {}", request.protocol),
            );
        }

        match request.method.as_str() {
            METHOD_HANDSHAKE => self.handshake(request),
            METHOD_LIST_DIR => self.list_dir(request),
            METHOD_READ_FILE => self.read_file(request),
            METHOD_READ_BINARY_FILE => self.read_binary_file(request),
            METHOD_WRITE_FILE => self.write_file(request),
            METHOD_STAT => self.stat(request),
            METHOD_CREATE_FILE => self.create_file(request),
            METHOD_CREATE_DIR => self.create_dir(request),
            METHOD_RENAME => self.rename(request),
            METHOD_DELETE => self.delete(request),
            METHOD_GREP => self.grep(request),
            METHOD_GREP_CANCEL => self.cancel_grep(request),
            METHOD_REPLACE_PREVIEW => self.replace_preview(request),
            METHOD_REPLACE_APPLY => self.replace_apply(request),
            METHOD_WORKSPACE_EDIT_PREVIEW => self.workspace_edit_preview(request),
            METHOD_WORKSPACE_EDIT_APPLY => self.workspace_edit_apply(request),
            METHOD_PTY_RESIZE => self.resize_pty(request),
            METHOD_PTY_CLOSE => self.close_pty(request),
            METHOD_WATCH_REMOVE => self.remove_watch(request),
            _ => RemoteResponse::failure(request.id, "method_not_found", "unknown remote method"),
        }
    }

    fn handshake(&mut self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<HandshakeParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let root = match canonical_directory(Path::new(&params.workspace_root)) {
            Ok(root) => root,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_root", error),
        };
        self.root = Some(root.clone());
        RemoteResponse::success(
            request.id,
            json!({
                "version": HELPER_VERSION,
                "protocol": PROTOCOL_VERSION,
                "platform": "linux",
                "workspaceRoot": root,
                "capabilities": [
                    METHOD_LIST_DIR,
                    METHOD_READ_FILE,
                    METHOD_READ_BINARY_FILE,
                    METHOD_WRITE_FILE,
                    METHOD_STAT,
                    METHOD_CREATE_FILE,
                    METHOD_CREATE_DIR,
                    METHOD_RENAME,
                    METHOD_DELETE,
                    METHOD_GREP,
                    METHOD_GREP_CANCEL,
                    METHOD_REPLACE_PREVIEW,
                    METHOD_REPLACE_APPLY,
                    METHOD_WORKSPACE_EDIT_PREVIEW,
                    METHOD_WORKSPACE_EDIT_APPLY,
                    METHOD_WATCH_ADD,
                    METHOD_WATCH_REMOVE,
                    METHOD_PTY_OPEN,
                    METHOD_PTY_RESIZE,
                    METHOD_PTY_CLOSE
                ]
            }),
        )
    }

    fn list_dir(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PathParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let path = match self.resolve_existing(params.path.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        let entries = match read_directory(&path) {
            Ok(entries) => entries,
            Err(error) => return RemoteResponse::failure(request.id, "read_failed", error),
        };
        RemoteResponse::success(request.id, json!({ "entries": entries }))
    }

    fn read_file(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PathParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let path = match self.resolve_existing(params.path.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                return RemoteResponse::failure(request.id, "stat_failed", error.to_string())
            }
        };
        if !metadata.is_file() {
            return RemoteResponse::failure(request.id, "not_a_file", "path is not a file");
        }
        if metadata.len() > MAX_FILE_BYTES {
            return RemoteResponse::failure(
                request.id,
                "file_too_large",
                "file exceeds the remote read limit",
            );
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                return RemoteResponse::failure(request.id, "read_failed", error.to_string())
            }
        };
        let content = match String::from_utf8(bytes) {
            Ok(content) => content,
            Err(_) => {
                return RemoteResponse::failure(
                    request.id,
                    "binary_file",
                    "file is not valid UTF-8",
                )
            }
        };
        RemoteResponse::success(
            request.id,
            json!({
                "content": content,
                "size": metadata.len(),
                "mtime": modified_millis(&metadata)
            }),
        )
    }

    fn read_binary_file(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PathParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let path = match self.resolve_existing(params.path.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                return RemoteResponse::failure(request.id, "stat_failed", error.to_string())
            }
        };
        if !metadata.is_file() {
            return RemoteResponse::failure(request.id, "not_a_file", "path is not a file");
        }
        if metadata.len() > MAX_BINARY_FILE_BYTES {
            return RemoteResponse::failure(
                request.id,
                "file_too_large",
                "binary file exceeds the remote preview limit",
            );
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                return RemoteResponse::failure(request.id, "read_failed", error.to_string())
            }
        };
        let content_base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        RemoteResponse::success(
            request.id,
            json!({
                "contentBase64": content_base64,
                "size": metadata.len(),
                "mtime": modified_millis(&metadata)
            }),
        )
    }

    fn prepare_grep(&self, request: &RemoteRequest) -> Result<PreparedSearch, String> {
        let root = self.root.as_ref().ok_or("handshake is required")?;
        self.search.prepare(root, request.params.clone())
    }

    fn grep(&self, request: RemoteRequest) -> RemoteResponse {
        let search = match self.prepare_grep(&request) {
            Ok(search) => search,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_params", error),
        };
        match run_search(search) {
            Ok(result) => RemoteResponse::success(request.id, result),
            Err(error) => RemoteResponse::failure(request.id, "search_failed", error),
        }
    }

    fn cancel_grep(&self, request: RemoteRequest) -> RemoteResponse {
        self.search.cancel();
        RemoteResponse::success(request.id, json!({ "cancelled": true }))
    }

    fn replace_preview(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<ReplacePreviewParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let root = match self.root.as_ref() {
            Some(root) => root.clone(),
            None => {
                return RemoteResponse::failure(
                    request.id,
                    "handshake_required",
                    "handshake is required",
                )
            }
        };
        let mut filesystem = RemoteWorkspaceEdit { root };
        match preview_transaction(&mut filesystem, &params.spec, &params.paths) {
            Ok(preview) => RemoteResponse::success(request.id, json!(preview)),
            Err(error) => RemoteResponse::failure(request.id, "replace_preview_failed", error),
        }
    }

    fn replace_apply(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<ReplaceApplyParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let root = match self.root.as_ref() {
            Some(root) => root.clone(),
            None => {
                return RemoteResponse::failure(
                    request.id,
                    "handshake_required",
                    "handshake is required",
                )
            }
        };
        let mut filesystem = RemoteWorkspaceEdit { root };
        RemoteResponse::success(
            request.id,
            json!(apply_transaction(
                &mut filesystem,
                &params.spec,
                &params.targets,
            )),
        )
    }

    fn workspace_edit_preview(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<WorkspaceEditPreviewParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let root = match self.root.as_ref() {
            Some(root) => root.clone(),
            None => {
                return RemoteResponse::failure(
                    request.id,
                    "handshake_required",
                    "handshake is required",
                )
            }
        };
        let mut filesystem = RemoteWorkspaceEdit { root };
        match preview_text_edits(&mut filesystem, &params.documents) {
            Ok(preview) => RemoteResponse::success(request.id, json!(preview)),
            Err(error) => {
                RemoteResponse::failure(request.id, "workspace_edit_preview_failed", error)
            }
        }
    }

    fn workspace_edit_apply(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<WorkspaceEditApplyParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let root = match self.root.as_ref() {
            Some(root) => root.clone(),
            None => {
                return RemoteResponse::failure(
                    request.id,
                    "handshake_required",
                    "handshake is required",
                )
            }
        };
        let mut filesystem = RemoteWorkspaceEdit { root };
        RemoteResponse::success(
            request.id,
            json!(apply_text_edits(&mut filesystem, &params.targets)),
        )
    }

    fn start_grep(&self, request: RemoteRequest, output: SharedOutput) -> Option<RemoteResponse> {
        let search = match self.prepare_grep(&request) {
            Ok(search) => search,
            Err(error) => {
                return Some(RemoteResponse::failure(request.id, "invalid_params", error))
            }
        };
        let request_id = request.id;
        let failure_id = request_id.clone();
        match thread::Builder::new()
            .name("voktty-remote-search".to_string())
            .spawn(move || {
                let response = match run_search(search) {
                    Ok(result) => RemoteResponse::success(request_id, result),
                    Err(error) => RemoteResponse::failure(request_id, "search_failed", error),
                };
                let _ = send_frame(&output, &Frame::Response(response));
            }) {
            Ok(_) => None,
            Err(error) => Some(RemoteResponse::failure(
                failure_id,
                "search_spawn_failed",
                error.to_string(),
            )),
        }
    }

    fn write_file(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<WriteFileParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        if params.content.len() as u64 > MAX_FILE_BYTES {
            return RemoteResponse::failure(
                request.id,
                "file_too_large",
                "file exceeds the remote write limit",
            );
        }
        let path = match self.resolve_for_write(&params.path) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        if let Err(error) = write_atomic(&path, params.content.as_bytes()) {
            return RemoteResponse::failure(request.id, "write_failed", error.to_string());
        }
        RemoteResponse::success(request.id, json!({ "path": path.to_string_lossy() }))
    }

    fn stat(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PathParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let path = match self.resolve_existing(params.path.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        let link_meta = fs::symlink_metadata(&path).ok();
        let is_symlink = link_meta
            .as_ref()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                if let Some(meta) = link_meta {
                    meta
                } else {
                    return RemoteResponse::failure(request.id, "stat_failed", error.to_string());
                }
            }
        };
        RemoteResponse::success(
            request.id,
            json!({
                "size": metadata.len(),
                "mtime": modified_millis(&metadata),
                "kind": if metadata.is_dir() { "dir" } else { "file" },
                "isSymlink": is_symlink
            }),
        )
    }

    fn create_file(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PathParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let path = match self.resolve_new_path(params.path.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => RemoteResponse::success(request.id, json!({ "path": path })),
            Err(error) => RemoteResponse::failure(request.id, "create_failed", error.to_string()),
        }
    }

    fn create_dir(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PathParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let path = match self.resolve_new_path(params.path.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        match fs::create_dir(&path) {
            Ok(()) => RemoteResponse::success(request.id, json!({ "path": path })),
            Err(error) => RemoteResponse::failure(request.id, "create_failed", error.to_string()),
        }
    }

    fn rename(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<RenameParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let from = match self.resolve_entry(params.from.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        let to = match self.resolve_new_path(params.to.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        if fs::symlink_metadata(&to).is_ok() {
            return RemoteResponse::failure(request.id, "already_exists", "target already exists");
        }
        match fs::rename(&from, &to) {
            Ok(()) => RemoteResponse::success(request.id, json!({ "path": to })),
            Err(error) => RemoteResponse::failure(request.id, "rename_failed", error.to_string()),
        }
    }

    fn delete(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PathParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let path = match self.resolve_entry(params.path.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                return RemoteResponse::failure(request.id, "delete_failed", error.to_string())
            }
        };
        let result = if metadata.is_dir() && !metadata.file_type().is_symlink() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        match result {
            Ok(()) => RemoteResponse::success(request.id, json!({ "path": path })),
            Err(error) => RemoteResponse::failure(request.id, "delete_failed", error.to_string()),
        }
    }

    fn add_watch(&mut self, request: RemoteRequest, output: SharedOutput) -> RemoteResponse {
        let params = match serde_json::from_value::<WatchParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        if params.paths.len() > MAX_WATCH_PATHS_PER_REQUEST {
            return RemoteResponse::failure(
                request.id,
                "watch_limit",
                "too many watch paths in one request",
            );
        }
        let paths = match params
            .paths
            .iter()
            .map(|path| self.resolve_watch_add(path))
            .collect::<Result<HashSet<_>, _>>()
        {
            Ok(paths) => paths,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        if let Err(error) = self.ensure_watch_started(output) {
            return RemoteResponse::failure(request.id, "watch_start_failed", error);
        }
        let watch = self.watcher.as_mut().expect("watcher was initialized");
        let new_count = paths
            .iter()
            .filter(|path| !watch.refcounts.contains_key(*path))
            .count();
        if watch.refcounts.len() + new_count > MAX_WATCH_DIRECTORIES {
            return RemoteResponse::failure(
                request.id,
                "watch_limit",
                "remote watch directory limit reached",
            );
        }
        let mut added = 0usize;
        for path in paths {
            let current = watch.refcounts.get(&path).copied().unwrap_or(0);
            if current > 0 {
                watch.refcounts.insert(path, current.saturating_add(1));
                added += 1;
                continue;
            }
            match watch.watcher.watch(&path, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    watch.refcounts.insert(path, 1);
                    added += 1;
                }
                Err(error) => eprintln!("remote watch add failed: {error}"),
            }
        }
        RemoteResponse::success(request.id, json!({ "watched": added }))
    }

    fn remove_watch(&mut self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<WatchParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        if params.paths.len() > MAX_WATCH_PATHS_PER_REQUEST {
            return RemoteResponse::failure(
                request.id,
                "watch_limit",
                "too many watch paths in one request",
            );
        }
        let paths = match params
            .paths
            .iter()
            .map(|path| self.resolve_watch_remove(path))
            .collect::<Result<HashSet<_>, _>>()
        {
            Ok(paths) => paths,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_path", error),
        };
        let Some(watch) = self.watcher.as_mut() else {
            return RemoteResponse::success(request.id, json!({ "removed": 0 }));
        };
        let mut removed = 0usize;
        for path in paths {
            let current = watch.refcounts.get(&path).copied().unwrap_or(0);
            if current > 1 {
                watch.refcounts.insert(path, current - 1);
                removed += 1;
            } else if current == 1 {
                watch.refcounts.remove(&path);
                let _ = watch.watcher.unwatch(&path);
                removed += 1;
            }
        }
        RemoteResponse::success(request.id, json!({ "removed": removed }))
    }

    fn ensure_watch_started(&mut self, output: SharedOutput) -> Result<(), String> {
        if self.watcher.is_some() {
            return Ok(());
        }
        let root = self.root.clone().ok_or("handshake is required")?;
        let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
        let watcher = RecommendedWatcher::new(
            move |event| {
                let _ = sender.send(event);
            },
            Config::default(),
        )
        .map_err(|error| error.to_string())?;
        thread::Builder::new()
            .name("voktty-remote-fs-watch".to_string())
            .spawn(move || drain_watch_events(receiver, output, root))
            .map_err(|error| error.to_string())?;
        self.watcher = Some(RemoteWatch {
            watcher,
            refcounts: HashMap::new(),
        });
        Ok(())
    }

    fn resolve_watch_add(&self, path: &str) -> Result<PathBuf, String> {
        let path = self.resolve_workspace_path(path, true)?;
        if is_watch_skipped(&path) {
            return Err("directory is excluded from watching".to_string());
        }
        if !path.is_dir() {
            return Err("watch path is not a directory".to_string());
        }
        Ok(path)
    }

    fn resolve_watch_remove(&self, path: &str) -> Result<PathBuf, String> {
        self.resolve_workspace_path(path, false)
    }

    fn resolve_workspace_path(&self, path: &str, must_exist: bool) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("handshake is required")?;
        let raw = Path::new(path);
        let candidate = if raw.is_absolute() {
            let canonical_raw = fs::canonicalize(raw).map_err(|e| e.to_string())?;
            if !canonical_raw.starts_with(root) {
                return Err("path is outside the workspace root".to_string());
            }
            canonical_raw
        } else {
            root.join(safe_relative_path(path)?)
        };
        if let Ok(canonical) = fs::canonicalize(&candidate) {
            return Ok(canonical);
        }
        if must_exist {
            return Err("watch path does not exist".to_string());
        }
        Ok(candidate)
    }

    fn open_pty(&self, request: RemoteRequest, output: SharedOutput) -> RemoteResponse {
        let params = match serde_json::from_value::<PtyOpenParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        let cwd = match self.resolve_pty_cwd(params.cwd.as_deref()) {
            Ok(path) => path,
            Err(error) => return RemoteResponse::failure(request.id, "invalid_cwd", error),
        };
        if params.cols == 0 || params.rows == 0 {
            return RemoteResponse::failure(
                request.id,
                "invalid_size",
                "PTY dimensions must be greater than zero",
            );
        }
        if self
            .ptys
            .lock()
            .map(|ptys| ptys.contains_key(&params.pty_id))
            .unwrap_or(true)
        {
            return RemoteResponse::failure(request.id, "duplicate_pty", "PTY id already exists");
        }

        let pty_system = native_pty_system();
        let size = PtySize {
            rows: params.rows,
            cols: params.cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = match pty_system.openpty(size) {
            Ok(pair) => pair,
            Err(error) => {
                return RemoteResponse::failure(request.id, "pty_open_failed", error.to_string())
            }
        };
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "/bin/sh".to_string());

        let mux_mode = params.multiplexer_mode.as_deref().unwrap_or("auto");

        let mut command = if mux_mode == "none" {
            let mut cmd = CommandBuilder::new(shell);
            cmd.arg("-l");
            cmd
        } else {
            let session_name = params
                .tmux_session_name
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("voktty");
            let sanitized_name: String = session_name
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                .collect();
            let session_name = if sanitized_name.is_empty() {
                "voktty".to_string()
            } else {
                sanitized_name
            };

            let action = params.multiplexer_action.as_deref().unwrap_or("auto");

            let tmux_args = match action {
                "attach_force" => format!("tmux attach -d -t '{session_name}' 2>/dev/null || tmux new-session -s '{session_name}'"),
                "new" => format!("tmux new-session -s '{session_name}'"),
                _ => format!("tmux new-session -A -s '{session_name}'"),
            };

            let screen_args = match action {
                "attach_force" => format!(
                    "screen -d -r '{session_name}' 2>/dev/null || screen -S '{session_name}'"
                ),
                _ => format!("screen -xRR -S '{session_name}'"),
            };

            let script = format!(
                "if command -v tmux >/dev/null 2>&1; then exec {tmux_args}; elif command -v screen >/dev/null 2>&1; then exec {screen_args}; else exec \"$SHELL\" -l; fi"
            );

            let mut cmd = CommandBuilder::new("/bin/sh");
            cmd.args(["-c", &script]);
            cmd
        };
        command.cwd(cwd.clone());
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("VOKTTY_TERMINAL", "1");
        if params.blocks.unwrap_or(false) {
            command.env("VOKTTY_BLOCKS", "1");
        }
        let mut child = match pair.slave.spawn_command(command) {
            Ok(child) => child,
            Err(error) => {
                return RemoteResponse::failure(request.id, "pty_spawn_failed", error.to_string())
            }
        };
        drop(pair.slave);
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let _ = child.kill();
                return RemoteResponse::failure(request.id, "pty_reader_failed", error.to_string());
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                let _ = child.kill();
                return RemoteResponse::failure(request.id, "pty_writer_failed", error.to_string());
            }
        };
        let pty = Arc::new(RemotePty {
            killer: Mutex::new(child.clone_killer()),
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
        });
        if let Ok(mut ptys) = self.ptys.lock() {
            ptys.insert(params.pty_id, pty.clone());
        } else {
            let _ = pty.killer.lock().map(|mut killer| killer.kill());
            return RemoteResponse::failure(request.id, "internal_error", "PTY state is poisoned");
        }

        let pty_id = params.pty_id;
        let output_reader = output.clone();
        let reader_thread = match thread::Builder::new()
            .name(format!("voktty-remote-pty-reader-{pty_id}"))
            .spawn(move || stream_pty_output(pty_id, reader, output_reader))
        {
            Ok(thread) => thread,
            Err(error) => {
                self.remove_pty(pty_id);
                return RemoteResponse::failure(request.id, "pty_reader_failed", error.to_string());
            }
        };
        let ptys = self.ptys.clone();
        if let Err(error) = thread::Builder::new()
            .name(format!("voktty-remote-pty-waiter-{pty_id}"))
            .spawn(move || {
                let code = child
                    .wait()
                    .map(|status| status.exit_code() as i32)
                    .unwrap_or(-1);
                let _ = reader_thread.join();
                if let Ok(mut sessions) = ptys.lock() {
                    sessions.remove(&pty_id);
                }
                let _ = send_frame(&output, &Frame::PtyExit { pty_id, code });
            })
        {
            self.remove_pty(pty_id);
            return RemoteResponse::failure(request.id, "pty_waiter_failed", error.to_string());
        }

        RemoteResponse::success(
            request.id,
            json!({ "ptyId": pty_id, "cwd": cwd, "cols": params.cols, "rows": params.rows }),
        )
    }

    fn write_pty(&self, pty_id: u64, data: &[u8]) -> Result<(), String> {
        let pty = self.find_pty(pty_id)?;
        let result = pty
            .writer
            .lock()
            .map_err(|_| "PTY writer is poisoned".to_string())?
            .write_all(data)
            .map_err(|error| error.to_string());
        result
    }

    fn resize_pty(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PtyResizeParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        if params.cols == 0 || params.rows == 0 {
            return RemoteResponse::failure(request.id, "invalid_size", "invalid PTY dimensions");
        }
        let pty = match self.find_pty(params.pty_id) {
            Ok(pty) => pty,
            Err(error) => return RemoteResponse::failure(request.id, "pty_not_found", error),
        };
        let result = pty
            .master
            .lock()
            .map_err(|_| "PTY master is poisoned".to_string())
            .and_then(|master| {
                master
                    .resize(PtySize {
                        rows: params.rows,
                        cols: params.cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    })
                    .map_err(|error| error.to_string())
            });
        match result {
            Ok(()) => RemoteResponse::success(request.id, json!({ "ptyId": params.pty_id })),
            Err(error) => RemoteResponse::failure(request.id, "pty_resize_failed", error),
        }
    }

    fn close_pty(&self, request: RemoteRequest) -> RemoteResponse {
        let params = match serde_json::from_value::<PtyIdParams>(request.params) {
            Ok(params) => params,
            Err(error) => {
                return RemoteResponse::failure(request.id, "invalid_params", error.to_string())
            }
        };
        if let Some(pty) = self.remove_pty(params.pty_id) {
            let _ = pty.killer.lock().map(|mut killer| killer.kill());
        }
        RemoteResponse::success(request.id, json!({ "ptyId": params.pty_id }))
    }

    fn find_pty(&self, pty_id: u64) -> Result<Arc<RemotePty>, String> {
        self.ptys
            .lock()
            .map_err(|_| "PTY state is poisoned".to_string())?
            .get(&pty_id)
            .cloned()
            .ok_or_else(|| "PTY not found".to_string())
    }

    fn remove_pty(&self, pty_id: u64) -> Option<Arc<RemotePty>> {
        self.ptys.lock().ok()?.remove(&pty_id)
    }

    fn resolve_pty_cwd(&self, cwd: Option<&str>) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("handshake is required")?;
        let requested = cwd.filter(|value| !value.trim().is_empty());
        let candidate = match requested {
            None => root.clone(),
            Some(value) if Path::new(value).is_absolute() => {
                let canonical_p = fs::canonicalize(value).map_err(|e| e.to_string())?;
                if !canonical_p.starts_with(root) {
                    return Err("PTY working directory is outside the workspace root".to_string());
                }
                if !canonical_p.is_dir() {
                    return Err("PTY working directory is not a directory".to_string());
                }
                canonical_p
            }
            Some(value) => {
                let rel = safe_relative_path(value)?;
                let cand = root.join(rel);
                let canonical = fs::canonicalize(&cand).map_err(|e| e.to_string())?;
                if !canonical.starts_with(root) {
                    return Err("PTY working directory is outside the workspace root".to_string());
                }
                if !canonical.is_dir() {
                    return Err("PTY working directory is not a directory".to_string());
                }
                canonical
            }
        };
        Ok(candidate)
    }

    fn resolve_existing(&self, path: Option<&str>) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("handshake is required")?;
        let relative = safe_relative_path(path.unwrap_or("."))?;
        let candidate = root.join(relative);
        if !candidate.exists() && fs::symlink_metadata(&candidate).is_err() {
            return Err("path does not exist".to_string());
        }
        Ok(candidate)
    }

    fn resolve_for_write(&self, path: &str) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("handshake is required")?;
        let relative = safe_relative_path(path)?;
        let candidate = root.join(relative);
        let parent = candidate.parent().ok_or("path has no parent")?;
        if !parent.exists() {
            return Err("parent directory does not exist".to_string());
        }
        Ok(candidate)
    }

    fn resolve_entry(&self, path: Option<&str>) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("handshake is required")?;
        let relative = safe_relative_path(path.unwrap_or("."))?;
        let candidate = root.join(relative);
        if !candidate.exists() && fs::symlink_metadata(&candidate).is_err() {
            return Err("path does not exist".to_string());
        }
        Ok(candidate)
    }

    fn resolve_new_path(&self, path: Option<&str>) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or("handshake is required")?;
        let relative = safe_relative_path(path.unwrap_or("."))?;
        let candidate = root.join(relative);
        if candidate == *root {
            return Err("path must not be the workspace root".to_string());
        }
        let parent = candidate.parent().ok_or("path has no parent")?;
        if !parent.exists() {
            return Err("parent directory does not exist".to_string());
        }
        if fs::symlink_metadata(&candidate).is_ok() {
            return Err("path already exists".to_string());
        }
        Ok(candidate)
    }
}

fn write_atomic(path: &Path, content: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    let suffix = format!(
        ".voktty-write.tmp.{}.{}",
        std::process::id(),
        unique_suffix()
    );
    let temporary = parent.join(suffix);
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(content)?;
        file.sync_all()?;
        if let Ok(metadata) = fs::metadata(path) {
            file.set_permissions(metadata.permissions())?;
        }
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

struct RemoteWorkspaceEdit {
    root: PathBuf,
}

impl RemoteWorkspaceEdit {
    fn resolve_file(&self, relative: &str) -> Result<PathBuf, String> {
        let candidate = self.root.join(safe_relative_path(relative)?);
        if !candidate.exists() && fs::symlink_metadata(&candidate).is_err() {
            return Err("replacement target does not exist".to_string());
        }
        let metadata = fs::metadata(&candidate).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("replacement target must be a regular file".to_string());
        }
        Ok(candidate)
    }
}

impl WorkspaceEditFs for RemoteWorkspaceEdit {
    fn read(&mut self, path: &str) -> Result<DiskFile, String> {
        let path = self.resolve_file(path)?;
        let before = fs::metadata(&path).map_err(|error| error.to_string())?;
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let after = fs::metadata(&path).map_err(|error| error.to_string())?;
        if before.len() != after.len() || modified_millis(&before) != modified_millis(&after) {
            return Err("replacement target changed while it was read".to_string());
        }
        let content = String::from_utf8(bytes)
            .map_err(|_| "replacement target is not valid UTF-8".to_string())?;
        Ok(DiskFile {
            content,
            mtime: modified_millis(&after),
        })
    }

    fn write_atomic(&mut self, path: &str, content: &str) -> Result<(), String> {
        let path = self.resolve_file(path)?;
        write_atomic(&path, content.as_bytes()).map_err(|error| error.to_string())
    }
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

#[derive(Deserialize)]
struct HandshakeParams {
    #[serde(rename = "workspaceRoot")]
    workspace_root: String,
}

#[derive(Deserialize)]
struct PathParams {
    path: Option<String>,
}

#[derive(Deserialize)]
struct RenameParams {
    from: Option<String>,
    to: Option<String>,
}

#[derive(Deserialize)]
struct WriteFileParams {
    path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplacePreviewParams {
    spec: ReplaceSpec,
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceApplyParams {
    spec: ReplaceSpec,
    targets: Vec<ReplaceTarget>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEditPreviewParams {
    documents: Vec<WorkspaceTextDocumentEdit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEditApplyParams {
    targets: Vec<WorkspaceTextEditTarget>,
}

#[derive(Deserialize)]
struct PtyOpenParams {
    #[serde(rename = "ptyId")]
    pty_id: u64,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    blocks: Option<bool>,
    #[serde(rename = "multiplexerMode")]
    multiplexer_mode: Option<String>,
    #[serde(rename = "tmuxSessionName")]
    tmux_session_name: Option<String>,
    #[serde(rename = "multiplexerAction")]
    multiplexer_action: Option<String>,
}

#[derive(Deserialize)]
struct PtyResizeParams {
    #[serde(rename = "ptyId")]
    pty_id: u64,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
struct PtyIdParams {
    #[serde(rename = "ptyId")]
    pty_id: u64,
}

#[derive(Deserialize)]
struct WatchParams {
    paths: Vec<String>,
}

fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(expand_home(path)).map_err(|error| error.to_string())?;
    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err("workspace root is not a directory".to_string())
    }
}

fn expand_home(path: &Path) -> PathBuf {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return path.to_path_buf();
    };
    if path == Path::new("~") {
        return home;
    }
    if let Ok(relative) = path.strip_prefix("~") {
        if relative
            .components()
            .next()
            .is_some_and(|component| matches!(component, Component::Normal(_)))
        {
            return home.join(relative);
        }
    }
    path.to_path_buf()
}

fn safe_relative_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if path.is_absolute() {
        return Err("path must be relative to the workspace root".to_string());
    }
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("path traversal is not allowed".to_string());
    }
    Ok(path.to_path_buf())
}

fn read_directory(path: &Path) -> Result<Vec<Value>, String> {
    let mut entries = fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| directory_entry(&entry))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
    Ok(entries)
}

fn directory_entry(entry: &fs::DirEntry) -> Result<Value, String> {
    let link_metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
    let is_symlink = link_metadata.file_type().is_symlink();
    let (metadata, is_dir) = if is_symlink {
        match fs::metadata(entry.path()) {
            Ok(target_meta) => {
                let is_dir = target_meta.is_dir();
                (target_meta, is_dir)
            }
            Err(_) => (link_metadata.clone(), false),
        }
    } else {
        (link_metadata.clone(), link_metadata.is_dir())
    };
    let kind = if is_dir {
        "directory"
    } else if is_symlink {
        "symlink"
    } else {
        "file"
    };
    let name = entry.file_name().to_string_lossy().into_owned();
    Ok(json!({
        "name": name,
        "kind": kind,
        "isSymlink": is_symlink,
        "size": metadata.len(),
        "mtime": modified_millis(&metadata)
    }))
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn is_watch_skipped(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| WATCH_SKIP_DIRS.contains(&name))
}

fn drain_watch_events(
    receiver: mpsc::Receiver<notify::Result<Event>>,
    output: SharedOutput,
    root: PathBuf,
) {
    loop {
        let first = match receiver.recv() {
            Ok(event) => event,
            Err(_) => return,
        };
        let mut paths = HashSet::new();
        collect_watch_paths(&mut paths, first, &root);
        let deadline = Instant::now() + WATCH_MAX_WINDOW;
        loop {
            let timeout = WATCH_DEBOUNCE.min(deadline.saturating_duration_since(Instant::now()));
            match receiver.recv_timeout(timeout) {
                Ok(event) => collect_watch_paths(&mut paths, event, &root),
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
        let mut paths: Vec<String> = paths.into_iter().collect();
        paths.sort();
        if send_frame(&output, &Frame::FsChanged(RemoteFsChanged { paths })).is_err() {
            return;
        }
    }
}

fn collect_watch_paths(paths: &mut HashSet<String>, event: notify::Result<Event>, root: &Path) {
    let Ok(event) = event else { return };
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    for path in event.paths {
        let candidate = if path.is_absolute() {
            path
        } else {
            root.join(path)
        };
        let candidate = fs::canonicalize(&candidate).unwrap_or(candidate);
        if candidate.starts_with(root) {
            paths.insert(candidate.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn stream_pty_output(pty_id: u64, mut reader: Box<dyn Read + Send>, output: SharedOutput) {
    let mut buffer = [0u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                if send_frame(
                    &output,
                    &Frame::PtyOutput {
                        pty_id,
                        data: buffer[..read].to_vec(),
                    },
                )
                .is_err()
                {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn send_frame(output: &SharedOutput, frame: &Frame) -> io::Result<()> {
    let mut writer = output
        .lock()
        .map_err(|_| io::Error::other("remote output is poisoned"))?;
    write_frame(&mut *writer, frame)?;
    writer.flush()
}

fn run_stdio() -> io::Result<()> {
    let mut stdin = io::stdin().lock();
    let stdout = Arc::new(Mutex::new(BufWriter::new(io::stdout())));
    let mut server = RemoteServer::new();
    while let Some(frame) = read_frame(&mut stdin)? {
        match frame {
            Frame::Request(request) => {
                let response = if request.protocol != PROTOCOL_VERSION {
                    RemoteResponse::failure(
                        request.id,
                        "protocol_mismatch",
                        format!("unsupported protocol version: {}", request.protocol),
                    )
                } else {
                    match request.method.as_str() {
                        METHOD_PTY_OPEN => server.open_pty(request, stdout.clone()),
                        METHOD_WATCH_ADD => server.add_watch(request, stdout.clone()),
                        METHOD_GREP => {
                            if let Some(response) = server.start_grep(request, stdout.clone()) {
                                send_frame(&stdout, &Frame::Response(response))?;
                            }
                            continue;
                        }
                        _ => server.handle(request),
                    }
                };
                send_frame(&stdout, &Frame::Response(response))?;
            }
            Frame::PtyInput { pty_id, data } => {
                let _ = server.write_pty(pty_id, &data);
            }
            Frame::Response(_)
            | Frame::PtyOutput { .. }
            | Frame::PtyExit { .. }
            | Frame::FsChanged(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "client sent a server-only frame",
                ));
            }
        }
    }
    Ok(())
}

fn main() {
    if std::env::args().nth(1).as_deref() != Some("--stdio") {
        eprintln!("voktty-remote requires --stdio");
        std::process::exit(2);
    }
    if let Err(error) = run_stdio() {
        eprintln!("voktty-remote stopped: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::tempdir;

    #[test]
    fn rejects_parent_traversal() {
        assert!(safe_relative_path("../outside").is_err());
        assert!(safe_relative_path("folder/../../outside").is_err());
    }

    #[test]
    fn reads_and_writes_only_inside_root() {
        let dir = tempdir().expect("temp dir");
        File::create(dir.path().join("main.rs")).expect("file");
        let mut server = RemoteServer::new();
        let handshake = RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "1".to_string(),
            method: METHOD_HANDSHAKE.to_string(),
            params: json!({ "workspaceRoot": dir.path() }),
        };
        assert!(server.handle(handshake).ok);

        let listing = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "2".to_string(),
            method: METHOD_LIST_DIR.to_string(),
            params: json!({}),
        });
        assert!(listing.ok);
        assert_eq!(
            listing.result.expect("listing")["entries"][0]["name"],
            "main.rs"
        );

        let write = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "3".to_string(),
            method: METHOD_WRITE_FILE.to_string(),
            params: json!({ "path": "notes.txt", "content": "hello" }),
        });
        assert!(write.ok);
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "hello"
        );

        let escape = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "4".to_string(),
            method: METHOD_READ_FILE.to_string(),
            params: json!({ "path": "../outside" }),
        });
        assert!(!escape.ok);
    }

    #[test]
    fn reads_binary_files_without_utf8_conversion() {
        let dir = tempdir().expect("temp dir");
        fs::write(dir.path().join("image.bin"), [0, 255, 128]).expect("binary fixture");
        let mut server = RemoteServer::new();
        let handshake = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "1".to_string(),
            method: METHOD_HANDSHAKE.to_string(),
            params: json!({ "workspaceRoot": dir.path() }),
        });
        assert!(handshake.ok);
        assert!(handshake.result.expect("handshake")["capabilities"]
            .as_array()
            .expect("capabilities")
            .iter()
            .any(|value| value == METHOD_READ_BINARY_FILE));

        let response = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "2".to_string(),
            method: METHOD_READ_BINARY_FILE.to_string(),
            params: json!({ "path": "image.bin" }),
        });

        assert!(response.ok);
        let result = response.result.expect("binary result");
        assert_eq!(result["contentBase64"], "AP+A");
        assert_eq!(result["size"], 3);
    }

    #[cfg(unix)]
    #[test]
    fn remote_atomic_write_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir().expect("temp dir");
        let target = dir.path().join("script.sh");
        fs::write(&target, "old").expect("test file");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).expect("permissions");

        write_atomic(&target, b"new").expect("atomic write");

        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[test]
    fn supports_workspace_file_operations() {
        let dir = tempdir().expect("temp dir");
        let mut server = RemoteServer::new();
        let handshake = RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "1".to_string(),
            method: METHOD_HANDSHAKE.to_string(),
            params: json!({ "workspaceRoot": dir.path() }),
        };
        assert!(server.handle(handshake).ok);

        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "2".to_string(),
                    method: METHOD_CREATE_DIR.to_string(),
                    params: json!({ "path": "src" }),
                })
                .ok
        );
        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "3".to_string(),
                    method: METHOD_CREATE_FILE.to_string(),
                    params: json!({ "path": "src/main.rs" }),
                })
                .ok
        );
        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "4".to_string(),
                    method: METHOD_RENAME.to_string(),
                    params: json!({ "from": "src/main.rs", "to": "src/lib.rs" }),
                })
                .ok
        );
        assert!(dir.path().join("src/lib.rs").is_file());
        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "5".to_string(),
                    method: METHOD_DELETE.to_string(),
                    params: json!({ "path": "src/lib.rs" }),
                })
                .ok
        );
        assert!(!dir.path().join("src/lib.rs").exists());
    }

    #[test]
    fn previews_and_applies_workspace_replacements() {
        let dir = tempdir().expect("temp dir");
        fs::write(dir.path().join("note.txt"), "foo foo").expect("test file");
        let mut server = RemoteServer::new();
        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "1".to_string(),
                    method: METHOD_HANDSHAKE.to_string(),
                    params: json!({ "workspaceRoot": dir.path() }),
                })
                .ok
        );
        let spec = json!({
            "pattern": "foo",
            "replacement": "bar",
            "regex": false,
            "caseSensitive": true,
            "wholeWord": false
        });
        let preview = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "2".to_string(),
            method: METHOD_REPLACE_PREVIEW.to_string(),
            params: json!({ "spec": spec, "paths": ["note.txt"] }),
        });
        assert!(preview.ok);
        let file = preview.result.expect("preview")["files"][0].clone();
        let apply = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "3".to_string(),
            method: METHOD_REPLACE_APPLY.to_string(),
            params: json!({
                "spec": spec,
                "targets": [{
                    "path": file["path"],
                    "expectedMtime": file["mtime"],
                    "expectedHash": file["hash"],
                    "expectedReplacements": file["replacements"]
                }]
            }),
        });

        assert!(apply.ok);
        assert_eq!(apply.result.expect("outcome")["status"], "applied");
        assert_eq!(
            fs::read_to_string(dir.path().join("note.txt")).unwrap(),
            "bar bar"
        );
    }

    #[test]
    fn previews_and_applies_structural_workspace_edits() {
        let dir = tempdir().expect("temp dir");
        fs::write(dir.path().join("note.txt"), "😀 old").expect("test file");
        let mut server = RemoteServer::new();
        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "1".to_string(),
                    method: METHOD_HANDSHAKE.to_string(),
                    params: json!({ "workspaceRoot": dir.path() }),
                })
                .ok
        );
        let edits = json!([{
            "range": {
                "start": { "line": 0, "character": 3 },
                "end": { "line": 0, "character": 6 }
            },
            "newText": "next"
        }]);
        let preview = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "2".to_string(),
            method: METHOD_WORKSPACE_EDIT_PREVIEW.to_string(),
            params: json!({
                "documents": [{ "path": "note.txt", "edits": edits }]
            }),
        });
        assert!(preview.ok);
        let file = preview.result.expect("preview")["files"][0].clone();
        let apply = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "3".to_string(),
            method: METHOD_WORKSPACE_EDIT_APPLY.to_string(),
            params: json!({
                "targets": [{
                    "path": file["path"],
                    "edits": edits,
                    "expectedMtime": file["mtime"],
                    "expectedHash": file["hash"],
                    "expectedResultHash": file["resultHash"],
                    "expectedEdits": file["edits"]
                }]
            }),
        });

        assert!(apply.ok);
        assert_eq!(apply.result.expect("outcome")["status"], "applied");
        assert_eq!(
            fs::read_to_string(dir.path().join("note.txt")).unwrap(),
            "😀 next"
        );
    }

    #[test]
    fn expands_home_directory_for_workspace_roots() {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return;
        };
        assert_eq!(expand_home(Path::new("~")), home);
        assert_eq!(expand_home(Path::new("~/project")), home.join("project"));
    }

    #[test]
    fn pty_working_directory_must_stay_inside_workspace_root() {
        let workspace = tempdir().expect("workspace");
        let outside = tempdir().expect("outside");
        fs::create_dir(workspace.path().join("nested")).expect("nested directory");
        let mut server = RemoteServer::new();
        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "1".to_string(),
                    method: METHOD_HANDSHAKE.to_string(),
                    params: json!({ "workspaceRoot": workspace.path() }),
                })
                .ok
        );

        assert_eq!(
            server.resolve_pty_cwd(Some("nested")).expect("nested cwd"),
            fs::canonicalize(workspace.path().join("nested")).expect("canonical nested")
        );
        assert!(server.resolve_pty_cwd(outside.path().to_str()).is_err());
        assert!(server.resolve_pty_cwd(Some("../outside")).is_err());
    }

    #[test]
    fn watch_paths_must_be_directories_inside_workspace_root() {
        let workspace = tempdir().expect("workspace");
        let outside = tempdir().expect("outside");
        fs::create_dir(workspace.path().join("src")).expect("source directory");
        fs::create_dir(workspace.path().join("node_modules")).expect("excluded directory");
        let mut server = RemoteServer::new();
        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "1".to_string(),
                    method: METHOD_HANDSHAKE.to_string(),
                    params: json!({ "workspaceRoot": workspace.path() }),
                })
                .ok
        );

        assert!(server.resolve_watch_add("src").is_ok());
        assert!(server.resolve_watch_add("node_modules").is_err());
        assert!(server
            .resolve_watch_add(outside.path().to_str().expect("outside path"))
            .is_err());
    }

    #[test]
    fn watch_refcounts_release_only_after_the_last_consumer() {
        let workspace = tempdir().expect("workspace");
        let watched = workspace.path().join("src");
        fs::create_dir(&watched).expect("source directory");
        let watched_key = fs::canonicalize(&watched).expect("canonical watch path");
        let mut server = RemoteServer::new();
        assert!(
            server
                .handle(RemoteRequest {
                    protocol: PROTOCOL_VERSION,
                    id: "handshake".to_string(),
                    method: METHOD_HANDSHAKE.to_string(),
                    params: json!({ "workspaceRoot": workspace.path() }),
                })
                .ok
        );
        let output = Arc::new(Mutex::new(BufWriter::new(io::stdout())));

        for id in ["add-1", "add-2"] {
            assert!(
                server
                    .add_watch(
                        RemoteRequest {
                            protocol: PROTOCOL_VERSION,
                            id: id.to_string(),
                            method: METHOD_WATCH_ADD.to_string(),
                            params: json!({ "paths": [watched] }),
                        },
                        output.clone(),
                    )
                    .ok
            );
        }
        assert_eq!(
            server
                .watcher
                .as_ref()
                .and_then(|watch| watch.refcounts.get(&watched_key)),
            Some(&2)
        );

        for (id, expected) in [("remove-1", Some(1)), ("remove-2", None)] {
            assert!(
                server
                    .remove_watch(RemoteRequest {
                        protocol: PROTOCOL_VERSION,
                        id: id.to_string(),
                        method: METHOD_WATCH_REMOVE.to_string(),
                        params: json!({ "paths": [watched] }),
                    })
                    .ok
            );
            assert_eq!(
                server
                    .watcher
                    .as_ref()
                    .and_then(|watch| watch.refcounts.get(&watched_key).copied()),
                expected
            );
        }
    }

    #[test]
    fn watch_events_ignore_access_and_paths_outside_root() {
        let workspace = tempdir().expect("workspace");
        let outside = tempdir().expect("outside");
        let changed = workspace.path().join("changed.txt");
        let mut paths = HashSet::new();

        collect_watch_paths(
            &mut paths,
            Ok(Event {
                kind: EventKind::Access(notify::event::AccessKind::Read),
                paths: vec![changed.clone()],
                attrs: Default::default(),
            }),
            workspace.path(),
        );
        collect_watch_paths(
            &mut paths,
            Ok(Event {
                kind: EventKind::Modify(notify::event::ModifyKind::Any),
                paths: vec![changed, outside.path().join("ignored.txt")],
                attrs: Default::default(),
            }),
            workspace.path(),
        );

        assert_eq!(paths.len(), 1);
        assert!(paths
            .iter()
            .next()
            .expect("changed path")
            .ends_with("changed.txt"));
    }

    #[test]
    fn handles_directory_and_file_symlinks() {
        let workspace = tempdir().expect("workspace");
        let external_target = tempdir().expect("external target");
        let ext_file = external_target.path().join("external_file.txt");
        fs::write(&ext_file, "external content").expect("external file write");

        let symlink_dir_path = workspace.path().join("linked_folder");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(external_target.path(), &symlink_dir_path)
                .expect("symlink dir");
        }
        #[cfg(windows)]
        {
            let _ = std::os::windows::fs::symlink_dir(external_target.path(), &symlink_dir_path);
        }

        // Only run assertions if symlink creation succeeded (some Windows test environments lack SeCreateSymbolicLinkPrivilege)
        if fs::symlink_metadata(&symlink_dir_path).is_ok() {
            let mut server = RemoteServer::new();
            assert!(
                server
                    .handle(RemoteRequest {
                        protocol: PROTOCOL_VERSION,
                        id: "1".to_string(),
                        method: METHOD_HANDSHAKE.to_string(),
                        params: json!({ "workspaceRoot": workspace.path() }),
                    })
                    .ok
            );

            // 1. List directory should identify the symlink folder as "directory"
            let list_root = server.handle(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: "2".to_string(),
                method: METHOD_LIST_DIR.to_string(),
                params: json!({}),
            });
            assert!(list_root.ok);
            let entries = list_root.result.expect("entries")["entries"]
                .as_array()
                .cloned()
                .unwrap();
            let link_entry = entries
                .iter()
                .find(|e| e["name"] == "linked_folder")
                .expect("entry found");
            assert_eq!(link_entry["kind"], "directory");
            assert_eq!(link_entry["isSymlink"], true);

            // 2. Listing inside the symlinked folder should return its contents
            let list_sub = server.handle(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: "3".to_string(),
                method: METHOD_LIST_DIR.to_string(),
                params: json!({ "path": "linked_folder" }),
            });
            assert!(list_sub.ok);
            let sub_entries = list_sub.result.expect("sub_entries")["entries"]
                .as_array()
                .cloned()
                .unwrap();
            assert!(sub_entries.iter().any(|e| e["name"] == "external_file.txt"));

            // 3. Reading a file through the symlinked folder should work
            let read_sub = server.handle(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: "4".to_string(),
                method: METHOD_READ_FILE.to_string(),
                params: json!({ "path": "linked_folder/external_file.txt" }),
            });
            assert!(read_sub.ok);
            assert_eq!(
                read_sub.result.expect("content")["content"],
                "external content"
            );

            // 4. Stat should report directory for linked folder
            let stat_dir = server.handle(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: "5".to_string(),
                method: METHOD_STAT.to_string(),
                params: json!({ "path": "linked_folder" }),
            });
            assert!(stat_dir.ok);
            let stat_res = stat_dir.result.expect("stat");
            assert_eq!(stat_res["kind"], "dir");
            assert_eq!(stat_res["isSymlink"], true);
        }
    }
}
