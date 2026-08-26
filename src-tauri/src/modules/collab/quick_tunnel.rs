use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use shared_child::SharedChild;
use tempfile::NamedTempFile;

const START_TIMEOUT_SECS: u64 = 20;

pub(super) struct CloudflaredTunnel {
    public_url: String,
    child: Arc<SharedChild>,
    _config: NamedTempFile,
    readers: Vec<JoinHandle<()>>,
}

impl CloudflaredTunnel {
    pub fn start(executable: &Path, local_url: &str) -> Result<Self, String> {
        if !local_url.starts_with("http://127.0.0.1:") {
            return Err("quick tunnel origin must be a loopback HTTP URL".to_string());
        }
        let config = NamedTempFile::new().map_err(|error| error.to_string())?;
        let mut command = Command::new(executable);
        command
            .args(command_args(local_url, config.path()))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::modules::proc::hide_console(&mut command);
        let child = Arc::new(SharedChild::spawn(&mut command).map_err(|error| error.to_string())?);
        let (sender, receiver) = mpsc::channel();
        let mut readers = Vec::with_capacity(2);
        if let Some(stdout) = child.take_stdout() {
            readers.push(spawn_log_reader(stdout, sender.clone()));
        }
        if let Some(stderr) = child.take_stderr() {
            readers.push(spawn_log_reader(stderr, sender));
        }

        let deadline = Instant::now() + Duration::from_secs(START_TIMEOUT_SECS);
        let mut last_message = None;
        loop {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(line) => {
                    if let Some(public_url) = extract_public_url(&line) {
                        return Ok(Self {
                            public_url,
                            child,
                            _config: config,
                            readers,
                        });
                    }
                    if !line.trim().is_empty() {
                        last_message = Some(line);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    stop_process(&child, readers);
                    return Err("cloudflared stopped before publishing a URL".to_string());
                }
            }
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                stop_process(&child, readers);
                return Err(format!(
                    "cloudflared exited before publishing a URL ({status}){}",
                    sanitized_context(last_message.as_deref())
                ));
            }
            if Instant::now() >= deadline {
                stop_process(&child, readers);
                return Err(format!(
                    "cloudflared did not publish a URL within {START_TIMEOUT_SECS} seconds{}",
                    sanitized_context(last_message.as_deref())
                ));
            }
        }
    }

    pub fn public_url(&self) -> &str {
        &self.public_url
    }
}

impl Drop for CloudflaredTunnel {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        for reader in self.readers.drain(..) {
            let _ = reader.join();
        }
    }
}

fn command_args(local_url: &str, config_path: &Path) -> Vec<OsString> {
    vec![
        OsString::from("tunnel"),
        OsString::from("--config"),
        config_path.as_os_str().to_owned(),
        OsString::from("--no-autoupdate"),
        OsString::from("--url"),
        OsString::from(local_url),
    ]
}

fn extract_public_url(line: &str) -> Option<String> {
    for (start, _) in line.match_indices("https://") {
        let tail = &line[start + "https://".len()..];
        let end = tail
            .find(|character: char| {
                !(character.is_ascii_alphanumeric() || character == '-' || character == '.')
            })
            .unwrap_or(tail.len());
        let host = &tail[..end];
        let Some(prefix) = host.strip_suffix(".trycloudflare.com") else {
            continue;
        };
        if prefix.is_empty()
            || prefix.split('.').any(|label| {
                label.is_empty()
                    || label.starts_with('-')
                    || label.ends_with('-')
                    || !label
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
        {
            continue;
        }
        return Some(format!("https://{host}"));
    }
    None
}

pub(super) fn verified_executable(custom_path: Option<&str>) -> Result<PathBuf, String> {
    let status = super::requirements::detect_cloudflared(custom_path);
    if !status.installed {
        return Err(status
            .error
            .unwrap_or_else(|| "cloudflared is not available".to_string()));
    }
    status
        .executable
        .map(PathBuf::from)
        .ok_or_else(|| "cloudflared executable path is unavailable".to_string())
}

fn spawn_log_reader(
    stream: impl std::io::Read + Send + 'static,
    sender: mpsc::Sender<String>,
) -> JoinHandle<()> {
    thread::Builder::new()
        .name("voktty-cloudflared-log".into())
        .spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        })
        .expect("spawn cloudflared log reader")
}

fn stop_process(child: &SharedChild, readers: Vec<JoinHandle<()>>) {
    let _ = child.kill();
    let _ = child.wait();
    for reader in readers {
        let _ = reader.join();
    }
}

fn sanitized_context(message: Option<&str>) -> String {
    let Some(message) = message.map(str::trim).filter(|value| !value.is_empty()) else {
        return String::new();
    };
    let tail: String = message.chars().take(300).collect();
    format!(": {tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_uses_an_empty_config_and_disables_self_updates() {
        let args = command_args(
            "http://127.0.0.1:43125",
            Path::new("C:/Temp/voktty-cloudflared.yml"),
        );
        let args: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            args,
            vec![
                "tunnel",
                "--config",
                "C:/Temp/voktty-cloudflared.yml",
                "--no-autoupdate",
                "--url",
                "http://127.0.0.1:43125",
            ]
        );
    }

    #[test]
    fn parser_accepts_only_https_trycloudflare_hosts() {
        assert_eq!(
            extract_public_url(
                r#"INF Requesting new quick Tunnel url=https://quiet-tree.trycloudflare.com"#
            ),
            Some("https://quiet-tree.trycloudflare.com".to_string())
        );
        assert_eq!(
            extract_public_url(
                r#"{"level":"info","message":"https://blue-sky.trycloudflare.com ready"}"#
            ),
            Some("https://blue-sky.trycloudflare.com".to_string())
        );
        assert_eq!(extract_public_url("http://bad.trycloudflare.com"), None);
        assert_eq!(
            extract_public_url("https://trycloudflare.com.attacker.example"),
            None
        );
    }
}
