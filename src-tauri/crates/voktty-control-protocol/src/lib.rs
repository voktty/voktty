use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
pub const METHOD_PING: &str = "ping";
pub const METHOD_CAPABILITIES: &str = "capabilities";
pub const METHOD_IDENTIFY: &str = "identify";
pub const METHOD_OPEN: &str = "open";
pub const METHOD_BROWSER_SNAPSHOT: &str = "browser.snapshot";
pub const METHOD_BROWSER_CLICK: &str = "browser.click";
pub const METHOD_BROWSER_TYPE: &str = "browser.type";
pub const METHOD_BROWSER_NAVIGATE: &str = "browser.navigate";
pub const METHOD_BROWSER_SELECTED: &str = "browser.selected";
pub const METHOD_BROWSER_EVAL: &str = "browser.eval";
pub const SERVER_RESPONSE_ID: &str = "server";
pub const METHODS: &[&str] = &[
    METHOD_PING,
    METHOD_CAPABILITIES,
    METHOD_IDENTIFY,
    METHOD_OPEN,
    METHOD_BROWSER_SNAPSHOT,
    METHOD_BROWSER_CLICK,
    METHOD_BROWSER_TYPE,
    METHOD_BROWSER_NAVIGATE,
    METHOD_BROWSER_SELECTED,
    METHOD_BROWSER_EVAL,
];

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct CallerContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<u32>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
pub struct ControlRequest {
    pub protocol: u16,
    pub id: String,
    pub token: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub caller: CallerContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ControlError {
    pub code: String,
    pub message: String,
}

impl ControlError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ControlResponse {
    pub protocol: u16,
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ControlError>,
}

impl ControlResponse {
    pub fn success(id: impl Into<String>, result: Value) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(
        id: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: false,
            result: None,
            error: Some(ControlError::new(code, message)),
        }
    }
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
pub struct ControlDescriptor {
    pub protocol: u16,
    pub address: String,
    pub token: String,
    pub pid: u32,
    pub app_version: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FrontendRequest {
    pub id: String,
    pub method: String,
    pub params: Value,
    pub caller: CallerContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FrontendResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ControlError>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct OpenParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    #[serde(default = "default_focus")]
    pub focus: bool,
}

fn default_focus() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BrowserNavigateParams {
    pub url: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct BrowserClickParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "ref")]
    pub element_ref: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BrowserTypeParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "ref")]
    pub element_ref: Option<u64>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submit: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BrowserEvalParams {
    pub script: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_round_trips_without_caller_context() {
        let raw = json!({
            "protocol": PROTOCOL_VERSION,
            "id": "42",
            "token": "secret",
            "method": METHOD_PING,
            "params": {}
        });
        let request: ControlRequest = serde_json::from_value(raw).expect("deserialize request");
        assert_eq!(request.caller, CallerContext::default());
        assert_eq!(request.method, METHOD_PING);
    }

    #[test]
    fn response_shapes_are_unambiguous() {
        let success = ControlResponse::success("1", json!({ "pong": true }));
        assert!(success.ok);
        assert!(success.result.is_some());
        assert!(success.error.is_none());

        let failure = ControlResponse::failure("2", "invalid_request", "bad request");
        assert!(!failure.ok);
        assert!(failure.result.is_none());
        assert_eq!(failure.error.expect("error").code, "invalid_request");
    }

    #[test]
    fn open_defaults_to_focusing_the_target() {
        let params: OpenParams =
            serde_json::from_value(json!({ "path": "/tmp/a" })).expect("deserialize open params");
        assert!(params.focus);
    }

    #[test]
    fn browser_methods_are_advertised() {
        assert!(METHODS.contains(&METHOD_BROWSER_SNAPSHOT));
        assert!(METHODS.contains(&METHOD_BROWSER_CLICK));
        assert!(METHODS.contains(&METHOD_BROWSER_EVAL));
    }

    #[test]
    fn browser_click_params_rename_ref() {
        let params: BrowserClickParams = serde_json::from_value(json!({
            "ref": 3,
            "selector": "#pay"
        }))
        .expect("deserialize click params");
        assert_eq!(params.element_ref, Some(3));
        assert_eq!(params.selector.as_deref(), Some("#pay"));
    }
}
