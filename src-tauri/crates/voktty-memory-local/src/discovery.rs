use crate::reader::{MemoryReadAccess, ReadControl, ReadError};
#[cfg(not(any(unix, windows)))]
use crate::reader_unavailable as platform;
#[cfg(unix)]
use crate::reader_unix as platform;
#[cfg(windows)]
use crate::reader_windows as platform;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc};
use std::time::{Duration, Instant};
use voktty_workspace_kit::{
    memory_project_key, parse_kit_config, resolve_memory_scope, MemoryScope, PathFact,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiscoveryPurpose {
    Discover,
    Initialize,
    Manage,
}
impl DiscoveryPurpose {
    fn name(self) -> &'static str {
        match self {
            Self::Discover => "discover",
            Self::Initialize => "initialize",
            Self::Manage => "manage",
        }
    }
}

#[derive(Clone)]
pub struct DiscoveryControl {
    cancelled: Arc<AtomicBool>,
    started: Instant,
    timeout: Duration,
}
impl Default for DiscoveryControl {
    fn default() -> Self {
        Self::new(Duration::from_secs(15))
    }
}
impl DiscoveryControl {
    pub fn new(timeout: Duration) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            started: Instant::now(),
            timeout: timeout.min(Duration::from_secs(15)),
        }
    }
    pub fn cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::Release);
    }
    pub(crate) fn phase(&self, max: Duration) -> ReadControl {
        ReadControl::phase(
            self.cancelled.clone(),
            max.min(self.timeout.saturating_sub(self.started.elapsed())),
        )
    }
}

#[derive(Debug)]
pub struct ScopeDirectory {
    pub directory_key: String,
    pub path: PathBuf,
    pub state: &'static str,
}
pub struct NativeScopeObservation {
    pub facts: Value,
    pub scope: MemoryScope,
    pub directories: Vec<ScopeDirectory>,
    pub blocked_paths: Vec<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EntryKind {
    Directory,
    File,
    Link,
    Other,
}
pub(crate) struct DirectoryEntry {
    pub name: OsString,
    pub kind: EntryKind,
}
pub(crate) struct DirectoryListing {
    pub entries: Vec<DirectoryEntry>,
    pub complete: bool,
}

fn stop(error: &ReadError) -> &'static str {
    match error {
        ReadError::Cancelled => "cancelled",
        ReadError::Timeout => "timeout",
        ReadError::Denied => "authorization",
        _ => "error",
    }
}
fn key(directory: &platform::Directory, path: &Path, machine: &str) -> Result<String, ReadError> {
    let resolved = directory.canonical_root(path)?;
    resolved.to_str().ok_or(ReadError::InvalidInput)?;
    memory_project_key(&json!({"schema":1,"kind":"local","machineId":machine,"filesystemId":directory.filesystem_id(),"canonicalRoot":voktty_paths::canonical_display_path(resolved)}).to_string()).map_err(ReadError::Contract)
}

struct Phase<'a> {
    access: &'a dyn MemoryReadAccess,
    control: ReadControl,
    entries: usize,
    config_bytes: usize,
}
impl Phase<'_> {
    fn probe(
        &self,
        directory: &platform::Directory,
        path: &Path,
        name: &str,
    ) -> Result<Option<EntryKind>, ReadError> {
        self.control.check()?;
        if !self.access.allows_metadata(&path.join(name)) {
            return Err(ReadError::Denied);
        }
        directory
            .probe(std::ffi::OsStr::new(name))
            .map_err(|_| ReadError::Io)
    }
    fn classify(
        &mut self,
        directory: &platform::Directory,
        path: &Path,
    ) -> Result<&'static str, ReadError> {
        match self.probe(directory, path, ".voktty")? {
            None => return Ok("absent"),
            Some(EntryKind::Directory) => {}
            Some(EntryKind::Link) => return Ok("unavailable"),
            _ => return Ok("invalid"),
        }
        let kit_path = path.join(".voktty");
        let kit =
            directory.open_child(std::ffi::OsStr::new(".voktty"), &kit_path, &self.control)?;
        match self.probe(&kit, &kit_path, "kit.json")? {
            Some(EntryKind::File) => {
                if self.config_bytes >= 1024 * 1024 {
                    return Err(ReadError::Limit);
                }
                if !self.access.allows_read(&kit_path.join("kit.json")) {
                    return Ok("denied");
                }
                match kit.read_text(&kit_path, "kit.json", self.access, &self.control)? {
                    PathFact::File { text } => {
                        self.config_bytes += text.len();
                        if self.config_bytes > 1024 * 1024 {
                            return Err(ReadError::Limit);
                        }
                        return Ok(if parse_kit_config(&text).is_ok() {
                            "valid"
                        } else {
                            "invalid"
                        });
                    }
                    _ => return Ok("unavailable"),
                }
            }
            Some(EntryKind::Link) => return Ok("unavailable"),
            Some(_) => return Ok("invalid"),
            None => {}
        }
        let listing = kit.entries(
            &kit_path,
            self.access,
            &self.control,
            128.min(20000 - self.entries),
        )?;
        self.entries += listing.entries.len();
        if !listing.complete {
            return Err(ReadError::Limit);
        }
        for entry in listing.entries {
            if entry.kind == EntryKind::Link {
                return Ok("unavailable");
            }
            let Some(name) = entry.name.to_str() else {
                return Ok("partial");
            };
            if !matches!(
                name.to_ascii_lowercase().as_str(),
                ".gitignore"
                    | "state"
                    | "mailbox"
                    | "locks"
                    | "sessions"
                    | "tasks"
                    | "tasks.json"
                    | "tools.json"
            ) {
                return Ok("partial");
            }
        }
        Ok("reserved")
    }
}

pub(crate) fn gather(
    root: &Path,
    machine: &str,
    access: &dyn MemoryReadAccess,
    purpose: DiscoveryPurpose,
    control: &DiscoveryControl,
) -> Result<NativeScopeObservation, ReadError> {
    let started = Instant::now();
    let mut phase = Phase {
        access,
        control: control.phase(Duration::from_secs(5)),
        entries: 0,
        config_bytes: 0,
    };
    let mut path = root.to_path_buf();
    let mut ancestors: Vec<Value> = Vec::new();
    let mut directories = Vec::new();
    let mut blocked_paths = Vec::new();
    let mut leases = Vec::new();
    let mut filesystem = None;
    let mut boundary = None;
    let ancestry_stop = loop {
        if let Err(error) = phase.control.check() {
            break stop(&error);
        }
        if !access.allows_metadata(&path) {
            break "authorization";
        }
        let directory = match platform::Directory::open_root(&path, &phase.control) {
            Ok(d) => d,
            Err(error) => break stop(&error),
        };
        if filesystem.is_some_and(|volume| volume != directory.identity().0) {
            boundary = Some((path.clone(), directory.identity()));
            break "root";
        }
        filesystem = Some(directory.identity().0);
        let directory_key = key(&directory, &path, machine)?;
        if let Some(previous) = ancestors.last_mut() {
            previous["parentKey"] = json!(directory_key);
        }
        let (state, classification_stop) = match phase.classify(&directory, &path) {
            Ok("denied") => ("denied", Some("authorization")),
            Ok("unavailable") => ("unavailable", Some("error")),
            Ok(state) => (state, None),
            Err(error) => (
                if error == ReadError::Denied {
                    "denied"
                } else {
                    "unavailable"
                },
                Some(stop(&error)),
            ),
        };
        ancestors.push(json!({"directoryKey":directory_key,"parentKey":null,"state":state}));
        leases.push((
            path.clone(),
            directory_key.clone(),
            state,
            directory.identity(),
        ));
        directories.push(ScopeDirectory {
            directory_key,
            path: path.clone(),
            state,
        });
        if let Some(reason) = classification_stop {
            break reason;
        }
        if let Err(error) = phase.control.check() {
            break stop(&error);
        }
        let Some(parent) = path.parent() else {
            break "root";
        };
        if ancestors.len() == 128 {
            break "depth";
        }
        path = parent.to_path_buf();
    };
    if ancestry_stop != "root" {
        blocked_paths.push(path.clone());
    }
    if ancestors.is_empty() {
        return Err(ReadError::Denied);
    }
    let ancestry_duration = started.elapsed();
    let elapsed = ancestry_duration.as_millis().min(9007199254740991) as u64;
    let descendants = if purpose == DiscoveryPurpose::Discover {
        Value::Null
    } else {
        let mut scan = Scan {
            phase: Phase {
                access,
                control: control.phase(Duration::from_secs(10)),
                entries: 0,
                config_bytes: 0,
            },
            machine,
            findings: Vec::new(),
            directories: &mut directories,
            seen: BTreeSet::new(),
            depth: 0,
            last_path: root.to_path_buf(),
            expected_root: ancestors[0]["state"].as_str().expect("native state"),
            filesystem: filesystem.expect("observed root filesystem"),
        };
        let began = Instant::now();
        let completed = scan.walk(root, 0, true);
        let scan_stop = match completed {
            Ok(()) => "complete",
            Err(ScanStop(reason)) => reason,
        };
        if scan_stop != "complete" {
            blocked_paths.push(scan.last_path.clone());
        }
        json!({"rootKey":ancestors[0]["directoryKey"],"stop":scan_stop,"entries":scan.phase.entries,"depth":scan.depth,"elapsedMs":began.elapsed().as_millis().min(9007199254740991) as u64,"findings":scan.findings})
    };
    let mut facts = json!({"schema":1,"purpose":purpose.name(),"ancestors":ancestors,"stop":ancestry_stop,"elapsedMs":elapsed,"descendants":descendants});
    if ancestry_stop == "root" {
        let verification_started = Instant::now();
        let mut verification = Phase {
            access,
            control: control.phase(Duration::from_secs(5).saturating_sub(ancestry_duration)),
            entries: phase.entries,
            config_bytes: phase.config_bytes,
        };
        for (index, (path, expected_key, expected_state, expected_id)) in leases.iter().enumerate()
        {
            let mut verify = || -> Result<(), ReadError> {
                verification.control.check()?;
                if !access.allows_metadata(path) {
                    return Err(ReadError::Denied);
                }
                let current = platform::Directory::open_root(path, &verification.control)?;
                if current.identity() != *expected_id
                    || key(&current, path, machine)? != *expected_key
                {
                    return Err(ReadError::StaleRoot);
                }
                if verification.classify(&current, path)? != *expected_state {
                    return Err(ReadError::StaleRoot);
                }
                verification.control.check()
            };
            if let Err(error) = verify() {
                facts["stop"] = json!(stop(&error));
                facts["ancestors"][index]["state"] = json!(if error == ReadError::Denied {
                    "denied"
                } else {
                    "unavailable"
                });
                directories[index].state = if error == ReadError::Denied {
                    "denied"
                } else {
                    "unavailable"
                };
                blocked_paths.push(path.clone());
                break;
            }
        }
        if facts["stop"] == "root" {
            if let Some((path, expected_id)) = &boundary {
                let verify = || -> Result<(), ReadError> {
                    verification.control.check()?;
                    if !access.allows_metadata(path) {
                        return Err(ReadError::Denied);
                    }
                    let current = platform::Directory::open_root(path, &verification.control)?;
                    if current.identity() != *expected_id {
                        return Err(ReadError::StaleRoot);
                    }
                    verification.control.check()
                };
                if let Err(error) = verify() {
                    facts["stop"] = json!(stop(&error));
                    let index = leases.len() - 1;
                    facts["ancestors"][index]["state"] = json!("unavailable");
                    directories[index].state = "unavailable";
                    blocked_paths.push(path.clone());
                }
            }
        }
        facts["elapsedMs"] = json!((ancestry_duration + verification_started.elapsed())
            .as_millis()
            .min(9007199254740991) as u64);
    }
    let scope = resolve_memory_scope(&facts.to_string()).map_err(ReadError::Contract)?;
    Ok(NativeScopeObservation {
        facts,
        scope,
        directories,
        blocked_paths,
    })
}

struct ScanStop(&'static str);
struct Scan<'a, 'b> {
    phase: Phase<'a>,
    machine: &'a str,
    findings: Vec<Value>,
    directories: &'b mut Vec<ScopeDirectory>,
    seen: BTreeSet<(u64, u128)>,
    depth: usize,
    last_path: PathBuf,
    expected_root: &'a str,
    filesystem: u64,
}
impl Scan<'_, '_> {
    fn walk(&mut self, path: &Path, depth: usize, is_root: bool) -> Result<(), ScanStop> {
        self.phase.control.check().map_err(|e| ScanStop(stop(&e)))?;
        if !self.phase.access.allows_metadata(path) {
            return Err(ScanStop("authorization"));
        }
        let directory = platform::Directory::open_root(path, &self.phase.control)
            .map_err(|e| ScanStop(stop(&e)))?;
        self.walk_directory(&directory, path, depth, is_root)
    }
    fn walk_directory(
        &mut self,
        directory: &platform::Directory,
        path: &Path,
        depth: usize,
        is_root: bool,
    ) -> Result<(), ScanStop> {
        self.last_path = path.to_path_buf();
        self.depth = self.depth.max(depth);
        if directory.identity().0 != self.filesystem {
            return Err(ScanStop("error"));
        }
        if !self.seen.insert(directory.identity()) {
            return Err(ScanStop("error"));
        }
        let before = directory.revision().map_err(|_| ScanStop("error"))?;
        let classification = self
            .phase
            .classify(directory, path)
            .map_err(|e| ScanStop(stop(&e)))?;
        if is_root && classification != self.expected_root {
            return Err(ScanStop("error"));
        }
        if !is_root && !matches!(classification, "absent" | "reserved") {
            if self.findings.len() == 1024 {
                return Err(ScanStop("entry_limit"));
            }
            let directory_key =
                key(directory, path, self.machine).map_err(|_| ScanStop("error"))?;
            self.findings
                .push(json!({"directoryKey":directory_key,"state":classification}));
            self.directories.push(ScopeDirectory {
                directory_key,
                path: path.to_path_buf(),
                state: classification,
            });
        }
        if classification == "denied" {
            return Err(ScanStop("authorization"));
        }
        if classification == "unavailable" {
            return Err(ScanStop("error"));
        }
        let remaining = 20000 - self.phase.entries;
        if remaining == 0 {
            return Err(ScanStop("entry_limit"));
        }
        let listing = directory
            .entries(path, self.phase.access, &self.phase.control, remaining)
            .map_err(|e| ScanStop(stop(&e)))?;
        self.phase.entries += listing.entries.len();
        if !listing.complete {
            return Err(ScanStop("entry_limit"));
        }
        for entry in listing.entries {
            self.phase.control.check().map_err(|e| ScanStop(stop(&e)))?;
            if entry.name == ".voktty" && matches!(classification, "valid" | "partial" | "invalid")
            {
                continue;
            }
            let child = path.join(&entry.name);
            self.last_path = child.clone();
            if entry.kind == EntryKind::Link {
                return Err(ScanStop("link"));
            }
            if entry.kind != EntryKind::Directory {
                continue;
            }
            if depth == 64 {
                return Err(ScanStop("depth"));
            }
            if !self.phase.access.allows_metadata(&child) {
                return Err(ScanStop("authorization"));
            }
            let nested = directory
                .open_child(&entry.name, &child, &self.phase.control)
                .map_err(|e| ScanStop(stop(&e)))?;
            self.walk_directory(&nested, &child, depth + 1, false)?;
        }
        if directory.revision().map_err(|_| ScanStop("error"))? != before {
            return Err(ScanStop("error"));
        }
        Ok(())
    }
}
