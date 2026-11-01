use super::*;
use crate::discovery::EntryKind;
use serde::Serialize;
use std::ffi::OsStr;
use voktty_workspace_kit::{
    handoff_created_at_ms, inspect_memory_text, measure_memory, HandoffFile, HandoffInventory,
    MemoryMeasurements,
};

#[derive(Serialize)]
pub struct NativeMemoryMeasurements {
    pub root: PathBuf,
    pub report: MemoryMeasurements,
}

pub(super) struct PinnedDirectory {
    pub(super) path: PathBuf,
    pub(super) directory: platform::Directory,
    revision: (i64, i64, i64, i64),
}

impl PinnedDirectory {
    pub(super) fn new(path: PathBuf, directory: platform::Directory) -> Result<Self, ReadError> {
        let revision = directory.revision().map_err(|_| ReadError::Io)?;
        Ok(Self {
            path,
            directory,
            revision,
        })
    }

    pub(super) fn child(
        &self,
        name: &str,
        access: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<Option<Self>, ReadError> {
        control.check()?;
        let path = self.path.join(name);
        if !access.allows_metadata(&path)
            || !path.to_str().is_some_and(crate::path_policy::readable)
        {
            return Err(ReadError::Denied);
        }
        if self
            .directory
            .probe(OsStr::new(name))
            .map_err(|_| ReadError::Io)?
            != Some(EntryKind::Directory)
        {
            return Ok(None);
        }
        let directory = self
            .directory
            .open_child(OsStr::new(name), &path, control)?;
        if directory.identity().0 != self.directory.identity().0 {
            return Err(ReadError::Unsupported);
        }
        Self::new(path, directory).map(Some)
    }

    pub(super) fn verify(
        &self,
        access: &dyn MemoryReadAccess,
        control: &ReadControl,
    ) -> Result<(), ReadError> {
        control.check()?;
        if !access.allows_metadata(&self.path) {
            return Err(ReadError::Denied);
        }
        let current = platform::Directory::open_root(&self.path, control)?;
        if current.identity() != self.directory.identity()
            || current.root_instance() != self.directory.root_instance()
            || current.revision().map_err(|_| ReadError::Io)? != self.revision
            || self.directory.revision().map_err(|_| ReadError::Io)? != self.revision
        {
            return Err(ReadError::StaleRoot);
        }
        control.check()
    }
}

fn handoffs(
    directory: Option<&PinnedDirectory>,
    access: &dyn MemoryReadAccess,
    control: &ReadControl,
) -> Result<HandoffInventory, ReadError> {
    let Some(directory) = directory else {
        return Ok(HandoffInventory {
            complete: false,
            files: vec![],
        });
    };
    let listing = directory
        .directory
        .entries(&directory.path, access, control, 20001)?;
    let mut inventory = HandoffInventory {
        complete: listing.complete && listing.entries.len() <= 20000,
        files: vec![],
    };
    for entry in listing.entries.into_iter().take(20000) {
        control.check()?;
        let Some(name) = entry.name.to_str() else {
            inventory.complete = false;
            continue;
        };
        if name.eq_ignore_ascii_case("README.md") || !name.to_ascii_lowercase().ends_with(".md") {
            continue;
        }
        if entry.kind != EntryKind::File || name.len() > 256 || name.contains(['/', '\\', '\0']) {
            inventory.complete = false;
            continue;
        }
        inventory.files.push(HandoffFile {
            name: name.to_owned(),
            created_at_ms: handoff_created_at_ms(name),
        });
    }
    Ok(inventory)
}

/// Observes bounded project memory without opening or creating private state.
/// The native caller owns read/metadata/enumeration authority through settlement.
pub fn measure_local_memory(
    requested: &Path,
    access: &dyn MemoryReadAccess,
    now_ms: u64,
    up_next_heading: &str,
    control: &crate::DiscoveryControl,
) -> Result<NativeMemoryMeasurements, ReadError> {
    inspect_memory_text("", up_next_heading).map_err(ReadError::Contract)?;
    if now_ms > 8640000000000000 {
        return Err(ReadError::InvalidInput);
    }
    let phase = control.read_control()?;
    let _permit = ReadPermit::acquire(&phase)?;
    if !access.allows_workspace_root(requested) {
        return Err(ReadError::Denied);
    }
    let execution = resolve_memory_directory(requested, &phase)?;
    if !access.allows_workspace_root(&execution) {
        return Err(ReadError::Denied);
    }
    let original = PinnedDirectory::new(
        execution.clone(),
        platform::Directory::open_root(&execution, &phase)?,
    )?;
    let machine = uuid::Uuid::new_v4().to_string();
    let scope = crate::discovery::gather(
        &execution,
        &machine,
        access,
        crate::DiscoveryPurpose::Discover,
        control,
    )?;
    if scope.scope.state != "ready" {
        return Err(ReadError::Unavailable);
    }
    let root = scope
        .directories
        .iter()
        .find(|d| Some(&d.directory_key) == scope.scope.root_key.as_ref())
        .map(|d| d.path.clone())
        .ok_or(ReadError::Unavailable)?;
    if !access.allows_workspace_root(&root) {
        return Err(ReadError::Denied);
    }
    let phase = control.read_control()?;
    let memory =
        PinnedDirectory::new(root.clone(), platform::Directory::open_root(&root, &phase)?)?;
    let kit = memory
        .child(".voktty", access, &phase)?
        .ok_or(ReadError::Unavailable)?;
    let config = kit
        .directory
        .read_text(&kit.path, "kit.json", access, &phase)?;
    let PathFact::File { text: config_text } = &config else {
        return Err(ReadError::Unavailable);
    };
    let parsed = parse_kit_config(config_text).map_err(ReadError::Contract)?;
    let plans = if parsed["limits"].get("plans/INDEX.md").is_some()
        || parsed["limits"].get("plans/TRACKING.md").is_some()
    {
        kit.child("plans", access, &phase)?
    } else {
        None
    };
    let continuity = if parsed["limits"].get("continuity/CHANGELOG.md").is_some()
        || parsed["limits"].get("continuity/handoffs/").is_some()
    {
        kit.child("continuity", access, &phase)?
    } else {
        None
    };
    let handoff_directory = continuity
        .as_ref()
        .filter(|_| parsed["limits"].get("continuity/handoffs/").is_some())
        .map(|directory| directory.child("handoffs", access, &phase))
        .transpose()?
        .flatten();
    let inventory = if parsed["limits"].get("continuity/handoffs/").is_some() {
        handoffs(handoff_directory.as_ref(), access, &phase)?
    } else {
        HandoffInventory {
            complete: true,
            files: vec![],
        }
    };
    let mut documents = BTreeMap::new();
    let mut bytes = config_text.len();
    for path in [
        "CONTEXT.md",
        "PROJECT.md",
        "plans/INDEX.md",
        "plans/TRACKING.md",
        "continuity/CHANGELOG.md",
    ] {
        if parsed["limits"].get(path).is_none() {
            continue;
        }
        let fact = kit.directory.read_text(&kit.path, path, access, &phase)?;
        if let PathFact::File { text } = &fact {
            bytes = bytes
                .checked_add(text.len())
                .filter(|n| *n <= 1536 * 1024)
                .ok_or(ReadError::Limit)?;
        }
        documents.insert(path.to_owned(), fact);
    }
    let report = measure_memory(config_text, &documents, &inventory, now_ms, up_next_heading)
        .map_err(ReadError::Contract)?;
    if !matches!(kit.directory.read_text(&kit.path, "kit.json", access, &phase)?, PathFact::File { text } if text == *config_text)
    {
        return Err(ReadError::StaleRoot);
    }
    for directory in [
        Some(&original),
        Some(&memory),
        Some(&kit),
        plans.as_ref(),
        continuity.as_ref(),
        handoff_directory.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        directory.verify(access, &phase)?;
    }
    let verified = crate::discovery::gather(
        &execution,
        &machine,
        access,
        crate::DiscoveryPurpose::Discover,
        control,
    )?;
    if verified.scope != scope.scope
        || !access.allows_workspace_root(&execution)
        || !access.allows_workspace_root(&root)
    {
        return Err(ReadError::StaleRoot);
    }
    let phase = control.read_control()?;
    for directory in [
        Some(&original),
        Some(&memory),
        Some(&kit),
        plans.as_ref(),
        continuity.as_ref(),
        handoff_directory.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        directory.verify(access, &phase)?;
    }
    if !access.allows_read(&kit.path.join("kit.json"))
        || documents.iter().any(|(path, fact)| {
            matches!(fact, PathFact::File { .. }) && !access.allows_read(&kit.path.join(path))
        })
        || (handoff_directory.as_ref().is_some_and(|directory| {
            parsed["limits"].get("continuity/handoffs/").is_some()
                && !access.allows_enumeration(&directory.path)
        }))
    {
        return Err(ReadError::Denied);
    }
    control.read_control()?;
    Ok(NativeMemoryMeasurements { root, report })
}
