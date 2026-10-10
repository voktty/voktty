use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT_BYTES: usize = 16 * 1024;
const READ_BUFFER_BYTES: usize = 4096;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Status,
    Start,
    Password,
}

impl Action {
    fn args(self) -> &'static [&'static str] {
        match self {
            Self::Status => &["service", "status"],
            Self::Start => &["service", "start"],
            Self::Password => &["service", "get", "password"],
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    pub action: Action,
    pub cwd: String,
}

pub fn run(action: Action, cwd: &Path) -> Result<String, String> {
    let mut command = Command::new("opencode");
    command
        .args(action.args())
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start OpenCode service command: {error}"))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("OpenCode service stdout is unavailable".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("OpenCode service stderr is unavailable".to_string());
    };
    let stdout_reader = thread::spawn(move || read_bounded(stdout));
    let stderr_reader = thread::spawn(move || read_bounded(stderr));

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < COMMAND_TIMEOUT => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err("OpenCode service command timed out".to_string());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(format!(
                    "could not wait for OpenCode service command: {error}"
                ));
            }
        }
    };

    let (stdout, stdout_exceeded) = join_reader(stdout_reader)?;
    let (stderr, stderr_exceeded) = join_reader(stderr_reader)?;
    if stdout_exceeded || stderr_exceeded {
        return Err("OpenCode service command output exceeded 16 KiB".to_string());
    }
    if !status.success() {
        let message = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(if message.is_empty() {
            format!(
                "OpenCode service command exited with code {}",
                status.code().unwrap_or(-1)
            )
        } else {
            message
        });
    }
    String::from_utf8(stdout)
        .map_err(|_| "OpenCode service command returned non-UTF-8 output".to_string())
}

fn read_bounded(mut reader: impl Read) -> io::Result<(Vec<u8>, bool)> {
    let mut output = Vec::with_capacity(READ_BUFFER_BYTES);
    let mut buffer = [0u8; READ_BUFFER_BYTES];
    let mut exceeded = false;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok((output, exceeded));
        }
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(output.len());
        let retained = read.min(remaining);
        output.extend_from_slice(&buffer[..retained]);
        exceeded |= retained < read;
    }
}

fn join_reader(
    reader: thread::JoinHandle<io::Result<(Vec<u8>, bool)>>,
) -> Result<(Vec<u8>, bool), String> {
    reader
        .join()
        .map_err(|_| "OpenCode service output reader stopped unexpectedly".to_string())?
        .map_err(|error| format!("could not read OpenCode service output: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actions_map_to_fixed_opencode_service_arguments() {
        assert_eq!(Action::Status.args(), ["service", "status"]);
        assert_eq!(Action::Start.args(), ["service", "start"]);
        assert_eq!(Action::Password.args(), ["service", "get", "password"]);
    }

    #[test]
    fn rejects_arbitrary_service_action_names() {
        assert!(serde_json::from_value::<Action>(serde_json::json!("stop")).is_err());
        assert!(serde_json::from_value::<Action>(serde_json::json!("models")).is_err());
    }

    #[test]
    fn rejects_unrecognized_service_parameters() {
        assert!(serde_json::from_value::<Params>(serde_json::json!({
            "action": "status",
            "cwd": "/repo",
            "args": ["--host", "0.0.0.0"]
        }))
        .is_err());
    }

    #[test]
    fn caps_output_while_draining_the_child_pipe() {
        let input = vec![b'x'; MAX_OUTPUT_BYTES + READ_BUFFER_BYTES];
        let (output, exceeded) = read_bounded(input.as_slice()).expect("bounded output");
        assert_eq!(output.len(), MAX_OUTPUT_BYTES);
        assert!(exceeded);
    }
}
