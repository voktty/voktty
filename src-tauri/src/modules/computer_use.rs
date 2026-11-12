//! Detects the `open-computer-use` CLI on this machine. Detection only: it
//! runs `--version` and, when asked, `doctor` with fixed arguments, no shell,
//! a hard timeout and bounded output. It never installs anything and never
//! touches any agent configuration.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Names the package installs, in the order they are looked up.
const BINARIES: [&str; 2] = ["open-computer-use", "ocu"];
const RUN_TIMEOUT: Duration = Duration::from_secs(5);
const READ_BYTES: usize = 8 * 1024;
const DOCTOR_CHARS: usize = 2000;
const VERSION_CHARS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProbeStatus {
    NotInstalled,
    Installed,
    DoctorProblem,
    /// The binary exists but did not report a version.
    Unusable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseProbe {
    pub status: ProbeStatus,
    pub path: Option<String>,
    pub version: Option<String>,
    /// Bounded `doctor` output. `None` when diagnostics were not requested.
    pub doctor: Option<String>,
    pub error: Option<String>,
}

impl ComputerUseProbe {
    fn not_installed() -> Self {
        Self {
            status: ProbeStatus::NotInstalled,
            path: None,
            version: None,
            doctor: None,
            error: None,
        }
    }
}

struct RunOutcome {
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
        // Drain the rest so a chatty binary never blocks on a full pipe.
        let _ = std::io::copy(&mut stream, &mut std::io::sink());
        let _ = sender.send(buffer);
    });
    receiver
}

fn run_bounded(executable: &Path, args: &[&str], path_env: Option<&str>) -> RunOutcome {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path_env) = path_env {
        command.env("PATH", path_env);
    }
    crate::modules::proc::hide_console(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return RunOutcome {
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
    // A grandchild can keep a pipe open after the child is gone, so never
    // wait for the readers without a limit.
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
    RunOutcome {
        success,
        timed_out,
        output,
    }
}

/// First version-looking token of the first non-empty line, or that line
/// bounded when it holds none.
pub(crate) fn parse_version(output: &str) -> Option<String> {
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

pub(crate) fn bound_text(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let mut cut: String = trimmed.chars().take(limit).collect();
    cut.push('~');
    cut
}

/// Probes with an injected executable lookup so tests never touch the real
/// PATH.
pub(crate) fn probe_with(
    find: impl Fn(&str) -> Option<PathBuf>,
    path_env: Option<&str>,
    run_doctor: bool,
) -> ComputerUseProbe {
    let Some(executable) = BINARIES.iter().find_map(|name| find(name)) else {
        return ComputerUseProbe::not_installed();
    };
    let path = Some(executable.to_string_lossy().into_owned());
    let version = run_bounded(&executable, &["--version"], path_env);
    let parsed = if version.success {
        parse_version(&version.output)
    } else {
        None
    };
    let Some(parsed) = parsed else {
        let error = if version.timed_out {
            "the version check timed out".to_string()
        } else {
            "the version check failed".to_string()
        };
        return ComputerUseProbe {
            status: ProbeStatus::Unusable,
            path,
            version: None,
            doctor: None,
            error: Some(error),
        };
    };
    if !run_doctor {
        return ComputerUseProbe {
            status: ProbeStatus::Installed,
            path,
            version: Some(parsed),
            doctor: None,
            error: None,
        };
    }
    let doctor = run_bounded(&executable, &["doctor"], path_env);
    let text = bound_text(&doctor.output, DOCTOR_CHARS);
    let problem = !doctor.success || doctor.timed_out;
    let text = if doctor.timed_out && text.is_empty() {
        "the diagnostics timed out".to_string()
    } else {
        text
    };
    ComputerUseProbe {
        status: if problem {
            ProbeStatus::DoctorProblem
        } else {
            ProbeStatus::Installed
        },
        path,
        version: Some(parsed),
        doctor: Some(text),
        error: None,
    }
}

/// `run_doctor` is false for the automatic check on macOS, where `doctor` can
/// open the system permission prompts, and true when the user asks for it.
#[tauri::command]
pub async fn computer_use_probe(run_doctor: bool) -> Result<ComputerUseProbe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path_env = crate::modules::lsp::env::server_env_overlay()
            .get("PATH")
            .cloned()
            .or_else(|| std::env::var("PATH").ok());
        probe_with(
            crate::modules::lsp::env::resolve_binary,
            path_env.as_deref(),
            run_doctor,
        )
    })
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_version_token() {
        assert_eq!(parse_version("1.1.4\n").as_deref(), Some("1.1.4"));
        assert_eq!(
            parse_version("open-computer-use v1.1.4").as_deref(),
            Some("1.1.4")
        );
        assert_eq!(
            parse_version("\n\n  ocu dev build  ").as_deref(),
            Some("ocu dev build")
        );
        assert_eq!(parse_version("   \n"), None);
        assert_eq!(
            parse_version(&"9".repeat(500)).unwrap().chars().count(),
            VERSION_CHARS
        );
    }

    #[test]
    fn bounds_long_text() {
        assert_eq!(bound_text("  ok  ", 10), "ok");
        let long = "x".repeat(DOCTOR_CHARS + 50);
        assert_eq!(
            bound_text(&long, DOCTOR_CHARS).chars().count(),
            DOCTOR_CHARS + 1
        );
    }

    #[test]
    fn reports_a_missing_binary_without_running_anything() {
        let probe = probe_with(|_| None, None, true);
        assert_eq!(probe, ComputerUseProbe::not_installed());
    }

    #[test]
    fn serializes_for_the_frontend() {
        let json = serde_json::to_value(ComputerUseProbe::not_installed()).unwrap();
        assert_eq!(json["status"], "not-installed");
        assert!(json["version"].is_null());
    }

    #[cfg(unix)]
    mod unix {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        use std::sync::{Mutex, MutexGuard};

        static SPAWN_LOCK: Mutex<()> = Mutex::new(());

        fn lock() -> MutexGuard<'static, ()> {
            SPAWN_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        }

        fn script(dir: &Path, body: &str) -> PathBuf {
            let path = dir.join("ocu");
            std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        fn find_in(path: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
            move |name| (name == "ocu").then(|| path.clone())
        }

        #[test]
        fn reads_version_and_doctor() {
            let _guard = lock();
            let dir = tempfile::tempdir().unwrap();
            let path = script(
                dir.path(),
                "case \"$1\" in --version) echo 1.1.4;; doctor) echo ready-ish;; esac",
            );
            let probe = probe_with(find_in(path), None, true);
            assert_eq!(probe.status, ProbeStatus::Installed);
            assert_eq!(probe.version.as_deref(), Some("1.1.4"));
            assert_eq!(probe.doctor.as_deref(), Some("ready-ish"));
        }

        #[test]
        fn skips_doctor_when_not_requested() {
            let _guard = lock();
            let dir = tempfile::tempdir().unwrap();
            let marker = dir.path().join("ran-doctor");
            let path = script(
                dir.path(),
                &format!(
                    "if [ \"$1\" = doctor ]; then touch {}; fi; echo 1.1.4",
                    marker.display()
                ),
            );
            let probe = probe_with(find_in(path), None, false);
            assert_eq!(probe.status, ProbeStatus::Installed);
            assert!(probe.doctor.is_none());
            assert!(!marker.exists());
        }

        #[test]
        fn a_failing_doctor_is_a_problem_with_bounded_text() {
            let _guard = lock();
            let dir = tempfile::tempdir().unwrap();
            let path = script(
                dir.path(),
                "if [ \"$1\" = doctor ]; then yes warning | head -c 100000; exit 1; fi; echo 1.1.4",
            );
            let probe = probe_with(find_in(path), None, true);
            assert_eq!(probe.status, ProbeStatus::DoctorProblem);
            assert!(probe.doctor.unwrap().chars().count() <= DOCTOR_CHARS + 1);
        }

        #[test]
        fn a_hung_binary_times_out_and_is_unusable() {
            let _guard = lock();
            let dir = tempfile::tempdir().unwrap();
            let path = script(dir.path(), "exec sleep 30");
            let started = Instant::now();
            let probe = probe_with(find_in(path), None, true);
            assert_eq!(probe.status, ProbeStatus::Unusable);
            assert!(probe.error.unwrap().contains("timed out"));
            assert!(started.elapsed() < Duration::from_secs(9));
        }

        #[test]
        fn a_binary_without_a_version_is_unusable() {
            let _guard = lock();
            let dir = tempfile::tempdir().unwrap();
            let path = script(dir.path(), "exit 3");
            let probe = probe_with(find_in(path), None, true);
            assert_eq!(probe.status, ProbeStatus::Unusable);
        }
    }
}
