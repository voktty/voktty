use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use voktty_collab_protocol::{
    DataFrame, Participant, ParticipantRole, ServerControl, MAX_CLIENT_NONCE_BYTES,
    MAX_PARTICIPANTS, MAX_PARTICIPANT_NAME_BYTES, MAX_PTY_DATA_BYTES, MAX_SNAPSHOT_DATA_BYTES,
    MIN_CLIENT_NONCE_BYTES, PROTOCOL_VERSION,
};

use super::auth::{generate_public_id, AuthError, SessionAuthenticator};
use super::crypto::{CryptoError, TransportCipher};

const MAX_REPLAY_BYTES: usize = 512 * 1024;
const MAX_REPLAY_FRAMES: usize = 64;
const SNAPSHOT_REFRESH_REPLAY_BYTES: usize = MAX_REPLAY_BYTES * 3 / 4;
const SNAPSHOT_REFRESH_REPLAY_FRAMES: usize = MAX_REPLAY_FRAMES * 3 / 4;
const TYPING_PRESENCE_TTL: Duration = Duration::from_millis(1_400);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum OutboundMessage {
    Control(ServerControl),
    Data(DataFrame),
}

pub(super) struct JoinRequest<'a> {
    pub participant_name: &'a str,
    pub client_nonce: &'a str,
    pub proof: &'a str,
    pub resume_after: Option<u64>,
}

#[derive(Debug)]
pub(super) struct JoinAccepted {
    pub participant: Participant,
    pub replay: Vec<DataFrame>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SessionError {
    Authentication,
    Authorization,
    Closed,
    Expired,
    InvalidParticipant,
    InvalidSequence,
    MessageTooLarge,
    ParticipantLimit,
    Replay,
    ReplayUnavailable,
    Banned,
    UnknownParticipant,
}

struct ParticipantRecord {
    participant: Participant,
    outbound: SyncSender<OutboundMessage>,
    last_input_sequence: u64,
    last_input_at: Option<Instant>,
}

struct SessionInner {
    closed: bool,
    cols: u16,
    rows: u16,
    participants: HashMap<String, ParticipantRecord>,
    used_nonces: HashSet<String>,
    banned_participant_names: HashSet<String>,
    controller_id: Option<String>,
    next_sequence: u64,
    snapshot: Option<DataFrame>,
    replay: VecDeque<DataFrame>,
    replay_bytes: usize,
}

pub(super) struct HostedSession {
    pub session_id: String,
    pub pty_id: u32,
    authenticator: SessionAuthenticator,
    expires_at: Instant,
    inner: Mutex<SessionInner>,
}

impl HostedSession {
    pub fn new(
        session_id: String,
        pty_id: u32,
        cols: u16,
        rows: u16,
        authenticator: SessionAuthenticator,
        expires_at: Instant,
    ) -> Self {
        Self {
            session_id,
            pty_id,
            authenticator,
            expires_at,
            inner: Mutex::new(SessionInner {
                closed: false,
                cols,
                rows,
                participants: HashMap::new(),
                used_nonces: HashSet::new(),
                banned_participant_names: HashSet::new(),
                controller_id: None,
                next_sequence: 0,
                snapshot: None,
                replay: VecDeque::new(),
                replay_bytes: 0,
            }),
        }
    }

    pub fn dimensions(&self) -> (u16, u16) {
        let inner = self.inner.lock().unwrap();
        (inner.cols, inner.rows)
    }

    pub fn join(
        &self,
        request: JoinRequest<'_>,
        outbound: SyncSender<OutboundMessage>,
    ) -> Result<JoinAccepted, SessionError> {
        let participant_name = request.participant_name.trim();
        if participant_name.is_empty()
            || participant_name.len() > MAX_PARTICIPANT_NAME_BYTES
            || participant_name.chars().any(char::is_control)
            || request.client_nonce.len() < MIN_CLIENT_NONCE_BYTES
            || request.client_nonce.len() > MAX_CLIENT_NONCE_BYTES
            || request.client_nonce.chars().any(char::is_control)
        {
            return Err(SessionError::InvalidParticipant);
        }
        self.authenticator.verify_join(
            &self.session_id,
            participant_name,
            request.client_nonce,
            request.resume_after,
            request.proof,
        )?;

        let participant_id = generate_public_id()?;
        let participant = Participant {
            id: participant_id.clone(),
            name: participant_name.to_string(),
            role: ParticipantRole::Observer,
            control_requested: false,
            typing: false,
        };
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        if Instant::now() >= self.expires_at {
            return Err(SessionError::Expired);
        }
        if inner
            .banned_participant_names
            .contains(&participant_name.to_lowercase())
        {
            return Err(SessionError::Banned);
        }
        if inner.used_nonces.contains(request.client_nonce) {
            return Err(SessionError::Replay);
        }
        if inner.participants.len() + 1 >= MAX_PARTICIPANTS {
            return Err(SessionError::ParticipantLimit);
        }
        let replay = replay_for_join(&inner, request.resume_after)?;

        let joined_notice = OutboundMessage::Control(ServerControl::ParticipantJoined {
            protocol: PROTOCOL_VERSION,
            participant: participant.clone(),
        });
        broadcast(&mut inner, joined_notice);
        inner.used_nonces.insert(request.client_nonce.to_string());
        inner.participants.insert(
            participant_id,
            ParticipantRecord {
                participant: participant.clone(),
                outbound,
                last_input_sequence: 0,
                last_input_at: None,
            },
        );

        Ok(JoinAccepted {
            participant,
            replay,
        })
    }

    pub fn transport_cipher(&self, client_nonce: &str) -> Result<TransportCipher, CryptoError> {
        TransportCipher::for_host(
            self.authenticator.key_material(),
            &self.session_id,
            client_nonce,
        )
    }

    pub fn set_controller(&self, participant_id: &str) -> Result<(), SessionError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        if !inner.participants.contains_key(participant_id) {
            return Err(SessionError::UnknownParticipant);
        }

        let previous = inner.controller_id.replace(participant_id.to_string());
        if let Some(previous_id) = previous.filter(|id| id != participant_id) {
            if let Some(record) = inner.participants.get_mut(&previous_id) {
                record.participant.role = ParticipantRole::Observer;
                record.participant.control_requested = false;
                record.last_input_at = None;
            }
            broadcast(
                &mut inner,
                OutboundMessage::Control(ServerControl::RoleChanged {
                    protocol: PROTOCOL_VERSION,
                    participant_id: previous_id,
                    role: ParticipantRole::Observer,
                }),
            );
        }
        if let Some(record) = inner.participants.get_mut(participant_id) {
            record.participant.role = ParticipantRole::Controller;
            record.participant.control_requested = false;
        }
        broadcast(
            &mut inner,
            OutboundMessage::Control(ServerControl::RoleChanged {
                protocol: PROTOCOL_VERSION,
                participant_id: participant_id.to_string(),
                role: ParticipantRole::Controller,
            }),
        );
        Ok(())
    }

    #[allow(dead_code)]
    pub fn participant_role(&self, participant_id: &str) -> Option<ParticipantRole> {
        self.inner
            .lock()
            .unwrap()
            .participants
            .get(participant_id)
            .map(|record| record.participant.role)
    }

    pub fn participants(&self) -> Vec<Participant> {
        let mut participants: Vec<Participant> = self
            .inner
            .lock()
            .unwrap()
            .participants
            .values()
            .map(|record| {
                let mut participant = record.participant.clone();
                participant.typing = record
                    .last_input_at
                    .is_some_and(|last_input| last_input.elapsed() < TYPING_PRESENCE_TTL);
                participant
            })
            .collect();
        participants.sort_by(|left, right| left.id.cmp(&right.id));
        participants
    }

    pub fn request_control(&self, participant_id: &str) -> Result<(), SessionError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        let record = inner
            .participants
            .get_mut(participant_id)
            .ok_or(SessionError::UnknownParticipant)?;
        record.participant.control_requested = true;
        broadcast(
            &mut inner,
            OutboundMessage::Control(ServerControl::ControlRequested {
                protocol: PROTOCOL_VERSION,
                participant_id: participant_id.to_string(),
            }),
        );
        Ok(())
    }

    pub fn release_control(&self, participant_id: &str) -> Result<(), SessionError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        if inner.controller_id.as_deref() != Some(participant_id) {
            return Err(SessionError::Authorization);
        }
        let record = inner
            .participants
            .get_mut(participant_id)
            .ok_or(SessionError::UnknownParticipant)?;
        record.participant.role = ParticipantRole::Observer;
        record.participant.control_requested = false;
        record.last_input_at = None;
        inner.controller_id = None;
        broadcast(
            &mut inner,
            OutboundMessage::Control(ServerControl::RoleChanged {
                protocol: PROTOCOL_VERSION,
                participant_id: participant_id.to_string(),
                role: ParticipantRole::Observer,
            }),
        );
        Ok(())
    }

    pub fn set_observer(&self, participant_id: &str) -> Result<(), SessionError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        let record = inner
            .participants
            .get_mut(participant_id)
            .ok_or(SessionError::UnknownParticipant)?;
        record.participant.role = ParticipantRole::Observer;
        record.participant.control_requested = false;
        record.last_input_at = None;
        if inner.controller_id.as_deref() == Some(participant_id) {
            inner.controller_id = None;
        }
        broadcast(
            &mut inner,
            OutboundMessage::Control(ServerControl::RoleChanged {
                protocol: PROTOCOL_VERSION,
                participant_id: participant_id.to_string(),
                role: ParticipantRole::Observer,
            }),
        );
        Ok(())
    }

    pub fn remove_participant(&self, participant_id: &str) -> Result<(), SessionError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        let record = inner
            .participants
            .remove(participant_id)
            .ok_or(SessionError::UnknownParticipant)?;
        if inner.controller_id.as_deref() == Some(participant_id) {
            inner.controller_id = None;
        }
        let _ = record
            .outbound
            .try_send(OutboundMessage::Control(ServerControl::Closed {
                protocol: PROTOCOL_VERSION,
                reason: "removed_by_host".to_string(),
            }));
        broadcast(
            &mut inner,
            OutboundMessage::Control(ServerControl::ParticipantLeft {
                protocol: PROTOCOL_VERSION,
                participant_id: participant_id.to_string(),
            }),
        );
        Ok(())
    }

    pub fn ban_participant(&self, participant_id: &str) -> Result<(), SessionError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        let record = inner
            .participants
            .remove(participant_id)
            .ok_or(SessionError::UnknownParticipant)?;
        inner
            .banned_participant_names
            .insert(record.participant.name.to_lowercase());
        if inner.controller_id.as_deref() == Some(participant_id) {
            inner.controller_id = None;
        }
        let _ = record
            .outbound
            .try_send(OutboundMessage::Control(ServerControl::Closed {
                protocol: PROTOCOL_VERSION,
                reason: "banned_by_host".to_string(),
            }));
        broadcast(
            &mut inner,
            OutboundMessage::Control(ServerControl::ParticipantLeft {
                protocol: PROTOCOL_VERSION,
                participant_id: participant_id.to_string(),
            }),
        );
        Ok(())
    }

    pub fn authorize_input(
        &self,
        participant_id: &str,
        sequence: u64,
        has_input: bool,
    ) -> Result<u32, SessionError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        let record = inner
            .participants
            .get_mut(participant_id)
            .ok_or(SessionError::UnknownParticipant)?;
        if !record.participant.role.can_write() {
            return Err(SessionError::Authorization);
        }
        if sequence != record.last_input_sequence.saturating_add(1) {
            return Err(SessionError::InvalidSequence);
        }
        record.last_input_sequence = sequence;
        if has_input {
            record.last_input_at = Some(Instant::now());
        }
        Ok(self.pty_id)
    }

    pub fn leave(&self, participant_id: &str) {
        let mut inner = self.inner.lock().unwrap();
        if inner.participants.remove(participant_id).is_none() {
            return;
        }
        if inner.controller_id.as_deref() == Some(participant_id) {
            inner.controller_id = None;
        }
        if !inner.closed {
            broadcast(
                &mut inner,
                OutboundMessage::Control(ServerControl::ParticipantLeft {
                    protocol: PROTOCOL_VERSION,
                    participant_id: participant_id.to_string(),
                }),
            );
        }
    }

    pub fn publish_output(&self, data: &[u8]) -> Result<u64, SessionError> {
        if data.len() > MAX_PTY_DATA_BYTES {
            return Err(SessionError::MessageTooLarge);
        }
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        inner.next_sequence = inner.next_sequence.saturating_add(1);
        let sequence = inner.next_sequence;
        let frame = DataFrame::PtyOutput {
            sequence,
            data: data.to_vec(),
        };
        inner.replay_bytes += data.len();
        inner.replay.push_back(frame.clone());
        while inner.replay.len() > MAX_REPLAY_FRAMES || inner.replay_bytes > MAX_REPLAY_BYTES {
            if let Some(removed) = inner.replay.pop_front() {
                inner.replay_bytes = inner
                    .replay_bytes
                    .saturating_sub(data_frame_payload_len(&removed));
            }
        }
        broadcast(&mut inner, OutboundMessage::Data(frame));
        Ok(sequence)
    }

    pub fn publish_resize(&self, cols: u16, rows: u16) -> Result<u64, SessionError> {
        if cols == 0 || rows == 0 {
            return Err(SessionError::MessageTooLarge);
        }
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        if inner.cols == cols && inner.rows == rows {
            return Ok(inner.next_sequence);
        }
        inner.cols = cols;
        inner.rows = rows;
        inner.next_sequence = inner.next_sequence.saturating_add(1);
        let sequence = inner.next_sequence;
        let frame = DataFrame::TerminalResize {
            sequence,
            cols,
            rows,
        };
        inner.replay.push_back(frame.clone());
        while inner.replay.len() > MAX_REPLAY_FRAMES || inner.replay_bytes > MAX_REPLAY_BYTES {
            if let Some(removed) = inner.replay.pop_front() {
                inner.replay_bytes = inner
                    .replay_bytes
                    .saturating_sub(data_frame_payload_len(&removed));
            }
        }
        broadcast(&mut inner, OutboundMessage::Data(frame));
        Ok(sequence)
    }

    pub fn output_sequence(&self) -> Result<u64, SessionError> {
        let inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        Ok(inner.next_sequence)
    }

    pub fn snapshot_required(&self) -> Result<bool, SessionError> {
        let inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        Ok(replay_for_join(&inner, None).is_err()
            || inner.replay.len() >= SNAPSHOT_REFRESH_REPLAY_FRAMES
            || inner.replay_bytes >= SNAPSHOT_REFRESH_REPLAY_BYTES)
    }

    pub fn set_snapshot(
        &self,
        sequence: u64,
        cols: u16,
        rows: u16,
        data: &[u8],
    ) -> Result<(), SessionError> {
        if cols == 0 || rows == 0 || data.len() > MAX_SNAPSHOT_DATA_BYTES {
            return Err(SessionError::MessageTooLarge);
        }
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        let previous_sequence = inner
            .snapshot
            .as_ref()
            .map(data_frame_sequence)
            .unwrap_or(0);
        if sequence > inner.next_sequence || sequence < previous_sequence {
            return Err(SessionError::InvalidSequence);
        }
        if sequence == inner.next_sequence {
            inner.cols = cols;
            inner.rows = rows;
        }
        inner.snapshot = Some(DataFrame::Snapshot {
            sequence,
            cols,
            rows,
            data: data.to_vec(),
        });
        while inner
            .replay
            .front()
            .is_some_and(|frame| data_frame_sequence(frame) <= sequence)
        {
            if let Some(removed) = inner.replay.pop_front() {
                inner.replay_bytes = inner
                    .replay_bytes
                    .saturating_sub(data_frame_payload_len(&removed));
            }
        }
        Ok(())
    }

    pub fn publish_terminal_exit(&self, code: i32) -> Result<u64, SessionError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return Err(SessionError::Closed);
        }
        inner.next_sequence = inner.next_sequence.saturating_add(1);
        let sequence = inner.next_sequence;
        broadcast(
            &mut inner,
            OutboundMessage::Data(DataFrame::TerminalExit { sequence, code }),
        );
        Ok(sequence)
    }

    pub fn close(&self, reason: &str) {
        let mut inner = self.inner.lock().unwrap();
        if inner.closed {
            return;
        }
        inner.closed = true;
        broadcast(
            &mut inner,
            OutboundMessage::Control(ServerControl::Closed {
                protocol: PROTOCOL_VERSION,
                reason: reason.to_string(),
            }),
        );
        inner.controller_id = None;
        inner.participants.clear();
        inner.used_nonces.clear();
        inner.banned_participant_names.clear();
        inner.snapshot = None;
        inner.replay.clear();
        inner.replay_bytes = 0;
    }
}

fn broadcast(inner: &mut SessionInner, message: OutboundMessage) {
    let mut lagged = Vec::new();
    for (participant_id, record) in &inner.participants {
        if matches!(
            record.outbound.try_send(message.clone()),
            Err(TrySendError::Full(_))
        ) {
            lagged.push(participant_id.clone());
        }
    }
    for participant_id in lagged {
        inner.participants.remove(&participant_id);
        if inner.controller_id.as_deref() == Some(participant_id.as_str()) {
            inner.controller_id = None;
        }
    }
}

fn data_frame_payload_len(frame: &DataFrame) -> usize {
    match frame {
        DataFrame::PtyInput { data, .. }
        | DataFrame::PtyOutput { data, .. }
        | DataFrame::Snapshot { data, .. } => data.len(),
        DataFrame::TerminalResize { .. } | DataFrame::TerminalExit { .. } => 0,
    }
}

fn data_frame_sequence(frame: &DataFrame) -> u64 {
    match frame {
        DataFrame::PtyInput { sequence, .. }
        | DataFrame::PtyOutput { sequence, .. }
        | DataFrame::Snapshot { sequence, .. }
        | DataFrame::TerminalResize { sequence, .. }
        | DataFrame::TerminalExit { sequence, .. } => *sequence,
    }
}

fn replay_for_join(
    inner: &SessionInner,
    resume_after: Option<u64>,
) -> Result<Vec<DataFrame>, SessionError> {
    if let Some(after) = resume_after {
        if after > inner.next_sequence {
            return Err(SessionError::InvalidSequence);
        }
        if after == inner.next_sequence {
            return Ok(Vec::new());
        }
        if let Some(replay) = continuous_replay(&inner.replay, after, inner.next_sequence) {
            return Ok(replay);
        }
        let Some(snapshot) = inner.snapshot.as_ref() else {
            return Err(SessionError::ReplayUnavailable);
        };
        let snapshot_sequence = data_frame_sequence(snapshot);
        if snapshot_sequence < after {
            return Err(SessionError::ReplayUnavailable);
        }
        return replay_from_snapshot(inner, snapshot);
    }

    if let Some(snapshot) = inner.snapshot.as_ref() {
        return replay_from_snapshot(inner, snapshot);
    }
    if inner.next_sequence == 0 {
        return Ok(Vec::new());
    }
    continuous_replay(&inner.replay, 0, inner.next_sequence).ok_or(SessionError::ReplayUnavailable)
}

fn replay_from_snapshot(
    inner: &SessionInner,
    snapshot: &DataFrame,
) -> Result<Vec<DataFrame>, SessionError> {
    let snapshot_sequence = data_frame_sequence(snapshot);
    if snapshot_sequence == inner.next_sequence {
        return Ok(vec![snapshot.clone()]);
    }
    if let Some(mut replay) =
        continuous_replay(&inner.replay, snapshot_sequence, inner.next_sequence)
    {
        replay.insert(0, snapshot.clone());
        Ok(replay)
    } else {
        Err(SessionError::ReplayUnavailable)
    }
}

fn continuous_replay(
    replay: &VecDeque<DataFrame>,
    after: u64,
    target: u64,
) -> Option<Vec<DataFrame>> {
    let mut expected = after.checked_add(1)?;
    let mut result = Vec::new();
    for frame in replay
        .iter()
        .filter(|frame| data_frame_sequence(frame) > after)
    {
        if data_frame_sequence(frame) != expected {
            return None;
        }
        result.push(frame.clone());
        expected = expected.checked_add(1)?;
    }
    (expected == target.saturating_add(1)).then_some(result)
}

impl From<AuthError> for SessionError {
    fn from(_: AuthError) -> Self {
        Self::Authentication
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::sync_channel;
    use std::time::Duration;

    use super::super::auth::{build_join_proof, GeneratedCredentials};
    use super::*;

    fn fixture() -> (HostedSession, GeneratedCredentials) {
        let credentials = GeneratedCredentials::generate().expect("credentials");
        let session = HostedSession::new(
            credentials.session_id.clone(),
            7,
            120,
            40,
            credentials.authenticator.clone(),
            Instant::now() + Duration::from_secs(60),
        );
        (session, credentials)
    }

    #[test]
    fn terminal_resize_updates_join_dimensions_and_sequence() {
        let (session, _) = fixture();
        assert_eq!(session.dimensions(), (120, 40));
        assert_eq!(session.publish_resize(132, 46).expect("resize"), 1);
        assert_eq!(session.dimensions(), (132, 46));
        session
            .set_snapshot(0, 120, 40, b"older grid")
            .expect("older snapshot");
        assert_eq!(session.dimensions(), (132, 46));
        assert_eq!(session.publish_resize(132, 46).expect("same resize"), 1);
    }

    fn join(
        session: &HostedSession,
        credentials: &GeneratedCredentials,
        name: &str,
        nonce: &str,
    ) -> Result<JoinAccepted, SessionError> {
        join_after(session, credentials, name, nonce, None)
    }

    fn join_after(
        session: &HostedSession,
        credentials: &GeneratedCredentials,
        name: &str,
        nonce: &str,
        resume_after: Option<u64>,
    ) -> Result<JoinAccepted, SessionError> {
        let proof = build_join_proof(
            &credentials.invite_code,
            &credentials.session_id,
            name,
            nonce,
            resume_after,
        )
        .expect("proof");
        let (sender, _receiver) = sync_channel(8);
        session.join(
            JoinRequest {
                participant_name: name,
                client_nonce: nonce,
                proof: &proof,
                resume_after,
            },
            sender,
        )
    }

    #[test]
    fn guests_join_as_observers_and_nonce_replay_is_rejected() {
        let (session, credentials) = fixture();
        let accepted =
            join(&session, &credentials, "Ada", "nonce-000000000001").expect("first join");

        assert_eq!(accepted.participant.role, ParticipantRole::Observer);
        assert_eq!(
            join(&session, &credentials, "Ada again", "nonce-000000000001")
                .expect_err("reject replay"),
            SessionError::Replay
        );
    }

    #[test]
    fn granting_control_demotes_the_previous_controller() {
        let (session, credentials) = fixture();
        let first = join(&session, &credentials, "Ada", "nonce-000000000001").expect("first join");
        let second =
            join(&session, &credentials, "Grace", "nonce-000000000002").expect("second join");

        session
            .set_controller(&first.participant.id)
            .expect("grant first");
        session
            .set_controller(&second.participant.id)
            .expect("grant second");

        assert_eq!(
            session.participant_role(&first.participant.id),
            Some(ParticipantRole::Observer)
        );
        assert_eq!(
            session.participant_role(&second.participant.id),
            Some(ParticipantRole::Controller)
        );
    }

    #[test]
    fn bounded_replay_requires_a_fresh_snapshot_after_a_gap() {
        let (session, credentials) = fixture();
        assert_eq!(session.publish_output(b"first").expect("publish"), 1);
        assert_eq!(session.publish_output(b"second").expect("publish"), 2);
        for _ in 0..(MAX_REPLAY_FRAMES + 10) {
            session.publish_output(b"x").expect("publish");
        }

        assert_eq!(
            join(&session, &credentials, "Ada", "nonce-000000000001")
                .expect_err("reject an incomplete replay"),
            SessionError::ReplayUnavailable
        );
        assert!(session.snapshot_required().expect("snapshot status"));
        session
            .set_snapshot(76, 120, 40, b"fresh screen")
            .expect("refresh snapshot");
        let accepted = join(&session, &credentials, "Ada", "nonce-000000000002")
            .expect("join from fresh snapshot");
        assert!(matches!(
            accepted.replay.as_slice(),
            [DataFrame::Snapshot { sequence: 76, .. }]
        ));
    }

    #[test]
    fn snapshot_refresh_is_requested_before_replay_eviction() {
        let (session, _) = fixture();
        session
            .set_snapshot(0, 120, 40, b"initial screen")
            .expect("initial snapshot");
        for _ in 0..SNAPSHOT_REFRESH_REPLAY_FRAMES {
            session.publish_output(b"x").expect("publish");
        }

        assert!(session.snapshot_required().expect("snapshot status"));
    }

    #[test]
    fn snapshot_precedes_only_output_newer_than_its_boundary() {
        let (session, credentials) = fixture();
        assert_eq!(session.publish_output(b"before").expect("publish"), 1);
        session
            .set_snapshot(1, 120, 40, b"serialized screen")
            .expect("set snapshot");
        assert_eq!(session.publish_output(b"after").expect("publish"), 2);

        let accepted = join(&session, &credentials, "Ada", "nonce-000000000001").expect("join");
        assert_eq!(
            accepted.replay,
            vec![
                DataFrame::Snapshot {
                    sequence: 1,
                    cols: 120,
                    rows: 40,
                    data: b"serialized screen".to_vec(),
                },
                DataFrame::PtyOutput {
                    sequence: 2,
                    data: b"after".to_vec(),
                },
            ]
        );
    }

    #[test]
    fn a_sequence_zero_snapshot_is_not_omitted_from_a_fresh_join() {
        let (session, credentials) = fixture();
        session
            .set_snapshot(0, 120, 40, b"existing prompt")
            .expect("set snapshot");

        let accepted = join(&session, &credentials, "Ada", "nonce-000000000001").expect("join");

        assert!(matches!(
            accepted.replay.as_slice(),
            [DataFrame::Snapshot { sequence: 0, data, .. }] if data == b"existing prompt"
        ));
    }

    #[test]
    fn reconnect_replays_only_the_contiguous_tail() {
        let (session, credentials) = fixture();
        session.publish_output(b"one").expect("publish one");
        session.publish_output(b"two").expect("publish two");
        session.publish_output(b"three").expect("publish three");

        let accepted = join_after(&session, &credentials, "Ada", "nonce-000000000001", Some(1))
            .expect("resume from first frame");

        assert_eq!(
            accepted.replay,
            vec![
                DataFrame::PtyOutput {
                    sequence: 2,
                    data: b"two".to_vec(),
                },
                DataFrame::PtyOutput {
                    sequence: 3,
                    data: b"three".to_vec(),
                },
            ]
        );
    }

    #[test]
    fn a_saturated_outbound_queue_disconnects_the_slow_participant() {
        let (session, credentials) = fixture();
        let nonce = "nonce-000000000001";
        let proof = build_join_proof(
            &credentials.invite_code,
            &credentials.session_id,
            "Ada",
            nonce,
            None,
        )
        .expect("proof");
        let (sender, _receiver) = sync_channel(1);
        session
            .join(
                JoinRequest {
                    participant_name: "Ada",
                    client_nonce: nonce,
                    proof: &proof,
                    resume_after: None,
                },
                sender,
            )
            .expect("join");

        session.publish_output(b"first").expect("first output");
        session.publish_output(b"second").expect("second output");

        assert!(session.participants().is_empty());
    }

    #[test]
    fn snapshot_rejects_a_boundary_that_has_not_been_published() {
        let (session, _) = fixture();
        assert_eq!(
            session
                .set_snapshot(1, 80, 24, b"future")
                .expect_err("reject future boundary"),
            SessionError::InvalidSequence
        );
    }

    #[test]
    fn close_revokes_the_session_and_notifies_participants() {
        let (session, credentials) = fixture();
        let proof = build_join_proof(
            &credentials.invite_code,
            &credentials.session_id,
            "Ada",
            "nonce-000000000001",
            None,
        )
        .expect("proof");
        let (sender, receiver) = sync_channel(8);
        session
            .join(
                JoinRequest {
                    participant_name: "Ada",
                    client_nonce: "nonce-000000000001",
                    proof: &proof,
                    resume_after: None,
                },
                sender,
            )
            .expect("join");

        session.close("host_closed");

        assert!(matches!(
            receiver.recv().expect("close message"),
            OutboundMessage::Control(ServerControl::Closed { reason, .. })
                if reason == "host_closed"
        ));
        assert_eq!(
            join(&session, &credentials, "Grace", "nonce-000000000002")
                .expect_err("closed session"),
            SessionError::Closed
        );
    }

    #[test]
    fn participant_names_reject_control_characters() {
        let (session, credentials) = fixture();

        assert_eq!(
            join(
                &session,
                &credentials,
                "Ada\nAdministrator",
                "nonce-000000000001"
            )
            .expect_err("control character"),
            SessionError::InvalidParticipant
        );
    }

    #[test]
    fn participant_limit_includes_the_host() {
        let (session, credentials) = fixture();
        for index in 0..(MAX_PARTICIPANTS - 1) {
            let nonce = format!("nonce-{index:016}");
            join(&session, &credentials, &format!("Guest {index}"), &nonce)
                .expect("join within limit");
        }

        assert_eq!(
            join(
                &session,
                &credentials,
                "One too many",
                "nonce-9999999999999999"
            )
            .expect_err("participant limit"),
            SessionError::ParticipantLimit
        );
    }

    #[test]
    fn host_removal_closes_the_participant_channel() {
        let (session, credentials) = fixture();
        let proof = build_join_proof(
            &credentials.invite_code,
            &credentials.session_id,
            "Ada",
            "nonce-000000000001",
            None,
        )
        .expect("proof");
        let (sender, receiver) = sync_channel(8);
        let accepted = session
            .join(
                JoinRequest {
                    participant_name: "Ada",
                    client_nonce: "nonce-000000000001",
                    proof: &proof,
                    resume_after: None,
                },
                sender,
            )
            .expect("join");

        session
            .remove_participant(&accepted.participant.id)
            .expect("remove participant");

        assert!(session.participants().is_empty());
        assert!(matches!(
            receiver.recv().expect("removal message"),
            OutboundMessage::Control(ServerControl::Closed { reason, .. })
                if reason == "removed_by_host"
        ));
    }

    #[test]
    fn control_requests_are_visible_to_the_host_until_resolved() {
        let (session, credentials) = fixture();
        let accepted =
            join(&session, &credentials, "Ada", "nonce-000000000001").expect("join participant");

        session
            .request_control(&accepted.participant.id)
            .expect("request control");
        assert!(session.participants()[0].control_requested);

        session
            .set_controller(&accepted.participant.id)
            .expect("grant control");
        let participant = &session.participants()[0];
        assert_eq!(participant.role, ParticipantRole::Controller);
        assert!(!participant.control_requested);
    }

    #[test]
    fn accepted_controller_input_exposes_short_lived_typing_presence() {
        let (session, credentials) = fixture();
        let accepted =
            join(&session, &credentials, "Ada", "nonce-000000000001").expect("join participant");
        session
            .set_controller(&accepted.participant.id)
            .expect("grant control");

        session
            .authorize_input(&accepted.participant.id, 1, true)
            .expect("authorize input");
        assert!(session.participants()[0].typing);

        session
            .inner
            .lock()
            .unwrap()
            .participants
            .get_mut(&accepted.participant.id)
            .expect("participant record")
            .last_input_at = Some(Instant::now() - TYPING_PRESENCE_TTL - Duration::from_millis(1));
        assert!(!session.participants()[0].typing);
    }

    #[test]
    fn banning_disconnects_and_rejects_the_same_name_for_the_session() {
        let (session, credentials) = fixture();
        let accepted =
            join(&session, &credentials, "Ada", "nonce-000000000001").expect("join participant");

        session
            .ban_participant(&accepted.participant.id)
            .expect("ban participant");

        assert!(session.participants().is_empty());
        assert_eq!(
            join(&session, &credentials, "ADA", "nonce-000000000002")
                .expect_err("reject banned name"),
            SessionError::Banned
        );
        assert!(join(&session, &credentials, "Grace", "nonce-000000000003").is_ok());
    }
}
