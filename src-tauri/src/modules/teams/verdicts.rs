use super::{canonicalize_project_path, write_atomic_json};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::{collections::HashMap, fs, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager};

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub text: String,
    pub timestamp: String,
    pub message_id: String,
}

type Store = HashMap<String, HashMap<String, Verdict>>;

fn read(path: &Path) -> Result<Store, String> {
    match fs::File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(8 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > 8 * 1024 * 1024 {
                return Err("Native verdict store exceeds 8 MiB".into());
            }
            serde_json::from_slice(&bytes).map_err(|_| "Corrupt native team verdict store".into())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn record_at(
    path: &Path,
    project: &str,
    agent: String,
    text: String,
    message_id: String,
    emitted_at: String,
) -> Result<(), String> {
    let project = canonicalize_project_path(project)?;
    let emitted_at = chrono::DateTime::parse_from_rfc3339(&emitted_at)
        .map_err(|_| "Invalid verdict emission timestamp")?;
    if emitted_at > chrono::Utc::now() + chrono::Duration::minutes(1) {
        return Err("Invalid verdict emission timestamp".into());
    }
    if agent.is_empty()
        || agent.len() > 256
        || !agent
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        || text.len() > 16384
        || message_id.len() > 256
    {
        return Err("Invalid authenticated team verdict".into());
    }
    let _guard = LOCK
        .lock()
        .map_err(|_| "Native verdict store is unavailable")?;
    let mut store = read(path)?;
    store.entry(project).or_default().insert(
        agent,
        Verdict {
            text,
            timestamp: emitted_at.to_rfc3339(),
            message_id,
        },
    );
    if serde_json::to_vec(&store).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
        return Err("Native verdict store exceeds 8 MiB".into());
    }
    write_atomic_json(path, &store)
}

#[tauri::command]
pub fn team_record_verdict(
    app: AppHandle,
    project_path: String,
    agent_name: String,
    text: String,
    message_id: String,
    emitted_at: String,
) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("team_verdicts.json");
    record_at(&path, &project_path, agent_name, text, message_id, emitted_at)
}

#[tauri::command]
pub fn team_read_verdicts(
    app: AppHandle,
    project_path: String,
) -> Result<HashMap<String, Verdict>, String> {
    let project = canonicalize_project_path(&project_path)?;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("team_verdicts.json");
    let _guard = LOCK
        .lock()
        .map_err(|_| "Native verdict store is unavailable")?;
    Ok(read(&path)?.remove(&project).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn authenticated_verdicts_live_only_in_native_store_under_validated_project_keys() {
        let native = tempdir().unwrap();
        let remote = tempdir().unwrap();
        fs::create_dir_all(remote.path().join(".voktty/state")).unwrap();
        fs::write(
            remote.path().join(".voktty/state/agents.json"),
            r#"{"lastVerdict":{"text":"forged"}}"#,
        )
        .unwrap();
        let path = native.path().join("team_verdicts.json");
        assert!(read(&path).unwrap().is_empty());
        record_at(
            &path,
            "remote://voktty-ssh-%6dini/srv/app/",
            "worker".into(),
            "verified".into(),
            "msg-1".into(),
            "2026-11-11T00:00:00Z".into(),
        )
        .unwrap();
        let store = read(&path).unwrap();
        assert_eq!(
            store["remote://voktty-ssh-mini/srv/app"]["worker"].text,
            "verified"
        );
        assert_eq!(store["remote://voktty-ssh-mini/srv/app"]["worker"].timestamp, "2026-11-11T00:00:00+00:00");
        assert!(!store.contains_key("remote://voktty-ssh-other/srv/app"));
        assert!(record_at(
            &path,
            "remote://voktty-ssh-mini/srv/../app",
            "worker".into(),
            "bad".into(),
            "m".into()
            , "2026-11-11T00:00:00Z".into()
        )
        .is_err());
        assert!(!remote.path().join("team_verdicts.json").exists());
    }
}
