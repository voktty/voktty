use std::collections::BTreeMap;
use std::fs;
#[cfg(unix)]
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use voktty_workspace_kit::{
    prepare_deployment, render_template, resource, DeploymentAction, PathFact, PreparedDeployment,
    RootLinks,
};

use crate::{
    DiscoveryControl, DiscoveryPurpose, LocalMemoryStore, LocalMemoryWorkspace,
    NativeScopeObservation, ReadError, StoreError,
};

const INTENT: &str = "memory-deployment.json";
const MAX_INTENT_BYTES: u64 = 2 * 1024 * 1024;
const PREVIEW_LIFETIME: Duration = Duration::from_secs(120);

/// Native workspace authorization, including secret-path protections. Read and
/// metadata authorization never imply permission to create files/directories.
pub trait MemoryWriteAccess: Send + Sync {
    fn allows_create(&self, path: &Path) -> bool;
    fn allows_replace(&self, _path: &Path) -> bool {
        false
    }
    fn allows_remove_staging(&self, _path: &Path) -> bool {
        false
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublicationError {
    Read(ReadError),
    Store(StoreError),
    Scope,
    Conflict,
    StalePreview,
    InvalidIntent,
    PendingIntent,
    Unsupported,
    MigrationUnsupported,
    RecoveryRequired(Vec<String>),
    Io,
}

impl std::fmt::Display for PublicationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Read(_) => "native memory filesystem validation failed",
            Self::Store(_) => "local memory state is unavailable",
            Self::Scope => "memory scope does not permit initialization",
            Self::Conflict => "project bytes conflict with the reviewed deployment",
            Self::StalePreview => "memory deployment preview changed or expired; review again",
            Self::InvalidIntent => "memory deployment recovery state is invalid",
            Self::PendingIntent => "another memory deployment requires explicit recovery",
            Self::Unsupported => "native memory publication is unsupported on this platform",
            Self::MigrationUnsupported => "native memory migration is not implemented",
            Self::RecoveryRequired(_) => "memory migration artifacts require explicit recovery",
            Self::Io => "native memory publication IO failed",
        })
    }
}
impl std::error::Error for PublicationError {}

impl From<ReadError> for PublicationError {
    fn from(error: ReadError) -> Self {
        Self::Read(error)
    }
}
impl From<StoreError> for PublicationError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

#[derive(Debug)]
pub struct PublicationFailure {
    pub error: PublicationError,
    pub created: Vec<String>,
    pub migrated: Vec<String>,
    pub cleaned: Vec<String>,
    pub possible_recovery_files: Vec<String>,
}

impl std::fmt::Display for PublicationFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(f)
    }
}
impl std::error::Error for PublicationFailure {}

#[derive(Debug, Default)]
pub struct PublicationReport {
    pub created: Vec<String>,
    pub skipped: Vec<String>,
    pub migrated: Vec<String>,
    pub cleaned: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryFile {
    pub path: String,
    pub text: String,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) struct Migration<'a> {
    pub path: &'a str,
    pub expected: &'a str,
    pub proposed: &'a str,
    pub backup: &'a str,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct IntentFile {
    path: String,
    proposed: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    original: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Intent {
    schema: u8,
    origin: String,
    destination: String,
    origin_id: String,
    destination_id: String,
    files: Vec<IntentFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transaction: Option<String>,
}

impl Intent {
    fn backup(&self, index: usize) -> Option<String> {
        self.files[index].original.as_ref()?;
        let transaction = self.transaction.as_ref()?;
        let parent = self.files[index]
            .path
            .rsplit_once('/')
            .map_or("", |(parent, _)| parent);
        Some(format!(
            "{parent}{}.voktty-migration-{transaction}-{index}",
            if parent.is_empty() { "" } else { "/" }
        ))
    }

    fn matches_proposals(&self, other: &Self) -> bool {
        self.origin == other.origin
            && self.destination == other.destination
            && self.origin_id == other.origin_id
            && self.destination_id == other.destination_id
            && self.files.len() == other.files.len()
            && self.files.iter().zip(&other.files).all(|(old, new)| {
                old.path == new.path
                    && old.proposed == new.proposed
                    && (new.original.is_none() || new.original == old.original)
            })
    }
}

/// Native-owned review artifact. It cannot be constructed/deserialized by IPC.
/// The owner must retire it when its captured cwd/transport selection changes.
pub struct InitializationPreview<'w, 'store> {
    origin: &'w LocalMemoryWorkspace<'store>,
    destination: &'w LocalMemoryWorkspace<'store>,
    prepared: PreparedDeployment,
    links: RootLinks,
    revision: u64,
    created_at: Instant,
    intent: Intent,
    resuming: bool,
    recovery: Vec<RecoveryFile>,
}

fn supported() -> Result<(), PublicationError> {
    if cfg!(any(unix, windows)) {
        Ok(())
    } else {
        Err(PublicationError::Unsupported)
    }
}

fn phase(control: &DiscoveryControl) -> crate::ReadControl {
    control.phase(Duration::from_secs(5))
}

fn ensure_fresh(created: Instant, now: Instant) -> Result<(), PublicationError> {
    if now.saturating_duration_since(created) >= PREVIEW_LIFETIME {
        Err(PublicationError::StalePreview)
    } else {
        Ok(())
    }
}

fn binding(
    workspace: &LocalMemoryWorkspace<'_>,
    control: &DiscoveryControl,
) -> Result<String, PublicationError> {
    let (volume, file) = workspace.checked_root(&phase(control))?.identity();
    Ok(format!("{volume:016x}:{file:032x}"))
}

fn load_intent(store: &LocalMemoryStore) -> Result<Option<Intent>, PublicationError> {
    let file = match crate::regular_file(&store.directory.join(INTENT), false, false) {
        Ok(file) => file,
        Err(StoreError::Missing) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if file.metadata().map_err(|_| PublicationError::Io)?.len() > MAX_INTENT_BYTES {
        return Err(PublicationError::InvalidIntent);
    }
    let mut bytes = Vec::new();
    file.take(MAX_INTENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PublicationError::Io)?;
    if bytes.len() as u64 > MAX_INTENT_BYTES {
        return Err(PublicationError::InvalidIntent);
    }
    let intent: Intent =
        serde_json::from_slice(&bytes).map_err(|_| PublicationError::InvalidIntent)?;
    if !matches!(intent.schema, 1 | 2) || intent.files.is_empty() || intent.files.len() > 128 {
        return Err(PublicationError::InvalidIntent);
    }
    let transaction_valid = intent.transaction.as_ref().is_some_and(|id| {
        uuid::Uuid::parse_str(id).is_ok_and(|uuid| {
            uuid.get_version_num() == 4
                && uuid.get_variant() == uuid::Variant::RFC4122
                && uuid.to_string() == *id
        })
    });
    let has_original = intent.files.iter().any(|file| file.original.is_some());
    if (intent.schema == 1 && (intent.transaction.is_some() || has_original))
        || (intent.schema == 2 && (!transaction_valid || !has_original))
        || (intent.transaction.is_some() && !transaction_valid)
        || intent.files.iter().any(|file| {
            file.path.len() > 256
                || file.path.contains('\0')
                || file.proposed.len() > 256 * 1024
                || file.proposed.contains('\0')
                || file.original.as_ref().is_some_and(|text| {
                    !transaction_valid
                        || text.len() > 256 * 1024
                        || text.contains('\0')
                        || !matches!(
                            file.path.as_str(),
                            ".voktty/.gitignore" | "AGENTS.md" | "CLAUDE.md"
                        )
                })
        })
    {
        return Err(PublicationError::InvalidIntent);
    }
    Ok(Some(intent))
}

fn save_intent(store: &LocalMemoryStore, intent: &Intent) -> Result<(), PublicationError> {
    let bytes = serde_json::to_vec(intent).map_err(|_| PublicationError::InvalidIntent)?;
    if bytes.len() as u64 > MAX_INTENT_BYTES {
        return Err(PublicationError::InvalidIntent);
    }
    let mut staging = tempfile::Builder::new()
        .prefix(".memory-deployment-")
        .tempfile_in(&store.directory)
        .map_err(|_| PublicationError::Io)?;
    staging
        .write_all(&bytes)
        .map_err(|_| PublicationError::Io)?;
    staging
        .as_file()
        .sync_all()
        .map_err(|_| PublicationError::Io)?;
    staging
        .persist_noclobber(store.directory.join(INTENT))
        .map_err(|error| {
            if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                PublicationError::PendingIntent
            } else {
                PublicationError::Io
            }
        })?;
    sync_state(store)
}

fn sync_state(store: &LocalMemoryStore) -> Result<(), PublicationError> {
    #[cfg(unix)]
    File::open(&store.directory)
        .and_then(|file| file.sync_all())
        .map_err(|_| PublicationError::Io)?;
    #[cfg(not(unix))]
    let _ = store;
    Ok(())
}

fn scopes_allow(
    origin: &NativeScopeObservation,
    destination: &NativeScopeObservation,
    destination_key: &str,
    resuming: bool,
    identical: bool,
) -> bool {
    let ancestors_ok = |observation: &NativeScopeObservation| {
        observation.scope.ancestry_complete
            && observation.directories.iter().all(|entry| {
                matches!(entry.state, "absent" | "reserved")
                    || (entry.directory_key == destination_key
                        && ((resuming && matches!(entry.state, "partial" | "valid"))
                            || (identical && entry.state == "valid")))
            })
    };
    ancestors_ok(origin)
        && ancestors_ok(destination)
        && destination.scope.descendants_complete == Some(true)
        && destination.facts["descendants"]["findings"]
            .as_array()
            .is_some_and(Vec::is_empty)
}

impl<'w, 'store> InitializationPreview<'w, 'store> {
    pub fn prepare(
        origin: &'w LocalMemoryWorkspace<'store>,
        destination: &'w LocalMemoryWorkspace<'store>,
        inputs: &Map<String, Value>,
        links: RootLinks,
        control: &DiscoveryControl,
    ) -> Result<Self, PublicationError> {
        supported()?;
        phase(control).check()?;
        let store = destination.store();
        if origin.store().directory != store.directory {
            return Err(PublicationError::Conflict);
        }
        let _lock = store.try_lock_deployment()?;
        let local = store.load()?;
        let files = render_template(inputs).map_err(ReadError::Contract)?;
        let manifest: Value =
            serde_json::from_str(resource("manifest.json").expect("embedded manifest"))
                .expect("validated manifest");
        let facts = destination.observe_deployment(links, &phase(control))?;
        let prepared = prepare_deployment(
            manifest["version"].as_str().expect("manifest version"),
            &files,
            &facts,
            links,
        )
        .map_err(ReadError::Contract)?;
        if !prepared.plan.can_publish {
            return Err(PublicationError::Conflict);
        }
        let mut intent = Intent {
            schema: if prepared
                .plan
                .entries
                .iter()
                .any(|entry| entry.action == DeploymentAction::Migrate)
            {
                2
            } else {
                1
            },
            origin: origin.project_key().into(),
            destination: destination.project_key().into(),
            origin_id: binding(origin, control)?,
            destination_id: binding(destination, control)?,
            files: prepared
                .plan
                .entries
                .iter()
                .map(|entry| IntentFile {
                    path: entry.path.clone(),
                    proposed: entry.proposed.clone(),
                    original: (entry.action == DeploymentAction::Migrate)
                        .then(|| entry.expected.clone())
                        .flatten(),
                })
                .collect(),
            transaction: prepared
                .plan
                .entries
                .iter()
                .any(|entry| entry.action == DeploymentAction::Migrate)
                .then(|| uuid::Uuid::new_v4().to_string()),
        };
        let pending = load_intent(store)?;
        if pending
            .as_ref()
            .is_some_and(|pending| !pending.matches_proposals(&intent))
        {
            return Err(PublicationError::PendingIntent);
        }
        let resuming = pending.is_some();
        if let Some(pending) = pending {
            intent = pending;
        }
        let recovery = read_recovery(destination, &intent, control)?;
        let identical = prepared
            .plan
            .entries
            .iter()
            .all(|entry| entry.action == DeploymentAction::Skip);
        let source = origin.observe_scope(DiscoveryPurpose::Discover, control)?;
        let target = destination.observe_scope(DiscoveryPurpose::Initialize, control)?;
        if !scopes_allow(
            &source,
            &target,
            destination.project_key(),
            resuming,
            identical,
        ) {
            return Err(PublicationError::Scope);
        }
        if store.load()? != local {
            return Err(PublicationError::StalePreview);
        }
        phase(control).check()?;
        Ok(Self {
            origin,
            destination,
            prepared,
            links,
            revision: local.revision(),
            created_at: Instant::now(),
            intent,
            resuming,
            recovery,
        })
    }

    pub fn deployment(&self) -> &PreparedDeployment {
        &self.prepared
    }

    pub fn is_resuming(&self) -> bool {
        self.resuming
    }

    pub fn recovery_files(&self) -> &[RecoveryFile] {
        &self.recovery
    }

    pub fn publication_blocker(&self) -> Option<PublicationError> {
        self.prepared
            .plan
            .entries
            .iter()
            .any(|entry| {
                entry.action == DeploymentAction::Migrate
                    && !cfg!(any(target_os = "linux", target_os = "android"))
            })
            .then_some(PublicationError::MigrationUnsupported)
    }

    pub fn publish(
        self,
        access: &dyn MemoryWriteAccess,
        control: &DiscoveryControl,
    ) -> Result<PublicationReport, Box<PublicationFailure>> {
        let mut report = PublicationReport::default();
        self.publish_inner(access, control, &mut report)
            .map_err(|error| {
                Box::new(PublicationFailure {
                    error,
                    created: report.created.clone(),
                    migrated: report.migrated.clone(),
                    cleaned: report.cleaned.clone(),
                    possible_recovery_files: (0..self.intent.files.len())
                        .filter_map(|index| self.intent.backup(index))
                        .collect(),
                })
            })?;
        Ok(report)
    }

    fn revalidate(&self, control: &DiscoveryControl) -> Result<(), PublicationError> {
        phase(control).check()?;
        ensure_fresh(self.created_at, Instant::now())?;
        let local = self.destination.store().load()?;
        if local.installation_id() != self.destination.identity()["machineId"]
            || local.installation_id() != self.origin.identity()["machineId"]
            || binding(self.origin, control)? != self.intent.origin_id
            || binding(self.destination, control)? != self.intent.destination_id
            || local.revision() != self.revision
        {
            return Err(PublicationError::StalePreview);
        }
        Ok(())
    }

    fn check_scopes(
        &self,
        resuming: bool,
        control: &DiscoveryControl,
    ) -> Result<(), PublicationError> {
        let source = self
            .origin
            .observe_scope(DiscoveryPurpose::Discover, control)?;
        let target = self
            .destination
            .observe_scope(DiscoveryPurpose::Initialize, control)?;
        let identical = self
            .prepared
            .plan
            .entries
            .iter()
            .all(|entry| entry.action == DeploymentAction::Skip);
        if !scopes_allow(
            &source,
            &target,
            self.destination.project_key(),
            resuming,
            identical,
        ) {
            return Err(PublicationError::Scope);
        }
        self.revalidate(control)
    }

    fn publish_inner(
        &self,
        access: &dyn MemoryWriteAccess,
        control: &DiscoveryControl,
        report: &mut PublicationReport,
    ) -> Result<(), PublicationError> {
        supported()?;
        self.revalidate(control)?;
        let store = self.destination.store();
        let _lock = store.try_lock_deployment()?;
        self.revalidate(control)?;
        if load_intent(store)?.as_ref() != self.resuming.then_some(&self.intent) {
            return Err(PublicationError::StalePreview);
        }
        if let Some(error) = self.publication_blocker() {
            return Err(error);
        }
        if read_recovery(self.destination, &self.intent, control)? != self.recovery {
            return Err(PublicationError::StalePreview);
        }
        let observed = self
            .destination
            .observe_deployment(self.links, &phase(control))?;
        for (index, entry) in self.prepared.plan.entries.iter().enumerate() {
            if !matches_expected(&observed[&entry.path], entry.expected.as_deref()) {
                return Err(PublicationError::StalePreview);
            }
            if entry.action == DeploymentAction::Create
                && !access.allows_create(&self.destination.root().join(&entry.path))
            {
                return Err(ReadError::Denied.into());
            }
            if entry.action == DeploymentAction::Migrate {
                let backup = self
                    .intent
                    .backup(index)
                    .ok_or(PublicationError::InvalidIntent)?;
                if !access.allows_replace(&self.destination.root().join(&entry.path))
                    || !access.allows_create(&self.destination.root().join(&backup))
                    || !access.allows_remove_staging(&self.destination.root().join(&backup))
                {
                    return Err(ReadError::Denied.into());
                }
            }
        }
        self.check_scopes(self.resuming, control)?;
        for file in &self.recovery {
            self.revalidate(control)?;
            cleanup(self.destination, file, access, control)?;
            report.cleaned.push(file.path.clone());
        }
        let mut intent_saved = self.resuming;
        for (index, entry) in self.prepared.plan.entries.iter().enumerate() {
            self.revalidate(control)?;
            if entry.action == DeploymentAction::Skip {
                report.skipped.push(entry.path.clone());
                continue;
            }
            if !intent_saved {
                save_intent(store, &self.intent)?;
                intent_saved = true;
            }
            if entry.path == ".voktty/kit.json" {
                self.check_scopes(true, control)?;
                let facts = self
                    .destination
                    .observe_deployment(self.links, &phase(control))?;
                verify_proposed(&self.prepared, &facts, false)?;
            }
            if entry.action == DeploymentAction::Migrate {
                let backup = self
                    .intent
                    .backup(index)
                    .ok_or(PublicationError::InvalidIntent)?;
                migrate(self.destination, entry, &backup, access, control)?;
                report.migrated.push(entry.path.clone());
            } else {
                create(
                    self.destination,
                    &entry.path,
                    &entry.proposed,
                    access,
                    control,
                )?;
                report.created.push(entry.path.clone());
            }
        }
        self.revalidate(control)?;
        let facts = self
            .destination
            .observe_deployment(self.links, &phase(control))?;
        verify_proposed(&self.prepared, &facts, true)?;
        self.check_scopes(true, control)?;
        for file in read_recovery(self.destination, &self.intent, control)? {
            self.revalidate(control)?;
            cleanup(self.destination, &file, access, control)?;
            report.cleaned.push(file.path.clone());
        }
        if intent_saved {
            if load_intent(store)?.as_ref() != Some(&self.intent) {
                return Err(PublicationError::InvalidIntent);
            }
            fs::remove_file(store.directory.join(INTENT)).map_err(|_| PublicationError::Io)?;
            sync_state(store)?;
        }
        Ok(())
    }
}

fn read_recovery(
    workspace: &LocalMemoryWorkspace<'_>,
    intent: &Intent,
    control: &DiscoveryControl,
) -> Result<Vec<RecoveryFile>, PublicationError> {
    let mut recovery = Vec::new();
    for (index, file) in intent.files.iter().enumerate() {
        let Some(path) = intent.backup(index) else {
            continue;
        };
        let fact = workspace.read_publication_artifact(&path, &phase(control))?;
        match fact {
            PathFact::Absent => {}
            PathFact::File { text }
                if file.original.as_ref() == Some(&text) || text == file.proposed =>
            {
                recovery.push(RecoveryFile { path, text })
            }
            _ => return Err(PublicationError::RecoveryRequired(vec![path])),
        }
    }
    Ok(recovery)
}

fn cleanup(
    workspace: &LocalMemoryWorkspace<'_>,
    file: &RecoveryFile,
    access: &dyn MemoryWriteAccess,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        workspace.checked_root(&phase(control))?.cleanup_migration(
            workspace.root(),
            file,
            workspace.access(),
            access,
            &phase(control),
        )
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (workspace, file, access, control);
        Err(PublicationError::MigrationUnsupported)
    }
}

fn migrate(
    workspace: &LocalMemoryWorkspace<'_>,
    entry: &voktty_workspace_kit::DeploymentEntry,
    backup: &str,
    access: &dyn MemoryWriteAccess,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        workspace.checked_root(&phase(control))?.replace_text(
            workspace.root(),
            &Migration {
                path: &entry.path,
                expected: entry
                    .expected
                    .as_deref()
                    .ok_or(PublicationError::InvalidIntent)?,
                proposed: &entry.proposed,
                backup,
            },
            workspace.access(),
            access,
            &phase(control),
        )
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (workspace, entry, backup, access, control);
        Err(PublicationError::MigrationUnsupported)
    }
}

fn matches_expected(fact: &PathFact, expected: Option<&str>) -> bool {
    match (fact, expected) {
        (PathFact::Absent, None) => true,
        (PathFact::File { text }, Some(expected)) => text == expected,
        _ => false,
    }
}

fn verify_proposed(
    prepared: &PreparedDeployment,
    facts: &BTreeMap<String, PathFact>,
    marker: bool,
) -> Result<(), PublicationError> {
    for entry in &prepared.plan.entries {
        if (marker || entry.path != ".voktty/kit.json")
            && !matches_expected(&facts[&entry.path], Some(&entry.proposed))
        {
            return Err(PublicationError::Conflict);
        }
    }
    Ok(())
}

fn create(
    workspace: &LocalMemoryWorkspace<'_>,
    path: &str,
    text: &str,
    access: &dyn MemoryWriteAccess,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    #[cfg(any(unix, windows))]
    {
        workspace
            .checked_root(&phase(control))?
            .create_text(
                workspace.root(),
                path,
                text,
                workspace.access(),
                access,
                &phase(control),
            )
            .map_err(|error| {
                if error == ReadError::Unavailable {
                    PublicationError::Conflict
                } else {
                    error.into()
                }
            })?;
        Ok(())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (workspace, path, text, access, control);
        Err(PublicationError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_acceptance_expires_at_the_review_lifetime() {
        let created = Instant::now();
        assert_eq!(
            ensure_fresh(
                created,
                created + PREVIEW_LIFETIME - Duration::from_nanos(1)
            ),
            Ok(())
        );
        assert_eq!(
            ensure_fresh(created, created + PREVIEW_LIFETIME),
            Err(PublicationError::StalePreview)
        );
        assert_eq!(
            ensure_fresh(created, created + PREVIEW_LIFETIME + Duration::from_secs(1)),
            Err(PublicationError::StalePreview)
        );
    }
}
