use std::fmt;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;

const SESSION_ID_BYTES: usize = 16;
const INVITE_KEY_BYTES: usize = 32;
#[allow(dead_code)]
const CLIENT_NONCE_BYTES: usize = 24;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub(super) struct SessionAuthenticator {
    key: [u8; INVITE_KEY_BYTES],
}

pub(super) struct GeneratedCredentials {
    pub session_id: String,
    pub invite_code: String,
    pub authenticator: SessionAuthenticator,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AuthError {
    InvalidInviteCode,
    InvalidProof,
    RandomSource,
}

impl fmt::Display for AuthError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInviteCode => formatter.write_str("invalid invitation code"),
            Self::InvalidProof => formatter.write_str("invalid authentication proof"),
            Self::RandomSource => formatter.write_str("secure random source unavailable"),
        }
    }
}

impl GeneratedCredentials {
    pub fn generate() -> Result<Self, AuthError> {
        let session_id = random_token(SESSION_ID_BYTES)?;
        let mut key = [0_u8; INVITE_KEY_BYTES];
        getrandom::fill(&mut key).map_err(|_| AuthError::RandomSource)?;
        Ok(Self {
            session_id,
            invite_code: URL_SAFE_NO_PAD.encode(key),
            authenticator: SessionAuthenticator { key },
        })
    }
}

impl SessionAuthenticator {
    pub(super) fn key_material(&self) -> &[u8; INVITE_KEY_BYTES] {
        &self.key
    }

    #[allow(dead_code)]
    pub fn from_invite_code(invite_code: &str) -> Result<Self, AuthError> {
        let decoded = URL_SAFE_NO_PAD
            .decode(invite_code)
            .map_err(|_| AuthError::InvalidInviteCode)?;
        let key = decoded
            .try_into()
            .map_err(|_| AuthError::InvalidInviteCode)?;
        Ok(Self { key })
    }

    pub fn verify_join(
        &self,
        session_id: &str,
        participant_name: &str,
        client_nonce: &str,
        resume_after: Option<u64>,
        proof: &str,
    ) -> Result<(), AuthError> {
        let proof = URL_SAFE_NO_PAD
            .decode(proof)
            .map_err(|_| AuthError::InvalidProof)?;
        let mac = join_mac(
            &self.key,
            session_id,
            participant_name,
            client_nonce,
            resume_after,
        );
        mac.verify_slice(&proof)
            .map_err(|_| AuthError::InvalidProof)
    }
}

#[allow(dead_code)]
pub(super) fn build_join_proof(
    invite_code: &str,
    session_id: &str,
    participant_name: &str,
    client_nonce: &str,
    resume_after: Option<u64>,
) -> Result<String, AuthError> {
    let authenticator = SessionAuthenticator::from_invite_code(invite_code)?;
    let mac = join_mac(
        &authenticator.key,
        session_id,
        participant_name,
        client_nonce,
        resume_after,
    );
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

#[allow(dead_code)]
pub(super) fn generate_client_nonce() -> Result<String, AuthError> {
    random_token(CLIENT_NONCE_BYTES)
}

pub(super) fn generate_public_id() -> Result<String, AuthError> {
    random_token(SESSION_ID_BYTES)
}

fn random_token(byte_count: usize) -> Result<String, AuthError> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes).map_err(|_| AuthError::RandomSource)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn join_mac(
    key: &[u8],
    session_id: &str,
    participant_name: &str,
    client_nonce: &str,
    resume_after: Option<u64>,
) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts keys of any length");
    update_field(&mut mac, b"voktty-collab-join-v1");
    update_field(&mut mac, session_id.as_bytes());
    update_field(&mut mac, participant_name.as_bytes());
    update_field(&mut mac, client_nonce.as_bytes());
    let mut resume = [0_u8; 9];
    if let Some(sequence) = resume_after {
        resume[0] = 1;
        resume[1..].copy_from_slice(&sequence.to_be_bytes());
    }
    update_field(&mut mac, &resume);
    mac
}

fn update_field(mac: &mut HmacSha256, value: &[u8]) {
    mac.update(&(value.len() as u64).to_be_bytes());
    mac.update(value);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_credentials_are_url_safe_and_have_full_entropy() {
        let first = GeneratedCredentials::generate().expect("generate credentials");
        let second = GeneratedCredentials::generate().expect("generate credentials");

        assert_ne!(first.session_id, second.session_id);
        assert_ne!(first.invite_code, second.invite_code);
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(&first.session_id)
                .expect("decode session id")
                .len(),
            SESSION_ID_BYTES
        );
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(&first.invite_code)
                .expect("decode invite code")
                .len(),
            INVITE_KEY_BYTES
        );
    }

    #[test]
    fn proof_is_bound_to_every_join_field() {
        let credentials = GeneratedCredentials::generate().expect("generate credentials");
        let nonce = generate_client_nonce().expect("generate nonce");
        let proof = build_join_proof(
            &credentials.invite_code,
            &credentials.session_id,
            "Ada",
            &nonce,
            Some(7),
        )
        .expect("build proof");

        assert!(credentials
            .authenticator
            .verify_join(&credentials.session_id, "Ada", &nonce, Some(7), &proof)
            .is_ok());
        assert_eq!(
            credentials.authenticator.verify_join(
                &credentials.session_id,
                "Grace",
                &nonce,
                Some(7),
                &proof
            ),
            Err(AuthError::InvalidProof)
        );
        assert_eq!(
            credentials.authenticator.verify_join(
                &credentials.session_id,
                "Ada",
                &nonce,
                None,
                &proof,
            ),
            Err(AuthError::InvalidProof)
        );
        assert_eq!(
            credentials.authenticator.verify_join(
                "another-session",
                "Ada",
                &nonce,
                Some(7),
                &proof
            ),
            Err(AuthError::InvalidProof)
        );
        assert_eq!(
            credentials.authenticator.verify_join(
                &credentials.session_id,
                "Ada",
                &nonce,
                Some(8),
                &proof,
            ),
            Err(AuthError::InvalidProof)
        );
    }

    #[test]
    fn malformed_secrets_and_proofs_are_rejected() {
        assert!(matches!(
            SessionAuthenticator::from_invite_code("not-a-valid-secret"),
            Err(AuthError::InvalidInviteCode)
        ));

        let credentials = GeneratedCredentials::generate().expect("generate credentials");
        assert_eq!(
            credentials.authenticator.verify_join(
                &credentials.session_id,
                "Ada",
                "nonce",
                None,
                "not-base64"
            ),
            Err(AuthError::InvalidProof)
        );
    }
}
