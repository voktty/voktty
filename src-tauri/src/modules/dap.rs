use serde::Serialize;
use serde_json::Value;
use shared_child::SharedChild;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::process::{ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

const MAX_COMMAND_BYTES: usize = 8 * 1024;
const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_BUFFER_BYTES: usize = 2 * MAX_FRAME_BYTES;
const MAX_PENDING_MESSAGES: usize = 512;
const MAX_STDERR_BYTES: usize = 256 * 1024;

#[derive(Default)]
pub struct DapState {
    sessions: RwLock<HashMap<u32, Arc<DapSession>>>,
    next_id: AtomicU32,
}

struct DapSession {
    #[cfg(windows)]
    job: Mutex<Option<crate::modules::proc::job::ProcessJob>>,
    child: Arc<SharedChild>,
    stdin: Mutex<ChildStdin>,
    inbox: Mutex<DapInbox>,
    stderr: Mutex<VecDeque<u8>>,
    exited: AtomicBool,
    exit_code: AtomicI32,
    exit_unknown: AtomicBool,
}

#[derive(Default)]
struct DapInbox {
    messages: VecDeque<Value>,
    error: Option<String>,
}

impl DapInbox {
    fn push(&mut self, message: Value) {
        if self.messages.len() >= MAX_PENDING_MESSAGES {
            self.messages.pop_front();
        }
        self.messages.push_back(message);
    }
}

impl Drop for DapSession {
    fn drop(&mut self) {
        self.kill();
    }
}

impl DapSession {
    fn kill(&self) {
        #[cfg(windows)]
        {
            self.job.lock().expect("DAP job mutex poisoned").take();
        }
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as libc::pid_t), libc::SIGKILL);
        }
        let _ = self.child.kill();
    }
}

impl DapState {
    pub fn kill_all(&self) {
        let sessions: Vec<_> = self
            .sessions
            .write()
            .expect("DAP state poisoned")
            .drain()
            .map(|(_, session)| session)
            .collect();
        for session in sessions {
            session.kill();
        }
    }
}

#[derive(Serialize)]
pub struct DapPollResponse {
    messages: Vec<Value>,
    stderr: String,
    exited: bool,
    exit_code: Option<i32>,
    error: Option<String>,
}

#[derive(Default)]
struct DapFrameDecoder {
    buffer: Vec<u8>,
}

impl DapFrameDecoder {
    fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Value>, String> {
        if self.buffer.len().saturating_add(bytes.len()) > MAX_BUFFER_BYTES {
            return Err("DAP receive buffer exceeded its limit".to_string());
        }
        self.buffer.extend_from_slice(bytes);
        let mut values = Vec::new();
        while let Some(header_end) = find_bytes(&self.buffer, b"\r\n\r\n") {
            let header = std::str::from_utf8(&self.buffer[..header_end])
                .map_err(|_| "DAP header is not UTF-8".to_string())?;
            let content_length = parse_content_length(header)?;
            if content_length > MAX_FRAME_BYTES {
                return Err("DAP frame exceeded its limit".to_string());
            }
            let body_start = header_end + 4;
            let body_end = body_start.saturating_add(content_length);
            if self.buffer.len() < body_end {
                break;
            }
            let value = serde_json::from_slice::<Value>(&self.buffer[body_start..body_end])
                .map_err(|e| format!("Invalid DAP JSON: {e}"))?;
            if !value.is_object() {
                return Err("DAP message must be a JSON object".to_string());
            }
            values.push(value);
            self.buffer.drain(..body_end);
        }
        Ok(values)
    }
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn parse_content_length(header: &str) -> Result<usize, String> {
    let mut length = None;
    for line in header.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            return Err("Malformed DAP header".to_string());
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err("Duplicate DAP Content-Length".to_string());
            }
            length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| "Invalid DAP Content-Length".to_string())?,
            );
        }
    }
    length.ok_or_else(|| "Missing DAP Content-Length".to_string())
}

fn encode_message(message: &Value) -> Result<Vec<u8>, String> {
    if !message.is_object() {
        return Err("DAP message must be a JSON object".to_string());
    }
    let body = serde_json::to_vec(message).map_err(|e| e.to_string())?;
    if body.len() > MAX_FRAME_BYTES {
        return Err("DAP frame exceeded its limit".to_string());
    }
    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend(body);
    Ok(frame)
}

fn append_bounded(buffer: &Mutex<VecDeque<u8>>, bytes: &[u8]) {
    let mut buffer = buffer.lock().expect("DAP stderr mutex poisoned");
    let overflow = buffer
        .len()
        .saturating_add(bytes.len())
        .saturating_sub(MAX_STDERR_BYTES);
    for _ in 0..overflow.min(buffer.len()) {
        buffer.pop_front();
    }
    let start = bytes.len().saturating_sub(MAX_STDERR_BYTES);
    buffer.extend(&bytes[start..]);
}

fn spawn_session(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
) -> Result<Arc<DapSession>, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_COMMAND_BYTES {
        return Err("Invalid DAP adapter command".to_string());
    }
    if workspace.is_remote() || workspace.is_docker() {
        return Err("DAP adapters are currently available in local and WSL workspaces".to_string());
    }
    let mut process =
        crate::modules::shell::build_oneshot_command(trimmed, &workspace, cwd.as_deref())?;
    if matches!(workspace, WorkspaceEnv::Local) {
        if let Some(ref directory) = cwd {
            process.current_dir(directory);
        }
    }
    process
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut process);
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        process.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }
    let child = Arc::new(SharedChild::spawn(&mut process).map_err(|e| e.to_string())?);
    #[cfg(windows)]
    let job = crate::modules::proc::job::ProcessJob::create_for(child.id()).ok();
    let stdin = child
        .take_stdin()
        .ok_or_else(|| "DAP adapter has no stdin".to_string())?;
    let stdout = child
        .take_stdout()
        .ok_or_else(|| "DAP adapter has no stdout".to_string())?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| "DAP adapter has no stderr".to_string())?;
    let session = Arc::new(DapSession {
        #[cfg(windows)]
        job: Mutex::new(job),
        child: child.clone(),
        stdin: Mutex::new(stdin),
        inbox: Mutex::new(DapInbox::default()),
        stderr: Mutex::new(VecDeque::new()),
        exited: AtomicBool::new(false),
        exit_code: AtomicI32::new(0),
        exit_unknown: AtomicBool::new(false),
    });

    {
        let session = session.clone();
        thread::spawn(move || {
            let mut reader = stdout;
            let mut decoder = DapFrameDecoder::default();
            let mut chunk = [0_u8; 8192];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(count) => match decoder.feed(&chunk[..count]) {
                        Ok(messages) => {
                            let mut inbox = session.inbox.lock().expect("DAP inbox mutex poisoned");
                            for message in messages {
                                inbox.push(message);
                            }
                        }
                        Err(error) => {
                            session
                                .inbox
                                .lock()
                                .expect("DAP inbox mutex poisoned")
                                .error = Some(error);
                            session.kill();
                            break;
                        }
                    },
                    Err(error) => {
                        session
                            .inbox
                            .lock()
                            .expect("DAP inbox mutex poisoned")
                            .error = Some(error.to_string());
                        break;
                    }
                }
            }
        });
    }
    {
        let session = session.clone();
        thread::spawn(move || {
            let mut reader = stderr;
            let mut chunk = [0_u8; 4096];
            while let Ok(count) = reader.read(&mut chunk) {
                if count == 0 {
                    break;
                }
                append_bounded(&session.stderr, &chunk[..count]);
            }
        });
    }
    {
        let session = session.clone();
        thread::spawn(move || {
            match child.wait() {
                Ok(status) => match status.code() {
                    Some(code) => session.exit_code.store(code, Ordering::Release),
                    None => session.exit_unknown.store(true, Ordering::Release),
                },
                Err(_) => session.exit_unknown.store(true, Ordering::Release),
            }
            session.exited.store(true, Ordering::Release);
        });
    }
    Ok(session)
}

#[tauri::command]
pub fn dap_start(
    state: tauri::State<DapState>,
    registry: tauri::State<WorkspaceRegistry>,
    adapter_command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let session = spawn_session(adapter_command, cwd, workspace)?;
    let id = state
        .next_id
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(1);
    state
        .sessions
        .write()
        .expect("DAP state poisoned")
        .insert(id, session);
    Ok(id)
}

#[tauri::command]
pub fn dap_send(
    state: tauri::State<DapState>,
    session_id: u32,
    message: Value,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .expect("DAP state poisoned")
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Unknown DAP session".to_string())?;
    let frame = encode_message(&message)?;
    let mut stdin = session.stdin.lock().expect("DAP stdin mutex poisoned");
    stdin
        .write_all(&frame)
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dap_poll(state: tauri::State<DapState>, session_id: u32) -> Result<DapPollResponse, String> {
    let session = state
        .sessions
        .read()
        .expect("DAP state poisoned")
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "Unknown DAP session".to_string())?;
    let mut inbox = session.inbox.lock().expect("DAP inbox mutex poisoned");
    let messages = inbox.messages.drain(..).collect();
    let error = inbox.error.take();
    drop(inbox);
    let stderr = {
        let mut bytes = session.stderr.lock().expect("DAP stderr mutex poisoned");
        let value = String::from_utf8_lossy(bytes.make_contiguous()).into_owned();
        bytes.clear();
        value
    };
    let exited = session.exited.load(Ordering::Acquire);
    let exit_code = if exited && !session.exit_unknown.load(Ordering::Acquire) {
        Some(session.exit_code.load(Ordering::Acquire))
    } else {
        None
    };
    Ok(DapPollResponse {
        messages,
        stderr,
        exited,
        exit_code,
        error,
    })
}

#[tauri::command]
pub fn dap_stop(state: tauri::State<DapState>, session_id: u32) -> Result<(), String> {
    if let Some(session) = state
        .sessions
        .write()
        .expect("DAP state poisoned")
        .remove(&session_id)
    {
        session.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decoder_accepts_fragmented_and_coalesced_frames() {
        let first = encode_message(&json!({"type":"event","event":"initialized"})).unwrap();
        let second = encode_message(&json!({"type":"response","request_seq":1})).unwrap();
        let split = first.len() / 2;
        let mut decoder = DapFrameDecoder::default();
        assert!(decoder.feed(&first[..split]).unwrap().is_empty());
        let mut tail = first[split..].to_vec();
        tail.extend(second);
        let messages = decoder.feed(&tail).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["event"], "initialized");
    }

    #[test]
    fn decoder_rejects_oversized_and_malformed_frames() {
        let mut decoder = DapFrameDecoder::default();
        assert!(decoder.feed(b"Content-Length: nope\r\n\r\n{}").is_err());
        let oversized = format!("Content-Length: {}\r\n\r\n", MAX_FRAME_BYTES + 1);
        assert!(DapFrameDecoder::default()
            .feed(oversized.as_bytes())
            .is_err());
    }

    #[test]
    fn encoder_rejects_non_object_messages() {
        assert!(encode_message(&json!(["request"])).is_err());
    }
}
