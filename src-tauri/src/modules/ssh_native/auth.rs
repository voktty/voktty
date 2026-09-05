//! The authentication chain.
//!
//! Methods are tried in the order the caller supplied. A method that fails
//! never aborts the chain: only exhausting every method is a failure, so a
//! stale agent key cannot mask a working password.

use std::sync::Arc;

use russh::client::{AuthResult, Handle};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg};

use super::agent;
use super::connection::NativeHandler;
use super::types::{SshCredential, SshErrorCode, SshNativeError};

/// Enough to cover an agent holding many keys without letting a hostile agent
/// keep the chain alive indefinitely.
const MAX_AGENT_IDENTITIES: usize = 16;

fn validate(user: &str, credentials: &[SshCredential]) -> Result<(), SshNativeError> {
    if user.trim().is_empty() {
        return Err(SshNativeError::new(
            SshErrorCode::Config,
            "no username for the connection",
        ));
    }
    if credentials.is_empty() {
        return Err(SshNativeError::new(
            SshErrorCode::AuthFailed,
            "no authentication method offered",
        ));
    }
    Ok(())
}

pub async fn authenticate(
    handle: &mut Handle<NativeHandler>,
    user: &str,
    credentials: &[SshCredential],
) -> Result<(), SshNativeError> {
    validate(user, credentials)?;

    // Asked once, and only if some credential can actually use it.
    let mut rsa_hash: Option<Option<HashAlg>> = None;
    let mut attempts: Vec<String> = Vec::new();

    for credential in credentials {
        let outcome = match credential {
            SshCredential::Agent => try_agent(handle, user.to_string(), &mut rsa_hash).await,
            SshCredential::PrivateKey { path, passphrase } => {
                try_private_key(
                    handle,
                    user.to_string(),
                    path.clone(),
                    passphrase.clone(),
                    &mut rsa_hash,
                )
                .await
            }
            SshCredential::Password { secret } => {
                try_password(handle, user.to_string(), secret.clone()).await
            }
        };

        match outcome {
            Ok(true) => return Ok(()),
            Ok(false) => attempts.push(describe(credential)),
            Err(detail) => attempts.push(format!("{} ({detail})", describe(credential))),
        }
    }

    Err(SshNativeError::new(
        SshErrorCode::AuthFailed,
        format!(
            "authentication failed for {user}: tried {}",
            attempts.join(", ")
        ),
    ))
}

fn describe(credential: &SshCredential) -> String {
    match credential {
        SshCredential::Agent => "agent".into(),
        SshCredential::PrivateKey { path, .. } => format!("key {path}"),
        SshCredential::Password { .. } => "password".into(),
    }
}

fn succeeded(result: &AuthResult) -> bool {
    matches!(result, AuthResult::Success)
}

/// The server advertises which RSA signature hashes it accepts. Resolving it
/// lazily keeps a connection that only uses Ed25519 from waiting on it.
async fn resolve_rsa_hash(
    handle: &Handle<NativeHandler>,
    cached: &mut Option<Option<HashAlg>>,
) -> Option<HashAlg> {
    if cached.is_none() {
        *cached = Some(
            handle
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten(),
        );
    }
    cached.expect("just populated")
}

/// The helpers take owned values: a `&str` crossing an async boundary reached
/// from a Tauri command fails the command future's higher-ranked `Send` bound.
async fn try_agent(
    handle: &mut Handle<NativeHandler>,
    user: String,
    rsa_hash: &mut Option<Option<HashAlg>>,
) -> Result<bool, String> {
    let mut client = agent::connect().await.map_err(|e| e.message)?;
    let identities = client
        .request_identities()
        .await
        .map_err(|e| format!("cannot list agent identities: {e}"))?;
    if identities.is_empty() {
        return Err("agent holds no identities".into());
    }

    let hash = resolve_rsa_hash(handle, rsa_hash).await;
    for identity in identities.into_iter().take(MAX_AGENT_IDENTITIES) {
        let hash_alg = identity.algorithm().is_rsa().then_some(hash).flatten();
        match handle
            .authenticate_publickey_with(user.clone(), identity, hash_alg, &mut client)
            .await
        {
            Ok(result) if succeeded(&result) => return Ok(true),
            // One unusable identity says nothing about the next one.
            Ok(_) | Err(_) => continue,
        }
    }
    Ok(false)
}

async fn try_private_key(
    handle: &mut Handle<NativeHandler>,
    user: String,
    path: String,
    passphrase: Option<String>,
    rsa_hash: &mut Option<Option<HashAlg>>,
) -> Result<bool, String> {
    let expanded = crate::modules::remote::expand_tilde(&path);
    let key = russh::keys::load_secret_key(&expanded, passphrase.as_deref())
        .map_err(|e| format!("cannot load {expanded}: {e}"))?;
    let hash_alg = if key.algorithm().is_rsa() {
        resolve_rsa_hash(handle, rsa_hash).await
    } else {
        None
    };

    handle
        .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg))
        .await
        .map(|result| succeeded(&result))
        .map_err(|e| e.to_string())
}

async fn try_password(
    handle: &mut Handle<NativeHandler>,
    user: String,
    password: String,
) -> Result<bool, String> {
    handle
        .authenticate_password(user, password)
        .await
        .map(|result| succeeded(&result))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_credential_description_never_leaks_its_secret() {
        assert_eq!(
            describe(&SshCredential::Password {
                secret: "hunter2".into()
            }),
            "password"
        );
        assert_eq!(
            describe(&SshCredential::PrivateKey {
                path: "~/.ssh/id_ed25519".into(),
                passphrase: Some("s3cret".into()),
            }),
            "key ~/.ssh/id_ed25519"
        );
    }

    #[test]
    fn a_connection_without_a_username_is_a_configuration_error() {
        let error = validate("  ", &[SshCredential::Agent]).expect_err("blank user is refused");
        assert_eq!(error.code, SshErrorCode::Config);
    }

    #[test]
    fn a_connection_without_any_method_fails_authentication() {
        let error = validate("root", &[]).expect_err("no method is refused");
        assert_eq!(error.code, SshErrorCode::AuthFailed);
    }

    #[test]
    fn only_an_outright_success_counts() {
        assert!(succeeded(&AuthResult::Success));
        assert!(!succeeded(&AuthResult::Failure {
            remaining_methods: russh::MethodSet::from(&[russh::MethodKind::Password][..]),
            partial_success: true,
        }));
    }
}
