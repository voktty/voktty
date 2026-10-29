use crate::{
    DiscoveryControl, DiscoveryPurpose, LocalMemoryStore, LocalMemoryWorkspace, MemoryReadAccess,
    NativeContextObservation, NativeScopeObservation, ReadControl, ReadError,
};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::runtime::Handle;
use tokio::sync::oneshot;

const CAPACITY: usize = 4;
static ACTIVE: OnceLock<Arc<AtomicUsize>> = OnceLock::new();

#[derive(Clone, Copy)]
pub enum MemoryStoreMode {
    OpenExisting,
    Initialize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryWorkError {
    Read(ReadError),
    RuntimeUnavailable,
    Failed,
}

impl std::fmt::Display for MemoryWorkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Read(error) => error.fmt(f),
            Self::RuntimeUnavailable => f.write_str("native memory worker runtime is unavailable"),
            Self::Failed => f.write_str("native memory worker did not return an observation"),
        }
    }
}
impl std::error::Error for MemoryWorkError {}
impl From<ReadError> for MemoryWorkError {
    fn from(error: ReadError) -> Self {
        Self::Read(error)
    }
}

#[derive(Clone)]
enum Control {
    Read(ReadControl),
    Scope(DiscoveryControl),
}
impl Control {
    fn check(&self) -> Result<(), ReadError> {
        match self {
            Self::Read(control) => control.check(),
            Self::Scope(control) => control.phase(Duration::from_secs(15)).check(),
        }
    }
    fn cancel(&self) {
        match self {
            Self::Read(control) => control.cancel(),
            Self::Scope(control) => control.cancel(),
        }
    }
    fn deadline(&self) -> Instant {
        match self {
            Self::Read(control) => control.deadline(),
            Self::Scope(control) => control.deadline(),
        }
    }
}

struct Slot(Arc<AtomicUsize>);
impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Dropping this consumer requests cooperative cancellation. A queued or running
/// worker retains its slot and captured native authority until it settles.
#[must_use = "finish or drop the observation job to release its consumer"]
pub struct MemoryJob<T> {
    job: Job<T, ReadError>,
}
impl<T> MemoryJob<T> {
    pub async fn finish(self) -> Result<T, MemoryWorkError> {
        self.job.receive().await?.map_err(MemoryWorkError::Read)
    }
}

struct Job<T, E> {
    receiver: oneshot::Receiver<(Result<T, E>, Slot)>,
    control: Control,
    settled: bool,
}
impl<T, E> Job<T, E> {
    async fn receive(mut self) -> Result<Result<T, E>, MemoryWorkError> {
        self.control.check()?;
        Handle::try_current().map_err(|_| MemoryWorkError::RuntimeUnavailable)?;
        let received = tokio::time::timeout_at(
            tokio::time::Instant::from_std(self.control.deadline()),
            &mut self.receiver,
        )
        .await;
        self.settled = received.is_ok();
        self.control.check()?;
        let (result, _slot) = received
            .map_err(|_| MemoryWorkError::Read(ReadError::Timeout))?
            .map_err(|_| MemoryWorkError::Failed)?;
        Ok(result)
    }
}
impl<T, E> Drop for Job<T, E> {
    fn drop(&mut self) {
        if !self.settled {
            self.control.cancel();
        }
    }
}

/// All production instances share four slots, including queued work, retired
/// workers and unconsumed results. Construction starts no runtime or worker.
#[derive(Clone)]
pub struct MemoryWorkers {
    active: Arc<AtomicUsize>,
}
impl Default for MemoryWorkers {
    fn default() -> Self {
        Self {
            active: ACTIVE.get_or_init(|| Arc::new(AtomicUsize::new(0))).clone(),
        }
    }
}

fn validate_path(path: &Path) -> Result<(), ReadError> {
    let text = path.to_str().ok_or(ReadError::InvalidInput)?;
    if !path.is_absolute() || text.contains('\0') {
        return Err(ReadError::InvalidInput);
    }
    if text.len() > 4096 || path.components().count() > 128 {
        return Err(ReadError::Limit);
    }
    Ok(())
}

impl MemoryWorkers {
    /// `parent` must come from the native application's directory resolver.
    /// Neither repository data nor webview paths may select private state.
    pub fn store(
        &self,
        parent: PathBuf,
        mode: MemoryStoreMode,
        control: ReadControl,
    ) -> Result<MemoryJob<Arc<LocalMemoryStore>>, MemoryWorkError> {
        validate_path(&parent)?;
        self.spawn(Control::Read(control.clone()), move || {
            match mode {
                MemoryStoreMode::OpenExisting => {
                    LocalMemoryStore::check_application_parent(&parent, &control)
                }
                MemoryStoreMode::Initialize => {
                    LocalMemoryStore::prepare_application_parent(&parent, &control)
                }
            }?;
            let store = match mode {
                MemoryStoreMode::OpenExisting => LocalMemoryStore::open_private(&parent, &control)?,
                MemoryStoreMode::Initialize => LocalMemoryStore::create_private(&parent, &control)?,
            };
            control.check()?;
            match mode {
                MemoryStoreMode::OpenExisting => store.load(),
                MemoryStoreMode::Initialize => store.initialize(),
            }
            .map_err(ReadError::Store)?;
            control.check()?;
            Ok(Arc::new(store))
        })
    }

    /// The native caller must capture and qualify the local filesystem and its
    /// authority first. This API never selects a transport or authorizes a root.
    pub fn scope(
        &self,
        store: Arc<LocalMemoryStore>,
        requested: PathBuf,
        access: Arc<dyn MemoryReadAccess>,
        purpose: DiscoveryPurpose,
        control: DiscoveryControl,
    ) -> Result<MemoryJob<NativeScopeObservation>, MemoryWorkError> {
        validate_path(&requested)?;
        self.spawn(Control::Scope(control.clone()), move || {
            let workspace = LocalMemoryWorkspace::open(
                &store,
                &requested,
                access.as_ref(),
                &control.phase(Duration::from_secs(5)),
            )?;
            workspace.observe_scope(purpose, &control)
        })
    }

    pub fn context(
        &self,
        store: Arc<LocalMemoryStore>,
        requested: PathBuf,
        access: Arc<dyn MemoryReadAccess>,
        role: Option<String>,
        control: ReadControl,
    ) -> Result<MemoryJob<NativeContextObservation>, MemoryWorkError> {
        validate_path(&requested)?;
        if role.as_ref().is_some_and(|role| role.len() > 256) {
            return Err(ReadError::Limit.into());
        }
        self.spawn(Control::Read(control.clone()), move || {
            let workspace =
                LocalMemoryWorkspace::open(&store, &requested, access.as_ref(), &control)?;
            workspace.observe_context(role.as_deref(), &control)
        })
    }

    fn spawn<T: Send + 'static>(
        &self,
        control: Control,
        work: impl FnOnce() -> Result<T, ReadError> + Send + 'static,
    ) -> Result<MemoryJob<T>, MemoryWorkError> {
        self.submit(control, work).map(|job| MemoryJob { job })
    }

    fn submit<T: Send + 'static, E: From<ReadError> + Send + 'static>(
        &self,
        control: Control,
        work: impl FnOnce() -> Result<T, E> + Send + 'static,
    ) -> Result<Job<T, E>, MemoryWorkError> {
        control.check()?;
        let runtime = Handle::try_current().map_err(|_| MemoryWorkError::RuntimeUnavailable)?;
        let mut active = self.active.load(Ordering::Acquire);
        loop {
            control.check()?;
            if active >= CAPACITY {
                return Err(ReadError::Busy.into());
            }
            match self.active.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(current) => active = current,
            }
        }
        let slot = Slot(self.active.clone());
        let (sender, receiver) = oneshot::channel();
        let worker_control = control.clone();
        drop(runtime.spawn_blocking(move || {
            let result = worker_control
                .check()
                .map_err(E::from)
                .and_then(|_| work())
                .and_then(|value| {
                    worker_control.check().map_err(E::from)?;
                    Ok(value)
                });
            let _ = sender.send((result, slot));
        }));
        Ok(Job {
            receiver,
            control,
            settled: false,
        })
    }
}

#[path = "deployment_workers.rs"]
mod deployment;
pub use deployment::{MemoryDeploymentJob, MemoryDeploymentWorkError, MemoryPreviewRequest};

#[cfg(test)]
#[path = "workers_tests.rs"]
mod tests;
