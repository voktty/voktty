//! Connection-side half of persistent agent processes: attachments that follow
//! a process log and turn it into protocol frames, and the stdin path back.
//! The process lifecycle itself lives in `agent_proc`.

#![cfg_attr(not(unix), allow(dead_code))]

use std::collections::HashMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use voktty_remote_protocol::{Frame, PROC_NO_EXIT_CODE};

use crate::agent_proc::{
    self, KillSignal, ProcError, SpawnSpec, TailEvent, TailReader, MAX_STDIN_CHUNK_BYTES,
};

/// Delivers a frame to the connected client.
pub type FrameSink = Arc<dyn Fn(Frame) -> io::Result<()> + Send + Sync>;
pub type Launcher = Box<dyn Fn(&Path) -> io::Result<()> + Send + Sync>;

pub const MAX_ATTACHMENTS: usize = 64;
const STDIN_QUEUE: usize = 64;
const TAIL_IDLE: Duration = Duration::from_millis(25);

struct Attachment {
    proc_id: String,
    stop: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    input: Option<SyncSender<Vec<u8>>>,
}

pub struct ProcHost {
    base: PathBuf,
    home: PathBuf,
    launcher: Launcher,
    attachments: HashMap<u64, Attachment>,
}

impl ProcHost {
    pub fn new(home: PathBuf, launcher: Launcher) -> Self {
        Self {
            base: agent_proc::proc_base_dir(&home),
            home,
            launcher,
            attachments: HashMap::new(),
        }
    }

    pub fn cleanup_expired(&self) -> usize {
        agent_proc::cleanup_expired(&self.base, SystemTime::now())
    }

    /// `attach_id` is chosen by the client so it can route frames that arrive
    /// before the response does.
    pub fn spawn(
        &mut self,
        spec: SpawnSpec,
        attach_id: u64,
        sink: FrameSink,
    ) -> Result<Value, ProcError> {
        if self.attachments.contains_key(&attach_id) {
            return Err(duplicate_attachment());
        }
        let spawned = agent_proc::spawn_process(&self.base, &self.home, &spec, &*self.launcher)?;
        match self.attach_to(&spawned.id, attach_id, 0, sink) {
            Ok(_) => Ok(json!({
                "procId": spawned.id,
                "attachId": attach_id,
                "pid": spawned.child_pid,
            })),
            Err(error) => {
                let _ = agent_proc::close(&self.base, &spawned.id, true);
                Err(error)
            }
        }
    }

    pub fn attach(
        &mut self,
        proc_id: &str,
        attach_id: u64,
        from_offset: u64,
        sink: FrameSink,
    ) -> Result<Value, ProcError> {
        let dir = self.attach_to(proc_id, attach_id, from_offset, sink)?;
        let running = agent_proc::read_exit(&dir).is_none() && agent_proc::supervisor_alive(&dir);
        let log_bytes = std::fs::metadata(dir.join("log"))
            .map(|m| m.len())
            .unwrap_or(0);
        Ok(json!({ "attachId": attach_id, "running": running, "logBytes": log_bytes }))
    }

    fn attach_to(
        &mut self,
        proc_id: &str,
        attach_id: u64,
        from_offset: u64,
        sink: FrameSink,
    ) -> Result<PathBuf, ProcError> {
        self.attachments
            .retain(|_, attachment| !attachment.finished.load(Ordering::SeqCst));
        if self.attachments.len() >= MAX_ATTACHMENTS {
            return Err(ProcError {
                code: "too_many_attachments",
                message: "too many process attachments".to_string(),
            });
        }
        if self.attachments.contains_key(&attach_id) {
            return Err(duplicate_attachment());
        }
        let dir = agent_proc::proc_dir(&self.base, proc_id)?;
        let tail = TailReader::open(&dir, from_offset)?;

        let stop = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let input = start_stdin_writer(&dir);
        {
            let (stop, finished) = (Arc::clone(&stop), Arc::clone(&finished));
            std::thread::spawn(move || {
                run_tail(tail, attach_id, sink, &stop);
                finished.store(true, Ordering::SeqCst);
            });
        }
        self.attachments.insert(
            attach_id,
            Attachment {
                proc_id: proc_id.to_string(),
                stop,
                finished,
                input,
            },
        );
        Ok(dir)
    }

    /// Stops following the log. The agent keeps running.
    pub fn detach(&mut self, attach_id: u64) -> bool {
        match self.attachments.remove(&attach_id) {
            Some(attachment) => {
                attachment.stop.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }

    pub fn kill(&self, proc_id: &str, signal: Option<&str>) -> Result<(), ProcError> {
        let dir = agent_proc::proc_dir(&self.base, proc_id)?;
        agent_proc::send_signal(&dir, KillSignal::parse(signal)?)
    }

    pub fn close(&mut self, proc_id: &str, force: bool) -> Result<(), ProcError> {
        agent_proc::close(&self.base, proc_id, force)?;
        let ids: Vec<u64> = self
            .attachments
            .iter()
            .filter(|(_, attachment)| attachment.proc_id == proc_id)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            self.detach(id);
        }
        Ok(())
    }

    pub fn list(&self) -> Value {
        json!({ "processes": agent_proc::list(&self.base) })
    }

    /// Queues stdin bytes for an attachment's process. Input that does not fit
    /// the bounded queue is dropped: the agent is not reading.
    pub fn write(&self, attach_id: u64, data: Vec<u8>) {
        if data.len() > MAX_STDIN_CHUNK_BYTES {
            return;
        }
        let Some(sender) = self
            .attachments
            .get(&attach_id)
            .and_then(|attachment| attachment.input.as_ref())
        else {
            return;
        };
        match sender.try_send(data) {
            Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
        }
    }
}

impl Drop for ProcHost {
    fn drop(&mut self) {
        for attachment in self.attachments.values() {
            attachment.stop.store(true, Ordering::SeqCst);
        }
    }
}

fn duplicate_attachment() -> ProcError {
    ProcError {
        code: "duplicate_attachment",
        message: "attachment id already in use".to_string(),
    }
}

fn start_stdin_writer(dir: &Path) -> Option<SyncSender<Vec<u8>>> {
    let mut fifo = agent_proc::open_stdin(dir).ok()?;
    let (sender, receiver) = mpsc::sync_channel::<Vec<u8>>(STDIN_QUEUE);
    std::thread::spawn(move || {
        while let Ok(data) = receiver.recv() {
            if fifo.write_all(&data).and_then(|_| fifo.flush()).is_err() {
                break;
            }
        }
    });
    Some(sender)
}

fn run_tail(mut tail: TailReader, attach_id: u64, sink: FrameSink, stop: &AtomicBool) {
    while !stop.load(Ordering::SeqCst) {
        match tail.poll() {
            Ok(TailEvent::Output {
                stream,
                data,
                next_offset,
            }) => {
                let frame = Frame::ProcOutput {
                    attach_id,
                    stream,
                    next_offset,
                    data,
                };
                if sink(frame).is_err() {
                    return;
                }
            }
            Ok(TailEvent::Exit { info, next_offset }) => {
                let _ = sink(Frame::ProcExit {
                    attach_id,
                    code: info.code.unwrap_or(PROC_NO_EXIT_CODE),
                    signal: info.signal.unwrap_or(0),
                    next_offset,
                    reason: info.reason.unwrap_or_default(),
                });
                return;
            }
            Ok(TailEvent::Idle) => std::thread::sleep(TAIL_IDLE),
            Err(error) => {
                let _ = sink(Frame::ProcExit {
                    attach_id,
                    code: PROC_NO_EXIT_CODE,
                    signal: 0,
                    next_offset: tail.offset(),
                    reason: error.code.to_string(),
                });
                return;
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc::Receiver;
    use std::sync::Mutex;
    use tempfile::tempdir;
    use voktty_remote_protocol::PROC_STREAM_STDOUT;

    struct Fixture {
        home: tempfile::TempDir,
        bin: tempfile::TempDir,
        work: tempfile::TempDir,
    }

    fn fixture(script: &str) -> Fixture {
        let home = tempdir().unwrap();
        let bin = tempdir().unwrap();
        let work = tempdir().unwrap();
        let path = bin.path().join("codex");
        fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        Fixture { home, bin, work }
    }

    fn host(fx: &Fixture) -> ProcHost {
        ProcHost::new(
            fx.home.path().to_path_buf(),
            Box::new(|dir: &Path| {
                let dir = dir.to_path_buf();
                std::thread::spawn(move || {
                    agent_proc::run_supervisor(&dir);
                });
                Ok(())
            }),
        )
    }

    fn spec(fx: &Fixture) -> SpawnSpec {
        SpawnSpec {
            command: "codex".into(),
            args: vec![],
            cwd: fx.work.path().to_path_buf(),
            label: None,
            search_path: Some(format!("{}:/usr/bin:/bin", fx.bin.path().display())),
        }
    }

    fn sink() -> (FrameSink, Receiver<Frame>) {
        let (sender, receiver) = mpsc::channel();
        let sender = Mutex::new(sender);
        (
            Arc::new(move |frame| {
                sender
                    .lock()
                    .unwrap()
                    .send(frame)
                    .map_err(|_| io::Error::other("closed"))
            }),
            receiver,
        )
    }

    fn drain(receiver: &Receiver<Frame>) -> (Vec<u8>, Frame) {
        let mut out = Vec::new();
        loop {
            match receiver
                .recv_timeout(Duration::from_secs(10))
                .expect("frame")
            {
                Frame::ProcOutput { stream, data, .. } => {
                    if stream == PROC_STREAM_STDOUT {
                        out.extend(data);
                    }
                }
                exit @ Frame::ProcExit { .. } => return (out, exit),
                other => panic!("unexpected {other:?}"),
            }
        }
    }

    #[test]
    fn spawn_streams_output_frames_and_ends_with_an_exit_frame() {
        let fx = fixture("echo hello; exit 4");
        let mut host = host(&fx);
        let (sink, receiver) = sink();
        let started = host.spawn(spec(&fx), 1, sink).unwrap();
        assert_eq!(started["attachId"], 1);
        assert!(started["procId"].as_str().unwrap().len() == 16);
        let (out, exit) = drain(&receiver);
        assert_eq!(out, b"hello\n");
        assert!(matches!(
            exit,
            Frame::ProcExit {
                code: 4,
                signal: 0,
                ..
            }
        ));
    }

    #[test]
    fn a_new_attachment_resumes_from_the_last_applied_offset() {
        let fx = fixture("echo one; echo two; echo three");
        let mut host = host(&fx);
        let (first_sink, first) = sink();
        let started = host.spawn(spec(&fx), 1, first_sink).unwrap();
        let proc_id = started["procId"].as_str().unwrap().to_string();
        let (_, exit) = drain(&first);
        let Frame::ProcExit {
            next_offset: end, ..
        } = exit
        else {
            panic!("expected exit")
        };

        let (second_sink, second) = sink();
        host.attach(&proc_id, 2, 0, second_sink).unwrap();
        let (all, _) = drain(&second);
        assert_eq!(all, b"one\ntwo\nthree\n");

        let tail_offset = {
            let (probe_sink, probe) = sink();
            host.attach(&proc_id, 3, 0, probe_sink).unwrap();
            let mut first_end = 0;
            if let Frame::ProcOutput { next_offset, .. } =
                probe.recv_timeout(Duration::from_secs(5)).unwrap()
            {
                first_end = next_offset;
            }
            first_end
        };
        let (third_sink, third) = sink();
        host.attach(&proc_id, 4, tail_offset, third_sink).unwrap();
        let (rest, exit) = drain(&third);
        assert!(rest.len() < all.len());
        assert!(matches!(exit, Frame::ProcExit { next_offset, .. } if next_offset == end));
    }

    #[test]
    fn input_frames_reach_the_agent_and_detach_leaves_it_running() {
        let fx =
            fixture("while read line; do echo \"got:$line\"; [ \"$line\" = quit ] && exit 0; done");
        let mut host = host(&fx);
        let (sink_a, receiver_a) = sink();
        let started = host.spawn(spec(&fx), 10, sink_a).unwrap();
        let proc_id = started["procId"].as_str().unwrap().to_string();
        let attach_a = started["attachId"].as_u64().unwrap();
        host.write(attach_a, b"ping\n".to_vec());
        match receiver_a.recv_timeout(Duration::from_secs(10)).unwrap() {
            Frame::ProcOutput { data, .. } => assert_eq!(data, b"got:ping\n"),
            other => panic!("unexpected {other:?}"),
        }
        assert!(host.detach(attach_a));
        assert!(!host.detach(attach_a));
        let listed = host.list();
        assert_eq!(listed["processes"][0]["running"], true);

        let (sink_b, receiver_b) = sink();
        let attached = host.attach(&proc_id, 11, 0, sink_b).unwrap();
        assert_eq!(attached["running"], true);
        host.write(11, b"quit\n".to_vec());
        let (dup_sink, _dup) = sink();
        assert_eq!(
            host.attach(&proc_id, 11, 0, dup_sink).unwrap_err().code,
            "duplicate_attachment"
        );
        let (out, exit) = drain(&receiver_b);
        assert_eq!(out, b"got:ping\ngot:quit\n");
        assert!(matches!(exit, Frame::ProcExit { code: 0, .. }));
    }

    #[test]
    fn kill_and_close_manage_the_process_lifetime() {
        let fx = fixture("sleep 30");
        let mut host = host(&fx);
        let (sink, receiver) = sink();
        let started = host.spawn(spec(&fx), 1, sink).unwrap();
        let proc_id = started["procId"].as_str().unwrap().to_string();
        assert_eq!(
            host.close(&proc_id, false).unwrap_err().code,
            "still_running"
        );
        host.kill(&proc_id, Some("term")).unwrap();
        let (_, exit) = drain(&receiver);
        assert!(matches!(exit, Frame::ProcExit { signal: 15, .. }));
        host.close(&proc_id, false).unwrap();
        assert_eq!(host.list()["processes"], json!([]));
        assert_eq!(
            host.kill(&proc_id, None).unwrap_err().code,
            "process_not_found"
        );
        assert_eq!(host.kill("zz", None).unwrap_err().code, "invalid_params");
    }

    #[test]
    fn attaching_past_the_end_of_the_log_is_rejected() {
        let fx = fixture("echo x");
        let mut host = host(&fx);
        let (sink, receiver) = sink();
        let started = host.spawn(spec(&fx), 1, sink).unwrap();
        drain(&receiver);
        let (late, _) = self::sink();
        let error = host
            .attach(started["procId"].as_str().unwrap(), 2, 1 << 30, late)
            .unwrap_err();
        assert_eq!(error.code, "offset_out_of_range");
    }
}
