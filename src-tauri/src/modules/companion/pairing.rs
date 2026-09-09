use std::collections::HashMap;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use serde::Serialize;
use voktty_companion_protocol::{
    AuthorizedDevice, PairingRequest, INVITATION_TTL_SECS, MAX_DEVICE_NAME_BYTES,
    PROTOCOL_VERSION,
};

type HmacSha256 = Hmac<Sha256>;

const PROOF_CONTEXT: &[u8] = b"voktty-companion-pair-v1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PendingPairing {
    pub id: String,
    pub device_name: String,
    pub device_public_key: String,
    pub fingerprint: String,
    pub expires_at_ms: u64,
}

pub(super) struct PairingRegistry {
    invitation_id: String,
    secret: Vec<u8>,
    expires_at_ms: u64,
    consumed: bool,
    pending: HashMap<String, PendingPairing>,
    decisions: HashMap<String, PairingDecision>,
    devices: HashMap<String, AuthorizedDevice>,
}

impl PairingRegistry {
    pub fn new(invitation_id: &str, secret: &str, expires_at_ms: u64) -> Result<Self, String> {
        let secret = URL_SAFE_NO_PAD
            .decode(secret)
            .map_err(|_| "companion invitation secret is invalid".to_string())?;
        if secret.len() < 32 {
            return Err("companion invitation secret is too short".to_string());
        }
        Ok(Self {
            invitation_id: invitation_id.to_string(),
            secret,
            expires_at_ms,
            consumed: false,
            pending: HashMap::new(),
            decisions: HashMap::new(),
            devices: HashMap::new(),
        })
    }

    pub fn request(
        &mut self,
        request: PairingRequest,
        now_ms: u64,
        request_id: String,
    ) -> Result<PendingPairing, PairingError> {
        if now_ms >= self.expires_at_ms {
            return Err(PairingError::Expired);
        }
        if self.consumed {
            return Err(PairingError::Consumed);
        }
        if request.protocol != PROTOCOL_VERSION {
            return Err(PairingError::UnsupportedProtocol);
        }
        if request.invitation_id != self.invitation_id {
            return Err(PairingError::Rejected);
        }
        validate_nonempty(&request.device_name, MAX_DEVICE_NAME_BYTES)?;
        validate_nonempty(&request.device_public_key, 256)?;
        let proof = URL_SAFE_NO_PAD
            .decode(&request.proof)
            .map_err(|_| PairingError::Rejected)?;
        let expected = proof_for(
            &self.secret,
            &request.invitation_id,
            &request.device_name,
            &request.device_public_key,
        );
        if proof.len() != expected.len() || !constant_time_eq(&proof, &expected) {
            return Err(PairingError::Rejected);
        }

        self.consumed = true;
        let pending = PendingPairing {
            id: request_id,
            device_name: request.device_name,
            fingerprint: fingerprint(&request.device_public_key),
            device_public_key: request.device_public_key,
            expires_at_ms: now_ms.saturating_add(INVITATION_TTL_SECS.saturating_mul(1000)),
        };
        self.pending.insert(pending.id.clone(), pending.clone());
        self.decisions
            .insert(pending.id.clone(), PairingDecision::Pending);
        Ok(pending)
    }

    pub fn approve(&mut self, request_id: &str, now_ms: u64) -> Result<AuthorizedDevice, PairingError> {
        let pending = self.pending.remove(request_id).ok_or(PairingError::Rejected)?;
        if now_ms >= pending.expires_at_ms {
            return Err(PairingError::Expired);
        }
        let device = AuthorizedDevice {
            id: pending.id,
            name: pending.device_name,
            public_key: pending.device_public_key,
            approved_at_ms: now_ms,
            last_connected_at_ms: Some(now_ms),
        };
        self.devices.insert(device.id.clone(), device.clone());
        self.decisions
            .insert(request_id.to_string(), PairingDecision::Approved);
        Ok(device)
    }

    pub fn reject(&mut self, request_id: &str) -> bool {
        if self.pending.remove(request_id).is_some() {
            self.decisions
                .insert(request_id.to_string(), PairingDecision::Rejected);
            true
        } else {
            false
        }
    }

    pub fn pending(&self) -> Vec<PendingPairing> {
        let mut pending: Vec<_> = self.pending.values().cloned().collect();
        pending.sort_by(|left, right| left.id.cmp(&right.id));
        pending
    }

    pub fn devices(&self) -> Vec<AuthorizedDevice> {
        self.devices.values().cloned().collect()
    }

    pub fn decision(&mut self, request_id: &str, now_ms: u64) -> Option<PairingDecision> {
        let expired = self
            .pending
            .get(request_id)
            .is_some_and(|pending| now_ms >= pending.expires_at_ms);
        if expired {
            self.pending.remove(request_id);
            self.decisions
                .insert(request_id.to_string(), PairingDecision::Expired);
        }
        self.decisions.get(request_id).copied()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PairingDecision {
    Pending,
    Approved,
    Rejected,
    Expired,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum PairingError {
    Consumed,
    Expired,
    Rejected,
    UnsupportedProtocol,
}

fn validate_nonempty(value: &str, max_bytes: usize) -> Result<(), PairingError> {
    if value.is_empty() || value.len() > max_bytes {
        return Err(PairingError::Rejected);
    }
    Ok(())
}

fn proof_for(secret: &[u8], invitation_id: &str, device_name: &str, device_public_key: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts arbitrary key lengths");
    for value in [PROOF_CONTEXT, invitation_id.as_bytes(), device_name.as_bytes(), device_public_key.as_bytes()] {
        mac.update(&(value.len() as u64).to_be_bytes());
        mac.update(value);
    }
    mac.finalize().into_bytes().to_vec()
}

fn fingerprint(public_key: &str) -> String {
    let digest = Sha256::digest(public_key.as_bytes());
    hex::encode(&digest[..6]).to_uppercase()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> PairingRegistry {
        PairingRegistry::new("invite-1", &URL_SAFE_NO_PAD.encode([7_u8; 32]), 10_000).expect("registry")
    }

    fn request() -> PairingRequest {
        let secret = [7_u8; 32];
        let proof = proof_for(&secret, "invite-1", "Pixel", "device-key");
        PairingRequest {
            protocol: PROTOCOL_VERSION,
            invitation_id: "invite-1".to_string(),
            device_name: "Pixel".to_string(),
            device_public_key: "device-key".to_string(),
            proof: URL_SAFE_NO_PAD.encode(proof),
        }
    }

    #[test]
    fn valid_request_is_single_use_and_requires_approval() {
        let mut registry = registry();
        let pending = registry.request(request(), 100, "request-1".to_string()).expect("pending");
        assert_eq!(pending.fingerprint.len(), 12);
        assert_eq!(registry.request(request(), 100, "request-2".to_string()), Err(PairingError::Consumed));
        let device = registry.approve("request-1", 101).expect("approval");
        assert_eq!(device.name, "Pixel");
        assert_eq!(registry.devices(), vec![device]);
    }

    #[test]
    fn rejects_tampered_proof_before_consuming_invitation() {
        let mut registry = registry();
        let mut tampered = request();
        tampered.proof = "bad".to_string();
        assert_eq!(registry.request(tampered, 100, "request-1".to_string()), Err(PairingError::Rejected));
        assert!(registry.request(request(), 100, "request-2".to_string()).is_ok());
    }

    #[test]
    fn rejects_expired_pending_request() {
        let mut registry = registry();
        registry.request(request(), 1, "request-1".to_string()).expect("pending");
        assert_eq!(registry.approve("request-1", 10_001), Err(PairingError::Expired));
    }
}
