use std::collections::HashMap;
use std::time::{Duration, Instant};

use bytes::Bytes;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};

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
}

fn default_body_none() -> ApiRequestBody {
    ApiRequestBody::None
}

fn default_auth_none() -> ApiRequestAuth {
    ApiRequestAuth::None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiTimings {
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

pub async fn execute_http_request(req: ApiRequestPayload) -> Result<ApiResponsePayload, String> {
    let start_instant = Instant::now();

    // 1. Parse URL & Query params
    let mut url = url::Url::parse(&req.url).map_err(|e| format!("Invalid URL: {e}"))?;

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
    let mut builder = reqwest::Client::builder()
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

    // 7. Execute Request
    let response = request_builder
        .send()
        .await
        .map_err(|e| format!("HTTP Request failed: {e}"))?;

    let elapsed = start_instant.elapsed().as_secs_f64() * 1000.0;
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

    let bytes: Bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;
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
            total_duration_ms: elapsed,
        },
        error: None,
    })
}
