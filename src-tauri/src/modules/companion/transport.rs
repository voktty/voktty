use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey};
use sha2::Sha256;
use voktty_companion_protocol::{
    ClientMessage, EncryptedFrame, FrameDirection, ProtocolError, ServerMessage, SessionControl,
    MAX_ENCRYPTED_FRAME_BYTES, PROTOCOL_VERSION,
};

type HmacSha256 = Hmac<Sha256>;

const KEY_CONTEXT: &[u8] = b"voktty-companion-transport-v1";
const CLIENT_NONCE_PREFIX: &[u8; 4] = b"VKC1";
const HOST_NONCE_PREFIX: &[u8; 4] = b"VKS1";
const TAG_BYTES: usize = 16;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum TransportError {
    Authentication,
    CounterExhausted,
    InvalidFrame,
    InvalidSequence,
    MessageTooLarge,
    WrongDirection,
}

pub(super) struct CompanionTransport {
    send_key: LessSafeKey,
    receive_key: LessSafeKey,
    send_direction: FrameDirection,
    receive_direction: FrameDirection,
    send_counter: u64,
    receive_counter: u64,
}

impl CompanionTransport {
    pub(super) fn for_host(shared_secret: &[u8], session_id: &str) -> Result<Self, TransportError> {
        Self::new(shared_secret, session_id, false)
    }

    #[cfg(test)]
    fn for_client(shared_secret: &[u8], session_id: &str) -> Result<Self, TransportError> {
        Self::new(shared_secret, session_id, true)
    }

    fn new(shared_secret: &[u8], session_id: &str, client: bool) -> Result<Self, TransportError> {
        let client_key = make_key(&derive_key(shared_secret, session_id, b"client-to-host"))?;
        let host_key = make_key(&derive_key(shared_secret, session_id, b"host-to-client"))?;
        let (send_key, receive_key, send_direction, receive_direction) = if client {
            (
                client_key,
                host_key,
                FrameDirection::ClientToHost,
                FrameDirection::HostToClient,
            )
        } else {
            (
                host_key,
                client_key,
                FrameDirection::HostToClient,
                FrameDirection::ClientToHost,
            )
        };
        Ok(Self {
            send_key,
            receive_key,
            send_direction,
            receive_direction,
            send_counter: 0,
            receive_counter: 0,
        })
    }

    fn seal_raw(&mut self, payload: &[u8]) -> Result<EncryptedFrame, TransportError> {
        let counter = self
            .send_counter
            .checked_add(1)
            .ok_or(TransportError::CounterExhausted)?;
        let header = header(self.send_direction, counter);
        if payload.len() > MAX_ENCRYPTED_FRAME_BYTES.saturating_sub(TAG_BYTES) {
            return Err(TransportError::MessageTooLarge);
        }
        let mut ciphertext = payload.to_vec();
        self.send_key
            .seal_in_place_append_tag(
                nonce(self.send_direction, counter),
                Aad::from(header.as_slice()),
                &mut ciphertext,
            )
            .map_err(|_| TransportError::Authentication)?;
        self.send_counter = counter;
        Ok(EncryptedFrame {
            protocol: PROTOCOL_VERSION,
            direction: self.send_direction,
            counter,
            ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
        })
    }

    fn open_raw(&mut self, frame: &EncryptedFrame) -> Result<Vec<u8>, TransportError> {
        frame.validate().map_err(protocol_error)?;
        if frame.direction != self.receive_direction {
            return Err(TransportError::WrongDirection);
        }
        let expected = self
            .receive_counter
            .checked_add(1)
            .ok_or(TransportError::CounterExhausted)?;
        if frame.counter != expected {
            return Err(TransportError::InvalidSequence);
        }
        let mut ciphertext = URL_SAFE_NO_PAD
            .decode(&frame.ciphertext)
            .map_err(|_| TransportError::InvalidFrame)?;
        if ciphertext.len() > MAX_ENCRYPTED_FRAME_BYTES || ciphertext.len() < TAG_BYTES {
            return Err(TransportError::MessageTooLarge);
        }
        let header = header(frame.direction, frame.counter);
        let plaintext = self
            .receive_key
            .open_in_place(
                nonce(frame.direction, frame.counter),
                Aad::from(header.as_slice()),
                &mut ciphertext,
            )
            .map_err(|_| TransportError::Authentication)?;
        let data = plaintext.to_vec();
        self.receive_counter = frame.counter;
        Ok(data)
    }

    pub(super) fn seal(
        &mut self,
        control: &SessionControl,
    ) -> Result<EncryptedFrame, TransportError> {
        control.validate().map_err(protocol_error)?;
        let bytes = serde_json::to_vec(control).map_err(|_| TransportError::InvalidFrame)?;
        self.seal_raw(&bytes)
    }

    pub(super) fn open(
        &mut self,
        frame: &EncryptedFrame,
    ) -> Result<SessionControl, TransportError> {
        let bytes = self.open_raw(frame)?;
        let control: SessionControl =
            serde_json::from_slice(&bytes).map_err(|_| TransportError::InvalidFrame)?;
        control.validate().map_err(protocol_error)?;
        Ok(control)
    }

    pub(super) fn seal_server_message(
        &mut self,
        message: &ServerMessage,
    ) -> Result<EncryptedFrame, TransportError> {
        message.validate().map_err(protocol_error)?;
        let bytes = serde_json::to_vec(message).map_err(|_| TransportError::InvalidFrame)?;
        self.seal_raw(&bytes)
    }

    pub(super) fn open_client_message(
        &mut self,
        frame: &EncryptedFrame,
    ) -> Result<ClientMessage, TransportError> {
        let bytes = self.open_raw(frame)?;
        let message: ClientMessage =
            serde_json::from_slice(&bytes).map_err(|_| TransportError::InvalidFrame)?;
        message.validate().map_err(protocol_error)?;
        Ok(message)
    }

    #[cfg(test)]
    pub(super) fn seal_client_message(
        &mut self,
        message: &ClientMessage,
    ) -> Result<EncryptedFrame, TransportError> {
        message.validate().map_err(protocol_error)?;
        let bytes = serde_json::to_vec(message).map_err(|_| TransportError::InvalidFrame)?;
        self.seal_raw(&bytes)
    }

    #[cfg(test)]
    pub(super) fn open_server_message(
        &mut self,
        frame: &EncryptedFrame,
    ) -> Result<ServerMessage, TransportError> {
        let bytes = self.open_raw(frame)?;
        let message: ServerMessage =
            serde_json::from_slice(&bytes).map_err(|_| TransportError::InvalidFrame)?;
        message.validate().map_err(protocol_error)?;
        Ok(message)
    }
}

fn derive_key(shared_secret: &[u8], session_id: &str, direction: &[u8]) -> [u8; 32] {
    let mut mac =
        HmacSha256::new_from_slice(shared_secret).expect("HMAC accepts arbitrary key lengths");
    for field in [KEY_CONTEXT, session_id.as_bytes(), direction] {
        mac.update(&(field.len() as u64).to_be_bytes());
        mac.update(field);
    }
    mac.finalize().into_bytes().into()
}

fn make_key(bytes: &[u8; 32]) -> Result<LessSafeKey, TransportError> {
    UnboundKey::new(&aead::AES_256_GCM, bytes)
        .map(LessSafeKey::new)
        .map_err(|_| TransportError::Authentication)
}

fn header(direction: FrameDirection, counter: u64) -> [u8; 14] {
    let mut header = [0_u8; 14];
    header[..4].copy_from_slice(b"VKCP");
    header[4] = 1;
    header[5] = match direction {
        FrameDirection::ClientToHost => 1,
        FrameDirection::HostToClient => 2,
    };
    header[6..].copy_from_slice(&counter.to_be_bytes());
    header
}

fn nonce(direction: FrameDirection, counter: u64) -> Nonce {
    let mut bytes = [0_u8; 12];
    bytes[..4].copy_from_slice(match direction {
        FrameDirection::ClientToHost => CLIENT_NONCE_PREFIX,
        FrameDirection::HostToClient => HOST_NONCE_PREFIX,
    });
    bytes[4..].copy_from_slice(&counter.to_be_bytes());
    Nonce::assume_unique_for_key(bytes)
}

fn protocol_error(error: ProtocolError) -> TransportError {
    match error {
        ProtocolError::MessageTooLarge => TransportError::MessageTooLarge,
        ProtocolError::InvalidField | ProtocolError::UnsupportedVersion(_) => {
            TransportError::InvalidFrame
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_confirmation_round_trip_rejects_replay_and_tampering() {
        let mut host = CompanionTransport::for_host(&[7; 32], "request-1").expect("host");
        let mut client = CompanionTransport::for_client(&[7; 32], "request-1").expect("client");
        let frame = client
            .seal(&SessionControl::KeyConfirm {
                protocol: PROTOCOL_VERSION,
            })
            .expect("seal");
        assert_eq!(
            host.open(&frame),
            Ok(SessionControl::KeyConfirm {
                protocol: PROTOCOL_VERSION
            })
        );
        assert_eq!(host.open(&frame), Err(TransportError::InvalidSequence));

        let mut tampered = client
            .seal(&SessionControl::KeyConfirm {
                protocol: PROTOCOL_VERSION,
            })
            .expect("seal");
        tampered.ciphertext.replace_range(..1, "A");
        assert_eq!(host.open(&tampered), Err(TransportError::Authentication));
    }

    #[test]
    fn transport_binds_the_session_and_direction() {
        let mut host = CompanionTransport::for_host(&[7; 32], "request-1").expect("host");
        let mut other_client =
            CompanionTransport::for_client(&[7; 32], "request-2").expect("client");
        let frame = other_client
            .seal(&SessionControl::KeyConfirm {
                protocol: PROTOCOL_VERSION,
            })
            .expect("seal");
        assert_eq!(host.open(&frame), Err(TransportError::Authentication));
    }

    #[test]
    fn messages_round_trip_cleanly_between_client_and_host() {
        let mut host = CompanionTransport::for_host(&[9; 32], "session-test").expect("host");
        let mut client = CompanionTransport::for_client(&[9; 32], "session-test").expect("client");

        let client_msg = ClientMessage::AgentMessage {
            protocol: PROTOCOL_VERSION,
            agent_id: "agent-alpha".into(),
            message: "Hello from mobile".into(),
        };
        let frame = client.seal_client_message(&client_msg).expect("seal");
        let received = host.open_client_message(&frame).expect("open");
        assert_eq!(received, client_msg);

        let server_msg = ServerMessage::AgentDelta {
            protocol: PROTOCOL_VERSION,
            agent_id: "agent-alpha".into(),
            cursor: 42,
            content: "Delta content".into(),
        };
        let frame = host.seal_server_message(&server_msg).expect("seal");
        let received = client.open_server_message(&frame).expect("open");
        assert_eq!(received, server_msg);
    }
}
