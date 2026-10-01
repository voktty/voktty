use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::{Component, Path};
use tauri::State;

use super::session_store::SessionStoreState;

pub(crate) fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS orchestration_runs (
           lead_id TEXT PRIMARY KEY,
           state TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS orchestration_sidebar (
           lead_id TEXT PRIMARY KEY,
           summary TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS orchestration_workers (
           session_id TEXT PRIMARY KEY,
           lead_id TEXT NOT NULL
         );",
    )?;
    Ok(())
}

pub(crate) fn remember_worker(
    conn: &Connection,
    session_id: &str,
    lead_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO orchestration_workers (session_id, lead_id) VALUES (?1, ?2)",
        params![session_id, lead_id],
    )?;
    Ok(())
}

pub(crate) fn index_orchestration(
    conn: &Connection,
    lead: &str,
    run: &Value,
) -> rusqlite::Result<()> {
    let Some(tasks) = run["tasks"].as_array() else {
        return Ok(());
    };
    let mut summaries = Vec::new();
    for task in tasks {
        let Some(id) = task["sessionId"].as_str() else {
            continue;
        };
        remember_worker(conn, id, lead)?;
        summaries.push(serde_json::json!({
            "sessionId": id,
            "title": task["title"],
            "harness": task["harness"],
            "model": task["model"],
            "status": task["status"],
        }));
    }
    let summary = serde_json::json!({ "status": run["status"], "tasks": summaries });
    conn.execute(
        "INSERT INTO orchestration_sidebar (lead_id, summary) VALUES (?1, ?2)
         ON CONFLICT(lead_id) DO UPDATE SET summary = excluded.summary",
        params![lead, summary.to_string()],
    )?;
    Ok(())
}

pub(crate) fn save_orchestration(
    conn: &Connection,
    lead: &str,
    run: &Value,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO orchestration_runs (lead_id, state) VALUES (?1, ?2)
         ON CONFLICT(lead_id) DO UPDATE SET state = excluded.state",
        params![lead, run.to_string()],
    )?;
    index_orchestration(&tx, lead, run)?;
    tx.commit()
}

pub(crate) fn worker_parent(conn: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT lead_id FROM orchestration_workers WHERE session_id = ?1",
        [id],
        |row| row.get(0),
    )
    .optional()
}

pub(crate) fn orchestration_summary(
    conn: &Connection,
    id: &str,
) -> rusqlite::Result<Option<Value>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT summary FROM orchestration_sidebar WHERE lead_id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub(crate) fn cleanup_session_orchestration(
    conn: &Connection,
    id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM orchestration_runs WHERE lead_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM orchestration_sidebar WHERE lead_id = ?1",
        [id],
    )?;
    conn.execute(
        "DELETE FROM orchestration_workers WHERE session_id = ?1 OR lead_id = ?1",
        [id],
    )?;
    Ok(())
}

fn comparison_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn resolve_scope(root: &Path, value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("Write scopes must be project-relative paths without '..'".into());
    }
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut existing = root.join(path);
    let mut missing = Vec::new();
    while !existing.exists() {
        missing.push(existing.file_name().ok_or("Invalid scope")?.to_os_string());
        if !existing.pop() {
            return Err("Invalid scope".into());
        }
    }
    existing = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    if !existing.starts_with(&root) {
        return Err("Write scope points outside the project".into());
    }
    for part in missing.into_iter().rev() {
        existing.push(part);
    }
    Ok(comparison_path(&existing))
}

#[tauri::command(async)]
pub fn control_save(
    store: State<'_, SessionStoreState>,
    lead_id: String,
    state: String,
) -> Result<(), String> {
    if state.len() > 8_000_000 {
        return Err("Orchestration history is too large".into());
    }
    let run: Value = serde_json::from_str(&state).map_err(|_| "Invalid run state")?;
    let conn = store.lock_conn()?;
    save_orchestration(&conn, &lead_id, &run).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn control_load(
    store: State<'_, SessionStoreState>,
    lead_id: String,
) -> Result<Option<String>, String> {
    let conn = store.lock_conn()?;
    conn.query_row(
        "SELECT state FROM orchestration_runs WHERE lead_id = ?1",
        [lead_id],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn control_attach_worker(
    store: State<'_, SessionStoreState>,
    lead_id: String,
    session_id: String,
) -> Result<String, String> {
    let path = std::env::temp_dir().join(format!("voktty-worker-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;

    let conn = store.lock_conn()?;
    remember_worker(&conn, &session_id, &lead_id).map_err(|e| e.to_string())?;

    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn control_scopes(cwd: String, files: Vec<String>) -> Result<Vec<String>, String> {
    if files.len() > 64 {
        return Err("At most 64 write scopes per task".into());
    }
    let root = crate::modules::harness::fs::expand_home(&cwd);
    files
        .iter()
        .map(|file| {
            resolve_scope(&root, file)
                .map_err(|error| format!("Invalid write scope \"{file}\": {error}"))
        })
        .collect()
}

#[tauri::command(async)]
pub fn control_write_path(path: String) -> Result<String, String> {
    let path_obj = Path::new(&path);
    if !path_obj.is_absolute() {
        return Err("Reported write paths must be absolute".into());
    }
    let mut existing = path_obj;
    let mut missing = Vec::new();
    while !existing.exists() {
        if std::fs::symlink_metadata(existing).is_ok() {
            return Err("Reported write path contains a dangling symlink".into());
        }
        missing.push(
            existing
                .file_name()
                .ok_or("Invalid write path")?
                .to_os_string(),
        );
        existing = match existing.parent() {
            Some(parent) => parent,
            None => return Err("Invalid write path".into()),
        };
    }
    let mut resolved = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    for part in missing.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn app_cli_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn control_enable(
    _store: State<'_, SessionStoreState>,
    _session_id: String,
    _cwd: String,
) -> Result<String, String> {
    app_cli_path()
}

#[tauri::command]
pub fn control_disable(
    _store: State<'_, SessionStoreState>,
    _session_id: String,
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_created_and_orchestration_saved_and_loaded() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_tables(&conn).unwrap();

        let run = serde_json::json!({
            "version": 2,
            "leadId": "lead-1",
            "cwd": "C:/projects/sample",
            "status": "active",
            "tasks": [
                {
                    "id": "t1",
                    "sessionId": "worker-1",
                    "title": "Build module",
                    "harness": "codex",
                    "model": "gpt-5-preview",
                    "status": "running"
                }
            ]
        });

        save_orchestration(&conn, "lead-1", &run).unwrap();

        let summary = orchestration_summary(&conn, "lead-1").unwrap().unwrap();
        assert_eq!(summary["status"], "active");
        assert_eq!(summary["tasks"][0]["sessionId"], "worker-1");

        assert_eq!(worker_parent(&conn, "worker-1").unwrap().as_deref(), Some("lead-1"));

        cleanup_session_orchestration(&conn, "lead-1").unwrap();
        assert!(orchestration_summary(&conn, "lead-1").unwrap().is_none());
        assert!(worker_parent(&conn, "worker-1").unwrap().is_none());
    }
}
