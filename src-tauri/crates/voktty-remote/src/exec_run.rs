use std::collections::HashMap;
use std::io::{self, Read};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::json;
use voktty_remote_protocol::{RemoteRequest, RemoteResponse};

const LIMIT: usize = 4;
const OUTPUT_LIMIT: usize = 256 * 1024;

#[derive(Default)]
struct Jobs {
    active: HashMap<String, Arc<AtomicBool>>,
    cancelled: HashMap<String, Instant>,
}

#[derive(Default)]
pub struct ExecState(Mutex<Jobs>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Params {
    pub cwd: String,
    command: String,
    timeout_secs: Option<u64>,
}

impl ExecState {
    pub fn cancel_all(&self) {
        if let Ok(jobs) = self.0.lock() {
            for cancelled in jobs.active.values() {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn shutdown(&self) {
        self.cancel_all();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if self
                .0
                .lock()
                .map(|jobs| jobs.active.is_empty())
                .unwrap_or(true)
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn cancel(&self, id: &str) -> bool {
        let Ok(mut jobs) = self.0.lock() else {
            return false;
        };
        if let Some(job) = jobs.active.get(id) {
            job.store(true, Ordering::SeqCst);
            return true;
        }
        jobs.cancelled
            .retain(|_, time| time.elapsed() < Duration::from_secs(130));
        if id.is_empty() || id.len() > 128 || jobs.cancelled.len() >= 256 {
            return false;
        }
        jobs.cancelled.insert(id.to_owned(), Instant::now());
        true
    }

    pub fn prepare(
        &self,
        request: &RemoteRequest,
    ) -> Result<(Params, Arc<AtomicBool>), RemoteResponse> {
        let fail =
            |message: &str| RemoteResponse::failure(request.id.clone(), "invalid_params", message);
        let params: Params = serde_json::from_value(request.params.clone())
            .map_err(|_| fail("invalid exec parameters"))?;
        if params.command.is_empty()
            || params.command.len() > 64 * 1024
            || params.timeout_secs == Some(0)
        {
            return Err(fail("invalid command or timeout"));
        }
        let mut jobs = self.0.lock().map_err(|_| fail("exec state unavailable"))?;
        jobs.cancelled.retain(|_, time| time.elapsed() < Duration::from_secs(130));
        if jobs.cancelled.len() >= 256 {
            return Err(fail("exec cancellation capacity exhausted"));
        }
        if request.id.len() > 128
            || jobs.active.len() >= LIMIT
            || jobs.active.contains_key(&request.id)
        {
            return Err(fail("exec capacity exhausted or duplicate request"));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        if jobs.cancelled.remove(&request.id).is_some() {
            cancelled.store(true, Ordering::SeqCst);
        }
        jobs.active.insert(request.id.clone(), cancelled.clone());
        Ok((params, cancelled))
    }

    pub fn finish(&self, id: &str) {
        if let Ok(mut jobs) = self.0.lock() {
            jobs.active.remove(id);
        }
    }
}

impl Drop for ExecState {
    fn drop(&mut self) {
        self.cancel_all();
    }
}

fn nonblocking<T: std::os::fd::AsRawFd>(pipe: &T) -> io::Result<()> {
    let fd = pipe.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn drain(pipe: &mut impl Read, output: &mut Vec<u8>, truncated: &mut bool) {
    let mut buffer = [0; 8192];
    for _ in 0..32 {
        match pipe.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                let take = n.min(OUTPUT_LIMIT.saturating_sub(output.len()));
                output.extend_from_slice(&buffer[..take]);
                *truncated |= take < n;
            }
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
}

pub fn run(id: String, params: Params, cwd: PathBuf, cancelled: Arc<AtomicBool>) -> RemoteResponse {
    let result = (|| -> io::Result<_> {
        if cancelled.load(Ordering::SeqCst) {
            return Err(io::Error::other("cancelled"));
        }
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg(&params.command)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()?;
        let pid = child.id() as i32;
        let mut stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");
        if let Err(error) = nonblocking(&stdout).and_then(|_| nonblocking(&stderr)) {
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            let _ = child.wait();
            return Err(error);
        }
        let deadline =
            Instant::now() + Duration::from_secs(params.timeout_secs.unwrap_or(120).min(120));
        let (mut out, mut err, mut truncated) = (Vec::new(), Vec::new(), false);
        let (status, timed_out, was_cancelled) = loop {
            drain(&mut stdout, &mut out, &mut truncated);
            drain(&mut stderr, &mut err, &mut truncated);
            let timed_out = Instant::now() >= deadline;
            let was_cancelled = cancelled.load(Ordering::SeqCst);
            if timed_out || was_cancelled {
                unsafe {
                    libc::kill(-pid, libc::SIGKILL);
                }
                break (child.wait()?, timed_out, was_cancelled);
            }
            match child.try_wait() {
                Ok(Some(status)) => break (status, false, false),
                Ok(None) => {}
                Err(error) => {
                    unsafe {
                        libc::kill(-pid, libc::SIGKILL);
                    }
                    let _ = child.wait();
                    return Err(error);
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
        drain(&mut stdout, &mut out, &mut truncated);
        drain(&mut stderr, &mut err, &mut truncated);
        Ok(
            json!({"stdout":String::from_utf8_lossy(&out), "stderr":String::from_utf8_lossy(&err), "exit_code":status.code(), "timed_out":timed_out, "cancelled":was_cancelled, "truncated":truncated, "cwd_after":cwd}),
        )
    })();
    match result {
        Ok(value) => RemoteResponse::success(id, value),
        Err(error) => RemoteResponse::failure(id, "exec_error", error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use voktty_remote_protocol::PROTOCOL_VERSION;

    fn request(id: &str, command: &str) -> RemoteRequest {
        RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            method: "exec.run".into(),
            params: json!({"cwd":".","command":command,"timeoutSecs":1}),
        }
    }

    #[test]
    fn capacity_and_early_cancellation_are_bounded() {
        let state = ExecState::default();
        assert!(state.cancel("early"));
        let (_, flag) = state.prepare(&request("early", "true")).unwrap();
        assert!(flag.load(Ordering::SeqCst));
        for id in ["a", "b", "c"] {
            state.prepare(&request(id, "true")).unwrap();
        }
        assert!(state.prepare(&request("excess", "true")).is_err());
        state.finish("early");
        assert!(state.prepare(&request("new", "true")).is_ok());
    }

    #[test]
    fn timeout_and_output_are_bounded() {
        let state = ExecState::default();
        let (params, flag) = state
            .prepare(&request("timeout", "while :; do printf 1234567890; done"))
            .unwrap();
        let result = run("timeout".into(), params, std::env::temp_dir(), flag)
            .result
            .unwrap();
        assert_eq!(result["timed_out"], true);
        assert_eq!(result["truncated"], true);
        assert_eq!(result["stdout"].as_str().unwrap().len(), OUTPUT_LIMIT);
    }

    #[test]
    fn cancellation_stops_running_command() {
        let state = Arc::new(ExecState::default());
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_path_buf();
        let (params, flag) = state
            .prepare(&request("cancel", "(sleep 2; touch survived) & wait"))
            .unwrap();
        let worker = std::thread::spawn(move || run("cancel".into(), params, cwd, flag));
        std::thread::sleep(Duration::from_millis(100));
        assert!(state.cancel("cancel"));
        assert_eq!(worker.join().unwrap().result.unwrap()["cancelled"], true);
        std::thread::sleep(Duration::from_millis(2100));
        assert!(!dir.path().join("survived").exists());
    }

    #[test]
    fn working_directory_rejects_outside_and_escaping_symlink() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
        let mut server = crate::RemoteServer::new();
        server.root = Some(root.path().canonicalize().unwrap());
        assert!(server
            .resolve_existing_directory(outside.path().to_str().unwrap())
            .is_err());
        assert!(server.resolve_existing_directory("escape").is_err());
        assert_eq!(
            server.resolve_existing_directory(".").unwrap(),
            root.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn shutdown_cancels_and_waits_for_active_jobs() {
        let state = Arc::new(ExecState::default());
        let (params, flag) = state.prepare(&request("shutdown", "sleep 30")).unwrap();
        let worker_state = state.clone();
        let worker = std::thread::spawn(move || {
            let response = run("shutdown".into(), params, std::env::temp_dir(), flag);
            worker_state.finish("shutdown");
            response
        });
        std::thread::sleep(Duration::from_millis(100));
        state.shutdown();
        assert!(state.0.lock().unwrap().active.is_empty());
        assert_eq!(worker.join().unwrap().result.unwrap()["cancelled"], true);
    }
}
