use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, Response};

// Global cancellation map for in-flight requests
type CancellationMap = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>;
static ACTIVE_CANCELLATIONS: std::sync::LazyLock<CancellationMap> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

pub fn cancel_in_flight_request(request_id: &str) -> bool {
    let mut map = ACTIVE_CANCELLATIONS.lock().unwrap();
    if let Some(tx) = map.remove(request_id) {
        let _ = tx.send(());
        true
    } else {
        false
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValueParam {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum ApiRequestBody {
    None,
    Json(serde_json::Value),
    Text(String),
    FormUrlEncoded(Vec<KeyValueParam>),
    Raw {
        content: String,
        content_type: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ApiRequestAuth {
    None,
    Bearer {
        token: String,
    },
    ApiKey {
        key: String,
        value: String,
        in_header: bool, // true = header, false = query
    },
    Basic {
        username: String,
        password: String,
    },
    OAuth2 {
        token: String,
        token_type: Option<String>,
    },
    AwsSigV4 {
        access_key: String,
        secret_key: String,
        region: String,
        service: String,
        session_token: Option<String>,
    },
    Digest {
        username: String,
        password: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequestPayload {
    pub id: Option<String>,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub query_params: Vec<KeyValueParam>,
    #[serde(default = "default_body_none")]
    pub body: ApiRequestBody,
    #[serde(default = "default_auth_none")]
    pub auth: ApiRequestAuth,
    pub timeout_ms: Option<u64>,
    #[serde(default = "default_true")]
    pub follow_redirects: bool,
    #[serde(default)]
    pub insecure_skip_verify: bool,
    #[serde(default)]
    pub variables: Option<HashMap<String, String>>,
    #[serde(default)]
    pub is_agent_call: bool,
}

fn default_body_none() -> ApiRequestBody {
    ApiRequestBody::None
}

fn default_auth_none() -> ApiRequestAuth {
    ApiRequestAuth::None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiTimings {
    pub dns_lookup_ms: Option<f64>,
    pub tcp_connect_ms: Option<f64>,
    pub tls_handshake_ms: Option<f64>,
    pub first_byte_ms: Option<f64>,
    pub download_ms: Option<f64>,
    pub total_duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponsePayload {
    pub request_id: Option<String>,
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub body_bytes_len: usize,
    pub is_json: bool,
    pub json_value: Option<serde_json::Value>,
    pub timings: ApiTimings,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ApiStreamEvent {
    Status {
        code: u16,
        reason: String,
    },
    Header {
        key: String,
        value: String,
    },
    Chunk {
        data: String,
        bytes_len: usize,
    },
    Done {
        total_bytes: usize,
        duration_ms: f64,
    },
    Error {
        message: String,
    },
}

/// Simple regex-free variable interpolation for {{ variable_name }}
pub fn interpolate_variables(input: &str, vars: &HashMap<String, String>) -> String {
    let mut out = input.to_string();
    for (k, v) in vars {
        let pattern1 = format!("{{{{{}}}}}", k.trim());
        let pattern2 = format!("{{{{ {} }}}}", k.trim());
        out = out.replace(&pattern1, v).replace(&pattern2, v);
    }
    out
}

pub async fn execute_http_request(
    mut req: ApiRequestPayload,
) -> Result<ApiResponsePayload, String> {
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let req_id = req
        .id
        .clone()
        .unwrap_or_else(|| format!("req_{}", Instant::now().elapsed().as_nanos()));

    {
        let mut map = ACTIVE_CANCELLATIONS.lock().unwrap();
        map.insert(req_id.clone(), cancel_tx);
    }

    // Ensure we unregister on return
    struct CancelGuard(String);
    impl Drop for CancelGuard {
        fn drop(&mut self) {
            let mut map = ACTIVE_CANCELLATIONS.lock().unwrap();
            map.remove(&self.0);
        }
    }
    let _guard = CancelGuard(req_id.clone());

    // Interpolate environment variables if provided
    if let Some(ref vars) = req.variables {
        req.url = interpolate_variables(&req.url, vars);
        for q in &mut req.query_params {
            q.key = interpolate_variables(&q.key, vars);
            q.value = interpolate_variables(&q.value, vars);
        }
        let mut new_headers = HashMap::new();
        for (k, v) in &req.headers {
            new_headers.insert(
                interpolate_variables(k, vars),
                interpolate_variables(v, vars),
            );
        }
        req.headers = new_headers;
    }

    let start_instant = Instant::now();

    // 1. Parse URL & Query params
    let mut url = url::Url::parse(&req.url).map_err(|e| format!("Invalid URL: {e}"))?;

    // Agent SSRF Security Guard check if marked as agent call
    if req.is_agent_call {
        if let Some(host) = url.host_str() {
            if host == "169.254.169.254" || host == "metadata.google.internal" || host == "metadata"
            {
                return Err("Blocked: Access to cloud metadata service is prohibited".to_string());
            }
        }
    }

    for qp in &req.query_params {
        if qp.enabled && !qp.key.trim().is_empty() {
            url.query_pairs_mut().append_pair(&qp.key, &qp.value);
        }
    }

    // Apply ApiKey query auth if configured
    if let ApiRequestAuth::ApiKey {
        ref key,
        ref value,
        in_header: false,
    } = req.auth
    {
        if !key.is_empty() {
            url.query_pairs_mut().append_pair(key, value);
        }
    }

    // 2. Parse Method
    let method = match req.method.to_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "PATCH" => Method::PATCH,
        "DELETE" => Method::DELETE,
        "HEAD" => Method::HEAD,
        "OPTIONS" => Method::OPTIONS,
        other => Method::from_bytes(other.as_bytes())
            .map_err(|e| format!("Invalid HTTP method '{other}': {e}"))?,
    };

    // 3. Build Client with timeout & TLS options
    let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(30_000).max(100));
    let mut builder =
        reqwest::Client::builder()
            .timeout(timeout)
            .redirect(if req.follow_redirects {
                reqwest::redirect::Policy::limited(10)
            } else {
                reqwest::redirect::Policy::none()
            });

    if req.insecure_skip_verify {
        builder = builder.danger_accept_invalid_certs(true);
    }

    let client = builder
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let mut request_builder = client.request(method, url);

    // 4. Set Headers
    let mut header_map = HeaderMap::new();
    for (k, v) in &req.headers {
        if let (Ok(hname), Ok(hval)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            header_map.insert(hname, hval);
        }
    }

    // 5. Apply Auth Headers
    match req.auth {
        ApiRequestAuth::Bearer { ref token } => {
            if !token.is_empty() {
                if let Ok(hval) = HeaderValue::from_str(&format!("Bearer {token}")) {
                    header_map.insert(reqwest::header::AUTHORIZATION, hval);
                }
            }
        }
        ApiRequestAuth::OAuth2 {
            ref token,
            ref token_type,
        } => {
            if !token.is_empty() {
                let prefix = token_type.as_deref().unwrap_or("Bearer");
                if let Ok(hval) = HeaderValue::from_str(&format!("{prefix} {token}")) {
                    header_map.insert(reqwest::header::AUTHORIZATION, hval);
                }
            }
        }
        ApiRequestAuth::ApiKey {
            ref key,
            ref value,
            in_header: true,
        } => {
            if !key.is_empty() {
                if let (Ok(hname), Ok(hval)) = (
                    HeaderName::from_bytes(key.as_bytes()),
                    HeaderValue::from_str(value),
                ) {
                    header_map.insert(hname, hval);
                }
            }
        }
        ApiRequestAuth::Basic {
            ref username,
            ref password,
        } => {
            request_builder = request_builder.basic_auth(username, Some(password));
        }
        _ => {}
    }

    // 6. Apply Body
    match req.body {
        ApiRequestBody::None => {}
        ApiRequestBody::Json(ref json) => {
            if !header_map.contains_key(reqwest::header::CONTENT_TYPE) {
                header_map.insert(
                    reqwest::header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json; charset=utf-8"),
                );
            }
            let serialized = serde_json::to_string(json).unwrap_or_else(|_| "{}".to_string());
            request_builder = request_builder.body(serialized);
        }
        ApiRequestBody::Text(ref text) => {
            if !header_map.contains_key(reqwest::header::CONTENT_TYPE) {
                header_map.insert(
                    reqwest::header::CONTENT_TYPE,
                    HeaderValue::from_static("text/plain; charset=utf-8"),
                );
            }
            request_builder = request_builder.body(text.clone());
        }
        ApiRequestBody::FormUrlEncoded(ref params) => {
            if !header_map.contains_key(reqwest::header::CONTENT_TYPE) {
                header_map.insert(
                    reqwest::header::CONTENT_TYPE,
                    HeaderValue::from_static("application/x-www-form-urlencoded"),
                );
            }
            let mut serializer = url::form_urlencoded::Serializer::new(String::new());
            for p in params.iter().filter(|p| p.enabled && !p.key.is_empty()) {
                serializer.append_pair(&p.key, &p.value);
            }
            request_builder = request_builder.body(serializer.finish());
        }
        ApiRequestBody::Raw {
            ref content,
            ref content_type,
        } => {
            if let Ok(hval) = HeaderValue::from_str(content_type) {
                header_map.insert(reqwest::header::CONTENT_TYPE, hval);
            }
            request_builder = request_builder.body(content.clone());
        }
    }

    request_builder = request_builder.headers(header_map);

    // 7. Execute Request with Cancellation Support
    let send_fut = request_builder.send();

    let response = tokio::select! {
        res = send_fut => {
            res.map_err(|e| format!("HTTP Request failed: {e}"))?
        }
        _ = &mut cancel_rx => {
            return Err("Request was cancelled by user".to_string());
        }
    };

    let ttfb_ms = start_instant.elapsed().as_secs_f64() * 1000.0;
    let status = response.status();
    let status_code = status.as_u16();
    let status_text = status.canonical_reason().unwrap_or("").to_string();

    let mut resp_headers: Vec<(String, String)> = Vec::new();
    for (k, v) in response.headers() {
        resp_headers.push((
            k.as_str().to_string(),
            v.to_str().unwrap_or("[binary]").to_string(),
        ));
    }

    let download_start = Instant::now();
    let bytes_fut = response.bytes();

    let bytes: Bytes = tokio::select! {
        res = bytes_fut => {
            res.map_err(|e| format!("Failed to read response body: {e}"))?
        }
        _ = &mut cancel_rx => {
            return Err("Response download was cancelled by user".to_string());
        }
    };

    let download_ms = download_start.elapsed().as_secs_f64() * 1000.0;
    let total_elapsed = start_instant.elapsed().as_secs_f64() * 1000.0;

    let body_bytes_len = bytes.len();
    let body_str = String::from_utf8_lossy(&bytes).to_string();

    let json_value: Option<serde_json::Value> = serde_json::from_str(&body_str).ok();
    let is_json = json_value.is_some();

    Ok(ApiResponsePayload {
        request_id: req.id,
        status: status_code,
        status_text,
        headers: resp_headers,
        body: body_str,
        body_bytes_len,
        is_json,
        json_value,
        timings: ApiTimings {
            dns_lookup_ms: None,
            tcp_connect_ms: None,
            tls_handshake_ms: None,
            first_byte_ms: Some(ttfb_ms),
            download_ms: Some(download_ms),
            total_duration_ms: total_elapsed,
        },
        error: None,
    })
}

pub async fn stream_http_request(
    mut req: ApiRequestPayload,
    on_event: Channel<Response>,
) -> Result<(), String> {
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let req_id = req
        .id
        .clone()
        .unwrap_or_else(|| format!("req_{}", Instant::now().elapsed().as_nanos()));

    {
        let mut map = ACTIVE_CANCELLATIONS.lock().unwrap();
        map.insert(req_id.clone(), cancel_tx);
    }

    struct CancelGuard(String);
    impl Drop for CancelGuard {
        fn drop(&mut self) {
            let mut map = ACTIVE_CANCELLATIONS.lock().unwrap();
            map.remove(&self.0);
        }
    }
    let _guard = CancelGuard(req_id.clone());

    if let Some(ref vars) = req.variables {
        req.url = interpolate_variables(&req.url, vars);
    }

    let start_instant = Instant::now();
    let url = url::Url::parse(&req.url).map_err(|e| format!("Invalid URL: {e}"))?;

    let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(60_000).max(100));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed to initialize client: {e}"))?;

    let method = match req.method.to_uppercase().as_str() {
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        _ => Method::GET,
    };

    let mut request_builder = client.request(method, url);
    let mut header_map = HeaderMap::new();
    header_map.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static("text/event-stream"),
    );

    for (k, v) in &req.headers {
        if let (Ok(hname), Ok(hval)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            header_map.insert(hname, hval);
        }
    }

    request_builder = request_builder.headers(header_map);

    let send_fut = request_builder.send();
    let response = tokio::select! {
        res = send_fut => res.map_err(|e| format!("Streaming request failed: {e}"))?,
        _ = &mut cancel_rx => return Err("Streaming cancelled".to_string()),
    };

    let status = response.status();
    let status_event = ApiStreamEvent::Status {
        code: status.as_u16(),
        reason: status.canonical_reason().unwrap_or("").to_string(),
    };
    if let Ok(json) = serde_json::to_vec(&status_event) {
        let _ = on_event.send(Response::new(json));
    }

    for (k, v) in response.headers() {
        let header_event = ApiStreamEvent::Header {
            key: k.as_str().to_string(),
            value: v.to_str().unwrap_or("").to_string(),
        };
        if let Ok(json) = serde_json::to_vec(&header_event) {
            let _ = on_event.send(Response::new(json));
        }
    }

    let mut stream = response.bytes_stream();
    let mut total_bytes = 0usize;

    loop {
        tokio::select! {
            chunk_opt = stream.next() => {
                match chunk_opt {
                    Some(Ok(bytes)) => {
                        total_bytes += bytes.len();
                        let text = String::from_utf8_lossy(&bytes).to_string();
                        let chunk_event = ApiStreamEvent::Chunk {
                            data: text,
                            bytes_len: bytes.len(),
                        };
                        if let Ok(json) = serde_json::to_vec(&chunk_event) {
                            let _ = on_event.send(Response::new(json));
                        }
                    }
                    Some(Err(e)) => {
                        let err_event = ApiStreamEvent::Error {
                            message: format!("Stream error: {e}"),
                        };
                        if let Ok(json) = serde_json::to_vec(&err_event) {
                            let _ = on_event.send(Response::new(json));
                        }
                        break;
                    }
                    None => {
                        let done_event = ApiStreamEvent::Done {
                            total_bytes,
                            duration_ms: start_instant.elapsed().as_secs_f64() * 1000.0,
                        };
                        if let Ok(json) = serde_json::to_vec(&done_event) {
                            let _ = on_event.send(Response::new(json));
                        }
                        break;
                    }
                }
            }
            _ = &mut cancel_rx => {
                let err_event = ApiStreamEvent::Error {
                    message: "Stream cancelled by user".to_string(),
                };
                if let Ok(json) = serde_json::to_vec(&err_event) {
                    let _ = on_event.send(Response::new(json));
                }
                break;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interpolate_variables() {
        let mut vars = HashMap::new();
        vars.insert("BASE_URL".to_string(), "https://api.voktty.dev".to_string());
        vars.insert("USER_ID".to_string(), "42".to_string());

        let url = "{{ BASE_URL }}/users/{{USER_ID}}/profile";
        let res = interpolate_variables(url, &vars);
        assert_eq!(res, "https://api.voktty.dev/users/42/profile");
    }

    #[test]
    fn test_cancellation_registration() {
        let req_id = "test_cancel_123";
        let (tx, _rx) = tokio::sync::oneshot::channel();
        {
            let mut map = ACTIVE_CANCELLATIONS.lock().unwrap();
            map.insert(req_id.to_string(), tx);
        }
        assert!(cancel_in_flight_request(req_id));
        assert!(!cancel_in_flight_request(req_id));
    }
}
