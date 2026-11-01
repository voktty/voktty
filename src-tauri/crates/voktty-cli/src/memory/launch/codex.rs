use super::super::super::{CliError, EXIT_UNAVAILABLE};
use std::ffi::OsString;
use std::path::Path;

pub(super) fn unavailable() -> CliError {
    CliError::new("memory_delivery_unavailable", "memory launch supports verified Codex 0.165.0 interactive arguments only; use Project Memory to copy a startup message, or --no-memory for an unchanged launch; no agent was started", EXIT_UNAVAILABLE)
}

fn takes_value(flag: &str) -> bool {
    matches!(
        flag,
        "--model"
            | "-m"
            | "--sandbox"
            | "-s"
            | "--ask-for-approval"
            | "-a"
            | "--local-provider"
            | "--add-dir"
    )
}

/// Leaves native options intact and prefixes only the initial user prompt.
pub(super) fn arguments(args: &[OsString], packet: &str) -> Result<Vec<OsString>, CliError> {
    let mut prompt = None;
    let mut separated = false;
    let mut i = 0;
    while i < args.len() {
        let text = args[i].to_str().ok_or_else(unavailable)?;
        if !separated && text == "--" {
            separated = true;
            i += 1;
            continue;
        }
        if !separated && takes_value(text) {
            i += 1;
            let value = args
                .get(i)
                .and_then(|value| value.to_str())
                .filter(|s| !s.is_empty() && !s.starts_with('-'))
                .ok_or_else(unavailable)?;
            let _ = value;
        } else if !separated && text.starts_with('-') {
            let assigned = text.split_once('=').is_some_and(|(flag, value)| {
                takes_value(flag) && !value.is_empty() && !value.starts_with('-')
            });
            if !assigned
                && !matches!(
                    text,
                    "--no-alt-screen"
                        | "--no-daemon"
                        | "--oss"
                        | "--search"
                        | "--approve-for-me"
                        | "--dangerously-bypass-approvals-and-sandbox"
                        | "--dangerously-bypass-hook-trust"
                )
            {
                return Err(unavailable());
            }
        } else {
            if prompt.is_some()
                || i + 1 != args.len()
                || text == "-"
                || (!separated
                    && matches!(
                        text,
                        "agents"
                            | "exec"
                            | "e"
                            | "review"
                            | "login"
                            | "logout"
                            | "mcp"
                            | "plugin"
                            | "app-server"
                            | "remote-control"
                            | "completion"
                            | "update"
                            | "doctor"
                            | "sandbox"
                            | "debug"
                            | "apply"
                            | "resume"
                            | "queue"
                            | "archive"
                            | "delete"
                            | "migrate-rollouts"
                            | "migrate-nfs-db"
                            | "unarchive"
                            | "fork"
                            | "cloud"
                            | "exec-server"
                            | "features"
                            | "help"
                    ))
            {
                return Err(unavailable());
            }
            prompt = Some(i);
        }
        i += 1;
    }
    let original = prompt.and_then(|index| args[index].to_str()).unwrap_or("");
    let text = format!("{packet}\n\nUser request:\n{original}");
    if text.len()
        + args
            .iter()
            .map(|s| s.as_encoded_bytes().len())
            .sum::<usize>()
        > 64 * 1024
    {
        return Err(unavailable());
    }
    let mut result = args.to_vec();
    if let Some(index) = prompt {
        result[index] = text.into();
    } else {
        if !separated {
            result.push("--".into());
        }
        result.push(text.into());
    }
    Ok(result)
}

#[cfg(unix)]
mod native {
    use super::*;
    use std::fs;
    use std::io::Read;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    type Identity = (u64, u64, u64, i64, i64, i64, i64);
    pub(crate) struct Admission {
        path: PathBuf,
        identity: Identity,
    }
    fn identity(path: &Path) -> Result<Identity, CliError> {
        let meta = fs::metadata(path).map_err(|_| unavailable())?;
        if !meta.is_file() || meta.permissions().mode() & 0o111 == 0 {
            return Err(unavailable());
        }
        Ok((
            meta.dev(),
            meta.ino(),
            meta.len(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec(),
        ))
    }
    struct Probe(Child);
    struct ProbeSignals(libc::sigset_t);
    impl ProbeSignals {
        fn defer() -> Result<Self, CliError> {
            let mut blocked = unsafe { std::mem::zeroed() };
            let mut previous = unsafe { std::mem::zeroed() };
            unsafe {
                libc::sigemptyset(&mut blocked);
                for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP, libc::SIGQUIT] {
                    libc::sigaddset(&mut blocked, signal);
                }
                if libc::sigprocmask(libc::SIG_BLOCK, &blocked, &mut previous) != 0 {
                    return Err(unavailable());
                }
            }
            Ok(Self(previous))
        }
    }
    impl Drop for ProbeSignals {
        fn drop(&mut self) {
            unsafe {
                libc::sigprocmask(libc::SIG_SETMASK, &self.0, std::ptr::null_mut());
            }
        }
    }
    impl Drop for Probe {
        fn drop(&mut self) {
            unsafe {
                libc::kill(-(self.0.id() as i32), libc::SIGKILL);
            }
            let _ = self.0.wait();
        }
    }
    impl Admission {
        pub(crate) fn prepare(root: &Path) -> Result<Self, CliError> {
            let paths = std::env::var_os("PATH").ok_or_else(unavailable)?;
            let path = std::env::split_paths(&paths)
                .map(|dir| {
                    let dir = if dir.is_absolute() {
                        dir
                    } else {
                        root.join(dir)
                    };
                    dir.join("codex")
                })
                .find(|path| identity(path).is_ok())
                .ok_or_else(unavailable)?;
            let path = fs::canonicalize(path).map_err(|_| unavailable())?;
            let admitted = Self {
                identity: identity(&path)?,
                path,
            };
            // This synchronous owner settles the probe before honoring termination.
            let signals = ProbeSignals::defer()?;
            let child_signals = signals.0;
            let mut command = Command::new(&admitted.path);
            command
                .arg("--version")
                .current_dir(root)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .process_group(0);
            unsafe {
                command.pre_exec(move || {
                    if libc::sigprocmask(libc::SIG_SETMASK, &child_signals, std::ptr::null_mut())
                        == 0
                    {
                        Ok(())
                    } else {
                        Err(std::io::Error::last_os_error())
                    }
                });
            }
            let child = command.spawn().map_err(|_| unavailable())?;
            let mut probe = Probe(child);
            let mut stdout = probe.0.stdout.take().ok_or_else(unavailable)?;
            let fd = stdout.as_raw_fd();
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
            {
                return Err(unavailable());
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut bytes = Vec::new();
            let mut eof = false;
            loop {
                if Instant::now() >= deadline {
                    return Err(unavailable());
                }
                let mut chunk = [0u8; 1024];
                match stdout.read(&mut chunk) {
                    Ok(0) => eof = true,
                    Ok(n) => {
                        bytes.extend_from_slice(&chunk[..n]);
                        if bytes.len() > 4096 {
                            return Err(unavailable());
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => return Err(unavailable()),
                }
                if eof {
                    if let Some(status) = probe.0.try_wait().map_err(|_| unavailable())? {
                        if !status.success() {
                            return Err(unavailable());
                        }
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            if std::str::from_utf8(&bytes).ok().map(str::trim) != Some("codex-cli 0.165.0") {
                return Err(unavailable());
            }
            admitted.path()?;
            Ok(admitted)
        }
        pub(crate) fn path(&self) -> Result<&Path, CliError> {
            if identity(&self.path)? != self.identity {
                return Err(unavailable());
            }
            Ok(&self.path)
        }
    }
}

#[cfg(unix)]
pub(super) use native::Admission;
