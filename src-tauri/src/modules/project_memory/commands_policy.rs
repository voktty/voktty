use super::*;
use voktty_memory_local::{MemoryPolicy, MemoryPolicyError, ProjectPreference, StoreError};

#[derive(Clone, Copy, Deserialize)]
#[serde(try_from = "String")]
enum PolicyChoice {
    Manual,
    Always,
    Never,
}
impl TryFrom<String> for PolicyChoice {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "manual" => Ok(Self::Manual),
            "always" => Ok(Self::Always),
            "never" => Ok(Self::Never),
            _ => Err("invalid project memory policy"),
        }
    }
}
impl From<PolicyChoice> for MemoryPolicy {
    fn from(choice: PolicyChoice) -> Self {
        match choice {
            PolicyChoice::Manual => Self::Manual,
            PolicyChoice::Always => Self::Always,
            PolicyChoice::Never => Self::Never,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyRequest {
    revision: u64,
    policy: PolicyChoice,
}

impl From<MemoryPolicyError> for MemoryCommandError {
    fn from(error: MemoryPolicyError) -> Self {
        match error {
            MemoryPolicyError::Changed
            | MemoryPolicyError::Worker(MemoryWorkError::Read(ReadError::Store(
                StoreError::Conflict,
            ))) => Self { code: "stale" },
            MemoryPolicyError::ScopeUnavailable => Self { code: "scope" },
            MemoryPolicyError::Worker(error) => error.into(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PolicyReply {
    schema: u8,
    review: String,
    revision: u64,
    #[serde(flatten)]
    snapshot: NativeMemoryPolicySnapshot,
}
#[derive(Debug, Serialize)]
pub struct PolicyAcceptedReply {
    schema: u8,
    preference: ProjectPreference,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Opening,
    Ready,
    Accepting,
}

#[derive(Clone)]
struct Capture {
    token: String,
    revision: u64,
    selected: NativeMemorySelectionReceipt,
    reservation: NativeMemoryPolicyReservation,
}
struct Review {
    capture: Capture,
    control: DiscoveryControl,
    phase: Phase,
    artifact: Option<NativeMemoryPolicyReview>,
}
impl Drop for Review {
    fn drop(&mut self) {
        self.capture.reservation.retire();
        self.control.cancel();
    }
}
#[derive(Default)]
pub(super) struct CommandPolicy {
    revision: u64,
    current: Option<Review>,
}

impl PresentationResource {
    fn policy_selected<'a>(
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
    fn reserve_policy_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        revision: u64,
    ) -> Result<Capture, MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.policy_selected(app, selection, &mut state)?;
        if revision == 0 || revision > 9_007_199_254_740_991 || revision <= selected.policy.revision
        {
            return Err(cancelled());
        }
        selected.policy.revision = revision;
        selected.policy.current = None;
        let control = DiscoveryControl::default();
        let reservation = app.reserve_policy(
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
        selected.policy.current = Some(Review {
            capture: capture.clone(),
            control,
            phase: Phase::Opening,
            artifact: None,
        });
        Ok(capture)
    }
    fn matching_policy<'a>(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &Capture,
        phase: Phase,
        state: &'a mut SelectionState,
    ) -> Result<&'a mut Review, MemoryCommandError> {
        self.policy_selected(app, selection, state)?
            .policy
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
    fn policy_control(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &Capture,
        phase: Phase,
    ) -> Result<DiscoveryControl, MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        Ok(self
            .matching_policy(app, selection, capture, phase, &mut state)?
            .control
            .clone())
    }
    fn adopt_policy(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        capture: &Capture,
        artifact: NativeMemoryPolicyReview,
    ) -> Result<PolicyReply, MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let review = self.matching_policy(app, selection, capture, Phase::Opening, &mut state)?;
        let snapshot = artifact.snapshot(&capture.reservation)?;
        review.artifact = Some(artifact);
        review.phase = Phase::Ready;
        Ok(PolicyReply {
            schema: 1,
            review: capture.token.clone(),
            revision: capture.revision,
            snapshot,
        })
    }
    fn cancel_policy_review(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        revision: u64,
        token: Option<&str>,
    ) -> Result<bool, MemoryCommandError> {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.policy_selected(app, selection, &mut state)?;
        if revision == 0 || revision > 9_007_199_254_740_991 {
            return Err(cancelled());
        }
        if token.is_none() && revision > selected.policy.revision {
            selected.policy.revision = revision;
            return Ok(selected.policy.current.take().is_some());
        }
        if !selected.policy.current.as_ref().is_some_and(|review| {
            review.capture.revision == revision
                && token.is_none_or(|token| token == review.capture.token)
        }) {
            return Ok(false);
        }
        selected.policy.current = None;
        Ok(true)
    }
    fn begin_policy_acceptance(
        &self,
        app: &NativeMemoryApplication,
        selection: &str,
        token: &str,
    ) -> Result<(Capture, Result<NativeMemoryPolicyWrite, MemoryPolicyError>), MemoryCommandError>
    {
        let mut state = self.selected.lock().map_err(|_| cancelled())?;
        let selected = self.policy_selected(app, selection, &mut state)?;
        let review = selected
            .policy
            .current
            .as_mut()
            .filter(|review| {
                token.len() == 36 && review.capture.token == token && review.phase == Phase::Ready
            })
            .ok_or_else(cancelled)?;
        let artifact = review.artifact.take().ok_or_else(cancelled)?;
        review.phase = Phase::Accepting;
        review.control = DiscoveryControl::default();
        let result = app.accept_policy(
            &self.window,
            &self.receipt,
            &review.capture.selected,
            artifact,
            review.control.clone(),
        );
        Ok((review.capture.clone(), result))
    }
}

async fn review(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    selection: &str,
    request: PolicyRequest,
) -> Result<PolicyReply, MemoryCommandError> {
    let capture = resource.reserve_policy_review(app, selection, request.revision)?;
    let choice = MemoryPolicy::from(request.policy);
    let result = async {
        let store = app
            .open_policy_store(
                &resource.window,
                &resource.receipt,
                &capture.selected,
                &capture.reservation,
            )
            .await;
        resource.policy_control(app, selection, &capture, Phase::Opening)?;
        let read = app.review_policy(
            &resource.window,
            &resource.receipt,
            &capture.selected,
            &capture.reservation,
            store?,
            choice,
        )?;
        let artifact = read.finish().await?;
        resource.adopt_policy(app, selection, &capture, artifact)
    }
    .await;
    match result {
        Ok(reply) => {
            resource.policy_control(app, selection, &capture, Phase::Ready)?;
            Ok(reply)
        }
        Err(error) => {
            if !resource.cancel_policy_review(
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

async fn confirm(
    app: &NativeMemoryApplication,
    resource: &PresentationResource,
    selection: &str,
    token: &str,
) -> Result<PolicyAcceptedReply, MemoryCommandError> {
    let (capture, job) = resource.begin_policy_acceptance(app, selection, token)?;
    let result = match job {
        Ok(job) => {
            let result = job.finish().await;
            resource.policy_control(app, selection, &capture, Phase::Accepting)?;
            result
        }
        Err(error) => Err(error),
    };
    if !resource.cancel_policy_review(app, selection, capture.revision, Some(&capture.token))? {
        return Err(cancelled());
    }
    Ok(PolicyAcceptedReply {
        schema: 1,
        preference: result?,
    })
}

#[tauri::command]
pub async fn project_memory_review_policy(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    request: PolicyRequest,
) -> Result<PolicyReply, MemoryCommandError> {
    let resource = presentation(&window, &handle)?;
    review(&app, &resource, &selection, request).await
}
#[tauri::command]
pub async fn project_memory_confirm_policy(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    review: String,
) -> Result<PolicyAcceptedReply, MemoryCommandError> {
    let resource = presentation(&window, &handle)?;
    confirm(&app, &resource, &selection, &review).await
}
#[tauri::command]
pub fn project_memory_cancel_policy(
    window: WebviewWindow,
    app: State<'_, NativeMemoryApplication>,
    handle: PresentationHandle,
    selection: String,
    revision: u64,
) -> Result<bool, MemoryCommandError> {
    presentation(&window, &handle)?.cancel_policy_review(&app, &selection, revision, None)
}

#[cfg(all(test, target_os = "linux"))]
#[path = "commands_policy_tests.rs"]
mod tests;
