use super::*;
use crate::reader::OwnedProjectMemoryWorkspace;
use crate::ProjectMemoryWorkspace;

#[path = "project_publication.rs"]
mod publication;

pub const PROJECT_INITIALIZATION_RECORD: &str = ".voktty/.initialization.json";

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
    links: RootLinks,
    observation_identity: String,
    created_at: Instant,
    transaction: String,
}

impl OwnedProjectInitializationPreview {
    pub fn prepare(
        request: ProjectInitializationRequest,
        control: &DiscoveryControl,
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
        check_recovery(&source, &target, control)?;
        let facts = target.observe_deployment(request.links, &control.read_control()?)?;
        let files = render_template(&request.inputs).map_err(ReadError::Contract)?;
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
            links: request.links,
            observation_identity: uuid::Uuid::new_v4().to_string(),
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
            "schema":1,
            "operation":"initialize-project",
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
            && !cfg!(any(target_os = "linux", target_os = "android", windows))
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
        check_recovery(&source, &target, control)?;
        let source_scope = source.observe_scope_with_identity(
            DiscoveryPurpose::Discover,
            &self.observation_identity,
            control,
        )?;
        let target_scope = target.observe_scope_with_identity(
            DiscoveryPurpose::Initialize,
            &self.observation_identity,
            control,
        )?;
        let key = target_scope
            .directories
            .iter()
            .find(|directory| directory.path == target.root())
            .map(|directory| directory.directory_key.as_str())
            .ok_or(PublicationError::Scope)?;
        if !scopes_allow_target(&source_scope, &target_scope, key, false, true) {
            return Err(PublicationError::Scope);
        }
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
        // A source can retire or be replaced while destination discovery runs.
        source.validate_root(&control.read_control()?)?;
        target.validate_root(&control.read_control()?)?;
        ensure_fresh(self.created_at, Instant::now())?;
        control.read_control()?;
        Ok(())
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
