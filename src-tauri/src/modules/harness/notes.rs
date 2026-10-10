use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::session_store::{now_millis, validate_id, SessionStoreState};

const TITLE_MAX: usize = 200;
const BODY_MAX: usize = 1_000_000;
const TAG_MAX: usize = 32;
const TAGS_MAX: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_cwd: Option<String>,
    #[serde(default)]
    pub slug_pending: bool,
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
    pub tags: Vec<String>,
    #[serde(default)]
    pub source_session_id: Option<String>,
    #[serde(default)]
    pub source_cwd: Option<String>,
    #[serde(default)]
    pub finalize_slug: bool,
}

struct ExistingNote {
    slug: String,
    created_at: i64,
    source_session_id: Option<String>,
    source_cwd: Option<String>,
    slug_pending: i64,
}

pub fn ensure_notes_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notes (
           id TEXT PRIMARY KEY,
           slug TEXT NOT NULL UNIQUE,
           title TEXT NOT NULL,
           body TEXT NOT NULL DEFAULT '',
           tags_json TEXT NOT NULL DEFAULT '[]',
           source_session_id TEXT,
           source_cwd TEXT,
           slug_pending INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS notes_updated_idx
           ON notes (updated_at DESC, id);",
    )?;
    ensure_notes_column(conn, "tags_json", "TEXT NOT NULL DEFAULT '[]'")?;
    ensure_notes_column(conn, "slug_pending", "INTEGER NOT NULL DEFAULT 0")
}

fn ensure_notes_column(conn: &Connection, name: &str, definition: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(notes)")?;
    let mut rows = stmt.query([])?;
    let mut found = false;
    while let Some(row) = rows.next()? {
        let col: String = row.get(1)?;
        if col == name {
            found = true;
            break;
        }
    }
    if !found {
        conn.execute(
            &format!("ALTER TABLE notes ADD COLUMN {name} {definition}"),
            [],
        )?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn notes_list(store: State<'_, SessionStoreState>) -> Result<Vec<Note>, String> {
    let conn = store.lock_conn()?;
    list_notes(&conn).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_get(store: State<'_, SessionStoreState>, id: String) -> Result<Option<Note>, String> {
    validate_id(&id, "note")?;
    let conn = store.lock_conn()?;
    get_note(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_upsert(store: State<'_, SessionStoreState>, note: NoteUpsert) -> Result<Note, String> {
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
pub fn notes_delete(store: State<'_, SessionStoreState>, id: String) -> Result<(), String> {
    validate_id(&id, "note")?;
    let conn = store.lock_conn()?;
    delete_note(&conn, &id).map_err(|e| e.to_string())
}

fn list_notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, title, body, source_session_id, source_cwd, tags_json,
                created_at, updated_at, slug_pending
         FROM notes
         ORDER BY updated_at DESC, id ASC",
    )?;
    let rows = stmt.query_map([], read_note)?;
    rows.collect()
}

fn get_note(conn: &Connection, id: &str) -> rusqlite::Result<Option<Note>> {
    conn.query_row(
        "SELECT id, slug, title, body, source_session_id, source_cwd, tags_json,
                created_at, updated_at, slug_pending
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
    let tags = normalize_tags(&note.tags);
    let tags_json = serde_json::to_string(&tags)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
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

    let existing = conn
        .query_row(
            "SELECT slug, created_at, source_session_id, source_cwd, slug_pending
             FROM notes WHERE id = ?1",
            params![note.id],
            |row| {
                Ok(ExistingNote {
                    slug: row.get(0)?,
                    created_at: row.get(1)?,
                    source_session_id: row.get(2)?,
                    source_cwd: row.get(3)?,
                    slug_pending: row.get(4)?,
                })
            },
        )
        .optional()?;

    if let Some(existing) = existing {
        let (slug, slug_pending) =
            if note.finalize_slug && existing.slug_pending != 0 && !is_placeholder_title(&title) {
                (unique_slug(conn, &title)?, false)
            } else {
                (existing.slug, existing.slug_pending != 0)
            };
        conn.execute(
            "UPDATE notes
             SET title = ?1, body = ?2, tags_json = ?3, updated_at = ?4,
                 slug = ?6, slug_pending = ?7
             WHERE id = ?5",
            params![
                title,
                body,
                tags_json,
                now,
                note.id,
                slug,
                if slug_pending { 1i64 } else { 0i64 }
            ],
        )?;
        Ok(Note {
            id: note.id.clone(),
            slug,
            title,
            body,
            tags,
            source_session_id: existing.source_session_id,
            source_cwd: existing.source_cwd,
            slug_pending,
            created_at: existing.created_at,
            updated_at: now,
        })
    } else {
        let slug_pending = note.title.trim().is_empty();
        let slug = unique_slug(conn, &title)?;
        conn.execute(
            "INSERT INTO notes (
               id, slug, title, body, source_session_id, source_cwd, tags_json,
               created_at, updated_at, slug_pending
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                note.id,
                slug,
                title,
                body,
                source_session_id,
                source_cwd,
                tags_json,
                now,
                now,
                if slug_pending { 1i64 } else { 0i64 }
            ],
        )?;
        Ok(Note {
            id: note.id.clone(),
            slug,
            title,
            body,
            tags,
            source_session_id: source_session_id.map(str::to_string),
            source_cwd: source_cwd.map(str::to_string),
            slug_pending,
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
    let tags_json: String = row.get(6)?;
    let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
    Ok(Note {
        id: row.get(0)?,
        slug: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        tags,
        source_session_id: row.get(4)?,
        source_cwd: row.get(5)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        slug_pending: row.get::<_, i64>(9)? != 0,
    })
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for input in tags {
        let tag = input
            .trim()
            .trim_start_matches('#')
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .to_lowercase();
        let tag: String = tag.chars().take(TAG_MAX).collect();
        let tag = tag.trim_end_matches('-').to_string();
        if tag.is_empty() || normalized.contains(&tag) {
            continue;
        }
        normalized.push(tag);
        if normalized.len() == TAGS_MAX {
            break;
        }
    }
    normalized
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
    let words = slug_words(title);
    let slug = words[..words.len().min(48)].trim_end_matches('-');
    if slug.is_empty() {
        "note".into()
    } else {
        slug.into()
    }
}

fn slug_words(title: &str) -> String {
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
    }
    out.trim_end_matches('-').to_string()
}

fn is_placeholder_title(title: &str) -> bool {
    let words = slug_words(title);
    match words.strip_prefix("untitled") {
        Some("") => true,
        Some(rest) => rest.strip_prefix('-').is_some_and(|suffix| {
            !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit())
        }),
        None => false,
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
    use super::super::session_store::SessionStore;
    use super::*;

    fn upsert(store: &SessionStore, id: &str, title: &str, body: &str) -> Note {
        let conn = store.lock_conn().unwrap();
        upsert_note(
            &conn,
            &NoteUpsert {
                id: id.into(),
                title: title.into(),
                body: body.into(),
                tags: Vec::new(),
                source_session_id: None,
                source_cwd: None,
                finalize_slug: false,
            },
        )
        .unwrap()
    }

    fn save(store: &SessionStore, id: &str, title: &str, finalize_slug: bool) -> Note {
        let conn = store.lock_conn().unwrap();
        upsert_note(
            &conn,
            &NoteUpsert {
                id: id.into(),
                title: title.into(),
                body: String::new(),
                tags: Vec::new(),
                source_session_id: None,
                source_cwd: None,
                finalize_slug,
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
    fn note_upsert_defaults_to_not_finalizing_the_slug() {
        let input: NoteUpsert = serde_json::from_value(serde_json::json!({
            "id": "n1",
            "title": "Plan",
            "body": ""
        }))
        .unwrap();
        assert!(!input.finalize_slug);
    }

    #[test]
    fn ensure_table_adds_tags_to_an_existing_notes_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (
               id TEXT PRIMARY KEY,
               slug TEXT NOT NULL UNIQUE,
               title TEXT NOT NULL,
               body TEXT NOT NULL DEFAULT '',
               source_session_id TEXT,
               source_cwd TEXT,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             INSERT INTO notes (id, slug, title, body, source_cwd, created_at, updated_at)
               VALUES ('old', 'untitled', 'Untitled', 'kept', '/repo', 1, 2);",
        )
        .unwrap();

        ensure_notes_table(&conn).unwrap();
        ensure_notes_table(&conn).unwrap();

        let tags_column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'tags_json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tags_column, 1);
        let slug_pending_column: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = 'slug_pending'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(slug_pending_column, 1);
        let legacy = get_note(&conn, "old").unwrap().unwrap();
        assert_eq!(legacy.slug, "untitled");
        assert_eq!(legacy.title, "Untitled");
        assert_eq!(legacy.body, "kept");
        assert_eq!(legacy.source_cwd.as_deref(), Some("/repo"));
        assert!(!legacy.slug_pending);
        assert_eq!((legacy.created_at, legacy.updated_at), (1, 2));
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
                tags: vec!["Ideas".into(), "project docs".into(), "ideas".into()],
                source_session_id: Some("sess-1".into()),
                source_cwd: Some("/tmp/a".into()),
                finalize_slug: false,
            },
        )
        .unwrap();
        assert_eq!(updated.slug, "alpha");
        assert_eq!(updated.title, "Alpha renamed");
        assert_eq!(updated.body, "changed");
        assert_eq!(updated.tags, vec!["ideas", "project-docs"]);
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
        assert!(note.slug_pending);
    }

    #[test]
    fn explicit_untitled_title_has_an_established_slug() {
        let store = SessionStore::open_in_memory().unwrap();
        let note = upsert(&store, "n1", "Untitled", "");
        assert_eq!(note.slug, "untitled");
        assert!(!note.slug_pending);
    }

    #[test]
    fn pending_slug_survives_debounced_saves_and_finalizes_once() {
        let store = SessionStore::open_in_memory().unwrap();
        save(&store, "n1", "", false);
        save(&store, "n1", "This i", false);
        let typed = save(&store, "n1", "This is my first note", false);
        assert_eq!(typed.slug, "untitled");
        assert!(typed.slug_pending);

        let finalized = save(&store, "n1", "This is my first note", true);
        assert_eq!(finalized.slug, "this-is-my-first-note");
        assert!(!finalized.slug_pending);

        for title in ["Renamed", "", "Another name"] {
            let renamed = save(&store, "n1", title, true);
            assert_eq!(renamed.slug, "this-is-my-first-note");
            assert!(!renamed.slug_pending);
        }
    }

    #[test]
    fn pending_slug_waits_for_a_real_title() {
        let store = SessionStore::open_in_memory().unwrap();
        save(&store, "n1", "", false);
        for title in ["Untitled", "   ", "Untitled 2"] {
            let saved = save(&store, "n1", title, true);
            assert_eq!(saved.slug, "untitled");
            assert!(saved.slug_pending);
        }
        let finalized = save(&store, "n1", "Auth approach", true);
        assert_eq!(finalized.slug, "auth-approach");
        assert!(!finalized.slug_pending);
    }

    #[test]
    fn finalizing_a_pending_slug_avoids_collisions() {
        let store = SessionStore::open_in_memory().unwrap();
        save(&store, "n1", "Plan", false);
        save(&store, "n2", "", false);
        let second_blank = save(&store, "n3", "", false);
        assert_eq!(second_blank.slug, "untitled-2");
        assert_eq!(save(&store, "n2", "Plan", true).slug, "plan-2");
        assert_eq!(save(&store, "n3", "Plan", true).slug, "plan-3");
    }

    #[test]
    fn placeholder_title_detection_checks_the_whole_title() {
        assert!(is_placeholder_title("Untitled"));
        assert!(is_placeholder_title("untitled 2"));
        assert!(is_placeholder_title("Untitled-137"));
        assert!(!is_placeholder_title("Untitled draft"));
        assert!(!is_placeholder_title("Untitled2"));
        assert!(!is_placeholder_title("My untitled"));

        let long = format!("Untitled {} draft", "1".repeat(40));
        assert!(slugify(&long).len() <= 48);
        assert!(!is_placeholder_title(&long));
        assert!(is_placeholder_title(&format!(
            "Untitled {}",
            "1".repeat(60)
        )));
    }

    #[test]
    fn real_title_past_the_slug_cutoff_finalizes() {
        let store = SessionStore::open_in_memory().unwrap();
        save(&store, "n1", "", false);
        let title = format!("Untitled {} draft", "1".repeat(40));
        let finalized = save(&store, "n1", &title, true);
        assert!(!finalized.slug_pending);
        assert_eq!(finalized.slug, slugify(&title));
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
