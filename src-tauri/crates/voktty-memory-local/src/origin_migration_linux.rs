use super::*;
use crate::{LocalMemoryStore, MemoryPolicy, StoreError, MEMORY_APPLICATION_ID};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

const NAME: &str = "project-memory";
const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Marker {
    schema: u8,
    kind: String,
    store: String,
    legacy_parent: String,
    destination_parent: String,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
struct Entry {
    name: String,
    size: usize,
    digest: String,
    device: u64,
    inode: u64,
    mode: u32,
    uid: u32,
    gid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginMigrationSummary {
    pub projects: usize,
    pub manual: usize,
    pub always: usize,
    pub never: usize,
    pub stored_trust: usize,
    pub recovery_journal: bool,
    pub pending_reservation: bool,
}

/// A failure can follow durable reservation or the completed atomic move.
/// Callers must preserve these facts instead of promising that nothing changed.
#[derive(Debug)]
pub struct OriginMigrationFailure {
    pub error: ReadError,
    pub application_parent_may_exist: bool,
    pub reservation_created: bool,
    pub moved: bool,
}

struct Capture {
    base: Directory,
    legacy: Directory,
    store: Directory,
    destination: Option<Directory>,
    marker: Option<File>,
    entries: Vec<Entry>,
    summary: OriginMigrationSummary,
    digest: String,
}

/// Owns a bounded review of one native data origin, never a repository path.
/// It grants no new trust, policy or session consent.
pub struct OriginMigrationReview {
    base: PathBuf,
    capture: Capture,
    created: Instant,
}

fn conflict() -> ReadError {
    ReadError::Store(StoreError::Conflict)
}
fn instance(directory: &Directory) -> Result<String, ReadError> {
    let value = directory.root_instance().ok_or(ReadError::Unsupported)?;
    serde_json::to_value(value)
        .map_err(|_| ReadError::Io)?
        .as_str()
        .map(str::to_owned)
        .ok_or(ReadError::Io)
}

fn state_file(
    directory: &Directory,
    name: &str,
    limit: u64,
    control: &ReadControl,
) -> Result<(File, Vec<u8>), ReadError> {
    control.check()?;
    let file = open_at(&directory.file, OsStr::new(name), false).map_err(|_| ReadError::Io)?;
    let before = file.metadata().map_err(|_| ReadError::Io)?;
    if !before.is_file() || before.nlink() != 1 || !crate::owned_and_not_shared_writable(&before) {
        return Err(ReadError::Denied);
    }
    if before.len() > limit {
        return Err(ReadError::Limit);
    }
    let mut bytes = Vec::new();
    (&file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ReadError::Io)?;
    if bytes.len() as u64 > limit
        || !same_file(&before, &file.metadata().map_err(|_| ReadError::Io)?)
    {
        return Err(conflict());
    }
    control.check()?;
    Ok((file, bytes))
}

fn marker(directory: &Directory, control: &ReadControl) -> Result<(File, Marker), ReadError> {
    let (file, bytes) = state_file(directory, NAME, 4096, control)?;
    if bytes.len() > 4096 || file.metadata().map_err(|_| ReadError::Io)?.mode() & 0o077 != 0 {
        return Err(ReadError::Denied);
    }
    let value: Marker = serde_json::from_slice(&bytes).map_err(|_| conflict())?;
    if value.schema != 1 || value.kind != "voktty-memory-origin-v1" {
        return Err(conflict());
    }
    Ok((file, value))
}

fn expected(
    store: &Directory,
    legacy: &Directory,
    destination: &Directory,
) -> Result<Marker, ReadError> {
    Ok(Marker {
        schema: 1,
        kind: "voktty-memory-origin-v1".into(),
        store: instance(store)?,
        legacy_parent: instance(legacy)?,
        destination_parent: instance(destination)?,
    })
}

struct Reservation {
    parent: File,
    name: CString,
    file: File,
}

fn own_entry(parent: &File, name: &CStr, owned: &fs::Metadata) -> bool {
    let mut actual = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            name.as_ptr(),
            actual.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return false;
    }
    let actual = unsafe { actual.assume_init() };
    #[allow(clippy::unnecessary_cast)]
    {
        actual.st_dev as u64 == owned.dev() && actual.st_ino as u64 == owned.ino()
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        let Ok(owned) = self.file.metadata() else {
            return;
        };
        if own_entry(&self.parent, &self.name, &owned) {
            unsafe {
                libc::unlinkat(self.parent.as_raw_fd(), self.name.as_ptr(), 0);
            }
        }
    }
}

fn reserve(
    destination: &Directory,
    value: &Marker,
    control: &ReadControl,
    created: &mut bool,
) -> Result<File, ReadError> {
    let name = CString::new(format!(".memory-origin-{}", uuid::Uuid::new_v4()))
        .map_err(|_| ReadError::Io)?;
    let parent = destination.file.try_clone().map_err(|_| ReadError::Io)?;
    control.check()?;
    let raw = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDWR
                | libc::O_CREAT
                | libc::O_EXCL
                | libc::O_NOFOLLOW
                | libc::O_CLOEXEC
                | libc::O_NONBLOCK,
            0o600,
        )
    };
    if raw < 0 {
        return Err(ReadError::Io);
    }
    let mut staging = Reservation {
        parent,
        name,
        file: unsafe { File::from_raw_fd(raw) },
    };
    let bytes = serde_json::to_vec(value).map_err(|_| ReadError::Io)?;
    staging.file.write_all(&bytes).map_err(|_| ReadError::Io)?;
    staging.file.sync_all().map_err(|_| ReadError::Io)?;
    control.check()?;
    if !own_entry(
        &staging.parent,
        &staging.name,
        &staging.file.metadata().map_err(|_| ReadError::Io)?,
    ) {
        return Err(conflict());
    }
    if unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            staging.parent.as_raw_fd(),
            staging.name.as_ptr(),
            staging.parent.as_raw_fd(),
            c"project-memory".as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } != 0
    {
        return Err(conflict());
    }
    *created = true;
    staging.parent.sync_all().map_err(|_| ReadError::Io)?;
    staging.file.try_clone().map_err(|_| ReadError::Io)
}

pub(crate) fn is_migrated(base: &Path, control: &ReadControl) -> Result<bool, ReadError> {
    let legacy_path = base.join("dev.voktty");
    let destination_path = base.join(MEMORY_APPLICATION_ID);
    LocalMemoryStore::check_application_parent(&legacy_path, control)?;
    LocalMemoryStore::check_application_parent(&destination_path, control)?;
    let legacy = Directory::open_root(&legacy_path, control)?;
    let destination = Directory::open_root(&destination_path, control)?;
    let store = destination.open_child(OsStr::new(NAME), &destination_path.join(NAME), control)?;
    store.qualify_state(true, control)?;
    let (_, observed) = marker(&legacy, control)?;
    if observed != expected(&store, &legacy, &destination)? {
        return Err(conflict());
    }
    Ok(true)
}

struct InventoryAccess;
impl MemoryReadAccess for InventoryAccess {
    fn allows_metadata(&self, _: &Path) -> bool {
        true
    }
    fn allows_read(&self, _: &Path) -> bool {
        false
    }
    fn allows_enumeration(&self, _: &Path) -> bool {
        true
    }
}

fn inventory(store: &Directory, control: &ReadControl) -> Result<Vec<Entry>, ReadError> {
    let listed = store.entries(Path::new("/"), &InventoryAccess, control, 5)?;
    if !listed.complete {
        return Err(ReadError::Limit);
    }
    let mut entries = Vec::new();
    for entry in listed.entries {
        let name = entry.name.to_str().ok_or(ReadError::InvalidInput)?;
        if !matches!(
            name,
            "memory-local.json"
                | "memory-local.lock"
                | "memory-deployment.json"
                | "memory-deployment.lock"
        ) || !matches!(entry.kind, EntryKind::File)
        {
            return Err(conflict());
        }
        let limit = if name == "memory-local.json" {
            crate::MAX_BYTES
        } else {
            MAX_ENTRY_BYTES
        };
        let (file, bytes) = state_file(store, name, limit, control)?;
        let metadata = file.metadata().map_err(|_| ReadError::Io)?;
        entries.push(Entry {
            name: name.into(),
            size: bytes.len(),
            digest: hex::encode(Sha256::digest(&bytes)),
            device: metadata.dev(),
            inode: metadata.ino(),
            mode: metadata.mode(),
            uid: metadata.uid(),
            gid: metadata.gid(),
        });
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(entries)
}

fn capture(
    base: &Path,
    deployment_lock: &File,
    preference_lock: &File,
    control: &ReadControl,
) -> Result<Capture, ReadError> {
    LocalMemoryStore::check_application_parent(base, control)?;
    let legacy_path = base.join("dev.voktty");
    let destination_path = base.join(MEMORY_APPLICATION_ID);
    LocalMemoryStore::check_application_parent(&legacy_path, control)?;
    let base_directory = Directory::open_root(base, control)?;
    let legacy = Directory::open_root(&legacy_path, control)?;
    let directory = legacy.open_child(OsStr::new(NAME), &legacy_path.join(NAME), control)?;
    directory.qualify_state(true, control)?;
    if directory.metadata.dev() != legacy.metadata.dev()
        || legacy.metadata.dev() != base_directory.metadata.dev()
    {
        return Err(ReadError::Unsupported);
    }
    let (_, snapshot_bytes) =
        state_file(&directory, "memory-local.json", crate::MAX_BYTES, control)?;
    let snapshot: crate::LocalMemorySnapshot = serde_json::from_slice(&snapshot_bytes)
        .map_err(|_| ReadError::Store(StoreError::InvalidStore))?;
    snapshot.validate().map_err(ReadError::Store)?;
    let entries = inventory(&directory, control)?;
    let snapshot_digest = hex::encode(Sha256::digest(&snapshot_bytes));
    if !entries
        .iter()
        .any(|entry| entry.name == "memory-local.json" && entry.digest == snapshot_digest)
    {
        return Err(conflict());
    }
    for (name, file) in [
        ("memory-deployment.lock", deployment_lock),
        ("memory-local.lock", preference_lock),
    ] {
        let metadata = file.metadata().map_err(|_| ReadError::Io)?;
        if !entries.iter().any(|entry| {
            entry.name == name && entry.device == metadata.dev() && entry.inode == metadata.ino()
        }) {
            return Err(conflict());
        }
    }
    let destination = match base_directory
        .probe(OsStr::new(MEMORY_APPLICATION_ID))
        .map_err(|_| ReadError::Io)?
    {
        None => None,
        Some(EntryKind::Directory) => {
            LocalMemoryStore::check_application_parent(&destination_path, control)?;
            Some(Directory::open_root(&destination_path, control)?)
        }
        _ => return Err(conflict()),
    };
    let marker = if let Some(destination) = &destination {
        if destination.metadata.dev() != directory.metadata.dev() {
            return Err(ReadError::Unsupported);
        }
        match destination
            .probe(OsStr::new(NAME))
            .map_err(|_| ReadError::Io)?
        {
            None => None,
            Some(EntryKind::File) => {
                let (file, observed) = marker(destination, control)?;
                if observed != expected(&directory, &legacy, destination)? {
                    return Err(conflict());
                }
                Some(file)
            }
            _ => return Err(conflict()),
        }
    } else {
        None
    };
    let summary = OriginMigrationSummary {
        projects: snapshot.projects.len(),
        manual: snapshot
            .projects
            .iter()
            .filter(|p| p.policy == MemoryPolicy::Manual)
            .count(),
        always: snapshot
            .projects
            .iter()
            .filter(|p| p.policy == MemoryPolicy::Always)
            .count(),
        never: snapshot
            .projects
            .iter()
            .filter(|p| p.policy == MemoryPolicy::Never)
            .count(),
        stored_trust: snapshot
            .projects
            .iter()
            .filter(|p| p.instruction_digest.is_some())
            .count(),
        recovery_journal: entries.iter().any(|e| e.name == "memory-deployment.json"),
        pending_reservation: marker.is_some(),
    };
    let reservation = marker
        .as_ref()
        .map(|file| {
            file.metadata()
                .map(|metadata| (metadata.dev(), metadata.ino()))
        })
        .transpose()
        .map_err(|_| ReadError::Io)?;
    let binding = serde_json::json!({"schema":1,"base":base,"baseInstance":instance(&base_directory)?,
        "legacy":instance(&legacy)?,"store":instance(&directory)?,"entries":entries,
        "destination":destination.as_ref().map(instance).transpose()?,"reservation":reservation,"summary":summary});
    let digest = hex::encode(Sha256::digest(
        serde_json::to_vec(&binding).map_err(|_| ReadError::Io)?,
    ));
    Ok(Capture {
        base: base_directory,
        legacy,
        store: directory,
        destination,
        marker,
        entries,
        summary,
        digest,
    })
}

impl OriginMigrationReview {
    pub fn prepare(base: &Path, control: &ReadControl) -> Result<Self, ReadError> {
        crate::bootstrap::validate_parent(base, control)?;
        let parent = base.join("dev.voktty");
        LocalMemoryStore::check_application_parent(&parent, control)?;
        let store = LocalMemoryStore::open_private(&parent, control)?;
        let deployment = store.try_lock_deployment().map_err(ReadError::Store)?;
        let preferences = store.lock().map_err(ReadError::Store)?;
        let capture = capture(base, &deployment._file, &preferences, control)?;
        Ok(Self {
            base: base.to_owned(),
            capture,
            created: Instant::now(),
        })
    }

    pub fn digest(&self) -> &str {
        &self.capture.digest
    }
    pub fn summary(&self) -> &OriginMigrationSummary {
        &self.capture.summary
    }

    pub fn accept(self, digest: &str, control: &ReadControl) -> Result<(), OriginMigrationFailure> {
        let mut failure = OriginMigrationFailure {
            error: ReadError::Io,
            application_parent_may_exist: false,
            reservation_created: false,
            moved: false,
        };
        let result = (|| {
            control.check()?;
            if digest != self.digest() || self.created.elapsed() >= Duration::from_secs(120) {
                return Err(conflict());
            }
            let parent = self.base.join("dev.voktty");
            LocalMemoryStore::check_application_parent(&parent, control)?;
            let store = LocalMemoryStore::open_private(&parent, control)?;
            let deployment = store.try_lock_deployment().map_err(ReadError::Store)?;
            let preferences = store.lock().map_err(ReadError::Store)?;
            let current = capture(&self.base, &deployment._file, &preferences, control)?;
            if current.digest != self.capture.digest {
                return Err(conflict());
            }
            let destination_path = self.base.join(MEMORY_APPLICATION_ID);
            failure.application_parent_may_exist = true;
            LocalMemoryStore::prepare_application_parent(&destination_path, control)?;
            let destination = Directory::open_root(&destination_path, control)?;
            if destination.metadata.dev() != current.store.metadata.dev() {
                return Err(ReadError::Unsupported);
            }
            if let Some(previous) = &current.destination {
                if instance(previous)? != instance(&destination)? {
                    return Err(conflict());
                }
            }
            let marker_file = if let Some(file) = current.marker {
                file
            } else {
                reserve(
                    &destination,
                    &expected(&current.store, &current.legacy, &destination)?,
                    control,
                    &mut failure.reservation_created,
                )?
            };
            control.check()?;
            LocalMemoryStore::check_application_parent(&parent, control)?;
            LocalMemoryStore::check_application_parent(&destination_path, control)?;
            current.store.qualify_state(true, control)?;
            if instance(&Directory::open_root(&self.base, control)?)? != instance(&current.base)?
                || instance(&Directory::open_root(&parent, control)?)? != instance(&current.legacy)?
                || instance(&Directory::open_root(&destination_path, control)?)?
                    != instance(&destination)?
                || instance(&Directory::open_root(&parent.join(NAME), control)?)?
                    != instance(&current.store)?
                || inventory(&current.store, control)? != current.entries
            {
                return Err(conflict());
            }
            let (actual_marker, observed) = marker(&destination, control)?;
            if observed != expected(&current.store, &current.legacy, &destination)?
                || !same_file(
                    &marker_file.metadata().map_err(|_| ReadError::Io)?,
                    &actual_marker.metadata().map_err(|_| ReadError::Io)?,
                )
            {
                return Err(conflict());
            }
            control.check()?;
            if self.created.elapsed() >= Duration::from_secs(120) {
                return Err(conflict());
            }
            if unsafe {
                libc::syscall(
                    libc::SYS_renameat2,
                    current.legacy.file.as_raw_fd(),
                    c"project-memory".as_ptr(),
                    destination.file.as_raw_fd(),
                    c"project-memory".as_ptr(),
                    libc::RENAME_EXCHANGE,
                )
            } != 0
            {
                return Err(ReadError::Io);
            }
            failure.moved = true;
            current.legacy.file.sync_all().map_err(|_| ReadError::Io)?;
            destination.file.sync_all().map_err(|_| ReadError::Io)?;
            if !is_migrated(&self.base, control)? {
                return Err(conflict());
            }
            Ok(())
        })();
        result.map_err(|error| {
            failure.error = error;
            failure
        })
    }
}

#[cfg(test)]
#[path = "origin_migration_linux_tests.rs"]
mod tests;
