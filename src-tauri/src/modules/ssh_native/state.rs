//! The registry of live native sessions.
//!
//! Generic over the session value so the rules here can be tested without a
//! real SSH transport; production stores the connected chain.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde::Serialize;

use super::cells::{self, Cell};
use super::connection::NativeChain;
use super::registry::Registry;
use super::types::{SshNativeError, SshNativeTarget};

/// Each session is a live socket and a spawned task, so the count is bounded.
const MAX_SESSIONS: usize = 32;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub hops: usize,
    /// How many consumers currently hold this session, so the UI can warn
    /// before closing something an SFTP panel is still using.
    pub consumers: usize,
}

#[derive(Clone)]
struct Entry<T> {
    cell: Cell<T>,
    info: SshSessionInfo,
    consumers: Arc<AtomicUsize>,
}

impl<T> Entry<T> {
    fn info(&self) -> SshSessionInfo {
        SshSessionInfo {
            consumers: self.consumers.load(Ordering::Acquire),
            ..self.info.clone()
        }
    }
}

/// A consumer's claim on a session. Holding it keeps the session counted as in
/// use; the value is read through the cell, so a reconnect reaches the holder.
pub struct SessionLease<T> {
    cell: Cell<T>,
    consumers: Arc<AtomicUsize>,
}

impl<T> SessionLease<T> {
    pub fn cell(&self) -> &Cell<T> {
        &self.cell
    }
}

impl<T: Clone> SessionLease<T> {
    pub fn value(&self) -> T {
        cells::read(&self.cell)
    }
}

impl<T> Drop for SessionLease<T> {
    fn drop(&mut self) {
        self.consumers.fetch_sub(1, Ordering::AcqRel);
    }
}

/// A live transport has nothing safe or useful to print.
impl<T> std::fmt::Debug for SessionLease<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionLease")
            .field("consumers", &self.consumers.load(Ordering::Acquire))
            .finish()
    }
}

pub struct SessionRegistry<T> {
    entries: Registry<Entry<T>>,
}

impl<T: Clone> SessionRegistry<T> {
    pub fn new() -> Self {
        Self {
            entries: Registry::new("ssh", MAX_SESSIONS),
        }
    }

    pub fn insert(
        &self,
        target: &SshNativeTarget,
        user: &str,
        hops: usize,
        value: T,
    ) -> Result<SshSessionInfo, SshNativeError> {
        let entry = self.entries.insert_with(|id| Entry {
            cell: cells::cell(value.clone()),
            info: SshSessionInfo {
                id: id.to_string(),
                host: target.destination.host.clone(),
                port: target.destination.port(),
                user: user.to_string(),
                hops,
                consumers: 0,
            },
            consumers: Arc::new(AtomicUsize::new(0)),
        })?;
        Ok(entry.info())
    }

    /// Point an existing session at a new transport after a reconnect. Every
    /// lease handed out earlier follows it.
    pub fn replace(&self, id: &str, value: T) -> Result<(), SshNativeError> {
        let entry = self.entries.get(id)?;
        cells::write(&entry.cell, value);
        Ok(())
    }

    pub fn acquire(&self, id: &str) -> Result<SessionLease<T>, SshNativeError> {
        let entry = self.entries.get(id)?;
        entry.consumers.fetch_add(1, Ordering::AcqRel);
        Ok(SessionLease {
            cell: Arc::clone(&entry.cell),
            consumers: Arc::clone(&entry.consumers),
        })
    }

    /// Removing the entry does not cut off a live lease: the cell stays alive
    /// until its last holder drops it, so an in-flight transfer is not severed
    /// mid-write.
    pub fn close(&self, id: &str) -> Result<(), SshNativeError> {
        self.entries.remove(id).map(|_| ())
    }

    pub fn info(&self, id: &str) -> Option<SshSessionInfo> {
        self.entries.find(id).map(|entry| entry.info())
    }

    pub fn list(&self) -> Vec<SshSessionInfo> {
        let mut sessions: Vec<SshSessionInfo> =
            self.entries.values().iter().map(Entry::info).collect();
        sessions.sort_by(|a, b| a.id.cmp(&b.id));
        sessions
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl<T: Clone> Default for SessionRegistry<T> {
    fn default() -> Self {
        Self::new()
    }
}

pub type SshNativeState = SessionRegistry<Arc<NativeChain>>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::ssh_native::types::{SshErrorCode, SshNativeHop};

    fn target(host: &str) -> SshNativeTarget {
        SshNativeTarget {
            destination: SshNativeHop {
                host: host.to_string(),
                port: Some(2222),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn registry() -> SessionRegistry<u32> {
        SessionRegistry::new()
    }

    #[test]
    fn an_inserted_session_is_listed_with_its_destination() {
        let registry = registry();
        let info = registry
            .insert(&target("example.com"), "root", 1, 7)
            .expect("insert succeeds");

        assert_eq!(info.host, "example.com");
        assert_eq!(info.port, 2222);
        assert_eq!(info.user, "root");
        assert_eq!(info.consumers, 0);
        assert_eq!(registry.list(), vec![info]);
    }

    #[test]
    fn session_ids_are_unique_and_listed_in_order() {
        let registry = registry();
        let first = registry.insert(&target("a"), "u", 1, 1).expect("first");
        let second = registry.insert(&target("b"), "u", 1, 2).expect("second");
        assert_ne!(first.id, second.id);

        let ids: Vec<String> = registry.list().into_iter().map(|s| s.id).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);
    }

    #[test]
    fn a_lease_counts_while_held_and_stops_counting_once_dropped() {
        let registry = registry();
        let info = registry.insert(&target("a"), "u", 1, 1).expect("insert");

        let lease = registry.acquire(&info.id).expect("acquire");
        assert_eq!(registry.info(&info.id).expect("info").consumers, 1);

        let second = registry.acquire(&info.id).expect("acquire again");
        assert_eq!(registry.info(&info.id).expect("info").consumers, 2);

        drop(second);
        assert_eq!(registry.info(&info.id).expect("info").consumers, 1);
        drop(lease);
        assert_eq!(registry.info(&info.id).expect("info").consumers, 0);
    }

    #[test]
    fn a_reconnect_reaches_a_lease_taken_before_it() {
        let registry = registry();
        let info = registry.insert(&target("a"), "u", 1, 1).expect("insert");
        let lease = registry.acquire(&info.id).expect("acquire");

        registry.replace(&info.id, 42).expect("replace succeeds");
        assert_eq!(lease.value(), 42);
    }

    #[test]
    fn closing_a_session_leaves_a_live_lease_usable() {
        let registry = registry();
        let info = registry.insert(&target("a"), "u", 1, 5).expect("insert");
        let lease = registry.acquire(&info.id).expect("acquire");

        registry.close(&info.id).expect("close succeeds");
        assert!(registry.is_empty());
        assert_eq!(lease.value(), 5);
    }

    #[test]
    fn operations_on_an_unknown_session_report_it() {
        let registry = registry();
        assert_eq!(
            registry.acquire("ssh-404").expect_err("acquire fails").code,
            SshErrorCode::Config
        );
        assert!(registry.replace("ssh-404", 1).is_err());
        assert!(registry.close("ssh-404").is_err());
        assert!(registry.info("ssh-404").is_none());
    }

    #[test]
    fn the_session_count_is_bounded() {
        let registry = registry();
        for index in 0..MAX_SESSIONS {
            registry
                .insert(&target("a"), "u", 1, index as u32)
                .expect("within the limit");
        }
        let error = registry
            .insert(&target("a"), "u", 1, 0)
            .expect_err("over the limit");
        assert_eq!(error.code, SshErrorCode::Config);
        assert_eq!(registry.len(), MAX_SESSIONS);
    }
}
