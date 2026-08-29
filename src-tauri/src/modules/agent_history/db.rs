use super::models::{HistoryMessage, HistorySession, HistoryStats, SessionFilter};
use rusqlite::{params, Connection, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct HistoryDb {
    conn: Mutex<Connection>,
}

impl HistoryDb {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn default_db_path() -> Option<PathBuf> {
        dirs::data_dir().map(|d| d.join("voktty").join("agent_history.db"))
    }

    pub fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;

             CREATE TABLE IF NOT EXISTS sessions (
                 id TEXT PRIMARY KEY,
                 agent TEXT NOT NULL,
                 title TEXT NOT NULL,
                 project_name TEXT NOT NULL,
                 project_path TEXT NOT NULL,
                 cwd TEXT,
                 git_branch TEXT,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 message_count INTEGER NOT NULL DEFAULT 0,
                 is_active INTEGER NOT NULL DEFAULT 0,
                 file_path TEXT,
                 source_hash TEXT,
                 can_resume INTEGER NOT NULL DEFAULT 0,
                 resume_command TEXT
             );

             CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
             CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name);
             CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_sessions_file_path ON sessions(file_path);

             CREATE TABLE IF NOT EXISTS messages (
                 id TEXT PRIMARY KEY,
                 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                 role TEXT NOT NULL,
                 content TEXT NOT NULL,
                 sequence INTEGER NOT NULL,
                 timestamp INTEGER NOT NULL,
                 tool_name TEXT,
                 tool_input TEXT,
                 tool_output TEXT,
                 is_error INTEGER NOT NULL DEFAULT 0,
                 redacted INTEGER NOT NULL DEFAULT 0
             );

             CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sequence);

             CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                 message_id UNINDEXED,
                 session_id UNINDEXED,
                 content,
                 tool_name,
                 tool_input,
                 tool_output,
                 tokenize = 'unicode61'
             );",
        )?;

        Ok(())
    }

    pub fn upsert_session(&self, session: &HistorySession) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (
                id, agent, title, project_name, project_path, cwd, git_branch,
                created_at, updated_at, message_count, is_active, file_path,
                source_hash, can_resume, resume_command
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                project_name = excluded.project_name,
                project_path = excluded.project_path,
                cwd = excluded.cwd,
                git_branch = excluded.git_branch,
                updated_at = excluded.updated_at,
                message_count = excluded.message_count,
                is_active = excluded.is_active,
                file_path = excluded.file_path,
                source_hash = excluded.source_hash,
                can_resume = excluded.can_resume,
                resume_command = excluded.resume_command;",
            params![
                session.id,
                session.agent,
                session.title,
                session.project_name,
                session.project_path,
                session.cwd,
                session.git_branch,
                session.created_at,
                session.updated_at,
                session.message_count,
                if session.is_active { 1 } else { 0 },
                session.file_path,
                session.source_hash,
                if session.can_resume { 1 } else { 0 },
                session.resume_command
            ],
        )?;
        Ok(())
    }

    pub fn get_source_hash_by_path(&self, file_path: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare_cached("SELECT source_hash FROM sessions WHERE file_path = ?1 LIMIT 1")?;
        let mut rows = stmt.query(params![file_path])?;
        if let Some(row) = rows.next()? {
            let hash: Option<String> = row.get(0)?;
            Ok(hash)
        } else {
            Ok(None)
        }
    }

    pub fn replace_session_messages(
        &self,
        session_id: &str,
        messages: &[HistoryMessage],
    ) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        // Eliminar mensajes previos y registros FTS correspondientes
        tx.execute(
            "DELETE FROM messages_fts WHERE session_id = ?1;",
            params![session_id],
        )?;
        tx.execute(
            "DELETE FROM messages WHERE session_id = ?1;",
            params![session_id],
        )?;

        {
            let mut insert_msg = tx.prepare(
                "INSERT INTO messages (
                    id, session_id, role, content, sequence, timestamp,
                    tool_name, tool_input, tool_output, is_error, redacted
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11);",
            )?;

            let mut insert_fts = tx.prepare(
                "INSERT INTO messages_fts (
                    message_id, session_id, content, tool_name, tool_input, tool_output
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            )?;

            for msg in messages {
                insert_msg.execute(params![
                    msg.id,
                    msg.session_id,
                    msg.role,
                    msg.content,
                    msg.sequence,
                    msg.timestamp,
                    msg.tool_name,
                    msg.tool_input,
                    msg.tool_output,
                    if msg.is_error { 1 } else { 0 },
                    if msg.redacted { 1 } else { 0 }
                ])?;

                insert_fts.execute(params![
                    msg.id,
                    msg.session_id,
                    msg.content,
                    msg.tool_name.as_deref().unwrap_or(""),
                    msg.tool_input.as_deref().unwrap_or(""),
                    msg.tool_output.as_deref().unwrap_or("")
                ])?;
            }
        }

        // Actualizar message_count en la sesión
        tx.execute(
            "UPDATE sessions SET message_count = ?1 WHERE id = ?2;",
            params![messages.len() as u32, session_id],
        )?;

        tx.commit()?;
        Ok(())
    }

    pub fn get_sessions(&self, filter: &SessionFilter) -> Result<Vec<HistorySession>> {
        let conn = self.conn.lock().unwrap();

        // Si hay search_query, buscar primero por FTS o match de título
        if let Some(ref q) = filter.search_query {
            let clean_q = q.trim();
            if !clean_q.is_empty() {
                return self.search_sessions_internal(&conn, clean_q, filter);
            }
        }

        let mut sql = String::from(
            "SELECT id, agent, title, project_name, project_path, cwd, git_branch,
                    created_at, updated_at, message_count, is_active, file_path,
                    source_hash, can_resume, resume_command
             FROM sessions WHERE 1=1",
        );

        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref agent) = filter.agent {
            if agent != "all" && !agent.is_empty() {
                sql.push_str(" AND agent = ?");
                params_vec.push(Box::new(agent.clone()));
            }
        }

        if let Some(ref project) = filter.project {
            if !project.is_empty() {
                sql.push_str(" AND (project_name = ? OR project_path LIKE ?)");
                params_vec.push(Box::new(project.clone()));
                params_vec.push(Box::new(format!("%{}%", project)));
            }
        }

        if let Some(from) = filter.from_timestamp {
            sql.push_str(" AND updated_at >= ?");
            params_vec.push(Box::new(from));
        }

        if let Some(to) = filter.to_timestamp {
            sql.push_str(" AND updated_at <= ?");
            params_vec.push(Box::new(to));
        }

        sql.push_str(" ORDER BY updated_at DESC");

        let limit = filter.limit.unwrap_or(50);
        let offset = filter.offset.unwrap_or(0);
        sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

        let params_slice: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|b| b.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let session_iter = stmt.query_map(params_slice.as_slice(), |row| {
            Ok(HistorySession {
                id: row.get(0)?,
                agent: row.get(1)?,
                title: row.get(2)?,
                project_name: row.get(3)?,
                project_path: row.get(4)?,
                cwd: row.get(5)?,
                git_branch: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                message_count: row.get(9)?,
                is_active: row.get::<_, i32>(10)? != 0,
                file_path: row.get(11)?,
                source_hash: row.get(12)?,
                can_resume: row.get::<_, i32>(13)? != 0,
                resume_command: row.get(14)?,
            })
        })?;

        let mut results = Vec::new();
        for s in session_iter {
            results.push(s?);
        }
        Ok(results)
    }

    fn search_sessions_internal(
        &self,
        conn: &Connection,
        query: &str,
        filter: &SessionFilter,
    ) -> Result<Vec<HistorySession>> {
        // Sanitizar query para SQLite FTS5 (evitar errores de sintaxis en caracteres especiales)
        let safe_query = query
            .replace('"', "\"\"")
            .split_whitespace()
            .map(|w| format!("\"{}\"*", w))
            .collect::<Vec<_>>()
            .join(" ");

        let sql = "
            SELECT s.id, s.agent, s.title, s.project_name, s.project_path,
                   s.cwd, s.git_branch, s.created_at, s.updated_at, s.message_count,
                   s.is_active, s.file_path, s.source_hash, s.can_resume, s.resume_command
            FROM sessions s
            WHERE (
                s.id IN (SELECT session_id FROM messages_fts WHERE messages_fts MATCH ?1)
                OR s.title LIKE ?2
                OR s.project_name LIKE ?2
            )
            AND (?3 IS NULL OR s.agent = ?3)
            AND (?4 IS NULL OR s.project_name = ?4)
            ORDER BY s.updated_at DESC
            LIMIT ?5 OFFSET ?6;";

        let agent_param = filter
            .agent
            .as_ref()
            .filter(|a| *a != "all" && !a.is_empty());
        let project_param = filter.project.as_ref().filter(|p| !p.is_empty());
        let limit = filter.limit.unwrap_or(50);
        let offset = filter.offset.unwrap_or(0);
        let title_like = format!("%{}%", query);

        let mut stmt = conn.prepare(sql)?;
        let session_iter = stmt.query_map(
            params![
                safe_query,
                title_like,
                agent_param,
                project_param,
                limit,
                offset
            ],
            |row| {
                Ok(HistorySession {
                    id: row.get(0)?,
                    agent: row.get(1)?,
                    title: row.get(2)?,
                    project_name: row.get(3)?,
                    project_path: row.get(4)?,
                    cwd: row.get(5)?,
                    git_branch: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    message_count: row.get(9)?,
                    is_active: row.get::<_, i32>(10)? != 0,
                    file_path: row.get(11)?,
                    source_hash: row.get(12)?,
                    can_resume: row.get::<_, i32>(13)? != 0,
                    resume_command: row.get(14)?,
                })
            },
        )?;

        let mut results = Vec::new();
        for s in session_iter {
            results.push(s?);
        }
        Ok(results)
    }

    pub fn get_session(&self, session_id: &str) -> Result<Option<HistorySession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, agent, title, project_name, project_path, cwd, git_branch,
                    created_at, updated_at, message_count, is_active, file_path,
                    source_hash, can_resume, resume_command
             FROM sessions WHERE id = ?1;",
        )?;

        let mut rows = stmt.query(params![session_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(HistorySession {
                id: row.get(0)?,
                agent: row.get(1)?,
                title: row.get(2)?,
                project_name: row.get(3)?,
                project_path: row.get(4)?,
                cwd: row.get(5)?,
                git_branch: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                message_count: row.get(9)?,
                is_active: row.get::<_, i32>(10)? != 0,
                file_path: row.get(11)?,
                source_hash: row.get(12)?,
                can_resume: row.get::<_, i32>(13)? != 0,
                resume_command: row.get(14)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_messages(
        &self,
        session_id: &str,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<HistoryMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, sequence, timestamp,
                    tool_name, tool_input, tool_output, is_error, redacted
             FROM messages
             WHERE session_id = ?1
             ORDER BY sequence ASC
             LIMIT ?2 OFFSET ?3;",
        )?;

        let rows = stmt.query_map(params![session_id, limit, offset], |row| {
            Ok(HistoryMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                sequence: row.get(4)?,
                timestamp: row.get(5)?,
                tool_name: row.get(6)?,
                tool_input: row.get(7)?,
                tool_output: row.get(8)?,
                is_error: row.get::<_, i32>(9)? != 0,
                redacted: row.get::<_, i32>(10)? != 0,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM messages_fts WHERE session_id = ?1;",
            params![session_id],
        )?;
        conn.execute(
            "DELETE FROM messages WHERE session_id = ?1;",
            params![session_id],
        )?;
        conn.execute("DELETE FROM sessions WHERE id = ?1;", params![session_id])?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages_fts;", [])?;
        conn.execute("DELETE FROM messages;", [])?;
        conn.execute("DELETE FROM sessions;", [])?;
        Ok(())
    }

    pub fn get_stats(&self, last_scan: i64) -> Result<HistoryStats> {
        let conn = self.conn.lock().unwrap();

        let total_sessions: u32 =
            conn.query_row("SELECT COUNT(*) FROM sessions;", [], |r| r.get(0))?;
        let total_messages: u32 =
            conn.query_row("SELECT COUNT(*) FROM messages;", [], |r| r.get(0))?;

        let mut agents_count = HashMap::new();
        let mut stmt_ag = conn.prepare("SELECT agent, COUNT(*) FROM sessions GROUP BY agent;")?;
        let ag_rows =
            stmt_ag.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?;
        for row in ag_rows {
            let (ag, count) = row?;
            agents_count.insert(ag, count);
        }

        let mut projects_count = HashMap::new();
        let mut stmt_pr =
            conn.prepare("SELECT project_name, COUNT(*) FROM sessions GROUP BY project_name;")?;
        let pr_rows =
            stmt_pr.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?;
        for row in pr_rows {
            let (pr, count) = row?;
            projects_count.insert(pr, count);
        }

        Ok(HistoryStats {
            total_sessions,
            total_messages,
            agents_count,
            projects_count,
            last_scan_timestamp: last_scan,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_in_memory_crud_and_fts() {
        let db = HistoryDb::open_in_memory().unwrap();

        let s1 = HistorySession {
            id: "test_s1".to_string(),
            agent: "claude".to_string(),
            title: "Refactor Authentication Engine".to_string(),
            project_name: "voktty".to_string(),
            project_path: "/projects/voktty".to_string(),
            cwd: Some("/projects/voktty".to_string()),
            git_branch: Some("main".to_string()),
            created_at: 1000,
            updated_at: 2000,
            message_count: 2,
            is_active: false,
            file_path: None,
            source_hash: Some("hash123".to_string()),
            can_resume: true,
            resume_command: Some("claude --resume test_s1".to_string()),
        };

        db.upsert_session(&s1).unwrap();

        let m1 = HistoryMessage {
            id: "m1".to_string(),
            session_id: "test_s1".to_string(),
            role: "user".to_string(),
            content: "Please help me implement OAuth2 token rotation".to_string(),
            sequence: 0,
            timestamp: 1000,
            tool_name: None,
            tool_input: None,
            tool_output: None,
            is_error: false,
            redacted: false,
        };

        let m2 = HistoryMessage {
            id: "m2".to_string(),
            session_id: "test_s1".to_string(),
            role: "assistant".to_string(),
            content: "Here is the implementation of OAuth2 token refresh handler".to_string(),
            sequence: 1,
            timestamp: 1050,
            tool_name: Some("view_file".to_string()),
            tool_input: Some("auth.ts".to_string()),
            tool_output: Some("file contents".to_string()),
            is_error: false,
            redacted: false,
        };

        db.replace_session_messages("test_s1", &[m1, m2]).unwrap();

        // 1. Get Session
        let retrieved = db.get_session("test_s1").unwrap().unwrap();
        assert_eq!(retrieved.title, "Refactor Authentication Engine");
        assert_eq!(retrieved.message_count, 2);

        // 2. FTS Search
        let search_res = db
            .get_sessions(&SessionFilter {
                search_query: Some("OAuth2".to_string()),
                ..Default::default()
            })
            .unwrap();

        assert_eq!(search_res.len(), 1);
        assert_eq!(search_res[0].id, "test_s1");

        // 3. Search missing term
        let empty_res = db
            .get_sessions(&SessionFilter {
                search_query: Some("NonExistentTerm".to_string()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(empty_res.len(), 0);

        // 4. Delete session
        db.delete_session("test_s1").unwrap();
        assert!(db.get_session("test_s1").unwrap().is_none());
    }
}
