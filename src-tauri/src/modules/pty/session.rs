use std::io::{Read, Write};
use std::mem::ManuallyDrop;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(not(target_os = "android"))]
use portable_pty::native_pty_system;
use portable_pty::{ChildKiller, MasterPty, PtySize};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager};

use super::agent_detect::AgentDetector;
use super::da_filter::DaFilter;
#[cfg(not(target_os = "android"))]
use super::shell_init;
use crate::modules::workspace::WorkspaceEnv;

const AGENT_EVENT: &str = "voktty:agent-signal";

// Flusher coalesces a short window after first-byte arrival so we send chunks,
// not single bytes. MAX_IDLE is only a safety net for missed signals.
const FLUSH_COALESCE: Duration = Duration::from_millis(4);
const FLUSH_MAX_IDLE: Duration = Duration::from_millis(50);
const READ_BUF: usize = 16 * 1024;
// Cap on buffered-but-not-yet-flushed bytes. On overflow we discard the
// entire pending buffer and emit an SGR-reset + notice in its place.
// Dropping a partial prefix would slice a CSI sequence in half and corrupt
// subsequent terminal state.
const MAX_PENDING: usize = 4 * 1024 * 1024;

// Hard reset (ESC c) + dim notice. Written verbatim into the stream when
// we're forced to discard backlog.
const OVERFLOW_NOTICE: &[u8] =
    b"\x1bc\x1b[2m[voktty: dropped output due to backpressure]\x1b[0m\r\n";

pub struct Session {
    // Windows process tree lifecycle:
    //
    // Drop order matters: Rust drops fields in declaration order:
    //   1. `_job` — on Windows, closing the Job HANDLE fires
    //      KILL_ON_JOB_CLOSE, terminating the pwsh tree before the master
    //      pipe drops. Without this, ClosePseudoConsole in `master`'s Drop
    //      can block waiting for conhost to drain pending output, freezing
    //      the Tauri worker thread that triggered the close.
    //   2. `killer` — best-effort kill (redundant on Windows once Job
    //      closed, but harmless and required on Unix where there is no Job).
    //   3. `writer` — closes the input side of the master pipe.
    //   4. `master` — last; ClosePseudoConsole on Windows. By now the child
    //      is dead and conhost has nothing left to drain.
    #[cfg(windows)]
    _job: Option<crate::modules::proc::job::ProcessJob>,
    /// PID of the shell process. 0 means unknown; callers must skip checks when 0.
    pub shell_pid: u32,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: PtyMaster,
    pub(super) output_gate: Arc<Mutex<()>>,
    pub(super) on_data: Channel<Response>,
    // Set by the waiter once the child exits, so pty_open can reap a shell
    // that died before it was registered.
    pub(super) exited: Arc<AtomicBool>,
}

impl Drop for Session {
    fn drop(&mut self) {
        // If the session Arc is dropped without an explicit pty_close (e.g.
        // frontend disconnected, window crashed, dev HMR), the reader/flusher
        // threads would otherwise stay alive forever holding the child. Kill
        // the child here so the reader hits EOF and the threads unwind.
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
    }
}
// Serializes ConPTY create and close: overlapping pseudoconsole lifecycle
// calls corrupt the new console so its shell never pumps output (issue #356).
#[cfg(windows)]
static CONPTY_LIFECYCLE_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn drop_session(session: Arc<Session>) {
    // CONPTY_LIFECYCLE_LOCK is acquired inside PtyMaster::drop, just before
    // ClosePseudoConsole, so we no longer need to hold it here for the full drop.
    drop(session);
}

/// Wraps the PTY master and serializes Windows ConPTY lifecycle around Drop.
///
/// `ClosePseudoConsole` (called when the inner `MasterPty` drops) can block up
/// to ~60 s if conhost hasn't exited. Holding `CONPTY_LIFECYCLE_LOCK` for
/// that entire duration prevented concurrent `CreatePseudoConsole` calls in
/// new terminals, causing a ~60-second input-echo delay for the next terminal
/// opened while an old one was closing.
///
/// This wrapper acquires the lock only for `ClosePseudoConsole` itself, not
/// for the whole session tear-down, so new terminals can be created freely
/// while an old master is still closing.
pub struct PtyMaster {
    inner: ManuallyDrop<Mutex<Box<dyn MasterPty + Send>>>,
}

impl PtyMaster {
    pub fn new(master: Box<dyn MasterPty + Send>) -> Self {
        Self {
            inner: ManuallyDrop::new(Mutex::new(master)),
        }
    }

    pub fn lock(
        &self,
    ) -> std::sync::LockResult<std::sync::MutexGuard<'_, Box<dyn MasterPty + Send>>> {
        self.inner.lock()
    }
}

impl Drop for PtyMaster {
    fn drop(&mut self) {
        #[cfg(windows)]
        let _guard = CONPTY_LIFECYCLE_LOCK.lock().unwrap();
        // SAFETY: this is the only drop of `inner`; we are inside PtyMaster::drop.
        // `_guard` (on Windows) is still alive here and releases only after this line.
        unsafe { ManuallyDrop::drop(&mut self.inner) };
    }
}

#[cfg(not(target_os = "android"))]
struct ChildKillGuard {
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
}

#[cfg(not(target_os = "android"))]
impl ChildKillGuard {
    fn new(killer: Box<dyn ChildKiller + Send + Sync>) -> Self {
        Self {
            killer: Some(killer),
        }
    }

    fn disarm(&mut self) {
        self.killer = None;
    }
}

#[cfg(not(target_os = "android"))]
impl Drop for ChildKillGuard {
    fn drop(&mut self) {
        if let Some(mut k) = self.killer.take() {
            let _ = k.kill();
        }
    }
}

#[cfg(target_os = "android")]
#[derive(Debug)]
struct AndroidChildKiller {
    pid: nix::unistd::Pid,
}

#[cfg(target_os = "android")]
impl ChildKiller for AndroidChildKiller {
    fn kill(&mut self) -> std::io::Result<()> {
        let _ = nix::sys::signal::kill(self.pid, nix::sys::signal::Signal::SIGKILL);
        Ok(())
    }
    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(AndroidChildKiller { pid: self.pid })
    }
}

#[cfg(target_os = "android")]
struct AndroidMasterPty {
    master_fd: std::os::fd::RawFd,
}

#[cfg(target_os = "android")]
impl MasterPty for AndroidMasterPty {
    fn resize(&self, size: PtySize) -> anyhow::Result<()> {
        let win = nix::pty::Winsize {
            ws_row: size.rows,
            ws_col: size.cols,
            ws_xpixel: size.pixel_width,
            ws_ypixel: size.pixel_height,
        };
        unsafe {
            let rc = libc::ioctl(self.master_fd, libc::TIOCSWINSZ, &win);
            if rc < 0 {
                log::debug!("ioctl TIOCSWINSZ returned {rc}");
            }
        }
        Ok(())
    }
    fn get_size(&self) -> anyhow::Result<portable_pty::PtySize> {
        Ok(portable_pty::PtySize::default())
    }
    fn try_clone_reader(&self) -> anyhow::Result<Box<dyn std::io::Read + Send>> {
        use std::os::fd::FromRawFd;
        let fd = unsafe { libc::dup(self.master_fd) };
        if fd < 0 {
            anyhow::bail!("dup failed");
        }
        Ok(Box::new(unsafe { std::fs::File::from_raw_fd(fd) }))
    }
    fn take_writer(&self) -> anyhow::Result<Box<dyn std::io::Write + Send>> {
        use std::os::fd::FromRawFd;
        let fd = unsafe { libc::dup(self.master_fd) };
        if fd < 0 {
            anyhow::bail!("dup failed");
        }
        Ok(Box::new(unsafe { std::fs::File::from_raw_fd(fd) }))
    }
    fn process_group_leader(&self) -> Option<i32> {
        None
    }
    fn as_raw_fd(&self) -> Option<i32> {
        Some(self.master_fd)
    }
    fn tty_name(&self) -> Option<std::path::PathBuf> {
        None
    }
}

#[cfg(target_os = "android")]
impl Drop for AndroidMasterPty {
    fn drop(&mut self) {
        unsafe { libc::close(self.master_fd); }
    }
}

#[cfg(target_os = "android")]
fn spawn_android(
    _id: u32,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<
    (
        Box<dyn MasterPty + Send>,
        Box<dyn ChildKiller + Send + Sync>,
        Box<dyn Read + Send>,
        Arc<Mutex<Box<dyn Write + Send>>>,
        u32,
        nix::unistd::Pid,
    ),
    String,
> {
    use nix::pty::{openpty, OpenptyResult, Winsize};
    use nix::unistd::{self, ForkResult, setsid};
    use std::os::fd::{FromRawFd, IntoRawFd};

    let win = Winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };

    let OpenptyResult { master, slave } =
        openpty(Some(&win), None).map_err(|e| format!("openpty: {e}"))?;

    let master_raw = master.into_raw_fd();
    let slave_raw = slave.into_raw_fd();

    match unsafe { unistd::fork() }.map_err(|e| format!("fork: {e}"))? {
        ForkResult::Child => {
            unsafe {
                libc::close(master_raw);
                let _ = setsid();
                libc::ioctl(slave_raw, libc::TIOCSCTTY as _, 0);
                libc::dup2(slave_raw, 0);
                libc::dup2(slave_raw, 1);
                libc::dup2(slave_raw, 2);
                if slave_raw > 2 {
                    libc::close(slave_raw);
                }
            }

            let home = crate::modules::bootstrap::home_dir();
            let prefix = crate::modules::bootstrap::prefix_dir();
            let termux_path = crate::modules::bootstrap::shell_path();
            let lib_dir = crate::modules::bootstrap::lib_dir();
            let bash = crate::modules::bootstrap::bash_path();

            if let Some(ref dir) = cwd {
                if std::env::set_current_dir(dir).is_err() {
                    let _ = std::env::set_current_dir(&home);
                }
            } else {
                let _ = std::env::set_current_dir(&home);
            }

            std::env::set_var("TERM", "xterm-256color");
            std::env::set_var("COLORTERM", "truecolor");
            std::env::set_var("HOME", &home);
            std::env::set_var("PREFIX", &prefix);
            std::env::set_var("TMPDIR", crate::modules::bootstrap::tmp_dir());
            std::env::set_var("PATH", &termux_path);
            std::env::set_var("SHELL", &bash);
            std::env::set_var("EDITOR", "vi");
            std::env::set_var("LD_LIBRARY_PATH", &lib_dir);
            let path_translate = lib_dir.join("libvoktty-path-translate.so");
            if path_translate.exists() {
                std::env::set_var("LD_PRELOAD", &path_translate);
            }
            std::env::set_var("LANG", "en_US.UTF-8");
            std::env::set_var("LC_ALL", "en_US.UTF-8");
            std::env::set_var("VOKTTY_TERMINAL", "1");
            std::env::set_var("TERAX_TERMINAL", "1");

            let (shell_bin, shell_args) = if bash.exists() {
                (bash.to_string_lossy().to_string(), vec!["bash".to_string(), "-l".to_string()])
            } else {
                ("/system/bin/sh".to_string(), vec!["sh".to_string()])
            };

            let shell_c = std::ffi::CString::new(shell_bin).unwrap();
            let argv: Vec<std::ffi::CString> = shell_args
                .iter()
                .map(|s| std::ffi::CString::new(s.as_str()).unwrap())
                .collect();
            let argv_refs: Vec<&std::ffi::CString> = argv.iter().collect();
            let _ = unistd::execvp(&shell_c, &argv_refs);
            unsafe { libc::_exit(1); }
        }
        ForkResult::Parent { child } => {
            unsafe { libc::close(slave_raw); }
            let reader_fd = unsafe { libc::dup(master_raw) };
            let writer_fd = unsafe { libc::dup(master_raw) };
            if reader_fd < 0 || writer_fd < 0 {
                let _ = nix::sys::signal::kill(child, nix::sys::signal::Signal::SIGKILL);
                return Err("dup master fd failed".to_string());
            }
            let reader: Box<dyn Read + Send> = Box::new(unsafe { std::fs::File::from_raw_fd(reader_fd) });
            let writer: Arc<Mutex<Box<dyn Write + Send>>> =
                Arc::new(Mutex::new(Box::new(unsafe { std::fs::File::from_raw_fd(writer_fd) })));
            let master: Box<dyn MasterPty + Send> = Box::new(AndroidMasterPty { master_fd: master_raw });
            let killer: Box<dyn ChildKiller + Send + Sync> = Box::new(AndroidChildKiller { pid: child });
            Ok((master, killer, reader, writer, child.as_raw() as u32, child))
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn spawn(
    id: u32,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    blocks: bool,
    shell: Option<String>,
    control: Option<crate::modules::control::ShellControlEnv>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<(Arc<Session>, PtySize), String> {
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    #[cfg(target_os = "android")]
    let (master_box, killer, mut reader, writer, shell_pid, child_pid) = {
        let _ = (&workspace, blocks, &shell, &control);
        spawn_android(id, cols, rows, cwd)?
    };

    #[cfg(not(target_os = "android"))]
    let (master_box, killer, mut reader, writer, shell_pid, mut child, job) = {
        let pty_system = native_pty_system();
        let pair = {
            #[cfg(windows)]
            let _spawn_guard = CONPTY_LIFECYCLE_LOCK.lock().unwrap();
            pty_system.openpty(size).map_err(|e| e.to_string())?
        };

        let cmd = shell_init::build_command(cwd, workspace, blocks, shell, control)?;
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let mut guard = ChildKillGuard::new(child.clone_killer());
        let killer = child.clone_killer();
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
            pair.master.take_writer().map_err(|e| e.to_string())?,
        ));
        guard.disarm();

        let shell_pid = child.process_id().unwrap_or(0);

        #[cfg(windows)]
        let job = match child.process_id() {
            Some(pid) => match crate::modules::proc::job::ProcessJob::create_for(pid) {
                Ok(j) => Some(j),
                Err(e) => {
                    log::warn!("pty job-object setup failed for pid={pid}: {e}");
                    None
                }
            },
            None => None,
        };
        #[cfg(not(windows))]
        let job = ();

        (pair.master, killer, reader, writer, shell_pid, child, job)
    };

    let exited = Arc::new(AtomicBool::new(false));
    let output_gate = Arc::new(Mutex::new(()));

    let session = Arc::new(Session {
        #[cfg(windows)]
        _job: job,
        shell_pid,
        killer: Mutex::new(killer),
        writer: writer.clone(),
        master: PtyMaster::new(master_box),
        output_gate: output_gate.clone(),
        on_data: on_data.clone(),
        exited: exited.clone(),
    });

    let pending: Arc<(Mutex<Vec<u8>>, Condvar)> =
        Arc::new((Mutex::new(Vec::with_capacity(READ_BUF)), Condvar::new()));
    let done = Arc::new(AtomicBool::new(false));
    let spawn_at = Instant::now();

    let first_byte = Arc::new(AtomicBool::new(false));

    let pending_r = pending.clone();
    let writer_for_da = writer.clone();
    let app_reader = app.clone();
    let first_byte_r = first_byte;
    let reader_thread = thread::Builder::new()
        .name("voktty-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            let mut filtered: Vec<u8> = Vec::with_capacity(READ_BUF);
            let mut da_filter = DaFilter::new();
            let mut agent_detect = AgentDetector::new();
            let mut dropped_bytes: u64 = 0;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if !first_byte_r.load(Ordering::Relaxed) {
                            first_byte_r.store(true, Ordering::Release);
                            log::debug!(
                                "pty first byte after {}ms",
                                spawn_at.elapsed().as_millis()
                            );
                        }
                        agent_detect.process(&buf[..n], |t| {
                            let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
                        });
                        filtered.clear();
                        da_filter.process(&buf[..n], &mut filtered, |reply| {
                            if let Ok(mut w) = writer_for_da.lock() {
                                let _ = w.write_all(reply);
                            }
                        });
                        if filtered.is_empty() {
                            continue;
                        }
                        let (lock, cv) = &*pending_r;
                        let mut g = lock.lock().unwrap();
                        if g.len() + filtered.len() > MAX_PENDING {
                            dropped_bytes += g.len() as u64;
                            g.clear();
                            g.extend_from_slice(OVERFLOW_NOTICE);
                        }
                        g.extend_from_slice(&filtered);
                        cv.notify_one();
                    }
                    Err(e) => {
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            agent_detect.finish(|t| {
                let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
            });
            pending_r.1.notify_one();
            if dropped_bytes > 0 {
                log::warn!("pty backpressure: dropped {dropped_bytes} bytes (cap {MAX_PENDING})");
            }
        })
        .expect("spawn pty reader thread");

    let on_data_flush = on_data.clone();
    let pending_f = pending.clone();
    let done_f = done.clone();
    let app_flusher = app.clone();
    let output_gate_f = output_gate.clone();
    thread::Builder::new()
        .name("voktty-pty-flusher".into())
        .spawn(move || {
            let (lock, cv) = &*pending_f;
            loop {
                {
                    let mut g = lock.lock().unwrap();
                    while g.is_empty() {
                        if done_f.load(Ordering::Acquire) {
                            return;
                        }
                        let (next, _) = cv.wait_timeout(g, FLUSH_MAX_IDLE).unwrap();
                        g = next;
                    }
                }
                // Coalesce a short window so a burst flushes as one chunk.
                thread::sleep(FLUSH_COALESCE);
                let chunk = std::mem::take(&mut *lock.lock().unwrap());
                if chunk.is_empty() {
                    continue;
                }
                let _output_guard = output_gate_f.lock().unwrap();
                if let Some(collab) = app_flusher.try_state::<crate::modules::collab::CollabState>()
                {
                    collab.publish_pty_output(id, &chunk);
                }
                if let Err(e) = on_data_flush.send(Response::new(chunk)) {
                    log::debug!("pty flusher exiting, channel closed: {e}");
                    break;
                }
            }
        })
        .expect("spawn pty flusher thread");

    let on_data_exit = on_data;
    let pending_e = pending;
    let done_e = done;
    let app_waiter = app;
    let exited_w = exited;
    let output_gate_e = output_gate;
    thread::Builder::new()
        .name("voktty-pty-waiter".into())
        .spawn(move || {
            #[cfg(target_os = "android")]
            let code = match nix::sys::wait::waitpid(child_pid, None) {
                Ok(nix::sys::wait::WaitStatus::Exited(_, code)) => code,
                Ok(nix::sys::wait::WaitStatus::Signaled(_, sig, _)) => sig as i32,
                Ok(_) => 0,
                Err(_) => -1,
            };
            #[cfg(not(target_os = "android"))]
            let code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(e) => {
                    log::warn!("pty child wait failed: {e}");
                    -1
                }
            };
            exited_w.store(true, Ordering::Release);
            // Wait for the reader to hit EOF before taking a final snapshot of
            // `pending`, so the last line of output never races the Exit event.
            #[cfg(windows)]
            {
                let deadline = Instant::now() + Duration::from_millis(50);
                while Instant::now() < deadline && !reader_thread.is_finished() {
                    thread::sleep(Duration::from_millis(5));
                }
            }
            #[cfg(not(windows))]
            if let Err(e) = reader_thread.join() {
                log::error!("pty reader thread panicked: {e:?}");
            }
            let (lock, cv) = &*pending_e;
            let tail = std::mem::take(&mut *lock.lock().unwrap());
            if !tail.is_empty() {
                let _output_guard = output_gate_e.lock().unwrap();
                if let Some(collab) = app_waiter.try_state::<crate::modules::collab::CollabState>()
                {
                    collab.publish_pty_output(id, &tail);
                }
                if let Err(e) = on_data_exit.send(Response::new(tail)) {
                    log::debug!("pty final-data send failed (channel closed): {e}");
                }
            }
            done_e.store(true, Ordering::Release);
            cv.notify_all();
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
            if let Some(collab) = app_waiter.try_state::<crate::modules::collab::CollabState>() {
                collab.terminal_exited(id, code);
            }
            if let Some(state) = app_waiter.try_state::<super::PtyState>() {
                if let Some(s) = state.take(id) {
                    drop_session(s);
                }
            }
        })
        .expect("spawn pty waiter thread");

    Ok((session, size))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use portable_pty::CommandBuilder;

    #[test]
    fn drop_kills_child_process() {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty");

        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("sleep 30");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);

        let killer = child.clone_killer();
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));

        let session = Arc::new(Session {
            shell_pid: child.process_id().unwrap_or(0),
            killer: Mutex::new(killer),
            writer,
            master: PtyMaster::new(pair.master),
            exited: Arc::new(AtomicBool::new(false)),
            output_gate: Arc::new(Mutex::new(())),
            on_data: Channel::new(|_| Ok(())),
        });

        assert!(
            child.try_wait().unwrap().is_none(),
            "child must be alive before drop",
        );

        drop(session);

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut exited = false;
        while Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(exited, "child still running 2s after Session drop");
    }

    #[test]
    fn drop_session_succeeds_after_child_already_exited() {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty");

        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("exit 0");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);
        let _ = child.wait();

        let killer = child.clone_killer();
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));

        let session = Arc::new(Session {
            shell_pid: 0,
            killer: Mutex::new(killer),
            writer,
            master: PtyMaster::new(pair.master),
            exited: Arc::new(AtomicBool::new(false)),
            output_gate: Arc::new(Mutex::new(())),
            on_data: Channel::new(|_| Ok(())),
        });

        drop_session(session);
    }
}
