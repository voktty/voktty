use std::fmt;

use hmac::{Hmac, Mac};
use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey};
use sha2::Sha256;
use voktty_collab_protocol::MAX_CONTROL_BYTES;

use super::auth::SessionAuthenticator;

const MAGIC: &[u8; 4] = b"VKCE";
const ENVELOPE_VERSION: u8 = 1;
const HEADER_BYTES: usize = 14;
const TAG_BYTES: usize = 16;
const PAYLOAD_CONTROL: u8 = 1;
const PAYLOAD_DATA: u8 = 2;

pub(super) const MAX_SECURE_MESSAGE_BYTES: usize = HEADER_BYTES + MAX_CONTROL_BYTES + 1 + TAG_BYTES;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum SecurePayload {
    Control(Vec<u8>),
    Data(Vec<u8>),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum CryptoError {
    Authentication,
    CounterExhausted,
    InvalidInvite,
    InvalidPayload,
    InvalidSequence,
    MessageTooLarge,
    WrongDirection,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Authentication => formatter.write_str("encrypted message authentication failed"),
            Self::CounterExhausted => formatter.write_str("encrypted message counter exhausted"),
            Self::InvalidInvite => formatter.write_str("invalid invitation code"),
            Self::InvalidPayload => formatter.write_str("invalid encrypted message"),
            Self::InvalidSequence => formatter.write_str("invalid encrypted message sequence"),
            Self::MessageTooLarge => formatter.write_str("encrypted message exceeds maximum size"),
            Self::WrongDirection => formatter.write_str("encrypted message has wrong direction"),
        }
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum Direction {
    ClientToServer = 1,
    ServerToClient = 2,
}

pub(super) struct TransportCipher {
    send_key: LessSafeKey,
    receive_key: LessSafeKey,
    send_direction: Direction,
    receive_direction: Direction,
    send_sequence: u64,
    receive_sequence: u64,
}

impl TransportCipher {
    pub fn for_host(
        secret: &[u8; 32],
        session_id: &str,
        client_nonce: &str,
    ) -> Result<Self, CryptoError> {
        Self::new(secret, session_id, client_nonce, false)
    }

    #[allow(dead_code)]
    pub fn for_guest(
        invite_code: &str,
        session_id: &str,
        client_nonce: &str,
    ) -> Result<Self, CryptoError> {
        let authenticator = SessionAuthenticator::from_invite_code(invite_code)
            .map_err(|_| CryptoError::InvalidInvite)?;
        Self::new(authenticator.key_material(), session_id, client_nonce, true)
    }

    fn new(
        secret: &[u8; 32],
        session_id: &str,
        client_nonce: &str,
        guest: bool,
    ) -> Result<Self, CryptoError> {
        let client_key = derive_key(secret, session_id, client_nonce, b"client-to-server");
        let server_key = derive_key(secret, session_id, client_nonce, b"server-to-client");
        let client_key = make_key(&client_key)?;
        let server_key = make_key(&server_key)?;
        let (send_key, receive_key, send_direction, receive_direction) = if guest {
            (
                client_key,
                server_key,
                Direction::ClientToServer,
                Direction::ServerToClient,
            )
        } else {
            (
                server_key,
                client_key,
                Direction::ServerToClient,
                Direction::ClientToServer,
            )
        };
        Ok(Self {
            send_key,
            receive_key,
            send_direction,
            receive_direction,
            send_sequence: 0,
            receive_sequence: 0,
        })
    }

    pub fn seal(&mut self, payload: SecurePayload) -> Result<Vec<u8>, CryptoError> {
        let (kind, bytes) = match payload {
            SecurePayload::Control(bytes) => (PAYLOAD_CONTROL, bytes),
            SecurePayload::Data(bytes) => (PAYLOAD_DATA, bytes),
        };
        if bytes.len() > MAX_CONTROL_BYTES {
            return Err(CryptoError::MessageTooLarge);
        }
        let sequence = self
            .send_sequence
            .checked_add(1)
            .ok_or(CryptoError::CounterExhausted)?;
        let header = header(self.send_direction, sequence);
        let mut encrypted = Vec::with_capacity(1 + bytes.len() + TAG_BYTES);
        encrypted.push(kind);
        encrypted.extend_from_slice(&bytes);
        self.send_key
            .seal_in_place_append_tag(
                nonce(self.send_direction, sequence),
                Aad::from(header.as_slice()),
                &mut encrypted,
            )
            .map_err(|_| CryptoError::Authentication)?;
        self.send_sequence = sequence;
        let mut envelope = Vec::with_capacity(HEADER_BYTES + encrypted.len());
        envelope.extend_from_slice(&header);
        envelope.extend_from_slice(&encrypted);
        Ok(envelope)
    }

    pub fn open(&mut self, envelope: &[u8]) -> Result<SecurePayload, CryptoError> {
        if envelope.len() > MAX_SECURE_MESSAGE_BYTES {
            return Err(CryptoError::MessageTooLarge);
        }
        if envelope.len() < HEADER_BYTES + TAG_BYTES + 1
            || &envelope[..4] != MAGIC
            || envelope[4] != ENVELOPE_VERSION
        {
            return Err(CryptoError::InvalidPayload);
        }
        let direction = match envelope[5] {
            1 => Direction::ClientToServer,
            2 => Direction::ServerToClient,
            _ => return Err(CryptoError::InvalidPayload),
        };
        if direction != self.receive_direction {
            return Err(CryptoError::WrongDirection);
        }
        let sequence = u64::from_be_bytes(
            envelope[6..HEADER_BYTES]
                .try_into()
                .map_err(|_| CryptoError::InvalidPayload)?,
        );
        let expected = self
            .receive_sequence
            .checked_add(1)
            .ok_or(CryptoError::CounterExhausted)?;
        if sequence != expected {
            return Err(CryptoError::InvalidSequence);
        }
        let mut encrypted = envelope[HEADER_BYTES..].to_vec();
        let plaintext = self
            .receive_key
            .open_in_place(
                nonce(direction, sequence),
                Aad::from(&envelope[..HEADER_BYTES]),
                &mut encrypted,
            )
            .map_err(|_| CryptoError::Authentication)?;
        let (&kind, bytes) = plaintext.split_first().ok_or(CryptoError::InvalidPayload)?;
        let payload = match kind {
            PAYLOAD_CONTROL => SecurePayload::Control(bytes.to_vec()),
            PAYLOAD_DATA => SecurePayload::Data(bytes.to_vec()),
            _ => return Err(CryptoError::InvalidPayload),
        };
        self.receive_sequence = sequence;
        Ok(payload)
    }
}

fn make_key(bytes: &[u8; 32]) -> Result<LessSafeKey, CryptoError> {
    UnboundKey::new(&aead::AES_256_GCM, bytes)
        .map(LessSafeKey::new)
        .map_err(|_| CryptoError::Authentication)
}

fn derive_key(
    secret: &[u8; 32],
    session_id: &str,
    client_nonce: &str,
    direction: &[u8],
) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts fixed length key");
    update_field(&mut mac, b"voktty-collab-transport-v1");
    update_field(&mut mac, session_id.as_bytes());
    update_field(&mut mac, client_nonce.as_bytes());
    update_field(&mut mac, direction);
    mac.finalize().into_bytes().into()
}

fn update_field(mac: &mut HmacSha256, value: &[u8]) {
    mac.update(&(value.len() as u64).to_be_bytes());
    mac.update(value);
}

fn header(direction: Direction, sequence: u64) -> [u8; HEADER_BYTES] {
    let mut header = [0_u8; HEADER_BYTES];
    header[..4].copy_from_slice(MAGIC);
    header[4] = ENVELOPE_VERSION;
    header[5] = direction as u8;
    header[6..].copy_from_slice(&sequence.to_be_bytes());
    header
}

fn nonce(direction: Direction, sequence: u64) -> Nonce {
    let mut bytes = [0_u8; 12];
    bytes[..4].copy_from_slice(match direction {
        Direction::ClientToServer => b"VKC1",
        Direction::ServerToClient => b"VKS1",
    });
    bytes[4..].copy_from_slice(&sequence.to_be_bytes());
    Nonce::assume_unique_for_key(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::collab::auth::GeneratedCredentials;

    fn cipher_pair() -> (TransportCipher, TransportCipher) {
        let credentials = GeneratedCredentials::generate().expect("credentials");
        let nonce = "client-nonce";
        let host = TransportCipher::for_host(
            credentials.authenticator.key_material(),
            &credentials.session_id,
            nonce,
        )
        .expect("host cipher");
        let guest =
            TransportCipher::for_guest(&credentials.invite_code, &credentials.session_id, nonce)
                .expect("guest cipher");
        (host, guest)
    }

    #[test]
    fn control_and_data_round_trip_in_both_directions() {
        let (mut host, mut guest) = cipher_pair();

        let encrypted = host
            .seal(SecurePayload::Control(b"joined".to_vec()))
            .expect("encrypt server control");
        assert_eq!(
            guest.open(&encrypted).expect("decrypt server control"),
            SecurePayload::Control(b"joined".to_vec())
        );

        let encrypted = guest
            .seal(SecurePayload::Data(b"whoami\r".to_vec()))
            .expect("encrypt client data");
        assert_eq!(
            host.open(&encrypted).expect("decrypt client data"),
            SecurePayload::Data(b"whoami\r".to_vec())
        );
    }

    #[test]
    fn ciphertext_hides_payload_and_rejects_tampering() {
        let (mut host, mut guest) = cipher_pair();
        let plaintext = b"sensitive terminal output";
        let mut encrypted = host
            .seal(SecurePayload::Data(plaintext.to_vec()))
            .expect("encrypt");

        assert!(!encrypted
            .windows(plaintext.len())
            .any(|window| window == plaintext));
        let last = encrypted.len() - 1;
        encrypted[last] ^= 1;
        assert_eq!(guest.open(&encrypted), Err(CryptoError::Authentication));
    }

    #[test]
    fn replay_wrong_direction_and_wrong_context_are_rejected() {
        let (mut host, mut guest) = cipher_pair();
        let encrypted = host
            .seal(SecurePayload::Control(b"presence".to_vec()))
            .expect("encrypt");

        assert!(guest.open(&encrypted).is_ok());
        assert_eq!(guest.open(&encrypted), Err(CryptoError::InvalidSequence));
        assert_eq!(host.open(&encrypted), Err(CryptoError::WrongDirection));

        let credentials = GeneratedCredentials::generate().expect("other credentials");
        let mut other_guest = TransportCipher::for_guest(
            &credentials.invite_code,
            &credentials.session_id,
            "other-nonce",
        )
        .expect("other guest cipher");
        assert_eq!(
            other_guest.open(&encrypted),
            Err(CryptoError::Authentication)
        );
    }
}
