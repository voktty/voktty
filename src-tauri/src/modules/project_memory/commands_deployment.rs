use super::*;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use voktty_memory_local::{MemoryDeploymentWorkError, PublicationError, PublicationReport};
use voktty_workspace_kit::{PreparedDeployment, RootLinks};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkChoices {
    agents: bool,
    claude: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewRequest {
    revision: u64,
    destination: PathBuf,
    environment: WorkspaceEnv,
    inputs: BTreeMap<String, String>,
    links: LinkChoices,
}

impl PreviewRequest {
    fn validate_inputs(&self) -> Result<(), ReadError> {
        if self.inputs.len() > 32 {
            return Err(ReadError::Limit);
        }
        let mut bytes = 0;
        for (key, value) in &self.inputs {
            bytes += key.len() + value.len();
            if key.len() > 64 || value.len() > 16 * 1024 || bytes > 256 * 1024 {
                return Err(ReadError::Limit);
            }
        }
        Ok(())
    }

    fn values(self, store: Arc<LocalMemoryStore>) -> NativeMemoryPreviewValues {
        NativeMemoryPreviewValues {
            store,
            inputs: self
                .inputs
                .into_iter()
                .map(|(k, v)| (k, Value::String(v)))
                .collect::<Map<_, _>>(),
            links: RootLinks {
                agents: self.links.agents,
                claude: self.links.claude,
            },
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationChanges {
    created: Vec<String>,
    migrated: Vec<String>,
    cleaned: Vec<String>,
    possible_recovery_files: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DeploymentCommandError {
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    changes: Option<PublicationChanges>,
}

impl From<MemoryCommandError> for DeploymentCommandError {
    fn from(error: MemoryCommandError) -> Self {
        Self {
            code: error.code,
            changes: None,
        }
    }
}
impl From<ReadError> for DeploymentCommandError {
    fn from(error: ReadError) -> Self {
        MemoryCommandError::from(MemoryWorkError::Read(error)).into()
    }
}
fn publication_code(error: PublicationError) -> &'static str {
    match error {
        PublicationError::Read(error) => {
            MemoryCommandError::from(MemoryWorkError::Read(error)).code
        }
        PublicationError::Store(error) => {
            MemoryCommandError::from(MemoryWorkError::Read(ReadError::Store(error))).code
        }
        PublicationError::Scope => "scope",
        PublicationError::Conflict => "conflict",
        PublicationError::StalePreview => "stale",
        PublicationError::InvalidIntent => "invalidRecovery",
        PublicationError::PendingIntent => "pendingRecovery",
        PublicationError::Unsupported => "unsupported",
        PublicationError::MigrationUnsupported => "migrationUnsupported",
        PublicationError::RecoveryRequired(_) => "recoveryRequired",
        PublicationError::Io => "unavailable",
    }
}
impl From<MemoryDeploymentWorkError> for DeploymentCommandError {
    fn from(error: MemoryDeploymentWorkError) -> Self {
        match error {
            MemoryDeploymentWorkError::Worker(error) => MemoryCommandError::from(error).into(),
            MemoryDeploymentWorkError::Preview(error) => Self {
                code: publication_code(error),
                changes: None,
            },
            MemoryDeploymentWorkError::Publication(failure) => Self {
                code: publication_code(failure.error),
                changes: Some(PublicationChanges {
                    created: failure.created,
                    migrated: failure.migrated,
                    cleaned: failure.cleaned,
                    possible_recovery_files: failure.possible_recovery_files,
                }),
            },
        }
    }
}

#[derive(Debug, Serialize)]
pub struct RecoveryReply {
    path: String,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewReply {
    schema: u8,
    review: String,
    revision: u64,
    deployment: PreparedDeployment,
    is_resuming: bool,
    recovery_files: Vec<RecoveryReply>,
    publication_blocker: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationReply {
    schema: u8,
    created: Vec<String>,
    skipped: Vec<String>,
    migrated: Vec<String>,
    cleaned: Vec<String>,
}
impl From<PublicationReport> for PublicationReply {
    fn from(report: PublicationReport) -> Self {
        Self {
            schema: 1,
            created: report.created,
            skipped: report.skipped,
            migrated: report.migrated,
            cleaned: report.cleaned,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Opening,
    Ready,
    Publishing,
}

#[derive(Clone)]
struct ReviewCapture {
    token: String,
    revision: u64,
    selection: NativeMemorySelectionReceipt,
    receipt: NativeMemoryPreviewReceipt,
}
struct CommandReview {
    capture: ReviewCapture,
    phase: Phase,
}
#[derive(Default)]
pub(super) struct CommandReviews {
    revision: u64,
    current: Option<CommandReview>,
}

impl PresentationResource {
    fn selected_review<'a>(
        &self,
        app: &NativeMemoryApplication,
        token: &str,
        state: &'a mut SelectionState,
    ) -> Result<&'a mut Selected, DeploymentCommandError> {
        if token.len() != 36 || !self.live.load(Ordering::Acquire) {
            return Err(cancelled().into());
        }
        let selected = state
            .selected
            .as_mut()
            .filter(|selected| selected.token == token)
            .ok_or_else(cancelled)?;
        if !app.is_current(&self.window, &self.receipt, &selected.receipt) {
            return Err(cancelled().into());
        }
        Ok(selected)
    }

    fn reserve_review(
        &self,
        app: &NativeMemoryApplication,
        registry: &WorkspaceRegistry,
        selection: &str,
        request: &PreviewRequest,
    ) -> Result<ReviewCapture, DeploymentCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.selected_review(app, selection, &mut state)?;
        if request.revision == 0
            || request.revision > 9_007_199_254_740_991
            || request.revision <= selected.reviews.revision
        {
            return Err(cancelled().into());
        }
        selected.reviews.revision = request.revision;
        selected.reviews.current = None;
        let receipt = app.reserve_preview(
            &self.window,
            &self.receipt,
            &selected.receipt,
            registry,
            NativeMemoryPreviewTarget {
                destination: request.destination.clone(),
                environment: request.environment.clone(),
                control: DiscoveryControl::default(),
            },
        )?;
        let capture = ReviewCapture {
            token: uuid::Uuid::new_v4().to_string(),
            revision: request.revision,
            selection: selected.receipt.clone(),
            receipt,
        };
        selected.reviews.current = Some(CommandReview {
            capture: capture.clone(),
            phase: Phase::Opening,
        });
        Ok(capture)
    }

    fn matching_review<'a>(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &ReviewCapture,
        phase: Phase,
        state: &'a mut SelectionState,
    ) -> Result<&'a mut CommandReview, DeploymentCommandError> {
        self.selected_review(app, selection, state)?
            .reviews
            .current
            .as_mut()
            .filter(|review| {
                review.capture.token == capture.token
                    && review.capture.revision == capture.revision
                    && review.phase == phase
            })
            .ok_or_else(|| cancelled().into())
    }

    fn adopt_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &ReviewCapture,
        prepared: NativeMemoryPreparedPreview,
    ) -> Result<PreviewReply, DeploymentCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let review = self.matching_review(app, selection, capture, Phase::Opening, &mut state)?;
        let receipt =
            app.accept_preview(&self.window, &self.receipt, &capture.selection, prepared)?;
        let snapshot =
            app.preview_snapshot(&self.window, &self.receipt, &capture.selection, &receipt)?;
        review.phase = Phase::Ready;
        Ok(PreviewReply {
            schema: 1,
            review: capture.token.clone(),
            revision: capture.revision,
            deployment: snapshot.deployment,
            is_resuming: snapshot.is_resuming,
            recovery_files: snapshot
                .recovery_files
                .into_iter()
                .map(|file| RecoveryReply {
                    path: file.path,
                    text: file.text,
                })
                .collect(),
            publication_blocker: snapshot.publication_blocker.map(publication_code),
        })
    }

    fn cancel_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        revision: u64,
        token: Option<&str>,
    ) -> Result<bool, DeploymentCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.selected_review(app, selection, &mut state)?;
        if revision == 0 || revision > 9_007_199_254_740_991 {
            return Err(cancelled().into());
        }
        if token.is_none() && revision > selected.reviews.revision {
            // A cancel can arrive before its preview command on the transport.
            selected.reviews.revision = revision;
            if let Some(review) = selected.reviews.current.take() {
                app.cancel_preview(
                    &self.window,
                    &self.receipt,
                    &review.capture.selection,
                    &review.capture.receipt,
                )?;
                return Ok(true);
            }
            return Ok(false);
        }
        if !selected.reviews.current.as_ref().is_some_and(|review| {
            review.capture.revision == revision
                && token.is_none_or(|token| token == review.capture.token)
        }) {
            return Ok(false);
        }
        let review = selected.reviews.current.take().ok_or_else(cancelled)?;
        app.cancel_preview(
            &self.window,
            &self.receipt,
            &review.capture.selection,
            &review.capture.receipt,
        )?;
        Ok(true)
    }

    fn begin_publication(
        &self,
        app: &NativeMemoryApplication,
        registry: &WorkspaceRegistry,
        selection: &str,
        token: &str,
    ) -> Result<
        (
            ReviewCapture,
            Result<NativeMemoryPublication, MemoryDeploymentWorkError>,
        ),
        DeploymentCommandError,
    > {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.selected_review(app, selection, &mut state)?;
        let review = selected
            .reviews
            .current
            .as_mut()
            .filter(|review| {
                token.len() == 36 && review.capture.token == token && review.phase == Phase::Ready
            })
            .ok_or_else(cancelled)?;
        review.phase = Phase::Publishing;
        let capture = review.capture.clone();
        let result = app.confirm_preview(
            &self.window,
            &self.receipt,
            &capture.selection,
            &capture.receipt,
            registry,
            DiscoveryControl::default(),
        );
        Ok((capture, result))
    }

    fn check_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &ReviewCapture,
        phase: Phase,
    ) -> Result<(), DeploymentCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        self.matching_review(app, selection, capture, phase, &mut state)?;
        if !app.is_preview_current(
            &self.window,
            &self.receipt,
            &capture.selection,
            &capture.receipt,
        ) {
            return Err(cancelled().into());
        }
        Ok(())
    }
}

async fn preview(
    app: &NativeMemoryApplication,
    registry: &WorkspaceRegistry,
    resource: &PresentationResource,
    selection: &str,
    request: PreviewRequest,
) -> Result<PreviewReply, DeploymentCommandError> {
    let capture = resource.reserve_review(app, registry, selection, &request)?;
    let result = async {
        request.validate_inputs()?;
        let store = app
            .open_preview_store(
                &resource.window,
                &resource.receipt,
                &capture.selection,
                &capture.receipt,
            )
            .await?;
        resource.check_review(app, selection, &capture, Phase::Opening)?;
        let read = app.start_preview(
            &resource.window,
            &resource.receipt,
            &capture.selection,
            &capture.receipt,
            request.values(store),
        )?;
        let prepared = read.finish().await?;
        resource.adopt_review(app, selection, &capture, prepared)
    }
    .await;
    match result {
        Ok(reply) => {
            resource.check_review(app, selection, &capture, Phase::Ready)?;
            Ok(reply)
        }
        Err(error) => {
            if !resource.cancel_review(app, selection, capture.revision, Some(&capture.token))? {
                return Err(cancelled().into());
            }
            Err(error)
        }
    }
}

async fn confirm(
    app: &NativeMemoryApplication,
    registry: &WorkspaceRegistry,
    resource: &PresentationResource,
    selection: &str,
    token: &str,
) -> Result<PublicationReply, DeploymentCommandError> {
    let (capture, job) = resource.begin_publication(app, registry, selection, token)?;
    let result = match job {
        Ok(job) => {
            let result = job.finish().await;
            resource.check_review(app, selection, &capture, Phase::Publishing)?;
            result
        }
        Err(error) => Err(error),
    };
    if !resource.cancel_review(app, selection, capture.revision, Some(&capture.token))? {
        return Err(cancelled().into());
    }
    Ok(result?.into())
}

#[tauri::command]
pub async fn project_memory_preview(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    registry: State<'_, WorkspaceRegistry>,
    handle: PresentationHandle,
    selection: String,
    request: PreviewRequest,
) -> Result<PreviewReply, DeploymentCommandError> {
    let resource = presentation(&window, &handle)?;
    preview(&app, &registry, &resource, &selection, request).await
}

#[tauri::command]
pub async fn project_memory_confirm_preview(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    registry: State<'_, WorkspaceRegistry>,
    handle: PresentationHandle,
    selection: String,
    review: String,
) -> Result<PublicationReply, DeploymentCommandError> {
    let resource = presentation(&window, &handle)?;
    confirm(&app, &registry, &resource, &selection, &review).await
}

#[tauri::command]
pub fn project_memory_cancel_preview(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    revision: u64,
) -> Result<bool, DeploymentCommandError> {
    presentation(&window, &handle)?.cancel_review(&app, &selection, revision, None)
}

#[cfg(all(test, target_os = "linux"))]
#[path = "commands_deployment_tests.rs"]
mod tests;

#[cfg(all(test, target_os = "linux"))]
#[path = "commands_ancestor_tests.rs"]
mod ancestor_tests;
