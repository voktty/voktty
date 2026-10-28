use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use voktty_workspace_kit::{
    instruction_fingerprint, memory_project_key, parse_kit_config, resource,
    InstructionFingerprint, Issue, PathFact, RootLinks,
};

#[cfg(not(any(unix, windows)))]
use crate::reader_unavailable as platform;
#[cfg(unix)]
use crate::reader_unix as platform;
#[cfg(windows)]
use crate::reader_windows as platform;
use crate::{LocalMemorySnapshot, LocalMemoryStore, StoreError};

static ACTIVE_READS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    InvalidInput,
    Denied,
    Unavailable,
    StaleRoot,
    StaleInstallation,
    Cancelled,
    Timeout,
    Busy,
    Limit,
    Unsupported,
    Io,
    Store(StoreError),
    Contract(Vec<Issue>),
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "invalid native memory read input",
            Self::Denied => "native memory read is not authorized",
            Self::Unavailable => "required memory document is unavailable",
            Self::StaleRoot => "memory root changed; resolve it again",
            Self::StaleInstallation => "local installation identity changed; resolve again",
            Self::Cancelled => "native memory read was cancelled",
            Self::Timeout => "native memory read deadline exceeded",
            Self::Busy => "native memory readers are busy",
            Self::Limit => "native memory read limit exceeded",
            Self::Unsupported => "native memory reader is unsupported for this platform",
            Self::Io => "native memory read IO failed",
            Self::Store(_) => "local memory preferences are unavailable",
            Self::Contract(_) => "observed memory documents failed validation",
        })
    }
}

impl std::error::Error for ReadError {}

/// Implemented by the native owner using workspace authorization and secret-path
/// protection. Repository data and IPC booleans must not implement this authority.
pub trait MemoryReadAccess: Send + Sync {
    fn allows_metadata(&self, path: &Path) -> bool;
    fn allows_read(&self, path: &Path) -> bool;
}

#[derive(Clone)]
pub struct ReadControl {
    cancelled: Arc<AtomicBool>,
    started: Instant,
    timeout: Duration,
}

impl Default for ReadControl {
    fn default() -> Self {
        Self::new(Duration::from_secs(5))
    }
}

impl ReadControl {
    pub fn new(timeout: Duration) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            started: Instant::now(),
            timeout: timeout.min(Duration::from_secs(5)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub(crate) fn check(&self) -> Result<(), ReadError> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(ReadError::Cancelled)
        } else if self.started.elapsed() >= self.timeout {
            Err(ReadError::Timeout)
        } else {
            Ok(())
        }
    }
}

struct ReadPermit;

impl ReadPermit {
    fn acquire(control: &ReadControl) -> Result<Self, ReadError> {
        control.check()?;
        let mut active = ACTIVE_READS.load(Ordering::Acquire);
        loop {
            control.check()?;
            if active >= 4 {
                return Err(ReadError::Busy);
            }
            match ACTIVE_READS.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(Self),
                Err(current) => active = current,
            }
        }
    }
}

impl Drop for ReadPermit {
    fn drop(&mut self) {
        ACTIVE_READS.fetch_sub(1, Ordering::AcqRel);
    }
}

pub struct NativeContextObservation {
    pub identity: Value,
    pub project_key: String,
    pub local_preferences: LocalMemorySnapshot,
    pub config: Value,
    pub instructions: Value,
    pub fingerprint: InstructionFingerprint,
    pub project: PathFact,
    pub context: PathFact,
}

/// Captures an authorized local execution root, not a resolved memory scope.
/// Keep remote/WSL/Docker selection in its native transport; never fall back here.
pub struct LocalMemoryWorkspace<'a> {
    root: PathBuf,
    root_id: (u64, u128),
    identity: Value,
    project_key: String,
    store: &'a LocalMemoryStore,
    access: &'a dyn MemoryReadAccess,
}

impl<'a> LocalMemoryWorkspace<'a> {
    pub fn open(
        store: &'a LocalMemoryStore,
        requested: &Path,
        access: &'a dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<Self, ReadError> {
        platform::ensure_supported()?;
        let _permit = ReadPermit::acquire(control)?;
        if !requested.is_absolute() {
            return Err(ReadError::InvalidInput);
        }
        if !access.allows_metadata(requested) {
            return Err(ReadError::Denied);
        }
        platform::validate_requested_root(requested)?;
        let root = std::fs::canonicalize(requested).map_err(|_| ReadError::Io)?;
        control.check()?;
        if !access.allows_metadata(&root) {
            return Err(ReadError::Denied);
        }
        if root.components().count() > 128
            || root.to_str().ok_or(ReadError::InvalidInput)?.len() > 4096
        {
            return Err(ReadError::Limit);
        }
        let directory = platform::Directory::open_root(&root, control)?;
        let local = store.load().map_err(ReadError::Store)?;
        control.check()?;
        let resolved = directory.canonical_root(&root)?;
        resolved.to_str().ok_or(ReadError::InvalidInput)?;
        let canonical_root = voktty_paths::canonical_display_path(&resolved);
        let identity = json!({
            "schema":1, "kind":"local", "machineId":local.installation_id(),
            "filesystemId":directory.filesystem_id(), "canonicalRoot":canonical_root,
        });
        let project_key = memory_project_key(&identity.to_string()).map_err(ReadError::Contract)?;
        control.check()?;
        Ok(Self {
            root,
            root_id: directory.identity(),
            identity,
            project_key,
            store,
            access,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn identity(&self) -> &Value {
        &self.identity
    }

    pub fn project_key(&self) -> &str {
        &self.project_key
    }

    pub fn observe_deployment(
        &self,
        links: RootLinks,
        control: &ReadControl,
    ) -> Result<BTreeMap<String, PathFact>, ReadError> {
        let mut paths = inventory(false);
        paths.insert(".voktty/kit.lock.json".into());
        if links.agents {
            paths.insert("AGENTS.md".into());
        }
        if links.claude {
            paths.insert("CLAUDE.md".into());
        }
        self.collect(&paths, 1024 * 1024, control)
            .map(|(facts, _)| facts)
    }

    pub fn observe_context(
        &self,
        role: Option<&str>,
        control: &ReadControl,
    ) -> Result<NativeContextObservation, ReadError> {
        let mut paths = inventory(true);
        if let Some(role) = role {
            let name = role
                .strip_prefix(".voktty/team/roles/")
                .and_then(|s| s.strip_suffix(".md"));
            if role.len() > 256
                || !name.is_some_and(|s| {
                    !s.is_empty()
                        && s.bytes()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
                })
            {
                return Err(ReadError::InvalidInput);
            }
            paths.insert(role.into());
        }
        paths.extend(["AGENTS.md".into(), "CLAUDE.md".into()]);
        let instruction_paths = paths.clone();
        paths.extend([
            ".voktty/kit.json".into(),
            ".voktty/PROJECT.md".into(),
            ".voktty/CONTEXT.md".into(),
        ]);
        let (mut facts, local_preferences) = self.collect(&paths, 2 * 1024 * 1024, control)?;
        let instructions = json!({"schema":1,"role":role,"files":instruction_paths.iter().map(|path| json!({"path":path,"fact":fact_value(&facts[path])})).collect::<Vec<_>>()});
        let fingerprint =
            instruction_fingerprint(&instructions.to_string()).map_err(ReadError::Contract)?;
        let config = match &facts[".voktty/kit.json"] {
            PathFact::File { text } => parse_kit_config(text).map_err(ReadError::Contract)?,
            _ => return Err(ReadError::Unavailable),
        };
        let project = facts.remove(".voktty/PROJECT.md").expect("fixed inventory");
        let context = facts.remove(".voktty/CONTEXT.md").expect("fixed inventory");
        if !matches!(project, PathFact::File { .. }) || !matches!(context, PathFact::File { .. }) {
            return Err(ReadError::Unavailable);
        }
        control.check()?;
        Ok(NativeContextObservation {
            identity: self.identity.clone(),
            project_key: self.project_key.clone(),
            local_preferences,
            config,
            instructions,
            fingerprint,
            project,
            context,
        })
    }

    fn checked_root(&self, control: &ReadControl) -> Result<platform::Directory, ReadError> {
        control.check()?;
        if !self.access.allows_metadata(&self.root) {
            return Err(ReadError::Denied);
        }
        let directory =
            platform::Directory::open_root(&self.root, control).map_err(|error| match error {
                ReadError::Cancelled | ReadError::Timeout => error,
                _ => ReadError::StaleRoot,
            })?;
        let resolved = directory.canonical_root(&self.root)?;
        control.check()?;
        if directory.identity() != self.root_id
            || voktty_paths::canonical_display_path(&resolved) != self.identity["canonicalRoot"]
        {
            return Err(ReadError::StaleRoot);
        }
        Ok(directory)
    }

    fn collect(
        &self,
        paths: &BTreeSet<String>,
        max_bytes: usize,
        control: &ReadControl,
    ) -> Result<(BTreeMap<String, PathFact>, LocalMemorySnapshot), ReadError> {
        let _permit = ReadPermit::acquire(control)?;
        let directory = self.checked_root(control)?;
        let local = self.store.load().map_err(ReadError::Store)?;
        if self.identity["machineId"] != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        if paths.len() > 128 {
            return Err(ReadError::Limit);
        }
        let mut bytes = 0usize;
        let mut facts = BTreeMap::new();
        for path in paths {
            control.check()?;
            let fact = directory.read_text(&self.root, path, self.access, control)?;
            if let PathFact::File { text } = &fact {
                bytes = bytes
                    .checked_add(text.len())
                    .filter(|n| *n <= max_bytes)
                    .ok_or(ReadError::Limit)?;
            }
            facts.insert(path.clone(), fact);
        }
        self.checked_root(control)?;
        let current = self.store.load().map_err(ReadError::Store)?;
        if current.installation_id() != local.installation_id() {
            return Err(ReadError::StaleInstallation);
        }
        if current.revision() != local.revision() {
            return Err(ReadError::Store(StoreError::Conflict));
        }
        control.check()?;
        Ok((facts, current))
    }
}

fn inventory(bases_only: bool) -> BTreeSet<String> {
    let manifest: Value =
        serde_json::from_str(resource("manifest.json").expect("embedded manifest"))
            .expect("validated manifest");
    manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .filter(|entry| entry["kind"] != "link" && (!bases_only || entry["kind"] == "base"))
        .map(|entry| {
            format!(
                ".voktty/{}",
                entry["source"]
                    .as_str()
                    .expect("source")
                    .strip_prefix("dot-voktty/")
                    .expect("kit source")
            )
        })
        .collect()
}

pub(crate) fn fact_value(fact: &PathFact) -> Value {
    match fact {
        PathFact::File { text } => json!({"kind":"file","text":text}),
        PathFact::Absent => json!({"kind":"absent"}),
        PathFact::Blocked => json!({"kind":"blocked"}),
    }
}
