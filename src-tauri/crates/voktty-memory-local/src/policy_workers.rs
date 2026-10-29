use super::{resolve_ready_memory, validate_path, Control, Job, MemoryWorkError, MemoryWorkers};
use crate::reader::OwnedMemoryWorkspace;
use crate::{
    DiscoveryControl, LocalMemorySnapshot, LocalMemoryStore, LocalMemoryWorkspace, MemoryPolicy,
    MemoryReadAccess, ProjectPreference, ReadError,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryPolicyError {
    Worker(MemoryWorkError),
    ScopeUnavailable,
    Changed,
}
impl std::fmt::Display for MemoryPolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Worker(error) => error.fmt(f),
            Self::ScopeUnavailable => f.write_str("memory scope is not ready for a policy choice"),
            Self::Changed => f.write_str("memory scope or preferences changed; review again"),
        }
    }
}
impl std::error::Error for MemoryPolicyError {}
impl From<MemoryWorkError> for MemoryPolicyError {
    fn from(error: MemoryWorkError) -> Self {
        Self::Worker(error)
    }
}
impl From<ReadError> for MemoryPolicyError {
    fn from(error: ReadError) -> Self {
        Self::Worker(error.into())
    }
}

pub struct MemoryPolicyReview {
    origin: OwnedMemoryWorkspace,
    memory: OwnedMemoryWorkspace,
    snapshot: LocalMemorySnapshot,
    preference: Option<ProjectPreference>,
    project_key: String,
    policy: MemoryPolicy,
    expires: Instant,
}
impl MemoryPolicyReview {
    pub fn root(&self) -> &Path {
        self.memory.root()
    }
    pub fn project_key(&self) -> &str {
        &self.project_key
    }
    pub fn preference(&self) -> Option<&ProjectPreference> {
        self.preference.as_ref()
    }
    pub fn policy(&self) -> MemoryPolicy {
        self.policy
    }

    fn accept(self, control: &DiscoveryControl) -> Result<ProjectPreference, MemoryPolicyError> {
        if Instant::now() >= self.expires {
            return Err(MemoryPolicyError::Changed);
        }
        let origin = self.origin.borrow();
        let memory = self.memory.borrow();
        let resolved = resolve_ready_memory(&origin, control)?;
        if resolved
            .as_ref()
            .map(|(path, key)| (path.as_path(), key.as_str()))
            != Some((memory.root(), self.project_key.as_str()))
        {
            return Err(MemoryPolicyError::ScopeUnavailable);
        }
        let (snapshot, _) = memory.observe_preference(&control.read_control()?)?;
        if snapshot != self.snapshot {
            return Err(MemoryPolicyError::Changed);
        }
        if resolve_ready_memory(&origin, control)?
            .as_ref()
            .map(|(path, key)| (path.as_path(), key.as_str()))
            != Some((memory.root(), self.project_key.as_str()))
        {
            return Err(MemoryPolicyError::ScopeUnavailable);
        }
        origin.checked_root(&control.read_control()?)?;
        if Instant::now() >= self.expires {
            return Err(MemoryPolicyError::Changed);
        }
        let written =
            memory.set_policy(snapshot.revision(), self.policy, &control.read_control()?)?;
        origin.checked_root(&control.read_control()?)?;
        written
            .project(&self.project_key)
            .cloned()
            .ok_or_else(|| ReadError::Unavailable.into())
    }
}

#[must_use = "finish or drop the policy job to retire its consumer"]
pub struct MemoryPolicyJob<T> {
    job: Job<T, MemoryPolicyError>,
}
impl<T> MemoryPolicyJob<T> {
    pub async fn finish(self) -> Result<T, MemoryPolicyError> {
        self.job.receive().await?
    }
}

impl MemoryWorkers {
    pub fn review_policy(
        &self,
        store: Arc<LocalMemoryStore>,
        origin: PathBuf,
        access: Arc<dyn MemoryReadAccess>,
        policy: MemoryPolicy,
        control: DiscoveryControl,
    ) -> Result<MemoryPolicyJob<MemoryPolicyReview>, MemoryPolicyError> {
        validate_path(&origin)?;
        let job = self.submit(Control::Scope(control.clone()), move || {
            let origin = LocalMemoryWorkspace::open(
                &store,
                &origin,
                access.as_ref(),
                &control.read_control()?,
            )?;
            let (path, key) = resolve_ready_memory(&origin, &control)?
                .ok_or(MemoryPolicyError::ScopeUnavailable)?;
            let memory = LocalMemoryWorkspace::open(
                &store,
                &path,
                access.as_ref(),
                &control.read_control()?,
            )?;
            if memory.project_key() != key {
                return Err(MemoryPolicyError::Changed);
            }
            let (snapshot, preference) = memory.observe_preference(&control.read_control()?)?;
            if resolve_ready_memory(&origin, &control)? != Some((path, key.clone())) {
                return Err(MemoryPolicyError::Changed);
            }
            Ok(MemoryPolicyReview {
                origin: origin.retain(store.clone(), access.clone())?,
                memory: memory.retain(store.clone(), access.clone())?,
                snapshot,
                preference,
                project_key: key,
                policy,
                expires: Instant::now() + Duration::from_secs(120),
            })
        })?;
        Ok(MemoryPolicyJob { job })
    }

    pub fn accept_policy(
        &self,
        review: MemoryPolicyReview,
        control: DiscoveryControl,
    ) -> Result<MemoryPolicyJob<ProjectPreference>, MemoryPolicyError> {
        let job = self.submit(Control::Scope(control.clone()), move || {
            review.accept(&control)
        })?;
        Ok(MemoryPolicyJob { job })
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "policy_workers_tests.rs"]
mod tests;
