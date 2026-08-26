use std::fmt;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use futures_util::StreamExt;
use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION};
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::modules::net::{build_pinned_http_client, resolve_safe_http_target};
use crate::secrets::{delete_secret, get_secret, set_secret, SecretsState};

use super::http::BearerToken;
use super::stdio::{McpError, McpErrorKind};

const TOKEN_SERVICE: &str = "voktty-mcp-oauth";
const MAX_METADATA_BYTES: usize = 256 * 1024;
const MAX_TOKEN_BYTES: usize = 64 * 1024;
const MAX_URL_BYTES: usize = 8 * 1024;
const MAX_TOKEN_VALUE_BYTES: usize = 16 * 1024;
const MAX_REDIRECTS: usize = 5;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthDiscovery {
    pub resource: String,
    pub authorization_server: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub scopes_supported: Vec<String>,
}

pub struct AuthorizationRequest {
    pub url: String,
    pub state: String,
    verifier: String,
    client_id: String,
    redirect_uri: String,
    resource: String,
    token_endpoint: String,
}

impl fmt::Debug for AuthorizationRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthorizationRequest")
            .field("url", &self.url)
            .field("state", &"[redacted]")
            .field("verifier", &"[redacted]")
            .field("client_id", &self.client_id)
            .field("redirect_uri", &self.redirect_uri)
            .field("resource", &self.resource)
            .field("token_endpoint", &self.token_endpoint)
            .finish()
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct OAuthTokenSet {
    access_token: String,
    refresh_token: Option<String>,
    token_type: String,
    expires_at_unix: Option<u64>,
    scope: Option<String>,
}

impl fmt::Debug for OAuthTokenSet {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OAuthTokenSet")
            .field("access_token", &"[redacted]")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "[redacted]"),
            )
            .field("token_type", &self.token_type)
            .field("expires_at_unix", &self.expires_at_unix)
            .field("scope", &self.scope)
            .finish()
    }
}

impl OAuthTokenSet {
    pub fn bearer_token(&self) -> Result<BearerToken, McpError> {
        if !self.token_type.eq_ignore_ascii_case("bearer") {
            return Err(authentication_error("OAuth token type is not Bearer"));
        }
        BearerToken::new(self.access_token.clone())
    }

    pub fn expires_at_unix(&self) -> Option<u64> {
        self.expires_at_unix
    }

    pub fn is_expired(&self, now_unix: u64) -> bool {
        self.expires_at_unix
            .is_some_and(|expires_at| expires_at <= now_unix.saturating_add(30))
    }
}

pub struct OAuthTokenVault<'a> {
    app: &'a tauri::AppHandle,
    state: &'a SecretsState,
}

impl<'a> OAuthTokenVault<'a> {
    pub fn new(app: &'a tauri::AppHandle, state: &'a SecretsState) -> Self {
        Self { app, state }
    }

    pub fn load(&self, server_id: &str) -> Result<Option<OAuthTokenSet>, McpError> {
        let account = token_account(server_id)?;
        let Some(serialized) = get_secret(self.app, self.state, TOKEN_SERVICE, &account)
            .map_err(|_| authentication_error("could not read MCP OAuth credentials"))?
        else {
            return Ok(None);
        };
        serde_json::from_str(&serialized)
            .map(Some)
            .map_err(|_| authentication_error("stored MCP OAuth credentials are invalid"))
    }

    pub fn save(&self, server_id: &str, tokens: &OAuthTokenSet) -> Result<(), McpError> {
        let account = token_account(server_id)?;
        let serialized = serde_json::to_string(tokens)
            .map_err(|_| authentication_error("could not encode MCP OAuth credentials"))?;
        set_secret(self.app, self.state, TOKEN_SERVICE, &account, &serialized)
            .map_err(|_| authentication_error("could not store MCP OAuth credentials"))
    }

    pub fn delete(&self, server_id: &str) -> Result<(), McpError> {
        let account = token_account(server_id)?;
        delete_secret(self.app, self.state, TOKEN_SERVICE, &account)
            .map_err(|_| authentication_error("could not revoke MCP OAuth credentials"))
    }
}

pub struct OAuthManager {
    allow_private_network: bool,
    timeout: Duration,
}

impl OAuthManager {
    pub fn new(allow_private_network: bool) -> Self {
        Self {
            allow_private_network,
            timeout: Duration::from_secs(15),
        }
    }

    pub async fn discover(
        &self,
        www_authenticate: &str,
        resource: &str,
    ) -> Result<OAuthDiscovery, McpError> {
        let resource = secure_url(resource, self.allow_private_network).await?;
        let metadata_url = challenge_parameter(www_authenticate, "resource_metadata")?
            .ok_or_else(|| authentication_error("MCP OAuth challenge omitted resource_metadata"))?;
        let metadata_url = secure_url(&metadata_url, self.allow_private_network).await?;
        let protected: ProtectedResourceMetadata = self.get_json(metadata_url).await?;
        let protected_resource = Url::parse(&protected.resource)
            .map_err(|_| authentication_error("protected resource metadata is invalid"))?;
        if protected_resource != resource {
            return Err(authentication_error(
                "protected resource metadata does not match the MCP endpoint",
            ));
        }
        let issuer = protected
            .authorization_servers
            .first()
            .ok_or_else(|| authentication_error("protected resource has no authorization server"))?
            .clone();
        if protected.authorization_servers.len() > 8 {
            return Err(authentication_error(
                "protected resource exposes too many authorization servers",
            ));
        }
        let issuer_url = secure_url(&issuer, self.allow_private_network).await?;
        let metadata_endpoint = authorization_metadata_url(&issuer_url)?;
        let authorization: AuthorizationServerMetadata = self.get_json(metadata_endpoint).await?;
        if Url::parse(&authorization.issuer).ok().as_ref() != Some(&issuer_url) {
            return Err(authentication_error(
                "authorization server metadata has a mismatched issuer",
            ));
        }
        if !authorization
            .code_challenge_methods_supported
            .iter()
            .any(|method| method == "S256")
        {
            return Err(authentication_error(
                "authorization server does not support PKCE S256",
            ));
        }
        let authorization_endpoint = secure_url(
            &authorization.authorization_endpoint,
            self.allow_private_network,
        )
        .await?;
        let token_endpoint =
            secure_url(&authorization.token_endpoint, self.allow_private_network).await?;
        if !same_origin(&issuer_url, &authorization_endpoint)
            || !same_origin(&issuer_url, &token_endpoint)
        {
            return Err(authentication_error(
                "authorization endpoints changed issuer origin",
            ));
        }
        Ok(OAuthDiscovery {
            resource: resource.into(),
            authorization_server: issuer_url.into(),
            authorization_endpoint: authorization_endpoint.into(),
            token_endpoint: token_endpoint.into(),
            scopes_supported: protected.scopes_supported,
        })
    }

    pub fn start_authorization(
        &self,
        discovery: &OAuthDiscovery,
        client_id: &str,
        redirect_uri: &str,
        scopes: &[String],
    ) -> Result<AuthorizationRequest, McpError> {
        validate_client_id(client_id)?;
        validate_redirect_uri(redirect_uri)?;
        if scopes.len() > 32 || scopes.iter().any(|scope| !valid_scope(scope)) {
            return Err(authentication_error("OAuth scopes are invalid"));
        }
        let verifier = random_urlsafe(32)?;
        let state = random_urlsafe(32)?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = Url::parse(&discovery.authorization_endpoint)
            .map_err(|_| authentication_error("authorization endpoint is invalid"))?;
        if url.query().is_some() || url.fragment().is_some() {
            return Err(authentication_error(
                "authorization endpoint contains unexpected state",
            ));
        }
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("response_type", "code");
            query.append_pair("client_id", client_id);
            query.append_pair("redirect_uri", redirect_uri);
            query.append_pair("code_challenge", &challenge);
            query.append_pair("code_challenge_method", "S256");
            query.append_pair("resource", &discovery.resource);
            query.append_pair("state", &state);
            if !scopes.is_empty() {
                query.append_pair("scope", &scopes.join(" "));
            }
        }
        Ok(AuthorizationRequest {
            url: url.into(),
            state,
            verifier,
            client_id: client_id.into(),
            redirect_uri: redirect_uri.into(),
            resource: discovery.resource.clone(),
            token_endpoint: discovery.token_endpoint.clone(),
        })
    }

    pub async fn exchange_code(
        &self,
        request: AuthorizationRequest,
        returned_state: &str,
        code: &str,
    ) -> Result<OAuthTokenSet, McpError> {
        if !constant_time_eq(request.state.as_bytes(), returned_state.as_bytes()) {
            return Err(authentication_error("OAuth state did not match"));
        }
        if code.is_empty()
            || code.len() > 8 * 1024
            || code.as_bytes().iter().any(|byte| byte.is_ascii_control())
        {
            return Err(authentication_error("OAuth authorization code is invalid"));
        }
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "authorization_code")
            .append_pair("code", code)
            .append_pair("client_id", &request.client_id)
            .append_pair("redirect_uri", &request.redirect_uri)
            .append_pair("code_verifier", &request.verifier)
            .append_pair("resource", &request.resource)
            .finish();
        self.post_token(&request.token_endpoint, form).await
    }

    pub async fn refresh_token(
        &self,
        discovery: &OAuthDiscovery,
        client_id: &str,
        current: &OAuthTokenSet,
    ) -> Result<OAuthTokenSet, McpError> {
        validate_client_id(client_id)?;
        let refresh_token = current
            .refresh_token
            .as_deref()
            .ok_or_else(|| authentication_error("OAuth credentials have no refresh token"))?;
        let form = refresh_form(client_id, refresh_token, &discovery.resource);
        let mut refreshed = self.post_token(&discovery.token_endpoint, form).await?;
        if refreshed.refresh_token.is_none() {
            refreshed.refresh_token = current.refresh_token.clone();
        }
        Ok(refreshed)
    }

    async fn get_json<T: for<'de> Deserialize<'de>>(&self, url: Url) -> Result<T, McpError> {
        let bytes = self
            .send_bounded(Method::GET, url, None, MAX_METADATA_BYTES)
            .await?;
        serde_json::from_slice(&bytes)
            .map_err(|_| authentication_error("OAuth metadata response is invalid"))
    }

    async fn post_token(&self, endpoint: &str, form: String) -> Result<OAuthTokenSet, McpError> {
        let endpoint = secure_url(endpoint, self.allow_private_network).await?;
        let bytes = self
            .send_bounded(Method::POST, endpoint, Some(form), MAX_TOKEN_BYTES)
            .await?;
        let response: TokenResponse = serde_json::from_slice(&bytes)
            .map_err(|_| authentication_error("OAuth token response is invalid"))?;
        if response.access_token.is_empty()
            || response.access_token.len() > MAX_TOKEN_VALUE_BYTES
            || response
                .refresh_token
                .as_ref()
                .is_some_and(|token| token.len() > MAX_TOKEN_VALUE_BYTES)
            || !response.token_type.eq_ignore_ascii_case("bearer")
        {
            return Err(authentication_error("OAuth token response is unsafe"));
        }
        let expires_at_unix = response.expires_in.map(|seconds| {
            now_unix()
                .unwrap_or_default()
                .saturating_add(seconds.min(31_536_000))
        });
        Ok(OAuthTokenSet {
            access_token: response.access_token,
            refresh_token: response.refresh_token,
            token_type: response.token_type,
            expires_at_unix,
            scope: response.scope,
        })
    }

    async fn send_bounded(
        &self,
        method: Method,
        url: Url,
        form: Option<String>,
        limit: usize,
    ) -> Result<Vec<u8>, McpError> {
        let original = url.clone();
        let mut current = url;
        for redirect_count in 0..=MAX_REDIRECTS {
            let target = resolve_safe_http_target(current.as_str(), self.allow_private_network)
                .await
                .map_err(|_| authentication_error("OAuth network target was rejected"))?;
            let client = build_pinned_http_client(&target, self.timeout)
                .map_err(|_| authentication_error("OAuth HTTP client failed"))?;
            let mut request = client
                .request(method.clone(), target.url)
                .header(ACCEPT, "application/json");
            if let Some(form) = &form {
                request = request
                    .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                    .body(form.clone());
            }
            let response = request
                .send()
                .await
                .map_err(|_| authentication_error("OAuth HTTP request failed"))?;
            if response.status().is_redirection() {
                if redirect_count == MAX_REDIRECTS {
                    return Err(authentication_error("OAuth redirect limit exceeded"));
                }
                if method == Method::POST
                    && !matches!(
                        response.status(),
                        StatusCode::TEMPORARY_REDIRECT | StatusCode::PERMANENT_REDIRECT
                    )
                {
                    return Err(authentication_error(
                        "OAuth POST redirect did not preserve the request",
                    ));
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .filter(|value| value.len() <= MAX_URL_BYTES)
                    .ok_or_else(|| authentication_error("OAuth redirect is invalid"))?;
                let next = current
                    .join(location)
                    .map_err(|_| authentication_error("OAuth redirect is invalid"))?;
                if !same_origin(&original, &next) {
                    return Err(authentication_error("OAuth redirect changed origin"));
                }
                current = secure_url(next.as_str(), self.allow_private_network).await?;
                continue;
            }
            if !response.status().is_success() {
                return Err(authentication_error(format!(
                    "OAuth server returned status {}",
                    response.status()
                )));
            }
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(|value| value.split(';').next().unwrap_or_default().trim());
            if content_type != Some("application/json") {
                return Err(authentication_error(
                    "OAuth response content type is invalid",
                ));
            }
            let mut bytes = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|_| authentication_error("OAuth response stream failed"))?;
                if bytes.len().saturating_add(chunk.len()) > limit {
                    return Err(authentication_error("OAuth response exceeded its budget"));
                }
                bytes.extend_from_slice(&chunk);
            }
            return Ok(bytes);
        }
        Err(authentication_error("OAuth redirect limit exceeded"))
    }
}

#[derive(Deserialize)]
struct ProtectedResourceMetadata {
    resource: String,
    #[serde(default)]
    authorization_servers: Vec<String>,
    #[serde(default)]
    scopes_supported: Vec<String>,
}

#[derive(Deserialize)]
struct AuthorizationServerMetadata {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    code_challenge_methods_supported: Vec<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
}

async fn secure_url(value: &str, allow_private: bool) -> Result<Url, McpError> {
    if value.len() > MAX_URL_BYTES {
        return Err(authentication_error("OAuth URL is too long"));
    }
    let target = resolve_safe_http_target(value, allow_private)
        .await
        .map_err(|_| authentication_error("OAuth URL was rejected"))?;
    if target.url.fragment().is_some()
        || (target.url.scheme() != "https" && !target.is_private_network)
    {
        return Err(authentication_error("OAuth URL is not secure"));
    }
    Ok(target.url)
}

fn authorization_metadata_url(issuer: &Url) -> Result<Url, McpError> {
    let mut metadata = issuer.clone();
    let path = issuer.path().trim_end_matches('/');
    metadata.set_path(&format!("/.well-known/oauth-authorization-server{path}"));
    metadata.set_query(None);
    metadata.set_fragment(None);
    Ok(metadata)
}

fn challenge_parameter(header: &str, name: &str) -> Result<Option<String>, McpError> {
    let trimmed = header.trim();
    let Some(parameters) = trimmed
        .get(..6)
        .filter(|prefix| prefix.eq_ignore_ascii_case("bearer"))
        .map(|_| trimmed[6..].trim())
    else {
        return Err(authentication_error("MCP OAuth challenge is not Bearer"));
    };
    for part in split_challenge_parameters(parameters)? {
        let Some((key, raw)) = part.split_once('=') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case(name) {
            let raw = raw.trim();
            let value = raw
                .strip_prefix('"')
                .and_then(|value| value.strip_suffix('"'))
                .unwrap_or(raw);
            if value.is_empty() || value.contains(['\r', '\n', '\0']) {
                return Err(authentication_error("MCP OAuth challenge is invalid"));
            }
            return Ok(Some(value.into()));
        }
    }
    Ok(None)
}

fn split_challenge_parameters(value: &str) -> Result<Vec<&str>, McpError> {
    let mut parts = Vec::new();
    let mut quoted = false;
    let mut start = 0usize;
    for (index, character) in value.char_indices() {
        match character {
            '"' => quoted = !quoted,
            ',' if !quoted => {
                parts.push(value[start..index].trim());
                start = index + 1;
            }
            _ => {}
        }
    }
    if quoted {
        return Err(authentication_error("MCP OAuth challenge is invalid"));
    }
    parts.push(value[start..].trim());
    Ok(parts)
}

fn validate_client_id(client_id: &str) -> Result<(), McpError> {
    if client_id.is_empty()
        || client_id.len() > 2 * 1024
        || client_id
            .as_bytes()
            .iter()
            .any(|byte| byte.is_ascii_control())
    {
        return Err(authentication_error("OAuth client id is invalid"));
    }
    Ok(())
}

fn validate_redirect_uri(value: &str) -> Result<(), McpError> {
    let url = Url::parse(value).map_err(|_| authentication_error("redirect URI is invalid"))?;
    let loopback = match url.host() {
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        _ => false,
    };
    if url.scheme() != "http"
        || !loopback
        || url.fragment().is_some()
        || url.username() != ""
        || url.password().is_some()
    {
        return Err(authentication_error(
            "desktop OAuth redirect URI must use loopback HTTP",
        ));
    }
    Ok(())
}

fn valid_scope(scope: &str) -> bool {
    !scope.is_empty()
        && scope.len() <= 256
        && scope
            .bytes()
            .all(|byte| matches!(byte, 0x21 | 0x23..=0x5b | 0x5d..=0x7e))
}

fn token_account(server_id: &str) -> Result<String, McpError> {
    if server_id.is_empty()
        || server_id.len() > 128
        || !server_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(authentication_error("MCP server id is invalid"));
    }
    Ok(format!("mcp-oauth:{server_id}"))
}

fn refresh_form(client_id: &str, refresh_token: &str, resource: &str) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "refresh_token")
        .append_pair("refresh_token", refresh_token)
        .append_pair("client_id", client_id)
        .append_pair("resource", resource)
        .finish()
}

fn random_urlsafe(bytes: usize) -> Result<String, McpError> {
    let mut random = vec![0u8; bytes];
    getrandom::fill(&mut random)
        .map_err(|_| authentication_error("secure OAuth randomness is unavailable"))?;
    Ok(URL_SAFE_NO_PAD.encode(random))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    let length = left.len().max(right.len());
    for index in 0..length {
        let left = left.get(index).copied().unwrap_or_default();
        let right = right.get(index).copied().unwrap_or_default();
        difference |= usize::from(left ^ right);
    }
    difference == 0
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn now_unix() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn authentication_error(message: impl AsRef<str>) -> McpError {
    McpError::new(McpErrorKind::Authentication, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovery() -> OAuthDiscovery {
        OAuthDiscovery {
            resource: "https://mcp.example.test/messages".into(),
            authorization_server: "https://auth.example.test".into(),
            authorization_endpoint: "https://auth.example.test/authorize".into(),
            token_endpoint: "https://auth.example.test/token".into(),
            scopes_supported: vec!["mcp:tools".into()],
        }
    }

    #[test]
    fn bearer_challenge_extracts_protected_resource_metadata() {
        let value = challenge_parameter(
            "Bearer realm=\"mcp\", resource_metadata=\"https://mcp.example.test/.well-known/oauth-protected-resource\"",
            "resource_metadata",
        )
        .unwrap();

        assert_eq!(
            value.as_deref(),
            Some("https://mcp.example.test/.well-known/oauth-protected-resource")
        );
    }

    #[test]
    fn authorization_request_binds_pkce_state_resource_and_redirect() {
        let manager = OAuthManager::new(false);
        let request = manager
            .start_authorization(
                &discovery(),
                "https://voktty.dev/oauth/client.json",
                "http://127.0.0.1:49152/callback",
                &["mcp:tools".into()],
            )
            .unwrap();
        let url = Url::parse(&request.url).unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
        let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(request.verifier.as_bytes()));

        assert_eq!(
            query.get("code_challenge").map(|value| value.as_ref()),
            Some(expected.as_str())
        );
        assert_eq!(
            query
                .get("code_challenge_method")
                .map(|value| value.as_ref()),
            Some("S256")
        );
        assert_eq!(
            query.get("resource").map(|value| value.as_ref()),
            Some(discovery().resource.as_str())
        );
        assert_eq!(
            query.get("state").map(|value| value.as_ref()),
            Some(request.state.as_str())
        );
        assert_eq!(
            query.get("redirect_uri").map(|value| value.as_ref()),
            Some("http://127.0.0.1:49152/callback")
        );
    }

    #[test]
    fn state_comparison_rejects_length_and_content_changes() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"other"));
        assert!(!constant_time_eq(b"same", b"same-longer"));
    }

    #[test]
    fn token_debug_output_never_contains_credentials() {
        let token = OAuthTokenSet {
            access_token: "access-secret".into(),
            refresh_token: Some("refresh-secret".into()),
            token_type: "Bearer".into(),
            expires_at_unix: Some(100),
            scope: Some("mcp:tools".into()),
        };
        let debug = format!("{token:?}");

        assert!(!debug.contains("access-secret"));
        assert!(!debug.contains("refresh-secret"));
        assert!(debug.contains("[redacted]"));
    }

    #[test]
    fn redirect_uri_is_limited_to_literal_loopback() {
        assert!(validate_redirect_uri("http://127.0.0.1:4000/callback").is_ok());
        assert!(validate_redirect_uri("http://[::1]:4000/callback").is_ok());
        assert!(validate_redirect_uri("http://localhost:4000/callback").is_err());
        assert!(validate_redirect_uri("https://attacker.example/callback").is_err());
    }

    #[test]
    fn keychain_account_is_stable_and_bounded() {
        assert_eq!(token_account("server-1").unwrap(), "mcp-oauth:server-1");
        assert!(token_account("../escape").is_err());
    }

    #[test]
    fn refresh_request_remains_bound_to_the_resource() {
        let form = refresh_form(
            "https://voktty.dev/oauth/client.json",
            "refresh-secret",
            "https://mcp.example.test/messages",
        );
        let fields: std::collections::HashMap<_, _> =
            url::form_urlencoded::parse(form.as_bytes()).collect();

        assert_eq!(
            fields.get("grant_type").map(|value| value.as_ref()),
            Some("refresh_token")
        );
        assert_eq!(
            fields.get("resource").map(|value| value.as_ref()),
            Some("https://mcp.example.test/messages")
        );
    }
}
