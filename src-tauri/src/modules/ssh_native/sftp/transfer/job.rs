//! The lifecycle of one transfer job.
//!
//! Pure state machine: every transition the panel can trigger is decided here,
//! so an illegal one is a compile-time-shaped error rather than a surprise in
//! the middle of a copy.

use serde::Serialize;

use super::super::super::types::{SshErrorCode, SshNativeError};
use super::plan::ConflictPolicy;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Queued,
    Running,
    Paused,
    /// A conflict came up under the `Ask` policy. Nothing is written until the
    /// user answers, so this is a stop, not a slow path.
    AwaitingDecision,
    Completed,
    Failed,
    Cancelled,
}

impl JobState {
    /// A terminal state never transitions again. Cancelling something already
    /// finished is a no-op, not an error the UI has to handle.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    pub fn is_active(self) -> bool {
        matches!(self, Self::Running | Self::AwaitingDecision)
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobEvent {
    Start,
    Pause,
    Resume,
    /// A conflict needs the user.
    Ask,
    /// The user answered; the job carries on.
    Decide,
    Finish,
    Fail,
    Cancel,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobDirection {
    Upload,
    Download,
}

/// Apply `event` to `state`.
///
/// Cancelling is accepted from any live state, because the user asking to stop
/// must never be refused. Everything else has to follow the order of work.
pub fn transition(state: JobState, event: JobEvent) -> Result<JobState, SshNativeError> {
    use JobEvent as E;
    use JobState as S;

    // Reaching a terminal state again changes nothing and is not worth an error.
    if state.is_terminal() {
        return Ok(state);
    }
    if event == E::Cancel {
        return Ok(S::Cancelled);
    }

    let next = match (state, event) {
        (S::Queued, E::Start) => S::Running,
        (S::Running, E::Pause) => S::Paused,
        (S::Paused, E::Resume) => S::Running,
        (S::Running, E::Ask) => S::AwaitingDecision,
        (S::AwaitingDecision, E::Decide) => S::Running,
        (S::Running, E::Finish) => S::Completed,
        (S::Running | S::Paused | S::AwaitingDecision, E::Fail) => S::Failed,
        _ => return Err(refused(state, event)),
    };
    Ok(next)
}

fn refused(state: JobState, event: JobEvent) -> SshNativeError {
    SshNativeError::new(
        SshErrorCode::Config,
        format!("a {state:?} transfer cannot handle {event:?}"),
    )
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub id: String,
    pub direction: JobDirection,
    pub state: JobState,
    pub source_root: String,
    pub destination_root: String,
    pub policy: ConflictPolicy,
    /// Set only once the job leaves the happy path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::JobEvent as E;
    use super::JobState as S;
    use super::*;

    const LIVE: [JobState; 4] = [S::Queued, S::Running, S::Paused, S::AwaitingDecision];
    const TERMINAL: [JobState; 3] = [S::Completed, S::Failed, S::Cancelled];

    #[test]
    fn a_job_runs_through_the_happy_path() {
        let state = transition(S::Queued, E::Start).expect("start");
        assert_eq!(state, S::Running);
        assert_eq!(transition(state, E::Finish).expect("finish"), S::Completed);
    }

    #[test]
    fn pausing_and_resuming_returns_to_running() {
        let paused = transition(S::Running, E::Pause).expect("pause");
        assert_eq!(paused, S::Paused);
        assert_eq!(transition(paused, E::Resume).expect("resume"), S::Running);
    }

    #[test]
    fn a_conflict_stops_the_job_until_the_user_answers() {
        let asking = transition(S::Running, E::Ask).expect("ask");
        assert_eq!(asking, S::AwaitingDecision);
        assert!(!asking.is_terminal());
        assert_eq!(transition(asking, E::Decide).expect("decide"), S::Running);
    }

    #[test]
    fn cancelling_is_accepted_from_every_live_state() {
        for state in LIVE {
            assert_eq!(
                transition(state, E::Cancel).expect("cancel is never refused"),
                S::Cancelled
            );
        }
    }

    #[test]
    fn a_terminal_state_absorbs_anything_without_erroring() {
        for state in TERMINAL {
            for event in [E::Start, E::Pause, E::Resume, E::Finish, E::Fail, E::Cancel] {
                assert_eq!(transition(state, event).expect("no error"), state);
            }
        }
    }

    #[test]
    fn failure_is_reachable_from_any_state_that_was_doing_work() {
        for state in [S::Running, S::Paused, S::AwaitingDecision] {
            assert_eq!(transition(state, E::Fail).expect("fail"), S::Failed);
        }
    }

    #[test]
    fn a_queued_job_cannot_finish_without_running() {
        let error = transition(S::Queued, E::Finish).expect_err("refused");
        assert_eq!(error.code, SshErrorCode::Config);
        assert!(error.message.contains("Queued"));
        assert!(error.message.contains("Finish"));
    }

    #[test]
    fn a_paused_job_cannot_be_paused_again_or_started_from_scratch() {
        assert!(transition(S::Paused, E::Pause).is_err());
        assert!(transition(S::Paused, E::Start).is_err());
    }

    #[test]
    fn a_job_waiting_on_the_user_cannot_be_resumed_as_if_it_were_paused() {
        // Resuming would carry on without an answer and write the very file the
        // user was asked about.
        assert!(transition(S::AwaitingDecision, E::Resume).is_err());
    }

    #[test]
    fn only_running_and_awaiting_count_as_active() {
        assert!(S::Running.is_active());
        assert!(S::AwaitingDecision.is_active());
        for state in [S::Queued, S::Paused, S::Completed, S::Failed, S::Cancelled] {
            assert!(!state.is_active());
        }
    }
}
