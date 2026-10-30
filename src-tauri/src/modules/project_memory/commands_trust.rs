use super::*;
use voktty_memory_local::{MemoryTrustError, ProjectPreference, StoreError};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustRequest {
    revision: u64,
    role: Option<String>,
}

impl From<MemoryTrustError> for MemoryCommandError {
    fn from(error: MemoryTrustError) -> Self {
        match error {
            MemoryTrustError::Changed
            | MemoryTrustError::Worker(MemoryWorkError::Read(ReadError::Store(
                StoreError::Conflict,
            ))) => Self { code: "stale" },
            MemoryTrustError::ScopeUnavailable => Self { code: "scope" },
            MemoryTrustError::Worker(error) => error.into(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TrustReply {
    schema: u8,
    review: String,
    revision: u64,
    #[serde(flatten)]
    snapshot: NativeMemoryTrustSnapshot,
}

#[derive(Debug, Serialize)]
pub struct TrustAcceptedReply {
    schema: u8,
    preference: ProjectPreference,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Opening,
    Ready,
    Accepting,
    BindingContext,
}

#[derive(Clone)]
struct Capture {
    token: String,
    revision: u64,
    selected: NativeMemorySelectionReceipt,
    reservation: NativeMemoryTrustReservation,
}
struct Review {
    capture: Capture,
    control: DiscoveryControl,
    phase: Phase,
    artifact: Option<NativeMemoryTrustReview>,
}
impl Drop for Review {
    fn drop(&mut self) {
        self.capture.reservation.retire();
        self.control.cancel();
    }
}
#[derive(Default)]
pub(super) struct CommandTrust {
    revision: u64,
    current: Option<Review>,
}

impl PresentationResource {
    fn begin_context_binding(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        token: &str,
        context: &super::context::ContextResource,
        mode: voktty_memory_local::MemorySessionUse,
    ) -> Result<
        (
            Capture,
            Result<NativeMemoryContextBinding, MemoryTrustError>,
        ),
        MemoryCommandError,
    > {
        context.check(app, &self.window)?;
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.trust_selected(app, selection, &mut state)?;
        let review = selected
            .trust
            .current
            .as_mut()
            .filter(|review| {
                token.len() == 36 && review.capture.token == token && review.phase == Phase::Ready
            })
            .ok_or_else(cancelled)?;
        let artifact = review.artifact.take().ok_or_else(cancelled)?;
        review.phase = Phase::BindingContext;
        review.control = DiscoveryControl::default();
        let result = app.bind_context_session(
            &self.window,
            NativeMemoryContextTarget {
                context: &context.receipt,
                presentation: &self.receipt,
                selected: &review.capture.selected,
            },
            artifact,
            mode,
            review.control.clone(),
        );
        Ok((review.capture.clone(), result))
    }

    fn promote_command_context(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &Capture,
        context: &super::context::ContextResource,
        prepared: NativeMemoryPreparedContext,
    ) -> Result<(), MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        self.matching_trust(app, selection, capture, Phase::BindingContext, &mut state)?;
        context.check(app, &self.window)?;
        app.promote_context(
            &self.window,
            NativeMemoryContextTarget {
                context: &context.receipt,
                presentation: &self.receipt,
                selected: &capture.selected,
            },
            prepared,
        )?;
        state.selected = None;
        if !self.live.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        context.check(app, &self.window)
    }

    fn trust_selected<'a>(
        &self,
        app: &NativeMemoryApplication,
        token: &str,
        state: &'a mut SelectionState,
    ) -> Result<&'a mut Selected, MemoryCommandError> {
        if token.len() != 36 || !self.live.load(Ordering::Acquire) {
            return Err(cancelled());
        }
        let selected = state
            .selected
            .as_mut()
            .filter(|selected| selected.token == token)
            .ok_or_else(cancelled)?;
        if !app.is_current(&self.window, &self.receipt, &selected.receipt) {
            return Err(cancelled());
        }
        Ok(selected)
    }

    fn reserve_trust_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        revision: u64,
    ) -> Result<Capture, MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.trust_selected(app, selection, &mut state)?;
        if revision == 0 || revision > 9_007_199_254_740_991 || revision <= selected.trust.revision
        {
            return Err(cancelled());
        }
        selected.trust.revision = revision;
        selected.trust.current = None;
        let control = DiscoveryControl::default();
        let reservation = app.reserve_trust(
            &self.window,
            &self.receipt,
            &selected.receipt,
            control.clone(),
        )?;
        let capture = Capture {
            token: uuid::Uuid::new_v4().to_string(),
            revision,
            selected: selected.receipt.clone(),
            reservation,
        };
        selected.trust.current = Some(Review {
            capture: capture.clone(),
            control,
            phase: Phase::Opening,
            artifact: None,
        });
        Ok(capture)
    }

    fn matching_trust<'a>(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &Capture,
        phase: Phase,
        state: &'a mut SelectionState,
    ) -> Result<&'a mut Review, MemoryCommandError> {
        self.trust_selected(app, selection, state)?
            .trust
            .current
            .as_mut()
            .filter(|review| {
                review.capture.token == capture.token
                    && review.capture.revision == capture.revision
                    && review.phase == phase
                    && capture.reservation.is_live()
            })
            .ok_or_else(cancelled)
    }

    fn trust_control(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &Capture,
        phase: Phase,
    ) -> Result<DiscoveryControl, MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        Ok(self
            .matching_trust(app, selection, capture, phase, &mut state)?
            .control
            .clone())
    }

    fn adopt_trust(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &Capture,
        artifact: NativeMemoryTrustReview,
    ) -> Result<TrustReply, MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let review = self.matching_trust(app, selection, capture, Phase::Opening, &mut state)?;
        let snapshot = artifact.snapshot(&capture.reservation)?;
        review.artifact = Some(artifact);
        review.phase = Phase::Ready;
        Ok(TrustReply {
            schema: 1,
            review: capture.token.clone(),
            revision: capture.revision,
            snapshot,
        })
    }

    fn cancel_trust_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        revision: u64,
        token: Option<&str>,
    ) -> Result<bool, MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.trust_selected(app, selection, &mut state)?;
        if revision == 0 || revision > 9_007_199_254_740_991 {
            return Err(cancelled());
        }
        if token.is_none() && revision > selected.trust.revision {
            selected.trust.revision = revision;
            return Ok(selected.trust.current.take().is_some());
        }
        if !selected.trust.current.as_ref().is_some_and(|review| {
            review.capture.revision == revision
                && token.is_none_or(|token| token == review.capture.token)
        }) {
            return Ok(false);
        }
        selected.trust.current = None;
        Ok(true)
    }

    fn begin_trust_acceptance(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        token: &str,
    ) -> Result<(Capture, Result<NativeMemoryTrustWrite, MemoryTrustError>), MemoryCommandError>
    {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.trust_selected(app, selection, &mut state)?;
        let review = selected
            .trust
            .current
            .as_mut()
            .filter(|review| {
                token.len() == 36 && review.capture.token == token && review.phase == Phase::Ready
            })
            .ok_or_else(cancelled)?;
        let artifact = review.artifact.take().ok_or_else(cancelled)?;
        review.phase = Phase::Accepting;
        review.control = DiscoveryControl::default();
        let result = app.accept_trust(
            &self.window,
            &self.receipt,
            &review.capture.selected,
            artifact,
            review.control.clone(),
        );
        Ok((review.capture.clone(), result))
    }
}

pub(super) async fn review(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    selection: &str,
    request: TrustRequest,
) -> Result<TrustReply, MemoryCommandError> {
    let capture = resource.reserve_trust_review(app, selection, request.revision)?;
    let result = async {
        if request.role.as_ref().is_some_and(|role| role.len() > 256) {
            return Err(MemoryWorkError::Read(ReadError::Limit).into());
        }
        let control = resource.trust_control(app, selection, &capture, Phase::Opening)?;
        let store = app
            .store(
                &resource.window,
                MemoryStoreMode::OpenExisting,
                control.read_control().map_err(MemoryTrustError::from)?,
            )
            .await;
        resource.trust_control(app, selection, &capture, Phase::Opening)?;
        let read = app.review_trust(
            &resource.window,
            &resource.receipt,
            &capture.selected,
            &capture.reservation,
            store?,
            request.role,
        )?;
        let artifact = read.finish().await?;
        resource.adopt_trust(app, selection, &capture, artifact)
    }
    .await;
    match result {
        Ok(reply) => {
            resource.trust_control(app, selection, &capture, Phase::Ready)?;
            Ok(reply)
        }
        Err(error) => {
            if !resource.cancel_trust_review(
                app,
                selection,
                capture.revision,
                Some(&capture.token),
            )? {
                return Err(cancelled());
            }
            Err(error)
        }
    }
}

pub(super) async fn confirm(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    selection: &str,
    token: &str,
) -> Result<TrustAcceptedReply, MemoryCommandError> {
    let (capture, job) = resource.begin_trust_acceptance(app, selection, token)?;
    let result = match job {
        Ok(job) => {
            let result = job.finish().await;
            resource.trust_control(app, selection, &capture, Phase::Accepting)?;
            result
        }
        Err(error) => Err(error),
    };
    if !resource.cancel_trust_review(app, selection, capture.revision, Some(&capture.token))? {
        return Err(cancelled());
    }
    Ok(TrustAcceptedReply {
        schema: 1,
        preference: result?,
    })
}

pub(super) async fn bind_context(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    selection: &str,
    token: &str,
    context: &super::context::ContextResource,
    mode: voktty_memory_local::MemorySessionUse,
) -> Result<(), MemoryCommandError> {
    let (capture, job) = resource.begin_context_binding(app, selection, token, context, mode)?;
    let result = async {
        let prepared = job?.finish().await?;
        resource.promote_command_context(app, selection, &capture, context, prepared)
    }
    .await;
    if let Err(error) = result {
        if !resource.cancel_trust_review(app, selection, capture.revision, Some(&capture.token))? {
            return Err(cancelled());
        }
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn project_memory_review_trust(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    request: TrustRequest,
) -> Result<TrustReply, MemoryCommandError> {
    let resource = presentation(&window, &handle)?;
    review(&app, &resource, &selection, request).await
}

#[tauri::command]
pub async fn project_memory_confirm_trust(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    review: String,
) -> Result<TrustAcceptedReply, MemoryCommandError> {
    let resource = presentation(&window, &handle)?;
    confirm(&app, &resource, &selection, &review).await
}

#[tauri::command]
pub fn project_memory_cancel_trust(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    revision: u64,
) -> Result<bool, MemoryCommandError> {
    presentation(&window, &handle)?.cancel_trust_review(&app, &selection, revision, None)
}

#[cfg(all(test, target_os = "linux"))]
#[path = "commands_trust_tests.rs"]
mod tests;
