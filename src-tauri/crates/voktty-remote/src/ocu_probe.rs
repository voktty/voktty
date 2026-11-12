//! `ocu.probe`: reports whether `open-computer-use` is installed on this host.
//! Detection only. It resolves the binary on the helper's agent search path
//! and runs `--version` and, when asked, `doctor` with fixed arguments, no
//! shell, a hard timeout and bounded output. It installs nothing.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::agent_proc::find_executable;

/// Names the package installs, in the order they are looked up.
const BINARIES: [&str; 2] = ["open-computer-use", "ocu"];
const RUN_TIMEOUT: Duration = Duration::from_secs(5);
const READ_BYTES: usize = 8 * 1024;
const DOCTOR_CHARS: usize = 2000;
const VERSION_CHARS: usize = 64;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Params {
    #[serde(default)]
    doctor: bool,
}

impl Params {
    pub fn doctor(&self) -> bool {
        self.doctor
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Status {
    NotInstalled,
    Installed,
    DoctorProblem,
    Unusable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    status: Status,
    path: Option<String>,
    version: Option<String>,
    doctor: Option<String>,
    error: Option<String>,
}

struct Outcome {
    success: bool,
    timed_out: bool,
    output: String,
}

fn bounded(mut stream: impl Read + Send + 'static) -> mpsc::Receiver<Vec<u8>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stream
            .by_ref()
            .take(READ_BYTES as u64)
            .read_to_end(&mut buffer);
        let _ = std::io::copy(&mut stream, &mut std::io::sink());
        let _ = sender.send(buffer);
    });
    receiver
}

fn run(executable: &Path, args: &[&str], search_path: &str) -> Outcome {
    let mut child = match Command::new(executable)
        .args(args)
        .env("PATH", search_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return Outcome {
                success: false,
                timed_out: false,
                output: format!("could not run the binary: {error}"),
            }
        }
    };
    let stdout = child.stdout.take().map(bounded);
    let stderr = child.stderr.take().map(bounded);
    let deadline = Instant::now() + RUN_TIMEOUT;
    let (success, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (status.success(), false),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break (false, true);
            }
        }
    };
    // A grandchild can keep a pipe open after the child is gone.
    let collect = |receiver: Option<mpsc::Receiver<Vec<u8>>>| {
        receiver
            .and_then(|receiver| receiver.recv_timeout(Duration::from_millis(500)).ok())
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default()
    };
    let mut output = collect(stdout);
    let errors = collect(stderr);
    if !errors.trim().is_empty() {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str(&errors);
    }
    Outcome {
        success,
        timed_out,
        output,
    }
}

fn parse_version(output: &str) -> Option<String> {
    let line = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let token = line.split_whitespace().find(|token| {
        let token = token.trim_start_matches('v');
        token.chars().next().is_some_and(|c| c.is_ascii_digit()) && token.contains('.')
    });
    let text = token.unwrap_or(line).trim_start_matches('v');
    Some(text.chars().take(VERSION_CHARS).collect())
}

fn bound_text(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let mut cut: String = trimmed.chars().take(limit).collect();
    cut.push('~');
    cut
}

pub fn probe(search_path: &str, run_doctor: bool) -> Probe {
    probe_with(
        |name| find_executable(name, search_path),
        search_path,
        run_doctor,
    )
}

fn probe_with(
    find: impl Fn(&str) -> Option<PathBuf>,
    search_path: &str,
    run_doctor: bool,
) -> Probe {
    let Some(executable) = BINARIES.iter().find_map(|name| find(name)) else {
        return Probe {
            status: Status::NotInstalled,
            path: None,
            version: None,
            doctor: None,
            error: None,
        };
    };
    let path = Some(executable.to_string_lossy().into_owned());
    let version = run(&executable, &["--version"], search_path);
    let parsed = if version.success {
        parse_version(&version.output)
    } else {
        None
    };
    let Some(parsed) = parsed else {
        let error = if version.timed_out {
            "the version check timed out"
        } else {
            "the version check failed"
        };
        return Probe {
            status: Status::Unusable,
            path,
            version: None,
            doctor: None,
            error: Some(error.to_string()),
        };
    };
    if !run_doctor {
        return Probe {
            status: Status::Installed,
            path,
            version: Some(parsed),
            doctor: None,
            error: None,
        };
    }
    let doctor = run(&executable, &["doctor"], search_path);
    let text = bound_text(&doctor.output, DOCTOR_CHARS);
    let text = if doctor.timed_out && text.is_empty() {
        "the diagnostics timed out".to_string()
    } else {
        text
    };
    Probe {
        status: if doctor.success && !doctor.timed_out {
            Status::Installed
        } else {
            Status::DoctorProblem
        },
        path,
        version: Some(parsed),
        doctor: Some(text),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn script(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("ocu");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn finds_the_binary_on_the_search_path_only() {
        let empty = tempfile::tempdir().unwrap();
        let none = probe(empty.path().to_str().unwrap(), true);
        assert_eq!(none.status, Status::NotInstalled);

        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "echo 1.1.4");
        let found = probe(dir.path().to_str().unwrap(), false);
        assert_eq!(found.status, Status::Installed);
        assert_eq!(found.version.as_deref(), Some("1.1.4"));
        assert!(found.doctor.is_none());
    }

    #[test]
    fn reads_doctor_output_and_flags_a_failing_doctor() {
        let dir = tempfile::tempdir().unwrap();
        script(
            dir.path(),
            "if [ \"$1\" = doctor ]; then echo needs-display; exit 1; fi; echo 1.1.4",
        );
        let probe = probe(dir.path().to_str().unwrap(), true);
        assert_eq!(probe.status, Status::DoctorProblem);
        assert_eq!(probe.doctor.as_deref(), Some("needs-display"));
    }

    #[test]
    fn doctor_is_not_run_unless_asked() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("ran-doctor");
        script(
            dir.path(),
            &format!(
                "if [ \"$1\" = doctor ]; then touch {}; fi; echo 1.1.4",
                marker.display()
            ),
        );
        probe(dir.path().to_str().unwrap(), false);
        assert!(!marker.exists());
    }

    #[test]
    fn output_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        script(
            dir.path(),
            "if [ \"$1\" = doctor ]; then yes warning | head -c 200000; exit 1; fi; echo 1.1.4",
        );
        let probe = probe(dir.path().to_str().unwrap(), true);
        assert!(probe.doctor.unwrap().chars().count() <= DOCTOR_CHARS + 1);
    }

    #[test]
    fn a_hung_binary_times_out() {
        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "exec sleep 30");
        let started = Instant::now();
        let probe = probe(dir.path().to_str().unwrap(), true);
        assert_eq!(probe.status, Status::Unusable);
        assert!(probe.error.unwrap().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(9));
    }

    #[test]
    fn a_binary_without_a_version_is_unusable() {
        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "exit 3");
        let probe = probe(dir.path().to_str().unwrap(), true);
        assert_eq!(probe.status, Status::Unusable);
    }

    #[test]
    fn rejects_unknown_parameters() {
        assert!(serde_json::from_str::<Params>("{\"doctor\":true}").is_ok());
        assert!(serde_json::from_str::<Params>("{\"command\":\"rm\"}").is_err());
    }
}
