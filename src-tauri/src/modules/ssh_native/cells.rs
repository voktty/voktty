//! A cell whose value can be swapped without invalidating the handles already
//! handed out.
//!
//! SFTP panels and port forwards hold a session's transport for hours. A
//! reconnect replaces that transport under the same session id, so a consumer
//! holding a plain copy stays pinned to a dead connection.

use std::sync::{Arc, RwLock};

pub type Cell<T> = Arc<RwLock<T>>;

pub fn cell<T>(value: T) -> Cell<T> {
    Arc::new(RwLock::new(value))
}

/// Poisoning is recovered from rather than propagated: a panic in one consumer
/// must not take down every long-lived session sharing the cell.
pub fn read<T: Clone>(cell: &Cell<T>) -> T {
    cell.read().unwrap_or_else(|e| e.into_inner()).clone()
}

pub fn write<T>(cell: &Cell<T>, value: T) {
    *cell.write().unwrap_or_else(|e| e.into_inner()) = value;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_written_value_reaches_a_holder_from_before_the_write() {
        let held = cell(1u32);
        let other = Arc::clone(&held);
        write(&other, 2);
        assert_eq!(read(&held), 2);
    }

    #[test]
    fn distinct_cells_are_independent() {
        let a = cell(1u32);
        let b = cell(1u32);
        write(&a, 9);
        assert_eq!(read(&b), 1);
        assert!(!Arc::ptr_eq(&a, &b));
    }

    #[test]
    fn a_poisoned_cell_still_reads_and_writes() {
        let held = cell(3u32);
        let poisoner = Arc::clone(&held);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.write().unwrap();
            panic!("poison the lock");
        })
        .join();

        assert_eq!(read(&held), 3);
        write(&held, 4);
        assert_eq!(read(&held), 4);
    }
}
