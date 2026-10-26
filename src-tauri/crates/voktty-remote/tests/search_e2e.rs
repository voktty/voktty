use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread::JoinHandle;
use std::time::Duration;

use serde_json::{json, Value};
use voktty_remote_protocol::{
    read_frame, write_frame, Frame, RemoteRequest, RemoteResponse, METHOD_GLOB, METHOD_GREP_CANCEL,
    METHOD_GREP_INDEPENDENT, METHOD_HANDSHAKE, PROTOCOL_VERSION,
};

struct Helper {
    child: Child,
    input: ChildStdin,
    output: Receiver<Frame>,
    reader: Option<JoinHandle<()>>,
}

impl Helper {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_voktty-remote"))
            .arg("--stdio")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let (sender, output) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            while let Ok(Some(frame)) = read_frame(&mut stdout) {
                if sender.send(frame).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            input,
            output,
            reader: Some(reader),
        }
    }

    fn send(&mut self, id: &str, method: &str, params: Value) {
        write_frame(
            &mut self.input,
            &Frame::Request(RemoteRequest {
                protocol: PROTOCOL_VERSION,
                id: id.into(),
                method: method.into(),
                params,
            }),
        )
        .unwrap();
        self.input.flush().unwrap();
    }

    fn receive(&self) -> RemoteResponse {
        match self.output.recv_timeout(Duration::from_secs(15)).unwrap() {
            Frame::Response(response) => response,
            _ => panic!("expected a search response"),
        }
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            reader.join().unwrap();
        }
    }
}

#[test]
fn real_stdio_searches_require_handshake_and_survive_interactive_cancellation() {
    let workspace = tempfile::tempdir().unwrap();
    let nested = workspace.path().join("src");
    std::fs::create_dir(&nested).unwrap();
    std::fs::write(nested.join("note.txt"), "needle").unwrap();
    std::fs::write(nested.join("empty.bin"), []).unwrap();
    std::fs::write(nested.join("binary.bin"), [0, 255]).unwrap();
    let mut helper = Helper::start();
    helper.send("no-auth", METHOD_GLOB, json!({"pattern":"*"}));
    let denied = helper.receive();
    assert!(!denied.ok);
    assert_eq!(denied.error.unwrap().code, "handshake_required");
    helper.send(
        "ready",
        METHOD_HANDSHAKE,
        json!({"workspaceRoot":workspace.path()}),
    );
    let ready = helper.receive();
    assert!(ready.ok);
    let capabilities = ready.result.unwrap()["capabilities"]
        .as_array()
        .unwrap()
        .clone();
    assert!(capabilities
        .iter()
        .any(|entry| entry == METHOD_GREP_INDEPENDENT));
    assert!(capabilities.iter().any(|entry| entry == METHOD_GLOB));

    helper.send(
        "grep-one",
        METHOD_GREP_INDEPENDENT,
        json!({"cwd":"src", "pattern":"needle", "regex":true, "include":["*.txt"]}),
    );
    helper.send("glob", METHOD_GLOB, json!({"cwd":"src", "pattern":"*"}));
    helper.send("cancel", METHOD_GREP_CANCEL, json!({}));
    helper.send(
        "grep-two",
        METHOD_GREP_INDEPENDENT,
        json!({"cwd":"src", "pattern":"needle", "regex":true}),
    );
    let mut replies = HashMap::new();
    for _ in 0..4 {
        let response = helper.receive();
        assert!(response.ok, "{:?}", response.error);
        replies.insert(response.id, response.result.unwrap());
    }
    assert_eq!(replies["glob"]["hits"].as_array().unwrap().len(), 3);
    for id in ["grep-one", "grep-two"] {
        assert_eq!(replies[id]["hits"].as_array().unwrap().len(), 1);
        assert_eq!(replies[id]["hits"][0]["rel"], "note.txt");
        assert_eq!(replies[id]["cancelled"], false);
    }
    helper.send(
        "escape",
        METHOD_GLOB,
        json!({"pattern":"*", "cwd":"../outside"}),
    );
    let escaped = helper.receive();
    assert!(!escaped.ok);
    assert_eq!(escaped.error.unwrap().code, "invalid_params");
}
