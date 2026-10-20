//! Real-process check of the persistence contract: the agent survives the
//! helper (its SSH connection) dying, and a new helper resumes the output.

#![cfg(unix)]

use std::fs;
use std::io::BufWriter;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use serde_json::{json, Value};
use voktty_remote_protocol::{
    read_frame, write_frame, Frame, RemoteRequest, RemoteResponse, PROTOCOL_VERSION,
};

struct Helper {
    child: Child,
    input: BufWriter<ChildStdin>,
    frames: Receiver<Frame>,
    sequence: u32,
}

impl Helper {
    fn start(home: &Path, bin: &Path, work: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_voktty-remote"))
            .arg("--stdio")
            .env("HOME", home)
            .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("helper starts");
        let input = BufWriter::new(child.stdin.take().expect("stdin"));
        let mut stdout = child.stdout.take().expect("stdout");
        let (sender, frames) = mpsc::channel();
        std::thread::spawn(move || {
            while let Ok(Some(frame)) = read_frame(&mut stdout) {
                if sender.send(frame).is_err() {
                    break;
                }
            }
        });
        let mut helper = Self {
            child,
            input,
            frames,
            sequence: 0,
        };
        let response = helper.request("handshake", json!({ "workspaceRoot": work }));
        assert!(response.ok, "{response:?}");
        helper
    }

    fn request(&mut self, method: &str, params: Value) -> RemoteResponse {
        self.sequence += 1;
        let id = format!("r{}", self.sequence);
        write_frame(
            &mut self.input,
            &Frame::Request(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: id.clone(),
                method: method.to_string(),
                params,
            }),
        )
        .expect("request is written");
        std::io::Write::flush(&mut self.input).expect("flush");
        loop {
            match self.next_frame() {
                Frame::Response(response) if response.id == id => return response,
                _ => {}
            }
        }
    }

    fn next_frame(&self) -> Frame {
        self.frames
            .recv_timeout(Duration::from_secs(15))
            .expect("a frame arrives in time")
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn the_agent_outlives_its_helper_and_a_new_helper_resumes_the_output() {
    let home = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let script = bin.path().join("codex");
    fs::write(&script, "#!/bin/sh\necho a\nsleep 1\necho b\nexit 5\n").unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

    let (proc_id, applied) = {
        let mut first = Helper::start(home.path(), bin.path(), work.path());
        let spawned = first.request(
            "proc.spawn",
            json!({ "command": "codex", "cwd": ".", "attachId": 1 }),
        );
        assert!(spawned.ok, "{spawned:?}");
        let proc_id = spawned.result.unwrap()["procId"]
            .as_str()
            .unwrap()
            .to_string();
        let applied = loop {
            if let Frame::ProcOutput {
                data, next_offset, ..
            } = first.next_frame()
            {
                assert_eq!(data, b"a\n");
                break next_offset;
            }
        };
        (proc_id, applied)
        // The first helper is dropped and killed here, as when SSH drops.
    };

    let mut second = Helper::start(home.path(), bin.path(), work.path());
    let listed = second.request("proc.list", json!({}));
    assert_eq!(
        listed.result.unwrap()["processes"][0]["id"],
        proc_id.as_str()
    );
    let attached = second.request(
        "proc.attach",
        json!({ "procId": proc_id, "attachId": 2, "fromOffset": applied }),
    );
    assert!(attached.ok, "{attached:?}");

    let mut output = Vec::new();
    let exit = loop {
        match second.next_frame() {
            Frame::ProcOutput { data, .. } => output.extend(data),
            Frame::ProcExit { code, reason, .. } => break (code, reason),
            _ => {}
        }
    };
    assert_eq!(output, b"b\n");
    assert_eq!(exit, (5, String::new()));

    let closed = second.request("proc.close", json!({ "procId": proc_id }));
    assert!(closed.ok, "{closed:?}");
}

#[test]
fn spawn_refuses_commands_outside_the_agent_allowlist_and_missing_binaries() {
    let home = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let mut helper = Helper::start(home.path(), bin.path(), work.path());

    let shell = helper.request(
        "proc.spawn",
        json!({ "command": "sh", "attachId": 1, "args": ["-c", "id"] }),
    );
    assert_eq!(shell.error.unwrap().code, "command_not_allowed");
    let missing = helper.request("proc.spawn", json!({ "command": "codex", "attachId": 1 }));
    assert_eq!(missing.error.unwrap().code, "command_not_found");
    let escape = helper.request(
        "proc.spawn",
        json!({ "command": "codex", "attachId": 1, "cwd": "/" }),
    );
    assert_eq!(escape.error.unwrap().code, "invalid_cwd");
    let unknown = helper.request(
        "proc.spawn",
        json!({ "command": "codex", "attachId": 1, "env": {"A": "b"} }),
    );
    assert_eq!(unknown.error.unwrap().code, "invalid_params");
}
