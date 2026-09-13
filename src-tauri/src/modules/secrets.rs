//! Secret storage with platform-appropriate backends.
//!
//! - macOS: macOS Keychain (via `keyring` crate)
//! - Windows: Credential Manager (via `keyring` crate)
//! - Linux: Secret Service with a private file fallback when unavailable.
//! - Android: a file in the app's local data dir, mode 0600.
//!
//! The frontend talks to `secrets_get`, `secrets_set`, `secrets_delete`,
//! and `secrets_get_all` — no platform branching in JS.
//!
//! All commands take `&AppHandle` so we can resolve the data directory
//! once via Tauri's path API.

use std::sync::Mutex;

use crate::identity::{KEYRING_SERVICE, LEGACY_KEYRING_SERVICE};
use tauri::AppHandle;

#[cfg(any(target_os = "linux", target_os = "android"))]
use std::collections::HashMap;
#[cfg(any(target_os = "linux", target_os = "android"))]
use std::fs;
#[cfg(any(target_os = "linux", target_os = "android"))]
use std::path::{Path, PathBuf};
#[cfg(any(target_os = "linux", target_os = "android"))]
use tauri::Manager;

#[derive(Default)]
pub struct SecretsState {
    #[cfg(target_os = "linux")]
    linux: Mutex<LinuxSecrets>,
    #[cfg(target_os = "android")]
    cache: Mutex<Option<HashMap<String, String>>>,
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    _phantom: Mutex<()>,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) fn key(service: &str, account: &str) -> String {
    format!("{}::{}", service, account)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("secrets.json"))
}

#[cfg(target_os = "android")]
fn read_store(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    read_store_at(&store_path(app)?)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) fn read_store_at(path: &std::path::Path) -> Result<HashMap<String, String>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice::<HashMap<String, String>>(&bytes).map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn write_store(app: &AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    write_store_at(&store_path(app)?, map)
}

#[cfg(any(target_os = "android", all(target_os = "linux", test)))]
pub(crate) fn write_store_at(
    path: &std::path::Path,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(map).map_err(|e| e.to_string())?;

    // 0600: only the owning user can read or write the secrets file.
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    f.write_all(&bytes).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn write_private_store_at(path: &Path, map: &HashMap<String, String>) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(map).map_err(|error| error.to_string())?;
    match fs::remove_file(&tmp) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&tmp, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(target_os = "android")]
fn with_store<F, R>(app: &AppHandle, state: &SecretsState, f: F) -> Result<R, String>
where
    F: FnOnce(&mut HashMap<String, String>) -> R,
{
    let mut guard = state.cache.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(read_store(app)?);
    }
    let map = guard.as_mut().expect("cache initialized above");
    Ok(f(map))
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum LinuxSecretsBackend {
    #[default]
    Undecided,
    SecretService,
    PrivateFile,
}

#[cfg(target_os = "linux")]
trait SecureStore {
    fn is_available(&self) -> Result<bool, String>;
    fn get(&self, service: &str, account: &str) -> Result<Option<String>, String>;
    fn set(&self, service: &str, account: &str, password: &str) -> Result<(), String>;
    fn delete(&self, service: &str, account: &str) -> Result<(), String>;
}

#[cfg(target_os = "linux")]
struct SecretServiceStore;

#[cfg(target_os = "linux")]
impl SecretServiceStore {
    fn entry(service: &str, account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(service, account).map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "linux")]
fn session_bus_is_absent(error: &dbus::Error) -> bool {
    matches!(
        error.name(),
        Some(
            "org.freedesktop.DBus.Error.FileNotFound"
                | "org.freedesktop.DBus.Error.NoServer"
                | "org.freedesktop.DBus.Error.NotSupported"
        )
    )
}

#[cfg(target_os = "linux")]
impl SecureStore for SecretServiceStore {
    fn is_available(&self) -> Result<bool, String> {
        use std::time::Duration;

        let connection = match dbus::blocking::Connection::new_session() {
            Ok(connection) => connection,
            Err(error) if session_bus_is_absent(&error) => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        let proxy = connection.with_proxy(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            Duration::from_secs(2),
        );
        let result: Result<(u32,), dbus::Error> = proxy.method_call(
            "org.freedesktop.DBus",
            "StartServiceByName",
            ("org.freedesktop.secrets", 0u32),
        );
        match result {
            Ok(_) => Ok(true),
            Err(error) if error.name() == Some("org.freedesktop.DBus.Error.ServiceUnknown") => {
                Ok(false)
            }
            Err(error) => Err(error.to_string()),
        }
    }

    fn get(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        match Self::entry(service, account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn set(&self, service: &str, account: &str, password: &str) -> Result<(), String> {
        Self::entry(service, account)?
            .set_password(password)
            .map_err(|error| error.to_string())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), String> {
        match Self::entry(service, account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct LinuxSecrets {
    backend: LinuxSecretsBackend,
    cache: Option<HashMap<String, String>>,
}

#[cfg(target_os = "linux")]
impl LinuxSecrets {
    #[cfg(test)]
    fn backend(&self) -> LinuxSecretsBackend {
        self.backend
    }

    fn select_backend(&mut self, store: &dyn SecureStore) -> Result<LinuxSecretsBackend, String> {
        if self.backend == LinuxSecretsBackend::Undecided {
            self.backend = if store.is_available()? {
                LinuxSecretsBackend::SecretService
            } else {
                LinuxSecretsBackend::PrivateFile
            };
        }
        Ok(self.backend)
    }

    fn file_values(&mut self, path: &Path) -> Result<&mut HashMap<String, String>, String> {
        if self.cache.is_none() {
            self.cache = Some(read_store_at(path)?);
        }
        Ok(self.cache.as_mut().expect("cache initialized above"))
    }

    fn update_file<F>(&mut self, path: &Path, update: F) -> Result<(), String>
    where
        F: FnOnce(&mut HashMap<String, String>),
    {
        let mut values = self.file_values(path)?.clone();
        update(&mut values);
        if values.is_empty() {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        } else {
            write_private_store_at(path, &values)?;
        }
        self.cache = Some(values);
        Ok(())
    }

    fn file_get(
        &mut self,
        path: &Path,
        service: &str,
        account: &str,
    ) -> Result<Option<String>, String> {
        let values = self.file_values(path)?;
        let current = values.get(&key(service, account)).cloned();
        if current.is_some() || service != KEYRING_SERVICE {
            return Ok(current);
        }
        Ok(values.get(&key(LEGACY_KEYRING_SERVICE, account)).cloned())
    }

    fn file_set(
        &mut self,
        path: &Path,
        service: &str,
        account: &str,
        password: &str,
    ) -> Result<(), String> {
        self.update_file(path, |values| {
            values.insert(key(service, account), password.to_owned());
        })
    }

    fn file_delete(&mut self, path: &Path, service: &str, account: &str) -> Result<(), String> {
        self.update_file(path, |values| {
            values.remove(&key(service, account));
            if service == KEYRING_SERVICE {
                values.remove(&key(LEGACY_KEYRING_SERVICE, account));
            }
        })
    }

    fn secure_get(
        store: &dyn SecureStore,
        service: &str,
        account: &str,
    ) -> Result<Option<String>, String> {
        let current = store.get(service, account)?;
        if current.is_some() || service != KEYRING_SERVICE {
            return Ok(current);
        }
        store.get(LEGACY_KEYRING_SERVICE, account)
    }

    fn secure_delete(store: &dyn SecureStore, service: &str, account: &str) -> Result<(), String> {
        store.delete(service, account)?;
        if service == KEYRING_SERVICE {
            store.delete(LEGACY_KEYRING_SERVICE, account)?;
        }
        Ok(())
    }

    fn secret_service_get(
        &mut self,
        path: &Path,
        store: &dyn SecureStore,
        service: &str,
        account: &str,
    ) -> Result<Option<String>, String> {
        if let Some(value) = Self::secure_get(store, service, account)? {
            self.file_delete(path, service, account)?;
            return Ok(Some(value));
        }
        let value = self.file_get(path, service, account)?;
        if let Some(password) = value.as_deref() {
            store.set(service, account, password)?;
            self.file_delete(path, service, account)?;
        }
        Ok(value)
    }

    fn get_at(
        &mut self,
        path: &Path,
        store: &dyn SecureStore,
        service: &str,
        account: &str,
    ) -> Result<Option<String>, String> {
        match self.select_backend(store)? {
            LinuxSecretsBackend::SecretService => {
                self.secret_service_get(path, store, service, account)
            }
            LinuxSecretsBackend::PrivateFile => self.file_get(path, service, account),
            LinuxSecretsBackend::Undecided => unreachable!(),
        }
    }

    fn set_at(
        &mut self,
        path: &Path,
        store: &dyn SecureStore,
        service: &str,
        account: &str,
        password: &str,
    ) -> Result<(), String> {
        if self.select_backend(store)? == LinuxSecretsBackend::PrivateFile {
            return self.file_set(path, service, account, password);
        }
        store.set(service, account, password)?;
        self.file_delete(path, service, account)
    }

    fn delete_at(
        &mut self,
        path: &Path,
        store: &dyn SecureStore,
        service: &str,
        account: &str,
    ) -> Result<(), String> {
        match self.select_backend(store)? {
            LinuxSecretsBackend::SecretService => {
                self.file_delete(path, service, account)?;
                Self::secure_delete(store, service, account)
            }
            LinuxSecretsBackend::PrivateFile => self.file_delete(path, service, account),
            LinuxSecretsBackend::Undecided => unreachable!(),
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn entry(service: &str, account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account).map_err(|e| e.to_string())
}

pub(crate) fn get_secret(
    app: &AppHandle,
    state: &SecretsState,
    service: &str,
    account: &str,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        let path = store_path(app)?;
        state
            .linux
            .lock()
            .map_err(|error| error.to_string())?
            .get_at(&path, &SecretServiceStore, service, account)
    }
    #[cfg(target_os = "android")]
    {
        let current = with_store(app, state, |map| map.get(&key(service, account)).cloned())?;
        if current.is_some() || service != KEYRING_SERVICE {
            return Ok(current);
        }
        with_store(app, state, |map| {
            map.get(&key(LEGACY_KEYRING_SERVICE, account)).cloned()
        })
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (app, state);
        match entry(service, account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) if service == KEYRING_SERVICE => {
                match entry(LEGACY_KEYRING_SERVICE, account)?.get_password() {
                    Ok(value) => Ok(Some(value)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(error) => Err(error.to_string()),
                }
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
}

pub(crate) fn set_secret(
    app: &AppHandle,
    state: &SecretsState,
    service: &str,
    account: &str,
    password: &str,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let path = store_path(app)?;
        state
            .linux
            .lock()
            .map_err(|error| error.to_string())?
            .set_at(&path, &SecretServiceStore, service, account, password)
    }
    #[cfg(target_os = "android")]
    {
        with_store(app, state, |map| {
            map.insert(key(service, account), password.into());
        })?;
        let snapshot = {
            let guard = state.cache.lock().map_err(|error| error.to_string())?;
            guard.as_ref().cloned().unwrap_or_default()
        };
        write_store(app, &snapshot)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (app, state);
        entry(service, account)?
            .set_password(password)
            .map_err(|error| error.to_string())
    }
}

pub(crate) fn delete_secret(
    app: &AppHandle,
    state: &SecretsState,
    service: &str,
    account: &str,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let path = store_path(app)?;
        state
            .linux
            .lock()
            .map_err(|error| error.to_string())?
            .delete_at(&path, &SecretServiceStore, service, account)
    }
    #[cfg(target_os = "android")]
    {
        with_store(app, state, |map| {
            map.remove(&key(service, account));
            if service == KEYRING_SERVICE {
                map.remove(&key(LEGACY_KEYRING_SERVICE, account));
            }
        })?;
        let snapshot = {
            let guard = state.cache.lock().map_err(|error| error.to_string())?;
            guard.as_ref().cloned().unwrap_or_default()
        };
        write_store(app, &snapshot)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (app, state);
        match entry(service, account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) if service == KEYRING_SERVICE => {
                match entry(LEGACY_KEYRING_SERVICE, account)?.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                    Err(error) => Err(error.to_string()),
                }
            }
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[tauri::command]
pub async fn secrets_get(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    service: String,
    account: String,
) -> Result<Option<String>, String> {
    get_secret(&app, &state, &service, &account)
}

#[tauri::command]
pub async fn secrets_set(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    service: String,
    account: String,
    password: String,
) -> Result<(), String> {
    set_secret(&app, &state, &service, &account, &password)
}

#[tauri::command]
pub async fn secrets_delete(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    service: String,
    account: String,
) -> Result<(), String> {
    delete_secret(&app, &state, &service, &account)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use tempfile::TempDir;

    #[test]
    fn linux_only_missing_session_bus_errors_allow_fallback() {
        for name in [
            "org.freedesktop.DBus.Error.FileNotFound",
            "org.freedesktop.DBus.Error.NoServer",
            "org.freedesktop.DBus.Error.NotSupported",
        ] {
            let error = dbus::Error::new_custom(name, "test");
            assert!(session_bus_is_absent(&error), "{name}");
        }

        for name in [
            "org.freedesktop.DBus.Error.AccessDenied",
            "org.freedesktop.DBus.Error.BadAddress",
            "org.freedesktop.DBus.Error.Failed",
        ] {
            let error = dbus::Error::new_custom(name, "test");
            assert!(!session_bus_is_absent(&error), "{name}");
        }
    }

    #[test]
    fn key_format_is_service_double_colon_account() {
        assert_eq!(key("openai", "alice"), "openai::alice");
        assert_eq!(key("", ""), "::");
    }

    #[test]
    fn read_store_at_missing_path_is_empty() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("nope.json");
        let map = read_store_at(&p).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn write_then_read_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");
        let mut m = HashMap::new();
        m.insert(key("svc", "alice"), "p1".into());
        m.insert(key("svc", "bob"), "p2".into());

        write_store_at(&p, &m).unwrap();
        let loaded = read_store_at(&p).unwrap();
        assert_eq!(loaded, m);
    }

    #[test]
    fn write_uses_mode_0600() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");
        write_store_at(&p, &HashMap::new()).unwrap();

        let mode = fs::metadata(&p).unwrap().mode() & 0o777;
        assert_eq!(mode, 0o600, "secrets file must be user-only readable");
    }

    #[test]
    fn write_does_not_leave_tmp_file_on_success() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");
        write_store_at(&p, &HashMap::new()).unwrap();

        let tmp_path = p.with_extension("json.tmp");
        assert!(
            !tmp_path.exists(),
            "tmp file must be renamed away on success"
        );
    }

    #[test]
    fn write_overwrites_existing_atomically() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");

        let mut first = HashMap::new();
        first.insert("a".into(), "1".into());
        write_store_at(&p, &first).unwrap();

        let mut second = HashMap::new();
        second.insert("b".into(), "2".into());
        write_store_at(&p, &second).unwrap();

        let loaded = read_store_at(&p).unwrap();
        assert_eq!(loaded, second);
        assert!(!loaded.contains_key("a"));
    }

    #[test]
    fn write_replaces_stale_tmp_with_mode_0600() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let tmp_path = path.with_extension("json.tmp");
        fs::write(&tmp_path, b"stale").unwrap();
        fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o666)).unwrap();

        write_private_store_at(&path, &HashMap::new()).unwrap();

        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
    }

    #[test]
    fn write_removes_tmp_file_when_rename_fails() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        fs::create_dir(&path).unwrap();

        assert!(write_private_store_at(&path, &HashMap::new()).is_err());
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn read_store_at_garbage_file_errors() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("secrets.json");
        fs::write(&p, b"not json").unwrap();
        assert!(read_store_at(&p).is_err());
    }

    #[derive(Default)]
    struct TestSecureStore {
        available: std::cell::Cell<bool>,
        accessible: std::cell::Cell<bool>,
        writable: std::cell::Cell<bool>,
        availability_error: std::cell::Cell<bool>,
        values: std::cell::RefCell<HashMap<String, String>>,
    }

    impl TestSecureStore {
        fn available() -> Self {
            Self {
                available: std::cell::Cell::new(true),
                accessible: std::cell::Cell::new(true),
                writable: std::cell::Cell::new(true),
                availability_error: std::cell::Cell::new(false),
                values: std::cell::RefCell::new(HashMap::new()),
            }
        }

        fn unavailable() -> Self {
            Self::default()
        }
    }

    impl SecureStore for TestSecureStore {
        fn is_available(&self) -> Result<bool, String> {
            if self.availability_error.get() {
                return Err("test availability probe failed".to_owned());
            }
            Ok(self.available.get())
        }

        fn get(&self, service: &str, account: &str) -> Result<Option<String>, String> {
            if !self.accessible.get() {
                return Err("test storage access denied".to_owned());
            }
            Ok(self.values.borrow().get(&key(service, account)).cloned())
        }

        fn set(&self, service: &str, account: &str, password: &str) -> Result<(), String> {
            if !self.accessible.get() || !self.writable.get() {
                return Err("test storage access denied".to_owned());
            }
            self.values
                .borrow_mut()
                .insert(key(service, account), password.to_owned());
            Ok(())
        }

        fn delete(&self, service: &str, account: &str) -> Result<(), String> {
            if !self.accessible.get() {
                return Err("test storage access denied".to_owned());
            }
            self.values.borrow_mut().remove(&key(service, account));
            Ok(())
        }
    }

    #[test]
    fn linux_prefers_secret_service_without_creating_a_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let store = TestSecureStore::available();
        let mut secrets = LinuxSecrets::default();

        secrets
            .set_at(&path, &store, "svc", "account", "sentinel")
            .unwrap();

        assert_eq!(
            store.get("svc", "account").unwrap().as_deref(),
            Some("sentinel")
        );
        assert!(!path.exists());
        assert_eq!(secrets.backend(), LinuxSecretsBackend::SecretService);
    }

    #[test]
    fn linux_falls_back_to_a_private_file_when_secret_service_is_unavailable() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let store = TestSecureStore::unavailable();
        let mut secrets = LinuxSecrets::default();

        secrets
            .set_at(&path, &store, "svc", "account", "sentinel")
            .unwrap();

        assert_eq!(
            read_store_at(&path)
                .unwrap()
                .get("svc::account")
                .map(String::as_str),
            Some("sentinel")
        );
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert_eq!(secrets.backend(), LinuxSecretsBackend::PrivateFile);

        let mut restarted = LinuxSecrets::default();
        assert_eq!(
            restarted
                .get_at(&path, &store, "svc", "account")
                .unwrap()
                .as_deref(),
            Some("sentinel")
        );
        restarted
            .delete_at(&path, &store, "svc", "account")
            .unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn linux_failed_file_write_keeps_the_cached_value_unchanged() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let store = TestSecureStore::unavailable();
        let mut secrets = LinuxSecrets::default();
        secrets
            .set_at(&path, &store, "svc", "account", "original")
            .unwrap();

        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o500)).unwrap();
        assert!(secrets
            .set_at(&path, &store, "svc", "account", "replacement")
            .is_err());
        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o700)).unwrap();

        assert_eq!(
            secrets
                .get_at(&path, &store, "svc", "account")
                .unwrap()
                .as_deref(),
            Some("original")
        );
        assert_eq!(
            read_store_at(&path)
                .unwrap()
                .get("svc::account")
                .map(String::as_str),
            Some("original")
        );
    }

    #[test]
    fn linux_migrates_file_secrets_when_secret_service_is_available() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let mut values = HashMap::new();
        values.insert("svc::account".to_owned(), "sentinel".to_owned());
        values.insert("other::account".to_owned(), "untouched".to_owned());
        write_store_at(&path, &values).unwrap();
        let store = TestSecureStore::available();
        let mut secrets = LinuxSecrets::default();

        assert_eq!(
            secrets
                .get_at(&path, &store, "svc", "account")
                .unwrap()
                .as_deref(),
            Some("sentinel")
        );
        assert_eq!(
            store.get("svc", "account").unwrap().as_deref(),
            Some("sentinel")
        );
        let remaining = read_store_at(&path).unwrap();
        assert_eq!(
            remaining.get("other::account").map(String::as_str),
            Some("untouched")
        );
        assert!(!remaining.contains_key("svc::account"));
    }

    #[test]
    fn linux_failed_migration_keeps_the_file_value() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let mut values = HashMap::new();
        values.insert("svc::account".to_owned(), "sentinel".to_owned());
        write_store_at(&path, &values).unwrap();
        let store = TestSecureStore::available();
        store.writable.set(false);
        let mut secrets = LinuxSecrets::default();

        assert!(secrets.get_at(&path, &store, "svc", "account").is_err());
        assert_eq!(
            read_store_at(&path)
                .unwrap()
                .get("svc::account")
                .map(String::as_str),
            Some("sentinel")
        );
    }

    #[test]
    fn linux_migration_never_overwrites_a_keyring_value() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let mut values = HashMap::new();
        values.insert("svc::account".to_owned(), "older-file-value".to_owned());
        write_store_at(&path, &values).unwrap();
        let store = TestSecureStore::available();
        store.set("svc", "account", "newer-keyring-value").unwrap();
        let mut secrets = LinuxSecrets::default();

        assert_eq!(
            secrets
                .get_at(&path, &store, "svc", "account")
                .unwrap()
                .as_deref(),
            Some("newer-keyring-value")
        );
        assert!(!path.exists());
    }

    #[test]
    fn linux_migration_preserves_a_newer_legacy_keyring_value() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let mut values = HashMap::new();
        values.insert(
            key(KEYRING_SERVICE, "account"),
            "older-file-value".to_owned(),
        );
        write_store_at(&path, &values).unwrap();
        let store = TestSecureStore::available();
        store
            .set(
                LEGACY_KEYRING_SERVICE,
                "account",
                "newer-legacy-keyring-value",
            )
            .unwrap();
        let mut secrets = LinuxSecrets::default();

        assert_eq!(
            secrets
                .get_at(&path, &store, KEYRING_SERVICE, "account")
                .unwrap()
                .as_deref(),
            Some("newer-legacy-keyring-value")
        );
        assert!(store.get(KEYRING_SERVICE, "account").unwrap().is_none());
        assert!(!path.exists());
    }

    #[test]
    fn linux_delete_removes_current_and_legacy_values() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let mut values = HashMap::new();
        values.insert(key(KEYRING_SERVICE, "account"), "current-file".to_owned());
        values.insert(
            key(LEGACY_KEYRING_SERVICE, "account"),
            "legacy-file".to_owned(),
        );
        write_store_at(&path, &values).unwrap();
        let store = TestSecureStore::available();
        store
            .set(KEYRING_SERVICE, "account", "current-secure")
            .unwrap();
        store
            .set(LEGACY_KEYRING_SERVICE, "account", "legacy-secure")
            .unwrap();
        let mut secrets = LinuxSecrets::default();

        secrets
            .delete_at(&path, &store, KEYRING_SERVICE, "account")
            .unwrap();

        assert!(store.get(KEYRING_SERVICE, "account").unwrap().is_none());
        assert!(store
            .get(LEGACY_KEYRING_SERVICE, "account")
            .unwrap()
            .is_none());
        assert!(!path.exists());
    }

    #[test]
    fn linux_failed_file_cleanup_preserves_the_secure_value() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let mut values = HashMap::new();
        values.insert("svc::account".to_owned(), "stale-file-value".to_owned());
        write_store_at(&path, &values).unwrap();
        let store = TestSecureStore::available();
        store.set("svc", "account", "secure-value").unwrap();
        let mut secrets = LinuxSecrets::default();
        assert_eq!(
            secrets.select_backend(&store).unwrap(),
            LinuxSecretsBackend::SecretService
        );

        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o500)).unwrap();
        assert!(secrets.delete_at(&path, &store, "svc", "account").is_err());
        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o700)).unwrap();

        assert_eq!(
            store.get("svc", "account").unwrap().as_deref(),
            Some("secure-value")
        );
        assert_eq!(
            read_store_at(&path)
                .unwrap()
                .get("svc::account")
                .map(String::as_str),
            Some("stale-file-value")
        );
    }

    #[test]
    fn linux_availability_error_never_activates_file_fallback() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let store = TestSecureStore::available();
        store.availability_error.set(true);
        let mut secrets = LinuxSecrets::default();

        assert!(secrets
            .set_at(&path, &store, "svc", "account", "sentinel")
            .is_err());
        assert!(!path.exists());
        assert_eq!(secrets.backend(), LinuxSecretsBackend::Undecided);
    }

    #[test]
    fn linux_access_denial_never_activates_file_fallback() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let store = TestSecureStore::available();
        store.accessible.set(false);
        let mut secrets = LinuxSecrets::default();

        assert!(secrets
            .set_at(&path, &store, "svc", "account", "sentinel")
            .is_err());
        assert!(!path.exists());
        assert_eq!(secrets.backend(), LinuxSecretsBackend::SecretService);
    }

    #[test]
    fn linux_does_not_silently_downgrade_after_selecting_secret_service() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("secrets.json");
        let store = TestSecureStore::available();
        let mut secrets = LinuxSecrets::default();
        secrets
            .set_at(&path, &store, "svc", "account", "sentinel")
            .unwrap();
        store.accessible.set(false);

        assert!(secrets.get_at(&path, &store, "svc", "account").is_err());
        assert!(!path.exists());
        assert_eq!(secrets.backend(), LinuxSecretsBackend::SecretService);
    }
}

/// Batch read — single IPC roundtrip for the cold-boot fan-out.
#[tauri::command]
pub async fn secrets_get_all(
    app: AppHandle,
    state: tauri::State<'_, SecretsState>,
    service: String,
    accounts: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    #[cfg(target_os = "linux")]
    {
        let path = store_path(&app)?;
        let mut linux = state.linux.lock().map_err(|error| error.to_string())?;
        accounts
            .iter()
            .map(|account| linux.get_at(&path, &SecretServiceStore, &service, account))
            .collect()
    }
    #[cfg(target_os = "android")]
    {
        with_store(&app, &state, |m| {
            accounts
                .iter()
                .map(|a| {
                    m.get(&key(&service, a)).cloned().or_else(|| {
                        (service == KEYRING_SERVICE)
                            .then(|| m.get(&key(LEGACY_KEYRING_SERVICE, a)).cloned())
                            .flatten()
                    })
                })
                .collect()
        })
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (app, state);
        Ok(accounts
            .into_iter()
            .map(|a| {
                keyring::Entry::new(&service, &a)
                    .ok()
                    .and_then(|e| e.get_password().ok())
                    .or_else(|| {
                        (service == KEYRING_SERVICE)
                            .then(|| keyring::Entry::new(LEGACY_KEYRING_SERVICE, &a).ok())
                            .flatten()
                            .and_then(|e| e.get_password().ok())
                    })
            })
            .collect())
    }
}
