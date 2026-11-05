use super::*;
use crate::reader::OwnedProjectMemoryWorkspace;
use crate::ProjectMemoryWorkspace;

#[path = "project_publication.rs"]
mod publication;

#[cfg(all(test, any(unix, windows)))]
#[path = "project_record_lock_tests.rs"]
mod record_lock_tests;

pub const PROJECT_INITIALIZATION_RECORD: &str = ".voktty/.initialization.json";

#[cfg(unix)]
pub(crate) fn lock_record(file: &std::fs::File) -> Result<(), ReadError> {
    file.try_lock().map_err(|error| match error {
        std::fs::TryLockError::WouldBlock => ReadError::Busy,
        std::fs::TryLockError::Error(_) => ReadError::Io,
    })
}

#[cfg(windows)]
pub(crate) fn lock_record(file: &std::fs::File) -> Result<(), ReadError> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
    };
    use windows_sys::Win32::System::IO::OVERLAPPED;

    // Windows byte locks deny reads through other handles. Reserve one byte
    // beyond the bounded record so validation can still read its complete text.
    let mut overlapped = OVERLAPPED::default();
    overlapped.Anonymous.Anonymous.Offset = u32::MAX - 1;
    overlapped.Anonymous.Anonymous.OffsetHigh = u32::MAX;
    if unsafe {
        LockFileEx(
            file.as_raw_handle(),
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            1,
            0,
            &mut overlapped,
        )
    } == 0
    {
        return Err(
            if std::io::Error::last_os_error().raw_os_error() == Some(33) {
                ReadError::Busy
            } else {
                ReadError::Io
            },
        );
    }
    Ok(())
}

enum InitializationPlacement {
    Resolved(String),
    ProjectRoot,
}

impl InitializationPlacement {
    fn name(&self) -> &'static str {
        match self {
            Self::Resolved(_) => "resolved-memory-scope",
            Self::ProjectRoot => "explicit-project-root",
        }
    }
}

/// Native-owned roots and read authorities. No private preference store or
/// renderer-supplied observation can stand in for the captured project IO.
pub struct ProjectInitializationRequest {
    pub origin: PathBuf,
    pub origin_access: Arc<dyn MemoryReadAccess>,
    pub destination: PathBuf,
    pub destination_access: Arc<dyn MemoryReadAccess>,
    pub inputs: Map<String, Value>,
    pub links: RootLinks,
}

/// Native-owned initialization review. Preparation grants no write authority,
/// persistent instruction trust or session consent. Publication consumes it.
pub struct OwnedProjectInitializationPreview {
    origin: OwnedProjectMemoryWorkspace,
    destination: OwnedProjectMemoryWorkspace,
    prepared: PreparedDeployment,
    template_values: Map<String, Value>,
    links: RootLinks,
    placement: InitializationPlacement,
    created_at: Instant,
    transaction: String,
}

impl OwnedProjectInitializationPreview {
    pub fn prepare(
        request: ProjectInitializationRequest,
        control: &DiscoveryControl,
    ) -> Result<Self, PublicationError> {
        Self::prepare_with_placement(
            request,
            control,
            InitializationPlacement::Resolved(uuid::Uuid::new_v4().to_string()),
        )
    }

    /// Places the kit at an explicitly selected native project root. This does
    /// not resolve a delivery scope or inspect unrelated ancestors/descendants.
    pub fn prepare_at_project_root(
        request: ProjectInitializationRequest,
        control: &DiscoveryControl,
    ) -> Result<Self, PublicationError> {
        Self::prepare_with_placement(request, control, InitializationPlacement::ProjectRoot)
    }

    fn prepare_with_placement(
        request: ProjectInitializationRequest,
        control: &DiscoveryControl,
        placement: InitializationPlacement,
    ) -> Result<Self, PublicationError> {
        supported()?;
        control.read_control()?;
        crate::template_inputs::validate_inputs(&request.inputs)?;
        let origin = ProjectMemoryWorkspace::open(
            &request.origin,
            request.origin_access.as_ref(),
            &control.read_control()?,
        )?
        .retain(request.origin_access.clone())?;
        let destination = ProjectMemoryWorkspace::open(
            &request.destination,
            request.destination_access.as_ref(),
            &control.read_control()?,
        )?
        .retain(request.destination_access.clone())?;
        origin.review_binding()?;
        destination.review_binding()?;
        let source = origin.borrow();
        let target = destination.borrow();
        check_placement_recovery(&placement, &source, &target, control)?;
        let facts = target.observe_deployment(request.links, &control.read_control()?)?;
        let mut inputs = request.inputs;
        if matches!(placement, InitializationPlacement::ProjectRoot) {
            // Initialization repairs the existing project; supplied defaults
            // must not rename it or change its original creation date.
            if let Some(PathFact::File { text }) = facts.get(".voktty/kit.json") {
                if let Ok(config) = voktty_workspace_kit::parse_kit_config(text) {
                    if let Some(values) = config["values"].as_object() {
                        inputs.extend(
                            values
                                .iter()
                                .filter(|(key, _)| key.as_str() != "kit_version")
                                .map(|(key, value)| (key.clone(), value.clone())),
                        );
                    }
                }
            }
        }
        crate::template_inputs::validate_inputs(&inputs)?;
        let mut files = render_template(&inputs).map_err(ReadError::Contract)?;
        let config = files
            .iter()
            .find(|file| file.path == ".voktty/kit.json")
            .ok_or(ReadError::InvalidInput)?;
        let config =
            voktty_workspace_kit::parse_kit_config(&config.text).map_err(ReadError::Contract)?;
        let template_values = config["values"]
            .as_object()
            .ok_or(ReadError::InvalidInput)?
            .clone();
        if matches!(placement, InitializationPlacement::ProjectRoot) {
            for file in &mut files {
                if file.kind == voktty_workspace_kit::FileKind::Content {
                    if let Some(PathFact::File { text }) = facts.get(&file.path) {
                        file.text.clone_from(text);
                    }
                }
            }
        }
        let manifest: Value =
            serde_json::from_str(resource("manifest.json").expect("embedded manifest"))
                .expect("validated manifest");
        let prepared = prepare_deployment(
            manifest["version"].as_str().expect("manifest version"),
            &files,
            &facts,
            request.links,
        )
        .map_err(ReadError::Contract)?;
        if !prepared.plan.can_publish {
            return Err(PublicationError::Conflict);
        }
        let preview = Self {
            origin,
            destination,
            prepared,
            template_values,
            links: request.links,
            placement,
            created_at: Instant::now(),
            transaction: uuid::Uuid::new_v4().to_string(),
        };
        preview.revalidate(control)?;
        Ok(preview)
    }

    pub fn root(&self) -> &Path {
        self.destination.root()
    }

    pub fn deployment(&self) -> &PreparedDeployment {
        &self.prepared
    }

    pub fn acceptance_digest(&self) -> String {
        let review = serde_json::json!({
            "schema":2,
            "operation":"initialize-project",
            "scope":self.placement.name(),
            "origin":self.origin.review_binding().expect("qualified native root"),
            "destination":self.destination.review_binding().expect("qualified native root"),
            "deployment":self.prepared,
        });
        hex::encode(Sha256::digest(review.to_string().as_bytes()))
    }

    pub fn publication_blocker(&self) -> Option<PublicationError> {
        if self
            .prepared
            .plan
            .entries
            .iter()
            .any(|entry| entry.action != DeploymentAction::Skip)
            && !cfg!(any(unix, windows))
        {
            return Some(PublicationError::Unsupported);
        }
        publication_blocker(&self.prepared)
    }

    pub fn revalidate(&self, control: &DiscoveryControl) -> Result<(), PublicationError> {
        ensure_fresh(self.created_at, Instant::now())?;
        control.read_control()?;
        let source = self.origin.borrow();
        let target = self.destination.borrow();
        check_placement_recovery(&self.placement, &source, &target, control)?;
        self.validate_placement(&source, &target, false, control)?;
        let facts = target.observe_deployment(self.links, &control.read_control()?)?;
        if self
            .prepared
            .plan
            .entries
            .iter()
            .any(|entry| !matches_expected(&facts[&entry.path], entry.expected.as_deref()))
        {
            return Err(PublicationError::StalePreview);
        }
        source.validate_root(&control.read_control()?)?;
        target.validate_root(&control.read_control()?)?;
        ensure_fresh(self.created_at, Instant::now())?;
        control.read_control()?;
        Ok(())
    }

    fn validate_placement(
        &self,
        source: &ProjectMemoryWorkspace<'_>,
        target: &ProjectMemoryWorkspace<'_>,
        allow_partial: bool,
        control: &DiscoveryControl,
    ) -> Result<(), PublicationError> {
        source.validate_root(&control.read_control()?)?;
        target.validate_root(&control.read_control()?)?;
        let InitializationPlacement::Resolved(identity) = &self.placement else {
            return validate_project_root(target.root());
        };
        let source_scope =
            source.observe_scope_with_identity(DiscoveryPurpose::Discover, identity, control)?;
        let target_scope =
            target.observe_scope_with_identity(DiscoveryPurpose::Initialize, identity, control)?;
        let key = target_scope
            .directories
            .iter()
            .find(|directory| directory.path == target.root())
            .map(|directory| directory.directory_key.as_str())
            .ok_or(PublicationError::Scope)?;
        if !scopes_allow_target(&source_scope, &target_scope, key, allow_partial, true) {
            return Err(PublicationError::Scope);
        }
        Ok(())
    }
}

fn validate_project_root(root: &Path) -> Result<(), PublicationError> {
    if root.components().any(|part| {
        part.as_os_str()
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(".voktty"))
    }) {
        return Err(ReadError::Denied.into());
    }
    Ok(())
}

fn check_placement_recovery(
    placement: &InitializationPlacement,
    source: &ProjectMemoryWorkspace<'_>,
    target: &ProjectMemoryWorkspace<'_>,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    match placement {
        InitializationPlacement::Resolved(_) => check_recovery(source, target, control),
        InitializationPlacement::ProjectRoot => {
            validate_project_root(target.root())?;
            check_recovery(target, target, control)
        }
    }
}

fn check_recovery(
    origin: &ProjectMemoryWorkspace<'_>,
    destination: &ProjectMemoryWorkspace<'_>,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    let mut paths = destination.recovery_artifacts(&control.read_control()?)?;
    if origin.root() != destination.root() {
        // Origin artifacts cannot safely be interpreted under the destination.
        let origin_paths = origin.recovery_artifacts(&control.read_control()?)?;
        if !origin_paths.is_empty() {
            return Err(PublicationError::PendingIntent);
        }
    }
    if !paths.is_empty() {
        paths.sort();
        return Err(PublicationError::RecoveryRequired(paths));
    }
    Ok(())
}
