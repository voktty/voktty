use super::{validate_path, Control, Job, MemoryWorkError, MemoryWorkers};
use crate::{
    DiscoveryControl, InitializationPreview, LocalMemoryStore, LocalMemoryWorkspace,
    MemoryReadAccess, MemoryWriteAccess, OwnedInitializationPreview, PublicationError,
    PublicationFailure, PublicationReport, ReadError,
};
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use voktty_workspace_kit::RootLinks;

/// Native-owned inputs. Callers must qualify the local transport and capture
/// actual authorities first; repository or IPC data cannot supply those grants.
pub struct MemoryPreviewRequest {
    pub store: Arc<LocalMemoryStore>,
    pub origin: PathBuf,
    pub origin_access: Arc<dyn MemoryReadAccess>,
    pub destination: PathBuf,
    pub destination_access: Arc<dyn MemoryReadAccess>,
    pub inputs: Map<String, Value>,
    pub links: RootLinks,
}

#[derive(Debug)]
pub enum MemoryDeploymentWorkError {
    Worker(MemoryWorkError),
    Preview(PublicationError),
    Publication(Box<PublicationFailure>),
}

impl std::fmt::Display for MemoryDeploymentWorkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Worker(error) => error.fmt(f),
            Self::Preview(error) => error.fmt(f),
            Self::Publication(error) => error.fmt(f),
        }
    }
}
impl std::error::Error for MemoryDeploymentWorkError {}
impl From<ReadError> for MemoryDeploymentWorkError {
    fn from(error: ReadError) -> Self {
        Self::Worker(MemoryWorkError::Read(error))
    }
}
impl From<MemoryWorkError> for MemoryDeploymentWorkError {
    fn from(error: MemoryWorkError) -> Self {
        Self::Worker(error)
    }
}

/// Retains the shared worker slot through physical settlement, including after
/// consumer retirement. Failure or cancellation never implies project rollback.
#[must_use = "finish or drop the deployment job to retire its consumer"]
pub struct MemoryDeploymentJob<T> {
    job: Job<T, MemoryDeploymentWorkError>,
}

impl<T> MemoryDeploymentJob<T> {
    pub async fn finish(self) -> Result<T, MemoryDeploymentWorkError> {
        self.job.receive().await?
    }
}

fn validate_inputs(inputs: &Map<String, Value>) -> Result<(), ReadError> {
    if inputs.len() > 32 {
        return Err(ReadError::Limit);
    }
    let mut bytes = 0usize;
    for (name, value) in inputs {
        let text = value.as_str().ok_or(ReadError::InvalidInput)?;
        if name.len() > 64 || text.len() > 16 * 1024 {
            return Err(ReadError::Limit);
        }
        bytes += name.len() + text.len();
        if bytes > 256 * 1024 {
            return Err(ReadError::Limit);
        }
    }
    Ok(())
}

impl MemoryWorkers {
    pub fn preview(
        &self,
        request: MemoryPreviewRequest,
        control: DiscoveryControl,
    ) -> Result<MemoryDeploymentJob<OwnedInitializationPreview>, MemoryDeploymentWorkError> {
        validate_path(&request.origin)?;
        validate_path(&request.destination)?;
        validate_inputs(&request.inputs)?;
        let job = self.submit(Control::Scope(control.clone()), move || {
            let prepare = || -> Result<OwnedInitializationPreview, PublicationError> {
                let origin = LocalMemoryWorkspace::open(
                    &request.store,
                    &request.origin,
                    request.origin_access.as_ref(),
                    &control.phase(Duration::from_secs(5)),
                )?;
                let destination = LocalMemoryWorkspace::open(
                    &request.store,
                    &request.destination,
                    request.destination_access.as_ref(),
                    &control.phase(Duration::from_secs(5)),
                )?;
                InitializationPreview::prepare(
                    &origin,
                    &destination,
                    &request.inputs,
                    request.links,
                    &control,
                )?
                .into_owned(
                    request.store.clone(),
                    request.origin_access.clone(),
                    request.destination_access.clone(),
                )
            };
            prepare().map_err(MemoryDeploymentWorkError::Preview)
        })?;
        Ok(MemoryDeploymentJob { job })
    }

    pub fn publish(
        &self,
        preview: OwnedInitializationPreview,
        access: Arc<dyn MemoryWriteAccess>,
        control: DiscoveryControl,
    ) -> Result<MemoryDeploymentJob<PublicationReport>, MemoryDeploymentWorkError> {
        let job = self.submit(Control::Scope(control.clone()), move || {
            preview
                .publish(access.as_ref(), &control)
                .map_err(MemoryDeploymentWorkError::Publication)
        })?;
        Ok(MemoryDeploymentJob { job })
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "deployment_workers_tests.rs"]
mod tests;
