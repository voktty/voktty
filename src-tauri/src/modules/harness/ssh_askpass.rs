//! OpenSSH calls the desktop executable in a small, non-GUI askpass mode.
//! Answers travel over a nonce-authenticated loopback socket, never argv/files.
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

const ADDRESS: &str = "TERAX_SSH_ASKPASS_ADDRESS";
const SECRET: &str = "TERAX_SSH_ASKPASS_SECRET";

#[derive(Serialize, Deserialize)]
struct Request {
    secret: String,
    prompt: String,
    confirm: bool,
}

fn confirmation_prompt(prompt: &str, hint: &str) -> bool {
    hint == "confirm" || prompt.contains("(yes/no/[fingerprint])") || prompt.contains("(yes/no)")
}

pub fn maybe_run() -> Option<i32> {
    let address = std::env::var(ADDRESS).ok()?;
    Some(
        (|| -> Result<i32, Box<dyn std::error::Error>> {
            let address: SocketAddr = address.parse()?;
            if !address.ip().is_loopback() {
                return Ok(1);
            }
            let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))?;
            stream.set_read_timeout(Some(Duration::from_secs(130)))?;
            stream.set_write_timeout(Some(Duration::from_secs(3)))?;
            let prompt = std::env::args()
                .nth(1)
                .unwrap_or_else(|| "SSH authentication".into());
            let confirm = confirmation_prompt(
                &prompt,
                &std::env::var("SSH_ASKPASS_PROMPT").unwrap_or_default(),
            );
            let request = Request {
                secret: std::env::var(SECRET)?,
                prompt,
                confirm,
            };
            writeln!(stream, "{}", serde_json::to_string(&request)?)?;
            let line = read_line(&mut stream)?;
            let answer: Option<String> = serde_json::from_str(&line)?;
            match answer {
                Some(answer) => {
                    println!("{answer}");
                    Ok(if confirm && answer != "yes" { 1 } else { 0 })
                }
                None => Ok(1),
            }
        })()
        .unwrap_or(1),
    )
}

fn read_line(stream: &mut TcpStream) -> Result<String, String> {
    use std::io::Read;
    let mut line = String::new();
    BufReader::new(stream)
        .take(16 * 1024)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    if !line.ends_with('\n') {
        return Err("SSH prompt exceeded its size limit".into());
    }
    Ok(line)
}

enum Worker {
    Running(std::thread::JoinHandle<()>),
    Joining,
    Finished,
}

pub struct Askpass {
    address: SocketAddr,
    secret: String,
    stopped: Arc<AtomicBool>,
    worker: Mutex<Worker>,
}

impl Askpass {
    pub fn start(
        handler: impl Fn(String, bool) -> Option<String> + Send + 'static,
    ) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let secret = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let stopped = Arc::new(AtomicBool::new(false));
        let shutdown = stopped.clone();
        let expected = secret.clone();
        let worker = std::thread::Builder::new()
            .name("voktty-ssh-askpass".into())
            .spawn(move || {
                while !shutdown.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            if shutdown.load(Ordering::Acquire) {
                                break;
                            }
                            // Accepted sockets can inherit the listener's nonblocking mode.
                            let _ = stream.set_nonblocking(false);
                            let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                            let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                            let request = read_line(&mut stream)
                                .ok()
                                .and_then(|line| serde_json::from_str::<Request>(&line).ok());
                            if shutdown.load(Ordering::Acquire) {
                                break;
                            }
                            if let Some(request) = request.filter(|r| r.secret == expected) {
                                let answer = handler(request.prompt, request.confirm);
                                if shutdown.load(Ordering::Acquire) {
                                    break;
                                }
                                let _ = writeln!(
                                    stream,
                                    "{}",
                                    serde_json::to_string(&answer)
                                        .unwrap_or_else(|_| "null".into())
                                );
                            }
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(50))
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|_| "Could not start SSH prompt bridge".to_string())?;
        Ok(Self {
            address,
            secret,
            stopped,
            worker: Mutex::new(Worker::Running(worker)),
        })
    }

    #[cfg(test)]
    pub(crate) fn with_worker_for_test(handle: std::thread::JoinHandle<()>) -> Self {
        Self {
            address: SocketAddr::from(([127, 0, 0, 1], 0)),
            secret: String::new(),
            stopped: Arc::new(AtomicBool::new(false)),
            worker: Mutex::new(Worker::Running(handle)),
        }
    }

    #[cfg(test)]
    pub(crate) fn is_stopped_for_test(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    pub fn close_with_timeout(&self, timeout: Duration) -> Result<(), String> {
        self.stopped.store(true, Ordering::Release);
        let started = std::time::Instant::now();
        loop {
            let finished = {
                let mut worker = self
                    .worker
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                match &*worker {
                    Worker::Finished => return Ok(()),
                    Worker::Running(handle) if handle.is_finished() => {
                        match std::mem::replace(&mut *worker, Worker::Joining) {
                            Worker::Running(handle) => Some(handle),
                            _ => unreachable!(),
                        }
                    }
                    _ => None,
                }
            };
            if let Some(handle) = finished {
                let _ = handle.join();
                *self
                    .worker
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = Worker::Finished;
                return Ok(());
            }
            let remaining = timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                return Err("SSH prompt bridge cleanup is pending".into());
            }
            std::thread::sleep(remaining.min(Duration::from_millis(5)));
        }
    }

    pub fn configure(&self, command: &mut Command) -> Result<(), String> {
        command
            .env(
                "SSH_ASKPASS",
                std::env::current_exe().map_err(|e| e.to_string())?,
            )
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", "terax-ai:0")
            .env(ADDRESS, self.address.to_string())
            .env(SECRET, &self.secret);
        Ok(())
    }
}

impl Drop for Askpass {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authenticated_handler_retains_close_until_exact_worker_finishes() {
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let bridge = Arc::new(
            Askpass::start(move |_, _| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Some("test answer".into())
            })
            .unwrap(),
        );
        let sibling = bridge.clone();
        let mut stream = TcpStream::connect(bridge.address).unwrap();
        writeln!(
            stream,
            "{}",
            serde_json::to_string(&Request {
                secret: bridge.secret.clone(),
                prompt: "Test prompt".into(),
                confirm: false,
            })
            .unwrap()
        )
        .unwrap();
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let started = std::time::Instant::now();
        assert_eq!(
            bridge.close_with_timeout(Duration::from_millis(20)),
            Err("SSH prompt bridge cleanup is pending".into())
        );
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(sibling.close_with_timeout(Duration::ZERO).is_err());
        release_tx.send(()).unwrap();
        assert_eq!(bridge.close_with_timeout(Duration::from_secs(2)), Ok(()));
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        assert!(read_line(&mut stream).is_err());
        assert_eq!(sibling.close_with_timeout(Duration::ZERO), Ok(()));
        assert!(TcpStream::connect_timeout(&bridge.address, Duration::from_millis(100)).is_err());
    }

    #[test]
    fn explicit_close_stops_listener_while_a_clone_keeps_bridge_alive() {
        let bridge = Arc::new(Askpass::start(|_, _| None).unwrap());
        let sibling = bridge.clone();
        assert_eq!(bridge.close_with_timeout(Duration::from_secs(2)), Ok(()));
        assert!(TcpStream::connect_timeout(&bridge.address, Duration::from_millis(100)).is_err());
        assert_eq!(sibling.close_with_timeout(Duration::ZERO), Ok(()));
    }

    #[test]
    fn concurrent_closers_do_not_acknowledge_an_active_handler() {
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let bridge = Arc::new(
            Askpass::start(move |_, _| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                None
            })
            .unwrap(),
        );
        let mut stream = TcpStream::connect(bridge.address).unwrap();
        writeln!(
            stream,
            "{}",
            serde_json::to_string(&Request {
                secret: bridge.secret.clone(),
                prompt: "Test prompt".into(),
                confirm: false,
            })
            .unwrap()
        )
        .unwrap();
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        std::thread::scope(|scope| {
            let a = scope.spawn(|| bridge.close_with_timeout(Duration::from_millis(20)));
            let b = scope.spawn(|| bridge.close_with_timeout(Duration::from_millis(20)));
            assert!(a.join().unwrap().is_err());
            assert!(b.join().unwrap().is_err());
        });
        release_tx.send(()).unwrap();
        assert_eq!(bridge.close_with_timeout(Duration::from_secs(2)), Ok(()));
    }

    #[test]
    fn partial_request_read_timeout_retains_worker_until_terminal() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (read_tx, read_rx) = std::sync::mpsc::channel();
        let worker = std::thread::Builder::new()
            .spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_millis(150)))
                    .unwrap();
                entered_tx.send(()).unwrap();
                read_rx.recv().unwrap();
                assert!(read_line(&mut stream).is_err());
            })
            .unwrap();
        let bridge = Askpass::with_worker_for_test(worker);
        let mut stream = TcpStream::connect(address).unwrap();
        stream.write_all(b"{\"secret\":").unwrap();
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(bridge.close_with_timeout(Duration::ZERO).is_err());
        read_tx.send(()).unwrap();
        assert_eq!(bridge.close_with_timeout(Duration::from_secs(2)), Ok(()));
        assert_eq!(bridge.close_with_timeout(Duration::ZERO), Ok(()));
    }

    #[test]
    fn detects_openssh_host_trust_without_a_prompt_hint() {
        assert!(confirmation_prompt(
            "Are you sure you want to continue connecting (yes/no/[fingerprint])?",
            ""
        ));
        assert!(confirmation_prompt("Allow access?", "confirm"));
        assert!(!confirmation_prompt("Enter passphrase for key:", ""));
        assert!(!confirmation_prompt("user@host's password:", ""));
    }

    #[test]
    fn prompt_bridge_rejects_unknown_clients_and_does_not_put_answers_in_files() {
        let bridge = Askpass::start(|prompt, confirm| {
            assert_eq!(prompt, "Passphrase?");
            assert!(!confirm);
            Some("test secret".into())
        })
        .unwrap();
        let mut stream = TcpStream::connect(bridge.address).unwrap();
        writeln!(
            stream,
            "{}",
            serde_json::to_string(&Request {
                secret: "wrong".into(),
                prompt: "ignored".into(),
                confirm: false
            })
            .unwrap()
        )
        .unwrap();
        assert!(read_line(&mut stream).is_err());
        let mut stream = TcpStream::connect(bridge.address).unwrap();
        writeln!(
            stream,
            "{}",
            serde_json::to_string(&Request {
                secret: bridge.secret.clone(),
                prompt: "Passphrase?".into(),
                confirm: false
            })
            .unwrap()
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<String>(&read_line(&mut stream).unwrap()).unwrap(),
            "test secret"
        );
    }
}
