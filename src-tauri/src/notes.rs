use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::session_store::{now_millis, validate_id, SessionStore};

const TITLE_MAX: usize = 200;
const BODY_MAX: usize = 1_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_cwd: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpsert {
    pub id: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub source_session_id: Option<String>,
    #[serde(default)]
    pub source_cwd: Option<String>,
}

pub fn ensure_notes_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes (
           id TEXT PRIMARY KEY,
           slug TEXT NOT NULL UNIQUE,
           title TEXT NOT NULL,
           body TEXT NOT NULL DEFAULT '',
           source_session_id TEXT,
           source_cwd TEXT,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS notes_updated_idx
           ON notes (updated_at DESC, id);",
    )
}

#[tauri::command(async)]
pub fn notes_list(store: State<'_, SessionStore>) -> Result<Vec<Note>, String> {
    let conn = store.lock_conn()?;
    list_notes(&conn).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_get(store: State<'_, SessionStore>, id: String) -> Result<Option<Note>, String> {
    validate_id(&id, "note")?;
    let conn = store.lock_conn()?;
    get_note(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_upsert(store: State<'_, SessionStore>, note: NoteUpsert) -> Result<Note, String> {
    validate_id(&note.id, "note")?;
    if let Some(session_id) = note.source_session_id.as_deref() {
        if !session_id.is_empty() {
            validate_id(session_id, "session")?;
        }
    }
    if note.body.len() > BODY_MAX {
        return Err("Note is too large".into());
    }
    let conn = store.lock_conn()?;
    upsert_note(&conn, &note).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_delete(store: State<'_, SessionStore>, id: String) -> Result<(), String> {
    validate_id(&id, "note")?;
    let conn = store.lock_conn()?;
    delete_note(&conn, &id).map_err(|e| e.to_string())
}

fn list_notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, title, body, source_session_id, source_cwd,
                created_at, updated_at
         FROM notes
         ORDER BY updated_at DESC, id ASC",
    )?;
    let rows = stmt.query_map([], read_note)?;
    rows.collect()
}

fn get_note(conn: &Connection, id: &str) -> rusqlite::Result<Option<Note>> {
    conn.query_row(
        "SELECT id, slug, title, body, source_session_id, source_cwd,
                created_at, updated_at
         FROM notes
         WHERE id = ?1",
        params![id],
        read_note,
    )
    .optional()
}

fn upsert_note(conn: &Connection, note: &NoteUpsert) -> rusqlite::Result<Note> {
    let title = normalize_title(&note.title);
    let body = note.body.replace("\r\n", "\n").replace('\r', "\n");
    let source_session_id = note
        .source_session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let source_cwd = note
        .source_cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let now = now_millis();

    let existing: Option<(String, i64, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT slug, created_at, source_session_id, source_cwd
             FROM notes WHERE id = ?1",
            params![note.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;

    if let Some((slug, created_at, existing_session, existing_cwd)) = existing {
        conn.execute(
            "UPDATE notes
             SET title = ?1, body = ?2, updated_at = ?3
             WHERE id = ?4",
            params![title, body, now, note.id],
        )?;
        Ok(Note {
            id: note.id.clone(),
            slug,
            title,
            body,
            source_session_id: existing_session,
            source_cwd: existing_cwd,
            created_at,
            updated_at: now,
        })
    } else {
        let slug = unique_slug(conn, &title)?;
        conn.execute(
            "INSERT INTO notes (
               id, slug, title, body, source_session_id, source_cwd,
               created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                note.id,
                slug,
                title,
                body,
                source_session_id,
                source_cwd,
                now,
                now
            ],
        )?;
        Ok(Note {
            id: note.id.clone(),
            slug,
            title,
            body,
            source_session_id: source_session_id.map(str::to_string),
            source_cwd: source_cwd.map(str::to_string),
            created_at: now,
            updated_at: now,
        })
    }
}

fn delete_note(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

fn read_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        slug: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        source_session_id: row.get(4)?,
        source_cwd: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn normalize_title(title: &str) -> String {
    let trimmed = title.trim();
    let sliced: String = trimmed.chars().take(TITLE_MAX).collect();
    let sliced = sliced.trim().to_string();
    if sliced.is_empty() {
        "Untitled".into()
    } else {
        sliced
    }
}

fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in title.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
        if out.len() >= 48 {
            break;
        }
    }
    let slug = out.trim_end_matches('-').to_string();
    if slug.is_empty() {
        "note".into()
    } else {
        slug
    }
}

fn unique_slug(conn: &Connection, title: &str) -> rusqlite::Result<String> {
    let base = slugify(title);
    for index in 0..1000 {
        let candidate = if index == 0 {
            base.clone()
        } else {
            format!("{base}-{}", index + 1)
        };
        let taken: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE slug = ?1",
            params![candidate],
            |row| row.get(0),
        )?;
        if taken == 0 {
            return Ok(candidate);
        }
    }
    Ok(format!("{base}-{}", now_millis()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionStore;

    fn upsert(store: &SessionStore, id: &str, title: &str, body: &str) -> Note {
        let conn = store.lock_conn().unwrap();
        upsert_note(
            &conn,
            &NoteUpsert {
                id: id.into(),
                title: title.into(),
                body: body.into(),
                source_session_id: None,
                source_cwd: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn migrate_creates_notes_table() {
        let store = SessionStore::open_in_memory().unwrap();
        let conn = store.lock_conn().unwrap();
        let table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
        let version: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 10",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn insert_update_and_list_newest_first() {
        let store = SessionStore::open_in_memory().unwrap();
        let first = upsert(&store, "n1", "Alpha", "one");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = upsert(&store, "n2", "Beta", "two");
        assert_eq!(first.slug, "alpha");
        assert_eq!(second.slug, "beta");

        let conn = store.lock_conn().unwrap();
        let listed = list_notes(&conn).unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|note| note.id.as_str())
                .collect::<Vec<_>>(),
            vec!["n2", "n1"]
        );

        std::thread::sleep(std::time::Duration::from_millis(5));
        let updated = upsert_note(
            &conn,
            &NoteUpsert {
                id: "n1".into(),
                title: "Alpha renamed".into(),
                body: "changed".into(),
                source_session_id: Some("sess-1".into()),
                source_cwd: Some("/tmp/a".into()),
            },
        )
        .unwrap();
        assert_eq!(updated.slug, "alpha");
        assert_eq!(updated.title, "Alpha renamed");
        assert_eq!(updated.body, "changed");
        assert_eq!(updated.created_at, first.created_at);
        assert!(updated.updated_at > first.updated_at);
        // Provenance is capture-time only; later edits must not rewrite it.
        assert_eq!(updated.source_session_id, None);
        assert_eq!(updated.source_cwd, None);
    }

    #[test]
    fn slug_collisions_get_a_numeric_suffix() {
        let store = SessionStore::open_in_memory().unwrap();
        let first = upsert(&store, "n1", "Auth approach", "a");
        let second = upsert(&store, "n2", "Auth approach", "b");
        assert_eq!(first.slug, "auth-approach");
        assert_eq!(second.slug, "auth-approach-2");
    }

    #[test]
    fn empty_title_becomes_untitled() {
        let store = SessionStore::open_in_memory().unwrap();
        let note = upsert(&store, "n1", "   ", "");
        assert_eq!(note.title, "Untitled");
        assert_eq!(note.slug, "untitled");
    }

    #[test]
    fn delete_removes_the_row() {
        let store = SessionStore::open_in_memory().unwrap();
        upsert(&store, "n1", "Gone", "bye");
        let conn = store.lock_conn().unwrap();
        delete_note(&conn, "n1").unwrap();
        assert!(get_note(&conn, "n1").unwrap().is_none());
        assert!(list_notes(&conn).unwrap().is_empty());
    }

    #[test]
    fn slugify_strips_punctuation() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("***"), "note");
        assert_eq!(slugify("Ä"), "note");
    }
}
