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
pub const METHOD_HARNESS_NEW: &str = "harness.new";
pub const METHOD_HARNESS_SEND: &str = "harness.send";
pub const METHOD_HARNESS_WAIT: &str = "harness.wait";
pub const METHOD_HARNESS_STATUS: &str = "harness.status";
pub const METHOD_HARNESS_RESULT: &str = "harness.result";
pub const METHOD_HARNESS_LIST: &str = "harness.list";
pub const METHOD_AGENT_LIST: &str = "agent.list";
pub const METHOD_AGENT_START: &str = "agent.start";
pub const METHOD_AGENT_SEND: &str = "agent.send";
pub const METHOD_AGENT_STATUS: &str = "agent.status";
pub const METHOD_AGENT_WAIT: &str = "agent.wait";
pub const METHOD_AGENT_RESULT: &str = "agent.result";
pub const METHOD_AGENT_STOP: &str = "agent.stop";
pub const METHOD_AGENT_CLOSE: &str = "agent.close";
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
    METHOD_HARNESS_NEW,
    METHOD_HARNESS_SEND,
    METHOD_HARNESS_WAIT,
    METHOD_HARNESS_STATUS,
    METHOD_HARNESS_RESULT,
    METHOD_HARNESS_LIST,
    METHOD_AGENT_LIST,
    METHOD_AGENT_START,
    METHOD_AGENT_SEND,
    METHOD_AGENT_STATUS,
    METHOD_AGENT_WAIT,
    METHOD_AGENT_RESULT,
    METHOD_AGENT_STOP,
    METHOD_AGENT_CLOSE,
];

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct CallerContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HarnessNewParams {
    pub harness: String,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HarnessSendParams {
    pub session_id: String,
    pub text: String,
}

fn default_harness_wait_timeout_ms() -> u64 {
    4_000
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HarnessWaitParams {
    pub session_id: String,
    /// Target states to stop waiting on; empty means any state change from "working".
    #[serde(default)]
    pub states: Vec<String>,
    #[serde(default = "default_harness_wait_timeout_ms")]
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HarnessStatusParams {
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HarnessResultParams {
    pub session_id: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct HarnessListParams {}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AgentListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgentStartParams {
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supervised: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgentSendParams {
    pub to: String,
    pub kind: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgentStatusParams {
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgentWaitParams {
    pub agent: String,
    #[serde(default = "default_agent_wait_until")]
    pub until: String,
    #[serde(default = "default_agent_wait_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

fn default_agent_wait_until() -> String {
    "verdict".to_string()
}

fn default_agent_wait_timeout_ms() -> u64 {
    30_000
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgentResultParams {
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgentStopParams {
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AgentCloseParams {
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
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
    fn harness_methods_are_advertised() {
        assert!(METHODS.contains(&METHOD_HARNESS_NEW));
        assert!(METHODS.contains(&METHOD_HARNESS_SEND));
        assert!(METHODS.contains(&METHOD_HARNESS_WAIT));
        assert!(METHODS.contains(&METHOD_HARNESS_STATUS));
        assert!(METHODS.contains(&METHOD_HARNESS_RESULT));
        assert!(METHODS.contains(&METHOD_HARNESS_LIST));
    }

    #[test]
    fn harness_wait_params_default_timeout_and_states() {
        let params: HarnessWaitParams =
            serde_json::from_value(json!({ "session_id": "s1" })).expect("deserialize");
        assert_eq!(params.timeout_ms, 4_000);
        assert!(params.states.is_empty());
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

    #[test]
    fn agent_methods_are_advertised() {
        assert!(METHODS.contains(&METHOD_AGENT_LIST));
        assert!(METHODS.contains(&METHOD_AGENT_START));
        assert!(METHODS.contains(&METHOD_AGENT_SEND));
        assert!(METHODS.contains(&METHOD_AGENT_STATUS));
        assert!(METHODS.contains(&METHOD_AGENT_WAIT));
        assert!(METHODS.contains(&METHOD_AGENT_RESULT));
        assert!(METHODS.contains(&METHOD_AGENT_STOP));
        assert!(METHODS.contains(&METHOD_AGENT_CLOSE));
    }

    #[test]
    fn caller_context_supports_agent_auth() {
        let ctx = CallerContext {
            pane_id: Some(1),
            agent_token: Some("tok_123".to_string()),
            session_id: Some("s_123".to_string()),
        };
        let val = serde_json::to_value(&ctx).expect("serialize");
        let back: CallerContext = serde_json::from_value(val).expect("deserialize");
        assert_eq!(back.agent_token.as_deref(), Some("tok_123"));
        assert_eq!(back.session_id.as_deref(), Some("s_123"));
    }
}
