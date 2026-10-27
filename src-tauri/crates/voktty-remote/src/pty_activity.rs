use crate::{RemotePty, RemoteServer};
use serde::Deserialize;
use serde_json::json;
use voktty_remote_protocol::{RemoteRequest, RemoteResponse};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Params {
    pty_id: u64,
}

pub fn handle(server: &RemoteServer, request: RemoteRequest) -> RemoteResponse {
    if server.root.is_none() {
        return RemoteResponse::failure(request.id, "handshake_required", "handshake is required");
    }
    let params = match serde_json::from_value::<Params>(request.params) {
        Ok(params) => params,
        Err(_) => {
            return RemoteResponse::failure(request.id, "invalid_params", "invalid PTY identity")
        }
    };
    let pty = match server.ptys.try_lock() {
        Ok(ptys) => ptys.get(&params.pty_id).cloned(),
        Err(_) => {
            return RemoteResponse::failure(request.id, "pty_busy", "PTY registry is unavailable")
        }
    };
    let Some(pty) = pty else {
        return RemoteResponse::failure(request.id, "pty_not_found", "PTY session not found");
    };
    match foreground_job(&pty) {
        Ok(busy) => RemoteResponse::success(request.id, json!({ "foregroundJob": busy })),
        Err(error) => RemoteResponse::failure(request.id, "pty_activity_unavailable", error),
    }
}

fn foreground_job(pty: &RemotePty) -> Result<bool, &'static str> {
    #[cfg(unix)]
    {
        if pty.tmux_session_name.is_some() {
            return Err("Multiplexer foreground activity is unavailable");
        }
        let pid = pty
            .child_pid
            .filter(|pid| *pid > 0 && *pid <= i32::MAX as u32)
            .ok_or("PTY shell identity is unavailable")?;
        let master = pty
            .master
            .try_lock()
            .map_err(|_| "PTY master is unavailable")?;
        let foreground = master
            .process_group_leader()
            .filter(|pid| *pid > 0)
            .ok_or("PTY foreground group is unavailable")?;
        Ok(foreground as u32 != pid)
    }
    #[cfg(not(unix))]
    {
        let _ = pty;
        Err("PTY activity inspection requires a Unix host")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use crate::{native_pty_system, CommandBuilder, Mutex, PtySize};
    use voktty_remote_protocol::{METHOD_HANDSHAKE, METHOD_PTY_GET_ACTIVITY, PROTOCOL_VERSION};

    fn request(params: serde_json::Value) -> RemoteRequest {
        RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "activity".into(),
            method: METHOD_PTY_GET_ACTIVITY.into(),
            params,
        }
    }

    #[test]
    fn activity_requires_handshake_valid_identity_and_a_registered_pty() {
        let mut server = RemoteServer::new();
        assert_eq!(
            server
                .handle(request(json!({ "ptyId": 1 })))
                .error
                .unwrap()
                .code,
            "handshake_required"
        );
        let root = tempfile::tempdir().unwrap();
        let response = server.handle(RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "hello".into(),
            method: METHOD_HANDSHAKE.into(),
            params: json!({ "workspaceRoot": root.path() }),
        });
        assert!(response.result.unwrap()["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == METHOD_PTY_GET_ACTIVITY));
        for params in [
            json!({}),
            json!({ "ptyId": -1 }),
            json!({ "ptyId": 1, "pid": 42 }),
        ] {
            assert_eq!(
                server.handle(request(params)).error.unwrap().code,
                "invalid_params"
            );
        }
        assert_eq!(
            server
                .handle(request(json!({ "ptyId": 1 })))
                .error
                .unwrap()
                .code,
            "pty_not_found"
        );
        let registry = server.ptys.clone();
        let _held = registry.lock().unwrap();
        assert_eq!(
            server
                .handle(request(json!({ "ptyId": 1 })))
                .error
                .unwrap()
                .code,
            "pty_busy"
        );
    }

    #[cfg(unix)]
    #[test]
    fn activity_observes_a_real_foreground_job_and_returns_to_idle() {
        use std::time::{Duration, Instant};
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-i");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut pty = RemotePty {
            killer: Mutex::new(child.clone_killer()),
            writer: Mutex::new(pair.master.take_writer().unwrap()),
            master: Mutex::new(pair.master),
            tmux_session_name: None,
            child_pid: child.process_id(),
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let deadline = Instant::now() + Duration::from_secs(3);
            while foreground_job(&pty) != Ok(false) {
                assert!(Instant::now() < deadline, "shell did not acquire its PTY");
                std::thread::sleep(Duration::from_millis(5));
            }
            pty.writer
                .lock()
                .unwrap()
                .write_all(b"sleep 0.4\r")
                .unwrap();
            while foreground_job(&pty) != Ok(true) {
                assert!(Instant::now() < deadline, "foreground job was not detected");
                std::thread::sleep(Duration::from_millis(5));
            }
            while foreground_job(&pty) != Ok(false) {
                assert!(Instant::now() < deadline, "shell did not return to idle");
                std::thread::sleep(Duration::from_millis(5));
            }
            let _held = pty.master.lock().unwrap();
            assert_eq!(foreground_job(&pty), Err("PTY master is unavailable"));
        }));
        pty.child_pid = None;
        assert_eq!(
            foreground_job(&pty),
            Err("PTY shell identity is unavailable")
        );
        pty.tmux_session_name = Some("multiplexer".to_string());
        assert_eq!(
            foreground_job(&pty),
            Err("Multiplexer foreground activity is unavailable")
        );
        child.kill().unwrap();
        child.wait().unwrap();
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }
}
