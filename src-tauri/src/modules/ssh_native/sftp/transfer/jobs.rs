//! Live transfer jobs and the surface the webview drives them through.

use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use super::super::super::registry::Registry;
use super::super::super::types::{SshErrorCode, SshNativeError};
use super::super::commands::SftpState;
use super::super::session::NativeSftp;
use super::engine::Cancel;
use super::job::{transition, JobEvent, JobState, JobSummary};
use super::plan::{ConflictPolicy, TransferStep};
use super::progress::TransferProgress;
use super::runner::{self, Interruption, TransferRequest};

/// A queue this long is a runaway caller, not a person moving files.
const MAX_JOBS: usize = 64;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum TransferEvent {
    Progress {
        job_id: String,
        progress: TransferProgress,
    },
    /// The run stopped before writing anything for this step.
    NeedsDecision {
        job_id: String,
        step: TransferStep,
    },
    Finished {
        job_id: String,
        skipped: u64,
    },
    Failed {
        job_id: String,
        code: SshErrorCode,
        message: String,
    },
    Cancelled {
        job_id: String,
    },
}

struct JobInner {
    state: JobState,
    steps: Vec<TransferStep>,
    next_index: usize,
    policy: ConflictPolicy,
    progress: Option<TransferProgress>,
    skipped: u64,
    error: Option<String>,
    pending: Option<TransferStep>,
}

pub struct TransferJob {
    id: String,
    request: TransferRequest,
    cancel: Cancel,
    inner: Mutex<JobInner>,
}

impl TransferJob {
    fn lock(&self) -> MutexGuard<'_, JobInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn summary(&self) -> JobSummary {
        let inner = self.lock();
        JobSummary {
            id: self.id.clone(),
            direction: self.request.direction,
            state: inner.state,
            source_root: self.request.source_root.clone(),
            destination_root: self.request.destination_root.clone(),
            policy: inner.policy,
            error: inner.error.clone(),
        }
    }

    pub fn progress(&self) -> Option<TransferProgress> {
        self.lock().progress
    }

    fn apply(&self, event: JobEvent) -> Result<JobState, SshNativeError> {
        let mut inner = self.lock();
        let next = transition(inner.state, event)?;
        inner.state = next;
        Ok(next)
    }
}

pub type TransferJobs = Registry<Arc<TransferJob>>;

pub fn new_state() -> TransferJobs {
    Registry::new("transfer", MAX_JOBS)
}

/// Plan the work, register the job and start it.
///
/// Planning happens before the job exists, so a request that cannot even be
/// walked fails immediately instead of leaving a job stuck at zero percent.
#[tauri::command]
pub async fn ssh_native_transfer_start(
    handles: State<'_, SftpState>,
    jobs: State<'_, TransferJobs>,
    handle: String,
    request: TransferRequest,
    on_event: Channel<TransferEvent>,
) -> Result<JobSummary, SshNativeError> {
    let sftp = handles.get(&handle)?;
    let planning = request.clone();
    let planner = Arc::clone(&sftp);
    let steps =
        super::super::super::run_detached(async move { runner::plan(&planner, &planning).await })
            .await?;

    let policy = request.policy;
    let job = jobs.insert_with(|id| {
        Arc::new(TransferJob {
            id: id.to_string(),
            request: request.clone(),
            cancel: Cancel::new(),
            inner: Mutex::new(JobInner {
                state: JobState::Queued,
                steps: steps.clone(),
                next_index: 0,
                policy,
                progress: None,
                skipped: 0,
                error: None,
                pending: None,
            }),
        })
    })?;

    let summary = job.summary();
    drive(job, sftp, on_event);
    Ok(summary)
}

/// Answer a conflict and carry on from the step it stopped at.
///
/// The chosen policy applies to the rest of the job, which is what a user
/// answering "overwrite" on a batch expects; the alternative is a prompt per
/// file with no way to say "all of them".
#[tauri::command]
pub async fn ssh_native_transfer_decide(
    handles: State<'_, SftpState>,
    jobs: State<'_, TransferJobs>,
    handle: String,
    job_id: String,
    policy: ConflictPolicy,
    on_event: Channel<TransferEvent>,
) -> Result<JobSummary, SshNativeError> {
    let job = jobs.get(&job_id)?;
    if policy == ConflictPolicy::Ask {
        return Err(SshNativeError::new(
            SshErrorCode::Config,
            "answering a conflict with Ask would stop again on the same file",
        ));
    }

    let sftp = handles.get(&handle)?;
    job.apply(JobEvent::Decide)?;
    {
        let mut inner = job.lock();
        inner.policy = policy;
        inner.pending = None;
    }

    let summary = job.summary();
    drive_from_running(job, sftp, on_event);
    Ok(summary)
}

#[tauri::command]
pub fn ssh_native_transfer_cancel(
    jobs: State<'_, TransferJobs>,
    job_id: String,
) -> Result<JobSummary, SshNativeError> {
    let job = jobs.get(&job_id)?;
    // Flagged before the state moves, so a run already inside a chunk sees it.
    job.cancel.cancel();
    job.apply(JobEvent::Cancel)?;
    Ok(job.summary())
}

#[tauri::command]
pub fn ssh_native_transfer_list(jobs: State<'_, TransferJobs>) -> Vec<JobSummary> {
    let mut summaries: Vec<JobSummary> = jobs.values().iter().map(|job| job.summary()).collect();
    summaries.sort_by(|a, b| a.id.cmp(&b.id));
    summaries
}

#[tauri::command]
pub fn ssh_native_transfer_progress(
    jobs: State<'_, TransferJobs>,
    job_id: String,
) -> Result<Option<TransferProgress>, SshNativeError> {
    Ok(jobs.get(&job_id)?.progress())
}

fn drive(job: Arc<TransferJob>, sftp: Arc<NativeSftp>, channel: Channel<TransferEvent>) {
    if job.apply(JobEvent::Start).is_err() {
        return;
    }
    drive_from_running(job, sftp, channel);
}

/// Runs on its own task: the transfer outlives the command that started it, and
/// the russh futures underneath carry bounds a command future cannot satisfy.
fn drive_from_running(
    job: Arc<TransferJob>,
    sftp: Arc<NativeSftp>,
    channel: Channel<TransferEvent>,
) {
    tokio::spawn(async move {
        let (steps, from) = {
            let inner = job.lock();
            (inner.steps.clone(), inner.next_index)
        };
        let request = TransferRequest {
            policy: job.lock().policy,
            ..job.request.clone()
        };

        let reporter = channel.clone();
        let job_id = job.id.clone();
        let mut on_progress = move |progress: TransferProgress| {
            let _ = reporter.send(TransferEvent::Progress {
                job_id: job_id.clone(),
                progress,
            });
        };

        let outcome =
            runner::execute(sftp, &request, &steps, from, &job.cancel, &mut on_progress).await;

        let event = match outcome {
            Ok(outcome) => finish(&job, outcome),
            Err(error) => fail(&job, error),
        };
        let _ = channel.send(event);
    });
}

fn finish(job: &Arc<TransferJob>, outcome: runner::TransferOutcome) -> TransferEvent {
    {
        let mut inner = job.lock();
        inner.progress = Some(outcome.progress);
        inner.skipped += outcome.skipped;
        inner.next_index = outcome.next_index;
    }

    match outcome.interruption {
        Some(Interruption::NeedsDecision { step }) => {
            let _ = job.apply(JobEvent::Ask);
            job.lock().pending = Some((*step).clone());
            TransferEvent::NeedsDecision {
                job_id: job.id.clone(),
                step: *step,
            }
        }
        None => {
            let _ = job.apply(JobEvent::Finish);
            TransferEvent::Finished {
                job_id: job.id.clone(),
                skipped: job.lock().skipped,
            }
        }
    }
}

fn fail(job: &Arc<TransferJob>, error: SshNativeError) -> TransferEvent {
    if error.code == SshErrorCode::Cancelled {
        let _ = job.apply(JobEvent::Cancel);
        return TransferEvent::Cancelled {
            job_id: job.id.clone(),
        };
    }
    let _ = job.apply(JobEvent::Fail);
    job.lock().error = Some(error.message.clone());
    TransferEvent::Failed {
        job_id: job.id.clone(),
        code: error.code,
        message: error.message,
    }
}

#[cfg(test)]
mod tests {
    use super::super::job::JobDirection;
    use super::*;

    fn job(state: JobState) -> Arc<TransferJob> {
        Arc::new(TransferJob {
            id: "transfer-1".into(),
            request: TransferRequest {
                direction: JobDirection::Upload,
                source_root: "/src".into(),
                destination_root: "/dst".into(),
                items: Vec::new(),
                policy: ConflictPolicy::Ask,
            },
            cancel: Cancel::new(),
            inner: Mutex::new(JobInner {
                state,
                steps: Vec::new(),
                next_index: 0,
                policy: ConflictPolicy::Ask,
                progress: None,
                skipped: 0,
                error: None,
                pending: None,
            }),
        })
    }

    #[test]
    fn a_summary_reports_the_roots_and_the_current_state() {
        let summary = job(JobState::Queued).summary();
        assert_eq!(summary.id, "transfer-1");
        assert_eq!(summary.state, JobState::Queued);
        assert_eq!(summary.source_root, "/src");
        assert_eq!(summary.destination_root, "/dst");
        assert_eq!(summary.direction, JobDirection::Upload);
        assert!(summary.error.is_none());
    }

    #[test]
    fn a_cancelled_run_reports_cancelled_rather_than_failed() {
        let job = job(JobState::Running);
        let event = fail(
            &job,
            SshNativeError::new(SshErrorCode::Cancelled, "stopped"),
        );
        assert_eq!(
            event,
            TransferEvent::Cancelled {
                job_id: "transfer-1".into()
            }
        );
        assert_eq!(job.summary().state, JobState::Cancelled);
        // A cancellation is not an error the panel should show in red.
        assert!(job.summary().error.is_none());
    }

    #[test]
    fn a_real_failure_keeps_its_code_and_message() {
        let job = job(JobState::Running);
        let event = fail(
            &job,
            SshNativeError::new(SshErrorCode::Unreachable, "link died"),
        );
        assert_eq!(
            event,
            TransferEvent::Failed {
                job_id: "transfer-1".into(),
                code: SshErrorCode::Unreachable,
                message: "link died".into(),
            }
        );
        assert_eq!(job.summary().state, JobState::Failed);
        assert_eq!(job.summary().error.as_deref(), Some("link died"));
    }

    #[test]
    fn a_conflict_parks_the_job_and_remembers_where_to_resume() {
        let job = job(JobState::Running);
        let step = TransferStep {
            source: "/src/a".into(),
            destination: "/dst/a".into(),
            size: 10,
            is_dir: false,
        };
        let event = finish(
            &job,
            runner::TransferOutcome {
                progress: super::super::progress::ProgressTracker::new(10, 1).snapshot(),
                skipped: 0,
                interruption: Some(Interruption::NeedsDecision {
                    step: Box::new(step.clone()),
                }),
                next_index: 3,
            },
        );

        assert_eq!(
            event,
            TransferEvent::NeedsDecision {
                job_id: "transfer-1".into(),
                step,
            }
        );
        assert_eq!(job.summary().state, JobState::AwaitingDecision);
        assert_eq!(job.lock().next_index, 3);
        assert!(job.lock().pending.is_some());
    }

    #[test]
    fn a_completed_run_reports_what_it_skipped() {
        let job = job(JobState::Running);
        let event = finish(
            &job,
            runner::TransferOutcome {
                progress: super::super::progress::ProgressTracker::new(10, 2).snapshot(),
                skipped: 2,
                interruption: None,
                next_index: 4,
            },
        );
        assert_eq!(
            event,
            TransferEvent::Finished {
                job_id: "transfer-1".into(),
                skipped: 2,
            }
        );
        assert_eq!(job.summary().state, JobState::Completed);
    }

    #[test]
    fn cancelling_flags_the_token_so_a_running_chunk_sees_it() {
        let job = job(JobState::Running);
        assert!(!job.cancel.is_cancelled());
        job.cancel.cancel();
        job.apply(JobEvent::Cancel).expect("cancel");
        assert!(job.cancel.is_cancelled());
        assert_eq!(job.summary().state, JobState::Cancelled);
    }

    #[test]
    fn the_job_registry_is_bounded_and_prefixed() {
        let jobs: Registry<String> = Registry::new("transfer", 2);
        let id = jobs.insert("a".into()).expect("first");
        assert!(id.starts_with("transfer-"));
        jobs.insert("b".into()).expect("second");
        assert!(jobs.insert("c".into()).is_err());
    }
}
