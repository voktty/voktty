use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Mutex};

use tauri::ipc::Invoke;
use tauri::Runtime;

const QUEUED_COMMANDS: usize = 256;

fn is_watch_command(command: &str) -> bool {
    matches!(
        command,
        "fs_watch_add" | "fs_watch_remove" | "fs_watch_add_tree" | "fs_watch_remove_tree"
    )
}

struct Worker<T> {
    sender: Mutex<Option<SyncSender<T>>>,
    process: Arc<dyn Fn(T) + Send + Sync>,
    capacity: usize,
}

impl<T: Send + 'static> Worker<T> {
    fn new(capacity: usize, process: impl Fn(T) + Send + Sync + 'static) -> Self {
        Self {
            sender: Mutex::new(None),
            process: Arc::new(process),
            capacity,
        }
    }

    fn submit(&self, message: T) -> Result<(), T> {
        let Ok(mut sender) = self.sender.lock() else {
            return Err(message);
        };
        if sender.is_none() {
            let (tx, rx) = mpsc::sync_channel(self.capacity);
            let process = self.process.clone();
            if std::thread::Builder::new()
                .name("voktty-watch-commands".into())
                .spawn(move || {
                    for message in rx {
                        process(message);
                    }
                })
                .is_err()
            {
                return Err(message);
            }
            *sender = Some(tx);
        }
        sender
            .as_ref()
            .expect("watch worker initialized")
            .try_send(message)
            .map_err(|error| match error {
                mpsc::TrySendError::Full(message) | mpsc::TrySendError::Disconnected(message) => {
                    message
                }
            })
    }
}

pub(crate) fn handler<R: Runtime>(
    handler: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    let handler = Arc::new(handler);
    let background = handler.clone();
    let worker = Worker::new(QUEUED_COMMANDS, move |invoke: Invoke<R>| {
        let resolver = invoke.resolver.clone();
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| background(invoke))) {
            Ok(true) => {}
            Ok(false) | Err(_) => resolver.reject("filesystem watcher command failed"),
        }
    });
    move |invoke| {
        if !is_watch_command(invoke.message.command()) {
            return handler(invoke);
        }
        if let Err(invoke) = worker.submit(invoke) {
            invoke
                .resolver
                .reject("filesystem watcher queue is busy or unavailable");
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn routes_only_the_four_native_watch_commands() {
        for command in [
            "fs_watch_add",
            "fs_watch_remove",
            "fs_watch_add_tree",
            "fs_watch_remove_tree",
        ] {
            assert!(is_watch_command(command));
        }
        for command in [
            "pty_write",
            "remote_watch_add",
            "fs_read_dir",
            "fs_watch_add_extra",
        ] {
            assert!(!is_watch_command(command));
        }
    }

    #[test]
    fn slow_watch_does_not_block_admission_and_add_remove_order_is_preserved() {
        let caller = std::thread::current().id();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        let (done_tx, done_rx) = mpsc::channel();
        let worker = Worker::new(2, move |operation| {
            assert_ne!(std::thread::current().id(), caller);
            if operation == "add" {
                entered_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
            }
            done_tx.send(operation).unwrap();
        });
        assert!(worker.sender.lock().unwrap().is_none());
        worker.submit("add").unwrap();
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        worker.submit("remove").unwrap();
        worker.submit("add-again").unwrap();
        assert_eq!(worker.submit("overflow"), Err("overflow"));
        assert!(done_rx.try_recv().is_err());
        release_tx.send(()).unwrap();
        for expected in ["add", "remove", "add-again"] {
            assert_eq!(
                done_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
                expected
            );
        }
        worker.submit("later").unwrap();
        assert_eq!(
            done_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            "later"
        );
    }

    #[test]
    fn admitted_cleanup_is_drained_after_the_dispatcher_is_dropped() {
        let (done_tx, done_rx) = mpsc::channel();
        let worker = Worker::new(2, move |operation| done_tx.send(operation).unwrap());
        worker.submit("remove").unwrap();
        drop(worker);
        assert_eq!(
            done_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            "remove"
        );
    }
}
