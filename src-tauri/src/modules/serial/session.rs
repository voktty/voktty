use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::ipc::{Channel, Response};

use super::types::{SerialOpenOptions, SerialSignals};

pub struct SerialSession {
    pub id: u32,
    pub port_name: String,
    pub port: Mutex<Box<dyn serialport::SerialPort>>,
    pub exited: Arc<AtomicBool>,
}

impl SerialSession {
    pub fn write_bytes(&self, bytes: &[u8]) -> Result<(), String> {
        let mut port = self
            .port
            .lock()
            .map_err(|_| "serial port lock poisoned".to_string())?;
        port.write_all(bytes).map_err(|e| e.to_string())?;
        port.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_signals(&self, signals: SerialSignals) -> Result<(), String> {
        let mut port = self
            .port
            .lock()
            .map_err(|_| "serial port lock poisoned".to_string())?;
        if let Some(dtr) = signals.dtr {
            port.write_data_terminal_ready(dtr)
                .map_err(|e| e.to_string())?;
        }
        if let Some(rts) = signals.rts {
            port.write_request_to_send(rts).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

pub fn spawn(
    id: u32,
    options: SerialOpenOptions,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<Arc<SerialSession>, String> {
    let port_name = options.port_name.clone();
    let data_bits = match options.data_bits.unwrap_or(8) {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    };
    let flow_control = match options.flow_control.as_deref() {
        Some("software") => serialport::FlowControl::Software,
        Some("hardware") => serialport::FlowControl::Hardware,
        _ => serialport::FlowControl::None,
    };
    let parity = match options.parity.as_deref() {
        Some("odd") => serialport::Parity::Odd,
        Some("even") => serialport::Parity::Even,
        _ => serialport::Parity::None,
    };
    let stop_bits = match options.stop_bits.unwrap_or(1) {
        2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    };

    let builder = serialport::new(&options.port_name, options.baud_rate)
        .data_bits(data_bits)
        .flow_control(flow_control)
        .parity(parity)
        .stop_bits(stop_bits)
        .timeout(Duration::from_millis(100));

    let port = builder
        .open()
        .map_err(|e| format!("failed to open serial port {}: {}", options.port_name, e))?;

    let mut reader_port = port
        .try_clone()
        .map_err(|e| format!("failed to clone serial port: {}", e))?;

    let exited = Arc::new(AtomicBool::new(false));
    let exited_clone = exited.clone();
    let name_for_log = port_name.clone();

    thread::Builder::new()
        .name(format!("voktty-serial-reader-{id}"))
        .spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if exited_clone.load(Ordering::Acquire) {
                    break;
                }
                match reader_port.read(&mut buf) {
                    Ok(0) => {
                        // EOF / Port disconnected
                        log::info!("serial port {name_for_log} reached EOF");
                        break;
                    }
                    Ok(n) => {
                        if let Err(e) = on_data.send(Response::new(buf[..n].to_vec())) {
                            log::debug!("serial on_data send failed for {name_for_log}: {e}");
                            break;
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        // Normal timeout on idle read, continue looping
                        continue;
                    }
                    Err(e) => {
                        if !exited_clone.load(Ordering::Acquire) {
                            log::warn!("serial read error on {name_for_log}: {e}");
                        }
                        break;
                    }
                }
            }
            exited_clone.store(true, Ordering::Release);
            let _ = on_exit.send(0);
        })
        .map_err(|e| format!("failed to spawn serial reader thread: {}", e))?;

    Ok(Arc::new(SerialSession {
        id,
        port_name,
        port: Mutex::new(port),
        exited,
    }))
}
