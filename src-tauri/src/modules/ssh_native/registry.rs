//! A bounded keyed map with generated ids.
//!
//! Shared by the session registry and the SFTP handle registry: both hand out
//! an opaque id, cap how many can exist and refuse an unknown one the same way.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use super::types::{SshErrorCode, SshNativeError};

pub struct Registry<T> {
    entries: Mutex<HashMap<String, T>>,
    next_id: AtomicU64,
    prefix: &'static str,
    limit: usize,
}

impl<T: Clone> Registry<T> {
    pub fn new(prefix: &'static str, limit: usize) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            prefix,
            limit,
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, T>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Insert a value that needs to know its own id. The id is generated and
    /// the limit checked before `build` runs, so a refused insert never
    /// constructs anything.
    pub fn insert_with<F>(&self, build: F) -> Result<T, SshNativeError>
    where
        F: FnOnce(&str) -> T,
    {
        let mut entries = self.lock();
        if entries.len() >= self.limit {
            return Err(SshNativeError::new(
                SshErrorCode::Config,
                format!("at most {} {} entries can be open", self.limit, self.prefix),
            ));
        }
        let id = format!(
            "{}-{}",
            self.prefix,
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let value = build(&id);
        entries.insert(id, value.clone());
        Ok(value)
    }

    pub fn insert(&self, value: T) -> Result<String, SshNativeError> {
        let mut id = String::new();
        self.insert_with(|generated| {
            id = generated.to_string();
            value.clone()
        })?;
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Result<T, SshNativeError> {
        self.lock().get(id).cloned().ok_or_else(|| self.unknown(id))
    }

    pub fn find(&self, id: &str) -> Option<T> {
        self.lock().get(id).cloned()
    }

    pub fn remove(&self, id: &str) -> Result<T, SshNativeError> {
        self.lock().remove(id).ok_or_else(|| self.unknown(id))
    }

    pub fn values(&self) -> Vec<T> {
        self.lock().values().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn unknown(&self, id: &str) -> SshNativeError {
        SshNativeError::new(
            SshErrorCode::Config,
            format!("unknown {} entry {id}", self.prefix),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> Registry<String> {
        Registry::new("thing", 3)
    }

    #[test]
    fn inserted_values_get_a_prefixed_unique_id() {
        let registry = registry();
        let first = registry.insert("a".into()).expect("first");
        let second = registry.insert("b".into()).expect("second");
        assert!(first.starts_with("thing-"));
        assert_ne!(first, second);
        assert_eq!(registry.len(), 2);
    }

    #[test]
    fn insert_with_lets_the_value_carry_its_own_id() {
        let registry = registry();
        let value = registry
            .insert_with(|id| format!("value for {id}"))
            .expect("insert");
        assert!(value.starts_with("value for thing-"));
        assert_eq!(registry.values(), vec![value]);
    }

    #[test]
    fn an_unknown_id_is_reported_the_same_way_everywhere() {
        let registry = registry();
        for error in [
            registry.get("thing-404").expect_err("get"),
            registry.remove("thing-404").expect_err("remove"),
        ] {
            assert_eq!(error.code, SshErrorCode::Config);
            assert!(error.message.contains("unknown thing entry"));
        }
        assert!(registry.find("thing-404").is_none());
    }

    #[test]
    fn the_limit_is_enforced_before_the_value_is_built() {
        let registry = registry();
        for _ in 0..3 {
            registry.insert("x".into()).expect("within the limit");
        }

        let mut built = false;
        let error = registry
            .insert_with(|_| {
                built = true;
                "y".to_string()
            })
            .expect_err("over the limit");
        assert_eq!(error.code, SshErrorCode::Config);
        assert!(!built, "a refused insert must not construct the value");
        assert_eq!(registry.len(), 3);
    }

    #[test]
    fn removing_frees_a_slot() {
        let registry = registry();
        let id = registry.insert("a".into()).expect("insert");
        assert_eq!(registry.remove(&id).expect("remove"), "a");
        assert!(registry.is_empty());
        registry.insert("b".into()).expect("slot freed");
    }
}
