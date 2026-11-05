use super::*;
use crate::reader::OwnedProjectMemoryWorkspace;
use crate::{DiscoveryPurpose, ProjectMemoryWorkspace};
use voktty_workspace_kit::MemoryUseDecision;

pub(super) struct ProjectBoundContext {
    origin: OwnedProjectMemoryWorkspace,
    memory: OwnedProjectMemoryWorkspace,
    role: Option<String>,
    live: AtomicBool,
    _slot: SessionSlot,
}

fn resolve_project(
    origin: &ProjectMemoryWorkspace<'_>,
    control: &DiscoveryControl,
) -> Result<PathBuf, MemoryTrustError> {
    let observed = origin.observe_scope(DiscoveryPurpose::Discover, control)?;
    if observed.scope.state != "ready"
        || !observed.scope.ancestry_complete
        || !observed.blocked_paths.is_empty()
    {
        return Err(MemoryTrustError::ScopeUnavailable);
    }
    observed
        .scope
        .root_key
        .as_ref()
        .and_then(|key| {
            observed
                .directories
                .iter()
                .find(|entry| &entry.directory_key == key)
                .map(|entry| entry.path.clone())
        })
        .ok_or(MemoryTrustError::ScopeUnavailable)
}

impl ProjectBoundContext {
    pub(super) fn prepare(
        requested: PathBuf,
        access: Arc<dyn MemoryReadAccess>,
        role: Option<String>,
        control: &DiscoveryControl,
        slot: SessionSlot,
    ) -> Result<Self, MemoryTrustError> {
        validate_path(&requested)?;
        if role.as_ref().is_some_and(|role| role.len() > 256) {
            return Err(ReadError::Limit.into());
        }
        let phase = control.read_control()?;
        let origin = ProjectMemoryWorkspace::open(&requested, access.as_ref(), &phase)?;
        let path = resolve_project(&origin, control)?;
        let memory =
            ProjectMemoryWorkspace::open(&path, access.as_ref(), &control.read_control()?)?;
        memory.read_context_packet(role.as_deref(), &control.read_control()?)?;
        let bound = Self {
            origin: origin.retain(access.clone())?,
            memory: memory.retain(access.clone())?,
            role,
            live: AtomicBool::new(true),
            _slot: slot,
        };
        bound.check_scope(control)?;
        Ok(bound)
    }

    pub(super) fn root(&self) -> &Path {
        self.memory.root()
    }

    pub(super) fn retire(&self) {
        self.live.store(false, Ordering::Release);
    }

    pub(super) fn check(&self) -> Result<(), ReadError> {
        if !self.live.load(Ordering::Acquire) {
            return Err(ReadError::Cancelled);
        }
        let origin = self.origin.borrow();
        let memory = self.memory.borrow();
        if !origin.access().allows_workspace_root(origin.root())
            || !memory.access().allows_workspace_root(memory.root())
        {
            return Err(ReadError::Denied);
        }
        if !self.live.load(Ordering::Acquire) {
            return Err(ReadError::Cancelled);
        }
        Ok(())
    }

    fn check_scope(&self, control: &DiscoveryControl) -> Result<(), MemoryTrustError> {
        self.check()?;
        let origin = self.origin.borrow();
        let memory = self.memory.borrow();
        origin.validate_root(&control.read_control()?)?;
        memory.validate_root(&control.read_control()?)?;
        if resolve_project(&origin, control)? != memory.root() {
            return Err(MemoryTrustError::Changed);
        }
        self.check()?;
        Ok(())
    }

    pub(super) fn read(
        &self,
        control: &DiscoveryControl,
    ) -> Result<MemoryContextResult, MemoryTrustError> {
        self.check_scope(control)?;
        let packet = self
            .memory
            .borrow()
            .read_context_packet(self.role.as_deref(), &control.read_control()?)?;
        self.check_scope(control)?;
        self.check()?;
        Ok(MemoryContextResult {
            schema: 1,
            decision: MemoryUseDecision {
                schema: 1,
                policy: "manual",
                context_allowed: true,
                capture_allowed: false,
                reason: "KIT_MEMORY_READY",
            },
            packet: Some(packet),
        })
    }
}
