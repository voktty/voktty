use crate::proc_host::FrameSink;
use crate::project_memory::MemoryServer;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use voktty_memory_local::DiscoveryControl;
use voktty_remote_protocol::{Frame, RemoteRequest, RemoteResponse};

const MAX_PENDING: usize = 4;
const MAX_REQUEST_BYTES: usize = 512 * 1024;

trait Processor: Send {
    fn reset(&mut self);
    fn process(
        &mut self,
        root: &Path,
        request: RemoteRequest,
        control: &DiscoveryControl,
    ) -> RemoteResponse;
}

impl Processor for MemoryServer {
    fn reset(&mut self) {
        MemoryServer::reset(self);
    }
    fn process(
        &mut self,
        root: &Path,
        request: RemoteRequest,
        control: &DiscoveryControl,
    ) -> RemoteResponse {
        self.handle_with_control(Some(root), request, control)
    }
}

struct Shared {
    generation: AtomicU64,
    closed: AtomicBool,
    pending: Mutex<HashMap<u64, DiscoveryControl>>,
}

impl Default for Shared {
    fn default() -> Self {
        Self {
            generation: AtomicU64::new(1),
            closed: AtomicBool::new(false),
            pending: Mutex::new(HashMap::new()),
        }
    }
}

impl Shared {
    fn current(&self, generation: u64) -> bool {
        !self.closed.load(Ordering::Acquire)
            && self.generation.load(Ordering::Acquire) == generation
    }

    fn retire(&self) {
        let mut generation = self.generation.load(Ordering::Acquire);
        loop {
            let Some(next) = generation.checked_add(1) else {
                self.closed.store(true, Ordering::Release);
                break;
            };
            match self.generation.compare_exchange_weak(
                generation,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(current) => generation = current,
            }
        }
        for control in self
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
        {
            control.cancel();
        }
    }

    fn fail(&self) {
        self.closed.store(true, Ordering::Release);
        self.retire();
    }
}

struct Permit {
    id: u64,
    shared: Arc<Shared>,
}

impl Drop for Permit {
    fn drop(&mut self) {
        self.shared
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.id);
    }
}

struct Work {
    root: PathBuf,
    request: RemoteRequest,
    generation: u64,
    control: DiscoveryControl,
    sink: FrameSink,
    permit: Permit,
}

enum Message {
    Work(Work),
    Reset,
}

struct Worker {
    sender: SyncSender<Message>,
    thread: JoinHandle<()>,
}

/// One lazy serial worker owns native state; queued work and output settlement
/// remain charged while the protocol loop continues serving interactive traffic.
pub(super) struct MemoryHost {
    processor: Option<Box<dyn Processor>>,
    worker: Option<Worker>,
    shared: Arc<Shared>,
    next_id: u64,
}

impl Default for MemoryHost {
    fn default() -> Self {
        Self::new(Box::new(MemoryServer::default()))
    }
}

impl MemoryHost {
    fn new(processor: Box<dyn Processor>) -> Self {
        Self {
            processor: Some(processor),
            worker: None,
            shared: Arc::new(Shared::default()),
            next_id: 0,
        }
    }

    pub fn reset(&mut self) {
        self.shared.retire();
        if let Some(worker) = &self.worker {
            let _ = worker.sender.try_send(Message::Reset);
        }
    }

    fn start(&mut self) -> Result<(), ()> {
        if self.worker.is_some() {
            return Ok(());
        }
        let processor = self.processor.take().ok_or(())?;
        let shared = self.shared.clone();
        let (sender, receiver) = mpsc::sync_channel(MAX_PENDING);
        match std::thread::Builder::new()
            .name("voktty-memory".into())
            .spawn(move || run(receiver, shared, processor))
        {
            Ok(thread) => {
                self.worker = Some(Worker { sender, thread });
                Ok(())
            }
            Err(_) => {
                self.shared.fail();
                Err(())
            }
        }
    }

    pub fn submit(
        &mut self,
        root: Option<PathBuf>,
        request: RemoteRequest,
        sink: FrameSink,
    ) -> Option<RemoteResponse> {
        let Some(root) = root else {
            return Some(failure(request.id, "handshake_required"));
        };
        if self.shared.closed.load(Ordering::Acquire) {
            return Some(failure(request.id, "unavailable"));
        }
        if request.params.to_string().len() > MAX_REQUEST_BYTES {
            return Some(failure(request.id, "limit"));
        }
        let Some(next_id) = self.next_id.checked_add(1) else {
            return Some(failure(request.id, "limit"));
        };
        if self.start().is_err() {
            return Some(failure(request.id, "unavailable"));
        }
        let control = crate::project_memory::request_control(&request);
        let generation = self.shared.generation.load(Ordering::Acquire);
        {
            let mut pending = self
                .shared
                .pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if self.shared.closed.load(Ordering::Acquire) {
                return Some(failure(request.id, "unavailable"));
            }
            if pending.len() >= MAX_PENDING {
                return Some(failure(request.id, "busy"));
            }
            pending.insert(next_id, control.clone());
        }
        self.next_id = next_id;
        let permit = Permit {
            id: next_id,
            shared: self.shared.clone(),
        };
        let work = Work {
            root,
            request,
            generation,
            control,
            sink,
            permit,
        };
        match self
            .worker
            .as_ref()
            .expect("worker started")
            .sender
            .try_send(Message::Work(work))
        {
            Ok(()) => None,
            Err(TrySendError::Full(Message::Work(work))) => {
                Some(failure(work.request.id.clone(), "busy"))
            }
            Err(TrySendError::Disconnected(Message::Work(work))) => {
                self.shared.fail();
                Some(failure(work.request.id.clone(), "unavailable"))
            }
            Err(_) => unreachable!("only work messages are submitted"),
        }
    }
}

impl Drop for MemoryHost {
    fn drop(&mut self) {
        self.shared.fail();
        if let Some(Worker { sender, thread }) = self.worker.take() {
            drop(sender);
            let _ = thread.join();
        }
    }
}

fn failure(id: String, code: &str) -> RemoteResponse {
    RemoteResponse::failure(
        id,
        code,
        "remote memory operation is unavailable or retired",
    )
}

fn synchronize(processor: &mut dyn Processor, shared: &Shared, generation: &mut u64) {
    let current = shared.generation.load(Ordering::Acquire);
    if *generation != current || shared.closed.load(Ordering::Acquire) {
        processor.reset();
        *generation = current;
    }
}

fn run(receiver: Receiver<Message>, shared: Arc<Shared>, mut processor: Box<dyn Processor>) {
    let mut generation = shared.generation.load(Ordering::Acquire);
    while let Ok(message) = receiver.recv() {
        synchronize(processor.as_mut(), &shared, &mut generation);
        let Message::Work(work) = message else {
            continue;
        };
        let Work {
            root,
            request,
            generation: admitted,
            control,
            sink,
            permit,
        } = work;
        let id = request.id.clone();
        let response = if !shared.current(admitted) {
            failure(id, "cancelled")
        } else if let Err(error) = control.read_control() {
            failure(
                id,
                if matches!(error, voktty_memory_local::ReadError::Cancelled) {
                    "cancelled"
                } else {
                    "timeout"
                },
            )
        } else {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                processor.process(&root, request, &control)
            })) {
                Ok(response) if shared.current(admitted) => response,
                Ok(_) => {
                    synchronize(processor.as_mut(), &shared, &mut generation);
                    failure(id, "cancelled")
                }
                Err(_) => {
                    shared.fail();
                    synchronize(processor.as_mut(), &shared, &mut generation);
                    failure(id, "unavailable")
                }
            }
        };
        if sink(Frame::Response(response)).is_err() {
            shared.fail();
            synchronize(processor.as_mut(), &shared, &mut generation);
        }
        drop(permit);
    }
}

#[cfg(test)]
#[path = "project_memory_host_tests.rs"]
mod tests;
