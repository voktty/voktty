use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpConnectOptions {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub domain: Option<String>,
    #[serde(default = "default_width")]
    pub width: u16,
    #[serde(default = "default_height")]
    pub height: u16,
    #[serde(default)]
    pub ignore_cert: bool,
}

fn default_port() -> u16 {
    3389
}

fn default_width() -> u16 {
    1280
}

fn default_height() -> u16 {
    800
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum RdpEvent {
    #[serde(rename = "connecting")]
    Connecting { status: String },
    #[serde(rename = "connected")]
    Connected { width: u16, height: u16 },
    #[serde(rename = "bitmap")]
    Bitmap {
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        /// Base64 encoded RGBA pixel data
        data: String,
    },
    #[serde(rename = "clipboard")]
    Clipboard { text: String },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "disconnected")]
    Disconnected { reason: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RdpInput {
    #[serde(rename = "mouse_move")]
    MouseMove { x: u16, y: u16 },
    #[serde(rename = "mouse_button")]
    MouseButton {
        button: u8, // 1 = Left, 2 = Middle, 3 = Right
        pressed: bool,
    },
    #[serde(rename = "mouse_wheel")]
    MouseWheel { vertical: bool, delta: i16 },
    #[serde(rename = "key")]
    Key {
        scancode: u16,
        pressed: bool,
        extended: bool,
    },
    #[serde(rename = "unicode_key")]
    UnicodeKey { code: u16 },
    #[serde(rename = "clipboard")]
    Clipboard { text: String },
}
