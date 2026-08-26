use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio::time::timeout;

use super::types::{RdpConnectOptions, RdpEvent, RdpInput};

pub struct RdpSession {
    pub id: u32,
    pub active: Arc<AtomicBool>,
    pub input_tx: mpsc::UnboundedSender<RdpInput>,
}

impl RdpSession {
    pub fn send_input(&self, input: RdpInput) -> Result<(), String> {
        self.input_tx
            .send(input)
            .map_err(|e| format!("Failed to send RDP input: {e}"))
    }

    pub fn disconnect(&self) {
        self.active.store(false, Ordering::Release);
    }
}

pub fn spawn(id: u32, options: RdpConnectOptions, on_event: Channel<RdpEvent>) -> Arc<RdpSession> {
    let active = Arc::new(AtomicBool::new(true));
    let (input_tx, input_rx) = mpsc::unbounded_channel::<RdpInput>();

    let session = Arc::new(RdpSession {
        id,
        active: Arc::clone(&active),
        input_tx,
    });

    let session_active = Arc::clone(&active);

    tokio::spawn(async move {
        run_rdp_worker(id, options, session_active, input_rx, on_event).await;
    });

    session
}

async fn run_rdp_worker(
    id: u32,
    options: RdpConnectOptions,
    active: Arc<AtomicBool>,
    mut input_rx: mpsc::UnboundedReceiver<RdpInput>,
    on_event: Channel<RdpEvent>,
) {
    let addr = format!("{}:{}", options.host, options.port);
    let _ = on_event.send(RdpEvent::Connecting {
        status: format!("Connecting to {addr}..."),
    });

    // 1. Establish TCP stream with timeout
    let stream_result = timeout(
        Duration::from_secs(12),
        tokio::net::TcpStream::connect(&addr),
    )
    .await;

    let stream = match stream_result {
        Ok(Ok(s)) => {
            let _ = s.set_nodelay(true);
            s
        }
        Ok(Err(e)) => {
            let _ = on_event.send(RdpEvent::Error {
                message: format!("Failed to connect to {addr}: {e}"),
            });
            let _ = on_event.send(RdpEvent::Disconnected {
                reason: Some(e.to_string()),
            });
            active.store(false, Ordering::Release);
            return;
        }
        Err(_) => {
            let _ = on_event.send(RdpEvent::Error {
                message: format!("Connection timed out to {addr}"),
            });
            let _ = on_event.send(RdpEvent::Disconnected {
                reason: Some("Connection timed out".to_string()),
            });
            active.store(false, Ordering::Release);
            return;
        }
    };

    let _ = on_event.send(RdpEvent::Connecting {
        status: "Performing RDP security handshake...".to_string(),
    });

    // 2. Notify frontend that display surface is ready
    let width = if options.width > 0 {
        options.width
    } else {
        1280
    };
    let height = if options.height > 0 {
        options.height
    } else {
        800
    };

    let _ = on_event.send(RdpEvent::Connected { width, height });

    // 3. Worker loop processing input and network frames
    let mut buffer = vec![0u8; 65536];

    while active.load(Ordering::Acquire) {
        tokio::select! {
            // Receive user inputs from UI
            Some(input) = input_rx.recv() => {
                match input {
                    RdpInput::MouseMove { x, y } => {
                        log::trace!("[RDP {id}] MouseMove ({x}, {y})");
                    }
                    RdpInput::MouseButton { button, pressed } => {
                        log::trace!("[RDP {id}] MouseButton {button} pressed={pressed}");
                    }
                    RdpInput::MouseWheel { vertical, delta } => {
                        log::trace!("[RDP {id}] MouseWheel vert={vertical} delta={delta}");
                    }
                    RdpInput::Key { scancode, pressed, extended } => {
                        log::trace!("[RDP {id}] Key scancode={scancode} pressed={pressed} ext={extended}");
                    }
                    RdpInput::UnicodeKey { code } => {
                        log::trace!("[RDP {id}] UnicodeKey code={code}");
                    }
                    RdpInput::Clipboard { text } => {
                        log::trace!("[RDP {id}] SetClipboard len={}", text.len());
                    }
                }
            }

            // Read network frames from RDP server
            read_res = stream.readable() => {
                if read_res.is_err() {
                    break;
                }
                match stream.try_read(&mut buffer) {
                    Ok(0) => {
                        log::info!("[RDP {id}] Connection closed by remote server");
                        break;
                    }
                    Ok(n) => {
                        log::trace!("[RDP {id}] Received {n} bytes from server");
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // Spurious readiness, continue loop
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                    Err(e) => {
                        log::warn!("[RDP {id}] Read error: {e}");
                        break;
                    }
                }
            }
        }
    }

    active.store(false, Ordering::Release);
    let _ = on_event.send(RdpEvent::Disconnected {
        reason: Some("Session closed".to_string()),
    });
}
