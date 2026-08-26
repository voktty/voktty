use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortDescriptor {
    pub port_name: String,
    pub port_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vid: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialOpenOptions {
    pub port_name: String,
    pub baud_rate: u32,
    #[serde(default)]
    pub data_bits: Option<u8>,
    #[serde(default)]
    pub flow_control: Option<String>,
    #[serde(default)]
    pub parity: Option<String>,
    #[serde(default)]
    pub stop_bits: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SerialSignals {
    #[serde(default)]
    pub dtr: Option<bool>,
    #[serde(default)]
    pub rts: Option<bool>,
}
