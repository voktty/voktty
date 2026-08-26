pub mod session;
pub mod types;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use serialport::SerialPortType;
use tauri::ipc::{Channel, Request, Response};

use session::SerialSession;
use types::{SerialOpenOptions, SerialPortDescriptor, SerialSignals};

pub struct SerialState {
    sessions: RwLock<HashMap<u32, Arc<SerialSession>>>,
    next_id: AtomicU32,
}

impl Default for SerialState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<SerialPortDescriptor>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    let mut result = Vec::with_capacity(ports.len());

    for p in ports {
        let (port_type, manufacturer, product, vid, pid, serial_number) = match p.port_type {
            SerialPortType::UsbPort(info) => (
                "USB".to_string(),
                info.manufacturer,
                info.product,
                Some(info.vid),
                Some(info.pid),
                info.serial_number,
            ),
            SerialPortType::PciPort => ("PCI".to_string(), None, None, None, None, None),
            SerialPortType::BluetoothPort => {
                ("Bluetooth".to_string(), None, None, None, None, None)
            }
            SerialPortType::Unknown => ("Unknown".to_string(), None, None, None, None, None),
        };

        result.push(SerialPortDescriptor {
            port_name: p.port_name,
            port_type,
            manufacturer,
            product,
            vid,
            pid,
            serial_number,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn serial_open(
    state: tauri::State<'_, SerialState>,
    options: SerialOpenOptions,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = session::spawn(id, options, on_data, on_exit)?;
    state.sessions.write().unwrap().insert(id, session);
    log::info!("serial session opened id={id}");
    Ok(id)
}

#[tauri::command]
pub fn serial_write(state: tauri::State<SerialState>, request: Request) -> Result<(), String> {
    let id: u32 = request
        .headers()
        .get("x-serial-id")
        .or_else(|| request.headers().get("x-pty-id"))
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "serial_write: missing x-serial-id header".to_string())?;

    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("serial_write: expected raw body".to_string());
    };

    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| {
            log::warn!("serial_write: unknown session id={id}");
            "no session".to_string()
        })?;

    session.write_bytes(bytes)
}

#[tauri::command]
pub fn serial_close(state: tauri::State<SerialState>, id: u32) -> Result<(), String> {
    let session = state.sessions.write().unwrap().remove(&id);
    if let Some(s) = session {
        s.exited.store(true, Ordering::Release);
        log::info!("serial session closed id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn serial_set_signals(
    state: tauri::State<SerialState>,
    id: u32,
    signals: SerialSignals,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("serial_set_signals: unknown session id={id}"))?;

    session.set_signals(signals)
}
