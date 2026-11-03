use super::*;

#[cfg(all(test, target_os = "linux"))]
#[path = "commands_recovery_tests.rs"]
mod tests;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryRequest {
    revision: u64,
    destination: PathBuf,
    environment: WorkspaceEnv,
}

impl RecoveryRequest {
    fn validate(&self) -> Result<(), ReadError> {
        let path = self.destination.to_str().ok_or(ReadError::InvalidInput)?;
        if !self.destination.is_absolute() || path.contains('\0') {
            return Err(ReadError::InvalidInput);
        }
        if path.len() > 4096 || self.destination.components().count() > 128 {
            return Err(ReadError::Limit);
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryConfirmation {
    review: String,
    digest: String,
}

#[derive(Debug, Serialize)]
pub struct RestorationEntry {
    target: String,
    backup: String,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReviewReply {
    schema: u8,
    root: PathBuf,
    review: String,
    revision: u64,
    digest: String,
    entries: Vec<RestorationEntry>,
}

type RecoveryCapture = ReviewCapture<NativeMemoryRecoveryReceipt>;

impl PresentationResource {
    fn reserve_recovery_review(
        &self,
        app: &NativeMemoryApplication,
        registry: &WorkspaceRegistry,
        selection: &str,
        request: &RecoveryRequest,
    ) -> Result<RecoveryCapture, DeploymentCommandError> {
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
        let receipt = app.reserve_recovery(
            &self.window,
            &self.receipt,
            &selected.receipt,
            registry,
            NativeMemoryRecoveryTarget {
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
        selected.reviews.current = Some(DeploymentReview::Recovery(CommandReview {
            capture: capture.clone(),
            phase: Phase::Opening,
        }));
        Ok(capture)
    }

    fn matching_recovery<'a>(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &RecoveryCapture,
        phase: Phase,
        state: &'a mut SelectionState,
    ) -> Result<&'a mut CommandReview<NativeMemoryRecoveryReceipt>, DeploymentCommandError> {
        self.selected_review(app, selection, state)?
            .reviews
            .current
            .as_mut()
            .and_then(|review| match review {
                DeploymentReview::Recovery(review) => Some(review),
                _ => None,
            })
            .filter(|review| {
                review.capture.token == capture.token
                    && review.capture.revision == capture.revision
                    && review.phase == phase
            })
            .ok_or_else(|| cancelled().into())
    }

    fn check_recovery_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &RecoveryCapture,
        phase: Phase,
    ) -> Result<(), DeploymentCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        self.matching_recovery(app, selection, capture, phase, &mut state)?;
        if !app.is_recovery_current(
            &self.window,
            &self.receipt,
            &capture.selection,
            &capture.receipt,
        ) {
            return Err(cancelled().into());
        }
        Ok(())
    }

    fn adopt_recovery_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &RecoveryCapture,
        prepared: NativeMemoryPreparedRecovery,
    ) -> Result<RecoveryReviewReply, DeploymentCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let review = self.matching_recovery(app, selection, capture, Phase::Opening, &mut state)?;
        let receipt =
            app.accept_recovery(&self.window, &self.receipt, &capture.selection, prepared)?;
        let snapshot =
            app.recovery_snapshot(&self.window, &self.receipt, &capture.selection, &receipt)?;
        review.phase = Phase::Ready;
        Ok(RecoveryReviewReply {
            schema: 1,
            root: snapshot.root,
            review: capture.token.clone(),
            revision: capture.revision,
            digest: snapshot.digest,
            entries: snapshot
                .entries
                .into_iter()
                .map(|entry| RestorationEntry {
                    target: entry.target,
                    backup: entry.backup,
                    text: entry.text,
                })
                .collect(),
        })
    }

    fn begin_restoration(
        &self,
        app: &NativeMemoryApplication,
        registry: &WorkspaceRegistry,
        selection: &str,
        confirmation: RecoveryConfirmation,
    ) -> Result<
        (
            RecoveryCapture,
            Result<NativeMemoryRestoration, MemoryDeploymentWorkError>,
        ),
        DeploymentCommandError,
    > {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.selected_review(app, selection, &mut state)?;
        let review = selected
            .reviews
            .current
            .as_mut()
            .and_then(|review| match review {
                DeploymentReview::Recovery(review) => Some(review),
                _ => None,
            })
            .filter(|review| {
                confirmation.review.len() == 36
                    && review.capture.token == confirmation.review
                    && review.phase == Phase::Ready
            })
            .ok_or_else(cancelled)?;
        review.phase = Phase::Restoring;
        let capture = review.capture.clone();
        let result = app.confirm_recovery(
            &self.window,
            &self.receipt,
            &capture.selection,
            &capture.receipt,
            registry,
            NativeMemoryRecoveryConfirmation {
                digest: confirmation.digest,
                control: DiscoveryControl::default(),
            },
        );
        Ok((capture, result))
    }
}

async fn review_recovery(
    app: &NativeMemoryApplication,
    registry: &WorkspaceRegistry,
    resource: &PresentationResource,
    selection: &str,
    request: RecoveryRequest,
) -> Result<RecoveryReviewReply, DeploymentCommandError> {
    let capture = resource.reserve_recovery_review(app, registry, selection, &request)?;
    let result = async {
        request.validate()?;
        let store = app
            .open_recovery_store(
                &resource.window,
                &resource.receipt,
                &capture.selection,
                &capture.receipt,
            )
            .await?;
        resource.check_recovery_review(app, selection, &capture, Phase::Opening)?;
        let prepared = app
            .start_recovery(
                &resource.window,
                &resource.receipt,
                &capture.selection,
                &capture.receipt,
                store,
            )?
            .finish()
            .await?;
        resource.adopt_recovery_review(app, selection, &capture, prepared)
    }
    .await;
    match result {
        Ok(reply) => {
            resource.check_recovery_review(app, selection, &capture, Phase::Ready)?;
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

async fn confirm_recovery(
    app: &NativeMemoryApplication,
    registry: &WorkspaceRegistry,
    resource: &PresentationResource,
    selection: &str,
    confirmation: RecoveryConfirmation,
) -> Result<PublicationReply, DeploymentCommandError> {
    let (capture, job) = resource.begin_restoration(app, registry, selection, confirmation)?;
    let result = match job {
        Ok(job) => {
            let result = job.finish().await;
            resource.check_recovery_review(app, selection, &capture, Phase::Restoring)?;
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
pub async fn project_memory_review_recovery(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    registry: State<'_, WorkspaceRegistry>,
    handle: PresentationHandle,
    selection: String,
    request: RecoveryRequest,
) -> Result<RecoveryReviewReply, DeploymentCommandError> {
    let resource = presentation(&window, &handle)?;
    review_recovery(&app, &registry, &resource, &selection, request).await
}

#[tauri::command]
pub async fn project_memory_confirm_recovery(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    registry: State<'_, WorkspaceRegistry>,
    handle: PresentationHandle,
    selection: String,
    confirmation: RecoveryConfirmation,
) -> Result<PublicationReply, DeploymentCommandError> {
    let resource = presentation(&window, &handle)?;
    confirm_recovery(&app, &registry, &resource, &selection, confirmation).await
}

#[tauri::command]
pub fn project_memory_cancel_recovery(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    revision: u64,
) -> Result<bool, DeploymentCommandError> {
    presentation(&window, &handle)?.cancel_review(&app, &selection, revision, None)
}
