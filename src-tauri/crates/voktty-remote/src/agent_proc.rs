//! Persistent agent processes for the remote helper.
//!
//! The helper dies with its SSH connection, so an agent CLI cannot be its
//! child. `spawn` starts a detached *supervisor* (the helper re-executed with
//! `--proc-supervisor <dir>`) that owns the agent and records everything it
//! prints in an append-only log under `~/.voktty/proc/<id>/`. A later helper
//! reattaches by reading the log from the last offset it applied, so a dropped
//! connection loses no output and never interrupts the agent.
//!
//! Layout of a process directory (mode 0700):
//! - `meta.json`: what was started.
//! - `log`: records `[stream u8][length u32 BE][bytes]`; offsets are file positions.
//! - `in`: FIFO the supervisor forwards to the agent stdin.
//! - `supervisor.pid`, `child.pid`: liveness and signalling.
//! - `exit.json`: written once, atomically, when the agent has ended.

#![cfg_attr(not(unix), allow(dead_code))]

use std::fs::{self, File};
#[cfg(unix)]
use std::io::Write;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use voktty_remote_protocol::{PROC_STREAM_STDERR, PROC_STREAM_STDOUT, REMOTE_AGENT_COMMANDS};

pub const MAX_LOG_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_RECORD_BYTES: usize = 1024 * 1024;
pub const MAX_LIVE_PROCESSES: usize = 16;
pub const MAX_ARGS: usize = 256;
pub const MAX_ARG_BYTES: usize = 32 * 1024;
pub const MAX_TOTAL_ARG_BYTES: usize = 256 * 1024;
pub const MAX_LABEL_CHARS: usize = 64;
pub const MAX_STDIN_CHUNK_BYTES: usize = 1024 * 1024;
const EXITED_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const ORPHAN_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const READ_CHUNK: usize = 64 * 1024;
const READY_TIMEOUT: Duration = Duration::from_secs(5);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq)]
pub struct ProcError {
    pub code: &'static str,
    pub message: String,
}

impl ProcError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn io(error: io::Error) -> Self {
        Self::new("io_error", error.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcMeta {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub label: Option<String>,
    pub started_at_ms: u64,
    pub helper_version: String,
    /// Search path for the agent binary, fixed when the process is started.
    pub search_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProcExitInfo {
    pub code: Option<i32>,
    pub signal: Option<i32>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub label: Option<String>,
    /// Overrides the computed search path. Only tests set it.
    pub search_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcSummary {
    pub id: String,
    pub command: String,
    pub label: Option<String>,
    pub cwd: String,
    pub started_at_ms: u64,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub log_bytes: u64,
}

// --- validation (pure) -----------------------------------------------------

pub fn validate_command(name: &str) -> Result<(), ProcError> {
    if REMOTE_AGENT_COMMANDS.contains(&name) {
        Ok(())
    } else {
        Err(ProcError::new(
            "command_not_allowed",
            format!("{name:?} is not a supported agent command"),
        ))
    }
}

pub fn validate_args(args: &[String]) -> Result<(), ProcError> {
    if args.len() > MAX_ARGS {
        return Err(ProcError::new("invalid_params", "too many arguments"));
    }
    let mut total = 0usize;
    for arg in args {
        if arg.len() > MAX_ARG_BYTES || arg.contains('\0') {
            return Err(ProcError::new("invalid_params", "invalid argument"));
        }
        total += arg.len();
        if total > MAX_TOTAL_ARG_BYTES {
            return Err(ProcError::new("invalid_params", "arguments are too large"));
        }
    }
    Ok(())
}

pub fn validate_label(label: &str) -> Result<(), ProcError> {
    if label.chars().count() > MAX_LABEL_CHARS || label.chars().any(char::is_control) {
        return Err(ProcError::new("invalid_params", "invalid process label"));
    }
    Ok(())
}

pub fn validate_proc_id(id: &str) -> Result<(), ProcError> {
    if id.len() == 16
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err(ProcError::new("invalid_params", "invalid process id"))
    }
}

pub fn proc_base_dir(home: &Path) -> PathBuf {
    home.join(".voktty").join("proc")
}

// --- search path -----------------------------------------------------------

/// Where agent CLIs usually live. A non-interactive SSH command gets a bare
/// PATH, and version managers only export theirs from interactive rc files,
/// so the well-known install locations are added explicitly.
pub fn agent_search_path(current: Option<&str>, home: &Path) -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut push = |path: PathBuf| {
        if !dirs.contains(&path) {
            dirs.push(path);
        }
    };
    for relative in [
        ".local/bin",
        ".cargo/bin",
        ".npm-global/bin",
        ".volta/bin",
        ".bun/bin",
        ".asdf/shims",
    ] {
        let path = home.join(relative);
        if path.is_dir() {
            push(path);
        }
    }
    for (root, suffix) in [
        (home.join(".nvm/versions/node"), "bin"),
        (
            home.join(".local/share/fnm/node-versions"),
            "installation/bin",
        ),
    ] {
        let mut versions: Vec<PathBuf> = fs::read_dir(&root)
            .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
            .unwrap_or_default();
        versions.sort();
        versions.reverse();
        for version in versions.into_iter().take(3) {
            let path = version.join(suffix);
            if path.is_dir() {
                push(path);
            }
        }
    }
    push(PathBuf::from("/usr/local/bin"));
    for entry in current.unwrap_or_default().split(':') {
        if !entry.is_empty() {
            push(PathBuf::from(entry));
        }
    }
    dirs.iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(unix)]
pub fn find_executable(name: &str, search_path: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    if name.contains('/') {
        return None;
    }
    search_path
        .split(':')
        .filter(|entry| !entry.is_empty())
        .map(|entry| Path::new(entry).join(name))
        .find(|candidate| {
            fs::metadata(candidate)
                .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        })
}

// --- log records -----------------------------------------------------------

pub fn encode_record(stream: u8, data: &[u8]) -> Vec<u8> {
    let mut record = Vec::with_capacity(5 + data.len());
    record.push(stream);
    record.extend_from_slice(&(data.len() as u32).to_be_bytes());
    record.extend_from_slice(data);
    record
}

#[derive(Debug, PartialEq)]
pub enum ReadOutcome {
    Record {
        stream: u8,
        data: Vec<u8>,
        next_offset: u64,
    },
    /// Nothing more is available yet (end of file or a record still being written).
    Pending,
    Corrupt,
}

/// Reads the record that starts at `offset`. A record the supervisor is still
/// writing reads as `Pending`, never as partial data.
pub fn read_record(file: &mut File, offset: u64) -> io::Result<ReadOutcome> {
    file.seek(SeekFrom::Start(offset))?;
    let mut header = [0u8; 5];
    let read = read_full(file, &mut header)?;
    if read < header.len() {
        return Ok(ReadOutcome::Pending);
    }
    let stream = header[0];
    let length = u32::from_be_bytes([header[1], header[2], header[3], header[4]]) as usize;
    if (stream != PROC_STREAM_STDOUT && stream != PROC_STREAM_STDERR) || length > MAX_RECORD_BYTES {
        return Ok(ReadOutcome::Corrupt);
    }
    let mut data = vec![0u8; length];
    if read_full(file, &mut data)? < length {
        return Ok(ReadOutcome::Pending);
    }
    Ok(ReadOutcome::Record {
        stream,
        data,
        next_offset: offset + 5 + length as u64,
    })
}

fn read_full(file: &mut File, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

// --- process directory helpers --------------------------------------------

fn meta_path(dir: &Path) -> PathBuf {
    dir.join("meta.json")
}
fn log_path(dir: &Path) -> PathBuf {
    dir.join("log")
}
fn exit_path(dir: &Path) -> PathBuf {
    dir.join("exit.json")
}
fn fifo_path(dir: &Path) -> PathBuf {
    dir.join("in")
}
fn pid_file(dir: &Path, name: &str) -> PathBuf {
    dir.join(name)
}

pub fn read_meta(dir: &Path) -> Result<ProcMeta, ProcError> {
    let bytes = fs::read(meta_path(dir)).map_err(ProcError::io)?;
    serde_json::from_slice(&bytes)
        .map_err(|error| ProcError::new("corrupt_process", error.to_string()))
}

pub fn read_exit(dir: &Path) -> Option<ProcExitInfo> {
    serde_json::from_slice(&fs::read(exit_path(dir)).ok()?).ok()
}

fn write_exit(dir: &Path, info: &ProcExitInfo) -> io::Result<()> {
    let tmp = dir.join("exit.json.tmp");
    let bytes = serde_json::to_vec(info).map_err(io::Error::other)?;
    fs::write(&tmp, bytes)?;
    fs::rename(tmp, exit_path(dir))
}

fn read_pid(dir: &Path, name: &str) -> Option<i32> {
    fs::read_to_string(pid_file(dir, name))
        .ok()?
        .trim()
        .parse::<i32>()
        .ok()
        .filter(|pid| *pid > 1)
}

#[cfg(unix)]
fn pid_alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn pid_alive(_pid: i32) -> bool {
    false
}

pub fn supervisor_alive(dir: &Path) -> bool {
    read_pid(dir, "supervisor.pid").is_some_and(pid_alive)
}

pub fn proc_dir(base: &Path, id: &str) -> Result<PathBuf, ProcError> {
    validate_proc_id(id)?;
    let dir = base.join(id);
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(ProcError::new("process_not_found", "no such process"))
    }
}

// --- tailing ---------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum TailEvent {
    Output {
        stream: u8,
        data: Vec<u8>,
        next_offset: u64,
    },
    Exit {
        info: ProcExitInfo,
        next_offset: u64,
    },
    Idle,
}

/// Follows a process log from a given offset. Used by one attachment.
pub struct TailReader {
    dir: PathBuf,
    file: File,
    offset: u64,
}

impl TailReader {
    pub fn open(dir: &Path, from_offset: u64) -> Result<Self, ProcError> {
        let file = File::open(log_path(dir)).map_err(ProcError::io)?;
        let length = file.metadata().map_err(ProcError::io)?.len();
        if from_offset > length {
            return Err(ProcError::new(
                "offset_out_of_range",
                format!("offset {from_offset} is past the end of the log ({length})"),
            ));
        }
        Ok(Self {
            dir: dir.to_path_buf(),
            file,
            offset: from_offset,
        })
    }

    pub fn offset(&self) -> u64 {
        self.offset
    }

    pub fn poll(&mut self) -> Result<TailEvent, ProcError> {
        match read_record(&mut self.file, self.offset).map_err(ProcError::io)? {
            ReadOutcome::Record {
                stream,
                data,
                next_offset,
            } => {
                self.offset = next_offset;
                return Ok(TailEvent::Output {
                    stream,
                    data,
                    next_offset,
                });
            }
            ReadOutcome::Corrupt => {
                return Err(ProcError::new("corrupt_log", "the process log is corrupt"))
            }
            ReadOutcome::Pending => {}
        }
        let finished = read_exit(&self.dir).or_else(|| {
            (!supervisor_alive(&self.dir)).then(|| ProcExitInfo {
                code: None,
                signal: None,
                reason: Some("supervisor_lost".to_string()),
            })
        });
        let Some(info) = finished else {
            return Ok(TailEvent::Idle);
        };
        // The supervisor writes the exit file after its last record, but this
        // read may have raced it: drain once more before reporting the exit.
        match read_record(&mut self.file, self.offset).map_err(ProcError::io)? {
            ReadOutcome::Record {
                stream,
                data,
                next_offset,
            } => {
                self.offset = next_offset;
                Ok(TailEvent::Output {
                    stream,
                    data,
                    next_offset,
                })
            }
            _ => Ok(TailEvent::Exit {
                info,
                next_offset: self.offset,
            }),
        }
    }
}

// --- stdin -----------------------------------------------------------------

#[cfg(unix)]
pub fn open_stdin(dir: &Path) -> Result<File, ProcError> {
    // Read-write so opening never blocks and the supervisor never sees EOF.
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(fifo_path(dir))
        .map_err(ProcError::io)
}

// --- control ---------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum KillSignal {
    Interrupt,
    Terminate,
    Kill,
}

impl KillSignal {
    pub fn parse(value: Option<&str>) -> Result<Self, ProcError> {
        match value.unwrap_or("term") {
            "int" => Ok(Self::Interrupt),
            "term" => Ok(Self::Terminate),
            "kill" => Ok(Self::Kill),
            other => Err(ProcError::new(
                "invalid_params",
                format!("unknown signal {other:?}"),
            )),
        }
    }
}

/// Signals the agent's whole process group. Already-finished processes are a no-op.
#[cfg(unix)]
pub fn send_signal(dir: &Path, signal: KillSignal) -> Result<(), ProcError> {
    if read_exit(dir).is_some() {
        return Ok(());
    }
    let Some(pid) = read_pid(dir, "child.pid") else {
        return Err(ProcError::new("not_running", "the process has not started"));
    };
    let number = match signal {
        KillSignal::Interrupt => libc::SIGINT,
        KillSignal::Terminate => libc::SIGTERM,
        KillSignal::Kill => libc::SIGKILL,
    };
    // SAFETY: a negative pid addresses the process group led by the agent.
    let result = unsafe { libc::kill(-pid, number) };
    if result == 0 || io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(ProcError::io(io::Error::last_os_error()))
    }
}

pub fn list(base: &Path) -> Vec<ProcSummary> {
    let mut summaries = Vec::new();
    let Ok(entries) = fs::read_dir(base) else {
        return summaries;
    };
    for entry in entries.flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if validate_proc_id(&id).is_err() {
            continue;
        }
        let dir = entry.path();
        let Ok(meta) = read_meta(&dir) else { continue };
        let exit = read_exit(&dir);
        summaries.push(ProcSummary {
            id,
            command: meta.command,
            label: meta.label,
            cwd: meta.cwd,
            started_at_ms: meta.started_at_ms,
            running: exit.is_none() && supervisor_alive(&dir),
            exit_code: exit.and_then(|info| info.code),
            log_bytes: fs::metadata(log_path(&dir)).map(|m| m.len()).unwrap_or(0),
        });
    }
    summaries.sort_by_key(|summary| summary.started_at_ms);
    summaries
}

fn live_count(base: &Path) -> usize {
    list(base).iter().filter(|summary| summary.running).count()
}

/// Removes a finished process directory; `force` also stops a running one.
pub fn close(base: &Path, id: &str, force: bool) -> Result<(), ProcError> {
    let dir = proc_dir(base, id)?;
    let running = read_exit(&dir).is_none() && supervisor_alive(&dir);
    if running {
        if !force {
            return Err(ProcError::new(
                "still_running",
                "the process is still running",
            ));
        }
        #[cfg(unix)]
        send_signal(&dir, KillSignal::Kill)?;
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while supervisor_alive(&dir) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    fs::remove_dir_all(dir).map_err(ProcError::io)
}

/// Drops finished processes after a day and dead orphans after a week.
pub fn cleanup_expired(base: &Path, now: SystemTime) -> usize {
    let Ok(entries) = fs::read_dir(base) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if validate_proc_id(&id).is_err() {
            continue;
        }
        let dir = entry.path();
        let age = |path: PathBuf| {
            fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
        };
        let expired = if exit_path(&dir).exists() {
            age(exit_path(&dir)).is_some_and(|age| age > EXITED_TTL)
        } else {
            !supervisor_alive(&dir) && age(meta_path(&dir)).is_some_and(|age| age > ORPHAN_TTL)
        };
        if expired && fs::remove_dir_all(&dir).is_ok() {
            removed += 1;
        }
    }
    removed
}

// --- spawn -----------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct SpawnedProcess {
    pub id: String,
    #[cfg_attr(not(test), allow(dead_code))]
    pub dir: PathBuf,
    pub child_pid: Option<i32>,
}

/// Starts the detached supervisor for a directory that is already prepared.
pub type SupervisorLauncher<'a> = &'a dyn Fn(&Path) -> io::Result<()>;

fn new_proc_id() -> String {
    let mut bytes = [0u8; 8];
    let filled = File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_ok();
    if !filled {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0) as u64;
        bytes = (nanos ^ ((std::process::id() as u64) << 32)).to_be_bytes();
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(unix)]
pub fn spawn_process(
    base: &Path,
    home: &Path,
    spec: &SpawnSpec,
    launch: SupervisorLauncher<'_>,
) -> Result<SpawnedProcess, ProcError> {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};

    validate_command(&spec.command)?;
    validate_args(&spec.args)?;
    if let Some(label) = &spec.label {
        validate_label(label)?;
    }
    if live_count(base) >= MAX_LIVE_PROCESSES {
        return Err(ProcError::new(
            "too_many_processes",
            format!("at most {MAX_LIVE_PROCESSES} agent processes may run at once"),
        ));
    }
    let search_path = spec
        .search_path
        .clone()
        .unwrap_or_else(|| agent_search_path(std::env::var("PATH").ok().as_deref(), home));
    if find_executable(&spec.command, &search_path).is_none() {
        return Err(ProcError::new(
            "command_not_found",
            format!("{} is not installed on this host", spec.command),
        ));
    }

    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(base)
        .map_err(ProcError::io)?;
    let id = new_proc_id();
    let dir = base.join(&id);
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&dir)
        .map_err(ProcError::io)?;
    let cleanup = |error: ProcError| {
        let _ = fs::remove_dir_all(&dir);
        error
    };

    let meta = ProcMeta {
        id: id.clone(),
        command: spec.command.clone(),
        args: spec.args.clone(),
        cwd: spec.cwd.to_string_lossy().into_owned(),
        label: spec.label.clone(),
        started_at_ms: now_ms(),
        helper_version: env!("CARGO_PKG_VERSION").to_string(),
        search_path,
    };
    let write_private = |path: PathBuf, bytes: &[u8]| -> io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(bytes)
    };
    write_private(
        meta_path(&dir),
        &serde_json::to_vec(&meta)
            .map_err(|e| cleanup(ProcError::new("io_error", e.to_string())))?,
    )
    .map_err(|e| cleanup(ProcError::io(e)))?;
    write_private(log_path(&dir), b"").map_err(|e| cleanup(ProcError::io(e)))?;
    make_fifo(&fifo_path(&dir)).map_err(|e| cleanup(ProcError::io(e)))?;

    launch(&dir).map_err(|e| cleanup(ProcError::new("spawn_failed", e.to_string())))?;

    let deadline = std::time::Instant::now() + READY_TIMEOUT;
    loop {
        if let Some(pid) = read_pid(&dir, "child.pid") {
            return Ok(SpawnedProcess {
                id,
                dir,
                child_pid: Some(pid),
            });
        }
        if let Some(exit) = read_exit(&dir) {
            // The supervisor already failed: report it instead of a dead id.
            let message = exit
                .reason
                .unwrap_or_else(|| "the agent exited".to_string());
            return Err(cleanup(ProcError::new("spawn_failed", message)));
        }
        if std::time::Instant::now() >= deadline {
            return Err(cleanup(ProcError::new(
                "spawn_timeout",
                "the agent supervisor did not start in time",
            )));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(unix)]
fn make_fifo(path: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"))?;
    // SAFETY: c_path is a valid NUL-terminated path and mkfifo does not retain it.
    if unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// Launcher used in production: the helper binary itself, detached into its
/// own session so it outlives the SSH connection.
#[cfg(unix)]
pub fn detached_supervisor_launcher(executable: PathBuf) -> impl Fn(&Path) -> io::Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    move |dir: &Path| {
        let mut command = Command::new(&executable);
        command
            .arg("--proc-supervisor")
            .arg(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // SAFETY: setsid is async-signal-safe and is the only call made after fork.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn()?;
        // Reap the supervisor if it ends while this helper is still running.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}

// --- supervisor ------------------------------------------------------------

#[cfg(unix)]
struct LogWriter {
    file: std::sync::Mutex<File>,
    written: std::sync::atomic::AtomicU64,
    limit: u64,
    limit_hit: std::sync::atomic::AtomicBool,
}

#[cfg(unix)]
impl LogWriter {
    /// Returns false once the log is full; nothing more is recorded.
    fn append(&self, stream: u8, data: &[u8]) -> bool {
        use std::sync::atomic::Ordering;
        for piece in data.chunks(MAX_RECORD_BYTES) {
            let record = encode_record(stream, piece);
            let previous = self
                .written
                .fetch_add(record.len() as u64, Ordering::SeqCst);
            if previous + record.len() as u64 > self.limit {
                self.limit_hit.store(true, Ordering::SeqCst);
                return false;
            }
            let Ok(mut file) = self.file.lock() else {
                return false;
            };
            if file.write_all(&record).and_then(|_| file.flush()).is_err() {
                return false;
            }
        }
        true
    }
}

/// Body of the detached supervisor. Returns the process exit status.
#[cfg(unix)]
pub fn run_supervisor(dir: &Path) -> i32 {
    run_supervisor_with_limit(dir, MAX_LOG_BYTES)
}

#[cfg(unix)]
pub fn run_supervisor_with_limit(dir: &Path, log_limit: u64) -> i32 {
    use std::os::unix::process::{CommandExt, ExitStatusExt};
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::sync::{mpsc, Arc};

    let finish = |info: ProcExitInfo| -> i32 {
        let _ = write_exit(dir, &info);
        0
    };
    let _ = fs::write(
        pid_file(dir, "supervisor.pid"),
        std::process::id().to_string(),
    );
    let meta = match read_meta(dir) {
        Ok(meta) => meta,
        Err(error) => {
            return finish(ProcExitInfo {
                code: Some(126),
                signal: None,
                reason: Some(format!("invalid_metadata: {}", error.message)),
            })
        }
    };
    let Some(executable) = find_executable(&meta.command, &meta.search_path) else {
        return finish(ProcExitInfo {
            code: Some(127),
            signal: None,
            reason: Some(format!("command_not_found: {}", meta.command)),
        });
    };
    let log_file = match fs::OpenOptions::new().append(true).open(log_path(dir)) {
        Ok(file) => file,
        Err(error) => {
            return finish(ProcExitInfo {
                code: Some(126),
                signal: None,
                reason: Some(format!("log_unavailable: {error}")),
            })
        }
    };
    let stdin_fifo = open_stdin(dir).ok();

    let mut command = Command::new(&executable);
    command
        .args(&meta.args)
        .current_dir(&meta.cwd)
        .env("PATH", &meta.search_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return finish(ProcExitInfo {
                code: Some(126),
                signal: None,
                reason: Some(format!("spawn_failed: {error}")),
            })
        }
    };
    let child_pid = child.id() as i32;
    let _ = fs::write(pid_file(dir, "child.pid"), child_pid.to_string());

    let writer = Arc::new(LogWriter {
        file: std::sync::Mutex::new(log_file),
        written: std::sync::atomic::AtomicU64::new(0),
        limit: log_limit,
        limit_hit: std::sync::atomic::AtomicBool::new(false),
    });
    let group = Arc::new(AtomicI32::new(child_pid));
    let (done_tx, done_rx) = mpsc::channel::<()>();

    let mut readers = 0;
    let mut spawn_reader = |stream: u8, mut source: Box<dyn Read + Send>| {
        readers += 1;
        let writer = Arc::clone(&writer);
        let group = Arc::clone(&group);
        let done = done_tx.clone();
        std::thread::spawn(move || {
            let mut buffer = vec![0u8; READ_CHUNK];
            loop {
                match source.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if !writer.append(stream, &buffer[..read]) {
                            // SAFETY: stops the agent group once the log is full.
                            unsafe { libc::kill(-group.load(Ordering::SeqCst), libc::SIGKILL) };
                            break;
                        }
                    }
                }
            }
            let _ = done.send(());
        });
    };
    if let Some(stdout) = child.stdout.take() {
        spawn_reader(PROC_STREAM_STDOUT, Box::new(stdout));
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_reader(PROC_STREAM_STDERR, Box::new(stderr));
    }
    drop(done_tx);

    if let (Some(mut fifo), Some(mut input)) = (stdin_fifo, child.stdin.take()) {
        std::thread::spawn(move || {
            let mut buffer = vec![0u8; READ_CHUNK];
            loop {
                match fifo.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if input
                            .write_all(&buffer[..read])
                            .and_then(|_| input.flush())
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });
    }

    let status = child.wait();
    let deadline = std::time::Instant::now() + DRAIN_TIMEOUT;
    for _ in 0..readers {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if done_rx.recv_timeout(remaining).is_err() {
            break;
        }
    }
    let limit_hit = writer.limit_hit.load(Ordering::SeqCst);
    let info = match status {
        Ok(status) => ProcExitInfo {
            code: status.code(),
            signal: status.signal(),
            reason: limit_hit.then(|| "log_limit".to_string()),
        },
        Err(error) => ProcExitInfo {
            code: None,
            signal: None,
            reason: Some(format!("wait_failed: {error}")),
        },
    };
    finish(info)
}

// --- unsupported platforms -------------------------------------------------

#[cfg(not(unix))]
pub fn spawn_process(
    _base: &Path,
    _home: &Path,
    _spec: &SpawnSpec,
    _launch: SupervisorLauncher<'_>,
) -> Result<SpawnedProcess, ProcError> {
    Err(ProcError::new(
        "unsupported_platform",
        "persistent agent processes need a Unix host",
    ))
}

#[cfg(not(unix))]
pub fn send_signal(_dir: &Path, _signal: KillSignal) -> Result<(), ProcError> {
    Err(ProcError::new(
        "unsupported_platform",
        "persistent agent processes need a Unix host",
    ))
}

#[cfg(not(unix))]
pub fn open_stdin(_dir: &Path) -> Result<File, ProcError> {
    Err(ProcError::new(
        "unsupported_platform",
        "persistent agent processes need a Unix host",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn only_known_agent_commands_are_accepted() {
        assert!(validate_command("codex").is_ok());
        for rejected in ["sh", "bash", "/usr/bin/codex", "codex --yolo", "", "rm"] {
            assert_eq!(
                validate_command(rejected).unwrap_err().code,
                "command_not_allowed"
            );
        }
    }

    #[test]
    fn arguments_are_bounded_and_free_of_nul() {
        assert!(validate_args(&["--json".into(), "x".into()]).is_ok());
        assert!(validate_args(&vec!["a".to_string(); MAX_ARGS + 1]).is_err());
        assert!(validate_args(&["a\0b".into()]).is_err());
        assert!(validate_args(&["x".repeat(MAX_ARG_BYTES + 1)]).is_err());
        let many = vec!["x".repeat(MAX_ARG_BYTES); 9];
        assert!(validate_args(&many).is_err());
    }

    #[test]
    fn process_ids_are_sixteen_lowercase_hex_digits() {
        assert!(validate_proc_id("0123456789abcdef").is_ok());
        for bad in [
            "",
            "0123456789ABCDEF",
            "../../etc/passwd",
            "0123456789abcde",
            "0123456789abcdeg",
        ] {
            assert!(validate_proc_id(bad).is_err(), "{bad}");
        }
        assert!(validate_proc_id(&new_proc_id()).is_ok());
    }

    #[test]
    fn labels_reject_control_characters_and_long_values() {
        assert!(validate_label("Codex: fix build").is_ok());
        assert!(validate_label("line\nbreak").is_err());
        assert!(validate_label(&"x".repeat(MAX_LABEL_CHARS + 1)).is_err());
    }

    #[test]
    fn records_round_trip_and_partial_writes_read_as_pending() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("log");
        let mut bytes = encode_record(PROC_STREAM_STDOUT, b"hello\n");
        let second = encode_record(PROC_STREAM_STDERR, b"oops");
        bytes.extend_from_slice(&second[..3]);
        fs::write(&path, &bytes).unwrap();
        let mut file = File::open(&path).unwrap();

        let first = read_record(&mut file, 0).unwrap();
        let next = match first {
            ReadOutcome::Record {
                stream,
                data,
                next_offset,
            } => {
                assert_eq!(
                    (stream, data.as_slice()),
                    (PROC_STREAM_STDOUT, &b"hello\n"[..])
                );
                next_offset
            }
            other => panic!("unexpected {other:?}"),
        };
        assert_eq!(next, 11);
        assert_eq!(read_record(&mut file, next).unwrap(), ReadOutcome::Pending);

        fs::write(&path, [bytes[..11].to_vec(), second.clone()].concat()).unwrap();
        let mut file = File::open(&path).unwrap();
        assert!(matches!(
            read_record(&mut file, next).unwrap(),
            ReadOutcome::Record {
                stream: PROC_STREAM_STDERR,
                ..
            }
        ));
    }

    #[test]
    fn corrupt_records_are_reported_not_guessed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("log");
        fs::write(&path, [9u8, 0, 0, 0, 1, 0]).unwrap();
        let mut file = File::open(&path).unwrap();
        assert_eq!(read_record(&mut file, 0).unwrap(), ReadOutcome::Corrupt);
        fs::write(&path, [1u8, 0xff, 0xff, 0xff, 0xff]).unwrap();
        let mut file = File::open(&path).unwrap();
        assert_eq!(read_record(&mut file, 0).unwrap(), ReadOutcome::Corrupt);
    }

    #[cfg(unix)]
    #[test]
    fn search_path_adds_version_manager_directories_without_duplicates() {
        let home = tempdir().unwrap();
        for relative in [
            ".local/bin",
            ".nvm/versions/node/v20.1.0/bin",
            ".nvm/versions/node/v22.2.0/bin",
            ".local/share/fnm/node-versions/v24.0.0/installation/bin",
        ] {
            fs::create_dir_all(home.path().join(relative)).unwrap();
        }
        let path = agent_search_path(Some("/usr/bin:/usr/local/bin:/usr/bin"), home.path());
        let entries: Vec<&str> = path.split(':').collect();
        let local = home
            .path()
            .join(".local/bin")
            .to_string_lossy()
            .into_owned();
        let newest = home
            .path()
            .join(".nvm/versions/node/v22.2.0/bin")
            .to_string_lossy()
            .into_owned();
        let older = home
            .path()
            .join(".nvm/versions/node/v20.1.0/bin")
            .to_string_lossy()
            .into_owned();
        assert_eq!(entries[0], local);
        let position = |value: &str| entries.iter().position(|entry| *entry == value);
        assert!(position(&newest) < position(&older));
        assert_eq!(entries.iter().filter(|e| **e == "/usr/bin").count(), 1);
        assert!(entries.contains(&"/usr/local/bin"));
    }

    #[test]
    fn expired_directories_are_removed_but_recent_and_live_ones_are_kept() {
        let base = tempdir().unwrap();
        let make = |id: &str, exit: bool| {
            let dir = base.path().join(id);
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("meta.json"),
                serde_json::to_vec(&ProcMeta {
                    id: id.to_string(),
                    command: "codex".into(),
                    args: vec![],
                    cwd: "/".into(),
                    label: None,
                    started_at_ms: 0,
                    helper_version: "t".into(),
                    search_path: String::new(),
                })
                .unwrap(),
            )
            .unwrap();
            if exit {
                write_exit(
                    &dir,
                    &ProcExitInfo {
                        code: Some(0),
                        signal: None,
                        reason: None,
                    },
                )
                .unwrap();
            }
            dir
        };
        make("00000000000000aa", true);
        make("00000000000000bb", false);
        fs::create_dir_all(base.path().join("not-a-proc")).unwrap();

        assert_eq!(cleanup_expired(base.path(), SystemTime::now()), 0);
        let day_later = SystemTime::now() + EXITED_TTL + Duration::from_secs(60);
        assert_eq!(cleanup_expired(base.path(), day_later), 1);
        assert!(!base.path().join("00000000000000aa").exists());
        assert!(base.path().join("00000000000000bb").exists());
        let week_later = SystemTime::now() + ORPHAN_TTL + Duration::from_secs(60);
        assert_eq!(cleanup_expired(base.path(), week_later), 1);
        assert!(base.path().join("not-a-proc").exists());
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    struct Fixture {
        _home: tempfile::TempDir,
        bin: tempfile::TempDir,
        base: PathBuf,
        work: tempfile::TempDir,
    }

    fn fixture(script_name: &str, script: &str) -> Fixture {
        let home = tempdir().unwrap();
        let bin = tempdir().unwrap();
        let work = tempdir().unwrap();
        let path = bin.path().join(script_name);
        fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        let base = proc_base_dir(home.path());
        Fixture {
            _home: home,
            bin,
            base,
            work,
        }
    }

    fn spec(fixture: &Fixture, command: &str) -> SpawnSpec {
        SpawnSpec {
            command: command.to_string(),
            args: vec!["--flag".to_string()],
            cwd: fixture.work.path().to_path_buf(),
            label: Some("test".to_string()),
            search_path: Some(format!("{}:/usr/bin:/bin", fixture.bin.path().display())),
        }
    }

    /// Runs the supervisor on a thread instead of a detached process.
    fn in_process_launcher(limit: u64) -> impl Fn(&Path) -> io::Result<()> {
        move |dir: &Path| {
            let dir = dir.to_path_buf();
            std::thread::spawn(move || {
                run_supervisor_with_limit(&dir, limit);
            });
            Ok(())
        }
    }

    fn collect(dir: &Path, from: u64) -> (Vec<u8>, Vec<u8>, ProcExitInfo, u64) {
        let mut tail = TailReader::open(dir, from).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            match tail.poll().unwrap() {
                TailEvent::Output { stream, data, .. } => {
                    if stream == PROC_STREAM_STDOUT {
                        out.extend(data);
                    } else {
                        err.extend(data);
                    }
                }
                TailEvent::Exit { info, next_offset } => return (out, err, info, next_offset),
                TailEvent::Idle => {
                    assert!(std::time::Instant::now() < deadline, "timed out");
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
    }

    #[test]
    fn records_stdout_stderr_and_the_exit_code_in_order() {
        let fx = fixture("codex", "echo out-$1; echo err >&2; pwd; exit 3");
        let launch = in_process_launcher(MAX_LOG_BYTES);
        let spawned = spawn_process(
            &fx.base,
            fx.base.parent().unwrap(),
            &spec(&fx, "codex"),
            &launch,
        )
        .unwrap();
        let (out, err, info, _) = collect(&spawned.dir, 0);
        let work = fs::canonicalize(fx.work.path()).unwrap();
        assert_eq!(
            String::from_utf8(out).unwrap(),
            format!("out---flag\n{}\n", work.display())
        );
        assert_eq!(err, b"err\n");
        assert_eq!(info.code, Some(3));
        assert_eq!(info.signal, None);
        assert!(validate_proc_id(&spawned.id).is_ok());
    }

    #[test]
    fn reattaching_from_a_saved_offset_replays_only_the_missing_tail() {
        let fx = fixture("codex", "echo first; sleep 0.3; echo second; echo third");
        let launch = in_process_launcher(MAX_LOG_BYTES);
        let spawned = spawn_process(
            &fx.base,
            fx.base.parent().unwrap(),
            &spec(&fx, "codex"),
            &launch,
        )
        .unwrap();

        let mut tail = TailReader::open(&spawned.dir, 0).unwrap();
        let mut applied = 0;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while applied == 0 {
            match tail.poll().unwrap() {
                TailEvent::Output {
                    data, next_offset, ..
                } => {
                    assert_eq!(data, b"first\n");
                    applied = next_offset;
                }
                _ => {
                    assert!(std::time::Instant::now() < deadline);
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
        drop(tail);

        let (out, _, info, _) = collect(&spawned.dir, applied);
        assert_eq!(out, b"second\nthird\n");
        assert_eq!(info.code, Some(0));
        let (all, _, _, end) = collect(&spawned.dir, 0);
        assert_eq!(all, b"first\nsecond\nthird\n");
        assert!(matches!(
            TailReader::open(&spawned.dir, end + 1),
            Err(ProcError {
                code: "offset_out_of_range",
                ..
            })
        ));
    }

    #[test]
    fn stdin_reaches_the_agent_through_the_fifo() {
        let fx = fixture(
            "codex",
            "while read line; do echo \"got:$line\"; [ \"$line\" = quit ] && exit 0; done",
        );
        let launch = in_process_launcher(MAX_LOG_BYTES);
        let spawned = spawn_process(
            &fx.base,
            fx.base.parent().unwrap(),
            &spec(&fx, "codex"),
            &launch,
        )
        .unwrap();
        let mut input = open_stdin(&spawned.dir).unwrap();
        input.write_all(b"one\ntwo\nquit\n").unwrap();
        let (out, _, info, _) = collect(&spawned.dir, 0);
        assert_eq!(out, b"got:one\ngot:two\ngot:quit\n");
        assert_eq!(info.code, Some(0));
    }

    #[test]
    fn kill_stops_the_whole_process_group_and_records_the_signal() {
        let fx = fixture("codex", "sleep 30 & sleep 30; wait");
        let launch = in_process_launcher(MAX_LOG_BYTES);
        let spawned = spawn_process(
            &fx.base,
            fx.base.parent().unwrap(),
            &spec(&fx, "codex"),
            &launch,
        )
        .unwrap();
        assert!(list(&fx.base)[0].running);
        send_signal(&spawned.dir, KillSignal::Terminate).unwrap();
        let (_, _, info, _) = collect(&spawned.dir, 0);
        assert_eq!(info.signal, Some(libc::SIGTERM));
        assert_eq!(info.code, None);
        assert!(!list(&fx.base)[0].running);
        send_signal(&spawned.dir, KillSignal::Kill).unwrap();
    }

    #[test]
    fn a_full_log_stops_the_agent_with_an_explicit_reason() {
        let fx = fixture("codex", "yes xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
        let launch = in_process_launcher(64 * 1024);
        let spawned = spawn_process(
            &fx.base,
            fx.base.parent().unwrap(),
            &spec(&fx, "codex"),
            &launch,
        )
        .unwrap();
        let (_, _, info, _) = collect(&spawned.dir, 0);
        assert_eq!(info.reason.as_deref(), Some("log_limit"));
        assert!(info.signal.is_some());
    }

    #[test]
    fn spawn_refuses_unknown_missing_and_excess_processes() {
        let fx = fixture("codex", "exit 0");
        let launch = in_process_launcher(MAX_LOG_BYTES);
        let home = fx.base.parent().unwrap();
        assert_eq!(
            spawn_process(&fx.base, home, &spec(&fx, "sh"), &launch)
                .unwrap_err()
                .code,
            "command_not_allowed"
        );
        assert_eq!(
            spawn_process(&fx.base, home, &spec(&fx, "claude"), &launch)
                .unwrap_err()
                .code,
            "command_not_found"
        );
        assert!(spawn_process(&fx.base, home, &spec(&fx, "codex"), &launch).is_ok());
    }

    #[test]
    fn close_removes_finished_processes_and_protects_running_ones() {
        let fx = fixture("codex", "sleep 30");
        let launch = in_process_launcher(MAX_LOG_BYTES);
        let spawned = spawn_process(
            &fx.base,
            fx.base.parent().unwrap(),
            &spec(&fx, "codex"),
            &launch,
        )
        .unwrap();
        assert_eq!(
            close(&fx.base, &spawned.id, false).unwrap_err().code,
            "still_running"
        );
        close(&fx.base, &spawned.id, true).unwrap();
        assert!(!spawned.dir.exists());
        assert_eq!(
            close(&fx.base, &spawned.id, false).unwrap_err().code,
            "process_not_found"
        );
        assert_eq!(
            close(&fx.base, "../..", false).unwrap_err().code,
            "invalid_params"
        );
    }

    #[test]
    fn a_missing_binary_in_the_supervisor_ends_with_code_127() {
        let fx = fixture("codex", "exit 0");
        let home = fx.base.parent().unwrap();
        fs::create_dir_all(&fx.base).unwrap();
        let dir = fx.base.join("00000000000000cc");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            meta_path(&dir),
            serde_json::to_vec(&ProcMeta {
                id: "00000000000000cc".into(),
                command: "codex".into(),
                args: vec![],
                cwd: fx.work.path().to_string_lossy().into_owned(),
                label: None,
                started_at_ms: 0,
                helper_version: "t".into(),
                search_path: home.to_string_lossy().into_owned(),
            })
            .unwrap(),
        )
        .unwrap();
        run_supervisor(&dir);
        let exit = read_exit(&dir).unwrap();
        assert_eq!(exit.code, Some(127));
        assert!(exit.reason.unwrap().starts_with("command_not_found"));
    }
}
