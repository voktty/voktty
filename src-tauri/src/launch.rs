#![cfg_attr(target_os = "android", allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::modules::workspace;

pub const LAUNCH_EVENT: &str = "voktty:launch-request";
const MAX_PENDING_REQUESTS: usize = 64;
const MAX_APPLIED_REQUESTS: usize = 256;
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchSource {
    ColdStart,
    SecondInstance,
    Opened,
    ControlCli,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchIntent {
    RestoreLastSession,
    OpenFilesOnly,
    OpenDirectoryOnly,
    OpenFilesInCurrentSession,
    OpenDirectoryInCurrentSession,
    NewStandaloneTab,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub request_id: String,
    pub source: LaunchSource,
    pub intent: LaunchIntent,
    pub paths: Vec<String>,
    pub source_cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LaunchEntry {
    Directory(PathBuf),
    File(PathBuf),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchBootstrap {
    pub instance_id: String,
    pub requests: Vec<LaunchRequest>,
}

struct QueueInner {
    pending: VecDeque<LaunchRequest>,
    applied_order: VecDeque<String>,
    applied: HashSet<String>,
}

pub struct LaunchQueue {
    inner: Mutex<QueueInner>,
    frontend_ready: AtomicBool,
    pending_capacity: usize,
    applied_capacity: usize,
    instance_id: String,
}

impl Default for LaunchQueue {
    fn default() -> Self {
        Self::new(
            MAX_PENDING_REQUESTS,
            MAX_APPLIED_REQUESTS,
            new_identifier("instance"),
        )
    }
}

impl LaunchQueue {
    #[cfg(test)]
    fn with_capacity(
        pending_capacity: usize,
        applied_capacity: usize,
        instance_id: String,
    ) -> Self {
        Self::new(pending_capacity, applied_capacity, instance_id)
    }

    fn new(pending_capacity: usize, applied_capacity: usize, instance_id: String) -> Self {
        Self {
            inner: Mutex::new(QueueInner {
                pending: VecDeque::new(),
                applied_order: VecDeque::new(),
                applied: HashSet::new(),
            }),
            frontend_ready: AtomicBool::new(false),
            pending_capacity,
            applied_capacity,
            instance_id,
        }
    }

    pub fn enqueue(&self, request: LaunchRequest) -> bool {
        let mut inner = self.inner.lock().expect("LaunchQueue mutex poisoned");
        if inner.applied.contains(&request.request_id)
            || inner
                .pending
                .iter()
                .any(|pending| pending.request_id == request.request_id)
        {
            return false;
        }
        if request.source == LaunchSource::Opened && request.intent == LaunchIntent::OpenFilesOnly {
            inner
                .pending
                .retain(|pending| pending.intent != LaunchIntent::RestoreLastSession);
        }
        while inner.pending.len() >= self.pending_capacity {
            inner.pending.pop_front();
        }
        inner.pending.push_back(request);
        true
    }

    pub fn deliverable(&self) -> Vec<LaunchRequest> {
        self.inner
            .lock()
            .expect("LaunchQueue mutex poisoned")
            .pending
            .iter()
            .cloned()
            .collect()
    }

    pub fn acknowledge(&self, request_id: &str) -> bool {
        let mut inner = self.inner.lock().expect("LaunchQueue mutex poisoned");
        let previous_len = inner.pending.len();
        inner
            .pending
            .retain(|request| request.request_id != request_id);
        if previous_len == inner.pending.len() && !inner.applied.contains(request_id) {
            return false;
        }
        if inner.applied.insert(request_id.to_string()) {
            inner.applied_order.push_back(request_id.to_string());
        }
        while inner.applied_order.len() > self.applied_capacity {
            if let Some(expired) = inner.applied_order.pop_front() {
                inner.applied.remove(&expired);
            }
        }
        true
    }

    #[cfg(target_os = "macos")]
    pub fn has_pending_restore(&self) -> bool {
        self.inner
            .lock()
            .expect("LaunchQueue mutex poisoned")
            .pending
            .iter()
            .any(|request| request.intent == LaunchIntent::RestoreLastSession)
    }

    pub fn set_frontend_ready(&self, ready: bool) {
        self.frontend_ready.store(ready, Ordering::Release);
    }

    pub fn frontend_ready(&self) -> bool {
        self.frontend_ready.load(Ordering::Acquire)
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }
}

fn new_identifier(prefix: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{timestamp:x}-{sequence:x}", std::process::id())
}

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn source_cwd(cwd: Option<String>) -> Option<String> {
    cwd.and_then(|value| {
        std::fs::canonicalize(&value)
            .ok()
            .filter(|path| path.is_dir())
            .map(|path| normalized_path(&path))
            .or(Some(value.replace('\\', "/")))
    })
}

pub fn classify_entries(
    source: LaunchSource,
    entries: Vec<LaunchEntry>,
    cwd: Option<String>,
) -> LaunchRequest {
    let directory = entries.iter().find_map(|entry| match entry {
        LaunchEntry::Directory(path) => Some(normalized_path(path)),
        LaunchEntry::File(_) => None,
    });
    let files = entries
        .iter()
        .filter_map(|entry| match entry {
            LaunchEntry::File(path) => Some(normalized_path(path)),
            LaunchEntry::Directory(_) => None,
        })
        .collect::<Vec<_>>();
    let cold = source == LaunchSource::ColdStart;
    let (intent, paths) = if let Some(directory) = directory {
        (
            if cold {
                LaunchIntent::OpenDirectoryOnly
            } else {
                LaunchIntent::OpenDirectoryInCurrentSession
            },
            vec![directory],
        )
    } else if !files.is_empty() {
        (
            if cold {
                LaunchIntent::OpenFilesOnly
            } else {
                LaunchIntent::OpenFilesInCurrentSession
            },
            files,
        )
    } else {
        (
            if cold {
                LaunchIntent::RestoreLastSession
            } else {
                LaunchIntent::NewStandaloneTab
            },
            Vec::new(),
        )
    };
    LaunchRequest {
        request_id: new_identifier("launch"),
        source,
        intent,
        paths,
        source_cwd: source_cwd(cwd),
        line: None,
        column: None,
        focus: None,
    }
}

pub fn parse_argv(
    source: LaunchSource,
    args: impl IntoIterator<Item = String>,
    cwd: Option<String>,
) -> LaunchRequest {
    let entries = args
        .into_iter()
        .skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .filter_map(|argument| std::fs::canonicalize(argument).ok())
        .filter_map(|path| {
            let metadata = std::fs::metadata(&path).ok()?;
            Some(if metadata.is_dir() {
                LaunchEntry::Directory(path)
            } else if metadata.is_file() {
                LaunchEntry::File(path)
            } else {
                return None;
            })
        })
        .collect();
    classify_entries(source, entries, cwd)
}

#[cfg(any(target_os = "macos", test))]
pub fn parse_opened_paths(
    paths: impl IntoIterator<Item = PathBuf>,
    cwd: Option<String>,
    cold: bool,
) -> LaunchRequest {
    let entries = paths
        .into_iter()
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .filter(|path| path.is_file())
        .map(LaunchEntry::File)
        .collect();
    let mut request = classify_entries(LaunchSource::Opened, entries, cwd);
    if cold && request.intent == LaunchIntent::OpenFilesInCurrentSession {
        request.intent = LaunchIntent::OpenFilesOnly;
    }
    request
}

pub fn workspace_dir(request: &LaunchRequest) -> Option<String> {
    match request.intent {
        LaunchIntent::OpenDirectoryOnly | LaunchIntent::OpenDirectoryInCurrentSession => {
            request.paths.first().cloned()
        }
        LaunchIntent::OpenFilesOnly | LaunchIntent::OpenFilesInCurrentSession => request
            .paths
            .first()
            .and_then(|path| Path::new(path).parent())
            .map(normalized_path),
        LaunchIntent::RestoreLastSession | LaunchIntent::NewStandaloneTab => {
            request.source_cwd.clone()
        }
    }
}

pub fn enqueue_and_emit(app: &AppHandle, request: LaunchRequest) -> bool {
    let Some(queue) = app.try_state::<LaunchQueue>() else {
        return false;
    };
    if let Some(registry) = app.try_state::<workspace::WorkspaceRegistry>() {
        for path in &request.paths {
            let target = Path::new(path);
            let root = if target.is_dir() {
                Some(target)
            } else {
                target.parent()
            };
            if let Some(root) = root {
                let _ = registry.authorize(root);
            }
        }
    }
    if !queue.enqueue(request.clone()) {
        return false;
    }
    if queue.frontend_ready() {
        let _ = app.emit(LAUNCH_EVENT, request);
    }
    true
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn launch_bootstrap(state: State<'_, LaunchQueue>) -> LaunchBootstrap {
    LaunchBootstrap {
        instance_id: state.instance_id().to_string(),
        requests: state.deliverable(),
    }
}

#[tauri::command]
pub fn launch_frontend_ready(state: State<'_, LaunchQueue>, ready: bool) -> Vec<LaunchRequest> {
    state.set_frontend_ready(ready);
    if ready {
        state.deliverable()
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub fn launch_acknowledge(state: State<'_, LaunchQueue>, request_id: String) -> bool {
    state.acknowledge(&request_id)
}

#[cfg(test)]
mod tests {
    use super::{
        classify_entries, parse_argv, parse_opened_paths, LaunchEntry, LaunchIntent, LaunchQueue,
        LaunchRequest, LaunchSource,
    };
    use std::path::PathBuf;

    fn request(id: &str, intent: LaunchIntent) -> LaunchRequest {
        LaunchRequest {
            request_id: id.to_string(),
            source: LaunchSource::ColdStart,
            intent,
            paths: Vec::new(),
            source_cwd: None,
            line: None,
            column: None,
            focus: None,
        }
    }

    #[test]
    fn cold_and_warm_empty_launches_have_distinct_intentions() {
        let cold = classify_entries(LaunchSource::ColdStart, Vec::new(), None);
        let warm = classify_entries(LaunchSource::SecondInstance, Vec::new(), None);

        assert_eq!(cold.intent, LaunchIntent::RestoreLastSession);
        assert_eq!(warm.intent, LaunchIntent::NewStandaloneTab);
    }

    #[test]
    fn files_and_directories_are_classified_deterministically() {
        let files = classify_entries(
            LaunchSource::ColdStart,
            vec![
                LaunchEntry::File(PathBuf::from("/repo/a.ts")),
                LaunchEntry::File(PathBuf::from("/repo/b.ts")),
            ],
            Some("/origin".to_string()),
        );
        let directory = classify_entries(
            LaunchSource::ColdStart,
            vec![
                LaunchEntry::File(PathBuf::from("/ignored.ts")),
                LaunchEntry::Directory(PathBuf::from("/repo")),
            ],
            None,
        );

        assert_eq!(files.intent, LaunchIntent::OpenFilesOnly);
        assert_eq!(files.paths, vec!["/repo/a.ts", "/repo/b.ts"]);
        assert_eq!(directory.intent, LaunchIntent::OpenDirectoryOnly);
        assert_eq!(directory.paths, vec!["/repo"]);
    }

    #[test]
    fn queue_bounds_pending_requests_and_tracks_applied_ids() {
        let queue = LaunchQueue::with_capacity(2, 3, "instance-test".to_string());
        assert!(queue.enqueue(request("one", LaunchIntent::NewStandaloneTab)));
        assert!(queue.enqueue(request("two", LaunchIntent::NewStandaloneTab)));
        assert!(queue.enqueue(request("three", LaunchIntent::NewStandaloneTab)));
        assert_eq!(
            queue
                .deliverable()
                .into_iter()
                .map(|item| item.request_id)
                .collect::<Vec<_>>(),
            vec!["two", "three"]
        );
        assert!(queue.acknowledge("two"));
        assert!(!queue.enqueue(request("two", LaunchIntent::NewStandaloneTab)));
        assert_eq!(queue.deliverable().len(), 1);
    }

    #[test]
    fn macos_opened_files_replace_an_unapplied_cold_restore() {
        let queue = LaunchQueue::default();
        assert!(queue.enqueue(request("restore", LaunchIntent::RestoreLastSession)));
        let mut opened = request("opened", LaunchIntent::OpenFilesOnly);
        opened.source = LaunchSource::Opened;
        opened.paths = vec!["/repo/a.ts".to_string()];

        assert!(queue.enqueue(opened));
        let pending = queue.deliverable();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].request_id, "opened");
    }

    #[test]
    fn argv_parser_canonicalizes_files_for_cold_and_second_instance_requests() {
        let directory = tempfile::tempdir().expect("tempdir");
        let file = directory.path().join("open.txt");
        std::fs::write(&file, "test").expect("write fixture");
        let args = vec!["voktty".to_string(), file.to_string_lossy().into_owned()];

        let cold = parse_argv(LaunchSource::ColdStart, args.clone(), None);
        let warm = parse_argv(LaunchSource::SecondInstance, args, None);

        assert_eq!(cold.intent, LaunchIntent::OpenFilesOnly);
        assert_eq!(warm.intent, LaunchIntent::OpenFilesInCurrentSession);
        assert_eq!(cold.paths, warm.paths);
        assert!(cold.paths[0].ends_with("/open.txt"));
    }

    #[test]
    fn opened_parser_uses_the_same_canonical_file_contract() {
        let directory = tempfile::tempdir().expect("tempdir");
        let file = directory.path().join("opened.txt");
        std::fs::write(&file, "test").expect("write fixture");

        let cold = parse_opened_paths(vec![file.clone()], None, true);
        let warm = parse_opened_paths(vec![file], None, false);

        assert_eq!(cold.intent, LaunchIntent::OpenFilesOnly);
        assert_eq!(warm.intent, LaunchIntent::OpenFilesInCurrentSession);
        assert_eq!(cold.paths, warm.paths);
    }
}
