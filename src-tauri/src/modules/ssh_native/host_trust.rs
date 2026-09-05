//! The single decision point for accepting a server's host key.
//!
//! Pure on purpose: the transport calls it from inside a callback where doing
//! anything interesting is awkward, and this is the rule set worth testing
//! exhaustively.

use super::known_hosts::{self, HostKeyVerdict, KnownHostEntry};
use super::types::{HostKeyApproval, HostKeyPrompt, SshErrorCode, SshNativeError};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrustDecision {
    Accept { remember: bool },
    Reject(SshNativeError),
}

pub struct PresentedKey<'a> {
    pub key_type: &'a str,
    pub key_base64: &'a str,
    pub fingerprint: &'a str,
}

pub fn decide(
    entries: &[KnownHostEntry],
    host: &str,
    port: u16,
    key: &PresentedKey<'_>,
    approval: &HostKeyApproval,
) -> TrustDecision {
    let verdict = known_hosts::verify(entries, host, port, key.key_type, key.key_base64);

    let changed = match verdict {
        HostKeyVerdict::Trusted => return TrustDecision::Accept { remember: false },
        // A revocation is not something the user can click through.
        HostKeyVerdict::Revoked => {
            return reject(SshErrorCode::HostKeyRevoked, host, port, key, true)
        }
        HostKeyVerdict::Changed { .. } => true,
        HostKeyVerdict::Unknown => false,
    };

    if let HostKeyApproval::Approve {
        key_base64,
        remember,
    } = approval
    {
        // Bound to the exact key the user was shown: a server that answers the
        // retry with a different key is still refused.
        if key_base64 == key.key_base64 {
            return TrustDecision::Accept {
                remember: *remember,
            };
        }
    }

    let code = if changed {
        SshErrorCode::HostKeyChanged
    } else {
        SshErrorCode::HostKeyUnknown
    };
    reject(code, host, port, key, changed)
}

fn reject(
    code: SshErrorCode,
    host: &str,
    port: u16,
    key: &PresentedKey<'_>,
    changed: bool,
) -> TrustDecision {
    TrustDecision::Reject(SshNativeError::host_key(
        code,
        HostKeyPrompt {
            host: host.to_string(),
            port,
            key_type: key.key_type.to_string(),
            key_base64: key.key_base64.to_string(),
            fingerprint: key.fingerprint.to_string(),
            changed,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIGtestkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const KEY_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIGotherkeyAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn presented(key: &str) -> PresentedKey<'_> {
        PresentedKey {
            key_type: "ssh-ed25519",
            key_base64: key,
            fingerprint: "SHA256:test",
        }
    }

    fn approve(key: &str, remember: bool) -> HostKeyApproval {
        HostKeyApproval::Approve {
            key_base64: key.to_string(),
            remember,
        }
    }

    fn code(decision: &TrustDecision) -> SshErrorCode {
        match decision {
            TrustDecision::Reject(error) => error.code,
            TrustDecision::Accept { .. } => panic!("expected a rejection"),
        }
    }

    #[test]
    fn a_known_key_is_accepted_without_remembering() {
        let entries = known_hosts::parse(&format!("example.com ssh-ed25519 {KEY_A}\n"));
        assert_eq!(
            decide(
                &entries,
                "example.com",
                22,
                &presented(KEY_A),
                &HostKeyApproval::None
            ),
            TrustDecision::Accept { remember: false }
        );
    }

    #[test]
    fn an_unknown_key_is_refused_without_approval() {
        let decision = decide(
            &[],
            "example.com",
            22,
            &presented(KEY_A),
            &HostKeyApproval::None,
        );
        assert_eq!(code(&decision), SshErrorCode::HostKeyUnknown);
    }

    #[test]
    fn the_rejection_carries_what_the_user_needs_to_decide() {
        let decision = decide(
            &[],
            "example.com",
            2222,
            &presented(KEY_A),
            &HostKeyApproval::None,
        );
        let TrustDecision::Reject(error) = decision else {
            panic!("expected a rejection");
        };
        let prompt = error.prompt.expect("prompt present");
        assert_eq!(prompt.host, "example.com");
        assert_eq!(prompt.port, 2222);
        assert_eq!(prompt.key_base64, KEY_A);
        assert_eq!(prompt.fingerprint, "SHA256:test");
        assert!(!prompt.changed);
    }

    #[test]
    fn approving_the_exact_key_accepts_it() {
        assert_eq!(
            decide(
                &[],
                "example.com",
                22,
                &presented(KEY_A),
                &approve(KEY_A, true)
            ),
            TrustDecision::Accept { remember: true }
        );
    }

    #[test]
    fn approving_one_key_does_not_accept_another() {
        let decision = decide(
            &[],
            "example.com",
            22,
            &presented(KEY_B),
            &approve(KEY_A, true),
        );
        assert_eq!(code(&decision), SshErrorCode::HostKeyUnknown);
    }

    #[test]
    fn a_changed_key_is_reported_as_changed_and_needs_approval() {
        let entries = known_hosts::parse(&format!("example.com ssh-ed25519 {KEY_A}\n"));
        let decision = decide(
            &entries,
            "example.com",
            22,
            &presented(KEY_B),
            &HostKeyApproval::None,
        );
        assert_eq!(code(&decision), SshErrorCode::HostKeyChanged);
        let TrustDecision::Reject(error) = decision else {
            panic!("expected a rejection");
        };
        assert!(error.prompt.expect("prompt present").changed);

        assert_eq!(
            decide(
                &entries,
                "example.com",
                22,
                &presented(KEY_B),
                &approve(KEY_B, false)
            ),
            TrustDecision::Accept { remember: false }
        );
    }

    #[test]
    fn approval_cannot_override_a_revocation() {
        let entries = known_hosts::parse(&format!("@revoked example.com ssh-ed25519 {KEY_A}\n"));
        let decision = decide(
            &entries,
            "example.com",
            22,
            &presented(KEY_A),
            &approve(KEY_A, true),
        );
        assert_eq!(code(&decision), SshErrorCode::HostKeyRevoked);
    }

    #[test]
    fn a_key_known_on_another_port_still_needs_approval() {
        let entries = known_hosts::parse(&format!("example.com ssh-ed25519 {KEY_A}\n"));
        let decision = decide(
            &entries,
            "example.com",
            2222,
            &presented(KEY_A),
            &HostKeyApproval::None,
        );
        assert_eq!(code(&decision), SshErrorCode::HostKeyUnknown);
    }
}
