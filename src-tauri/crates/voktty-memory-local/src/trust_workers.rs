use super::{validate_path, Control, Job, MemoryWorkError, MemoryWorkers};
use crate::reader::OwnedMemoryWorkspace;
use crate::{
    DiscoveryControl, DiscoveryPurpose, LocalMemorySnapshot, LocalMemoryStore,
    LocalMemoryWorkspace, MemoryReadAccess, NativeContextObservation, ReadError,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryTrustError {
    Worker(MemoryWorkError),
    ScopeUnavailable,
    Changed,
}

impl std::fmt::Display for MemoryTrustError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Worker(error) => error.fmt(f),
            Self::ScopeUnavailable => {
                f.write_str("memory scope is not ready for instruction review")
            }
            Self::Changed => {
                f.write_str("memory instructions or preferences changed; review again")
            }
        }
    }
}
impl std::error::Error for MemoryTrustError {}
impl From<MemoryWorkError> for MemoryTrustError {
    fn from(error: MemoryWorkError) -> Self {
        Self::Worker(error)
    }
}
impl From<ReadError> for MemoryTrustError {
    fn from(error: ReadError) -> Self {
        Self::Worker(error.into())
    }
}

/// Native-owned, single-use acceptance of the displayed instruction bytes.
/// Neither the observation nor its digest is an authorization to deliver context.
pub struct MemoryTrustReview {
    origin: OwnedMemoryWorkspace,
    memory: OwnedMemoryWorkspace,
    observed: NativeContextObservation,
    expires: Instant,
}

impl MemoryTrustReview {
    pub fn root(&self) -> &Path {
        self.memory.root()
    }

    pub fn observation(&self) -> &NativeContextObservation {
        &self.observed
    }

    fn accept(self, control: &DiscoveryControl) -> Result<LocalMemorySnapshot, MemoryTrustError> {
        if Instant::now() >= self.expires {
            return Err(MemoryTrustError::Changed);
        }
        let origin = self.origin.borrow();
        let memory = self.memory.borrow();
        let (path, key) = resolve(&origin, control)?;
        if path != memory.root() || key != self.observed.project_key {
            return Err(MemoryTrustError::Changed);
        }
        let current = memory.observe_context(
            self.observed.fingerprint.role.as_deref(),
            &control.read_control()?,
        )?;
        if current.fingerprint != self.observed.fingerprint
            || current.config != self.observed.config
            || current.local_preferences != self.observed.local_preferences
        {
            return Err(MemoryTrustError::Changed);
        }
        // The instruction read can outlive a scope change made by another writer.
        let (path, key) = resolve(&origin, control)?;
        if path != memory.root() || key != self.observed.project_key {
            return Err(MemoryTrustError::Changed);
        }
        origin.checked_root(&control.read_control()?)?;
        memory.checked_root(&control.read_control()?)?;
        control.read_control()?;
        if Instant::now() >= self.expires {
            return Err(MemoryTrustError::Changed);
        }
        memory
            .trust_instructions(
                self.observed.local_preferences.revision(),
                &self.observed.fingerprint.digest,
                &control.read_control()?,
            )
            .map_err(Into::into)
    }
}

fn resolve(
    origin: &LocalMemoryWorkspace<'_>,
    control: &DiscoveryControl,
) -> Result<(PathBuf, String), MemoryTrustError> {
    let observed = origin.observe_scope(DiscoveryPurpose::Discover, control)?;
    if observed.scope.state != "ready"
        || !observed.scope.ancestry_complete
        || !observed.blocked_paths.is_empty()
    {
        return Err(MemoryTrustError::ScopeUnavailable);
    }
    let key = observed
        .scope
        .root_key
        .ok_or(MemoryTrustError::ScopeUnavailable)?;
    let directory = observed
        .directories
        .into_iter()
        .find(|directory| directory.directory_key == key && directory.state == "valid")
        .ok_or(MemoryTrustError::ScopeUnavailable)?;
    Ok((directory.path, key))
}

#[must_use = "finish or drop the trust job to retire its consumer"]
pub struct MemoryTrustJob<T> {
    job: Job<T, MemoryTrustError>,
}
impl<T> MemoryTrustJob<T> {
    pub async fn finish(self) -> Result<T, MemoryTrustError> {
        self.job.receive().await?
    }
}

impl MemoryWorkers {
    /// Resolves from an execution directory using captured native authority.
    /// Metadata-only ancestor inspection never grants instruction read access.
    pub fn review_trust(
        &self,
        store: Arc<LocalMemoryStore>,
        origin: PathBuf,
        access: Arc<dyn MemoryReadAccess>,
        role: Option<String>,
        control: DiscoveryControl,
    ) -> Result<MemoryTrustJob<MemoryTrustReview>, MemoryTrustError> {
        validate_path(&origin)?;
        if role.as_ref().is_some_and(|role| role.len() > 256) {
            return Err(ReadError::Limit.into());
        }
        let job = self.submit(Control::Scope(control.clone()), move || {
            let origin = LocalMemoryWorkspace::open(
                &store,
                &origin,
                access.as_ref(),
                &control.read_control()?,
            )?;
            let (path, key) = resolve(&origin, &control)?;
            let memory = LocalMemoryWorkspace::open(
                &store,
                &path,
                access.as_ref(),
                &control.read_control()?,
            )?;
            if memory.project_key() != key {
                return Err(MemoryTrustError::Changed);
            }
            let observed = memory.observe_context(role.as_deref(), &control.read_control()?)?;
            let (current_path, current_key) = resolve(&origin, &control)?;
            if current_path != path || current_key != key {
                return Err(MemoryTrustError::Changed);
            }
            Ok(MemoryTrustReview {
                origin: origin.retain(store.clone(), access.clone())?,
                memory: memory.retain(store.clone(), access.clone())?,
                observed,
                expires: Instant::now() + Duration::from_secs(120),
            })
        })?;
        Ok(MemoryTrustJob { job })
    }

    /// Consumes the exact native review, rereads its instructions and scope, then
    /// updates only trust using the reviewed local revision. No policy or session
    /// consent is inferred. An admitted write may settle after response retirement.
    pub fn accept_trust(
        &self,
        review: MemoryTrustReview,
        control: DiscoveryControl,
    ) -> Result<MemoryTrustJob<LocalMemorySnapshot>, MemoryTrustError> {
        let job = self.submit(Control::Scope(control.clone()), move || {
            review.accept(&control)
        })?;
        Ok(MemoryTrustJob { job })
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "trust_workers_tests.rs"]
mod tests;
