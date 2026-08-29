use super::models::{
    FileReviewState, LineRange, ReviewClaim, ReviewComment, ReviewSession, ReviewSource,
};
use rusqlite::{params, Connection, Result};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct ReviewDb {
    conn: Mutex<Connection>,
}

impl ReviewDb {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let parent = path.as_ref().parent();
        if let Some(p) = parent {
            if !p.exists() {
                let _ = std::fs::create_dir_all(p);
            }
        }

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
        dirs::data_dir().map(|d| d.join("voktty").join("review.db"))
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;

             CREATE TABLE IF NOT EXISTS review_sessions (
                 id TEXT PRIMARY KEY,
                 session_key TEXT UNIQUE NOT NULL,
                 repo_root TEXT NOT NULL,
                 target TEXT NOT NULL,
                 base_ref TEXT,
                 head_ref TEXT,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 closed_at INTEGER
             );

             CREATE TABLE IF NOT EXISTS reviewed_files (
                 session_id TEXT NOT NULL,
                 path TEXT NOT NULL,
                 snapshot_hash TEXT NOT NULL,
                 viewed_at INTEGER NOT NULL,
                 PRIMARY KEY (session_id, path),
                 FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS review_range_claims (
                 id TEXT PRIMARY KEY,
                 session_id TEXT NOT NULL,
                 path TEXT NOT NULL,
                 block_id TEXT NOT NULL,
                 block_label TEXT NOT NULL,
                 snapshot_hash TEXT NOT NULL,
                 ranges_json TEXT NOT NULL,
                 viewed_at INTEGER NOT NULL,
                 FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
             );

             CREATE TABLE IF NOT EXISTS review_comments (
                 id TEXT PRIMARY KEY,
                 session_id TEXT NOT NULL,
                 path TEXT NOT NULL,
                 side TEXT NOT NULL,
                 line INTEGER NOT NULL,
                 end_line INTEGER,
                 snapshot_hash TEXT NOT NULL,
                 comment TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 status TEXT NOT NULL,
                 FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
             );

             CREATE INDEX IF NOT EXISTS idx_reviewed_files_session ON reviewed_files(session_id);
             CREATE INDEX IF NOT EXISTS idx_review_range_claims_session_path ON review_range_claims(session_id, path);
             CREATE INDEX IF NOT EXISTS idx_review_comments_session_path ON review_comments(session_id, path);",
        )?;

        Ok(())
    }

    pub fn open_session(
        &self,
        repo_root: &str,
        target: &str,
        base_ref: Option<&str>,
        head_ref: Option<&str>,
    ) -> Result<ReviewSession> {
        let conn = self.conn.lock().unwrap();
        let session_key = format!("{}#{}", repo_root, target);
        let now = chrono::Utc::now().timestamp_millis();

        // Check if existing session
        let existing: Option<ReviewSession> = conn
            .query_row(
                "SELECT id, session_key, repo_root, target, base_ref, head_ref, created_at, updated_at, closed_at
                 FROM review_sessions WHERE session_key = ?1",
                params![session_key],
                |row| {
                    Ok(ReviewSession {
                        id: row.get(0)?,
                        session_key: row.get(1)?,
                        repo_root: row.get(2)?,
                        target: row.get(3)?,
                        base_ref: row.get(4)?,
                        head_ref: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                        closed_at: row.get(8)?,
                    })
                },
            )
            .ok();

        if let Some(mut session) = existing {
            conn.execute(
                "UPDATE review_sessions SET closed_at = NULL, updated_at = ?1 WHERE id = ?2",
                params![now, session.id],
            )?;
            session.closed_at = None;
            session.updated_at = now;
            return Ok(session);
        }

        let new_id = format!("rev_{}", uuid_v4());
        conn.execute(
            "INSERT INTO review_sessions (id, session_key, repo_root, target, base_ref, head_ref, created_at, updated_at, closed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
            params![new_id, session_key, repo_root, target, base_ref, head_ref, now, now],
        )?;

        Ok(ReviewSession {
            id: new_id,
            session_key,
            repo_root: repo_root.to_string(),
            target: target.to_string(),
            base_ref: base_ref.map(|s| s.to_string()),
            head_ref: head_ref.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
            closed_at: None,
        })
    }

    pub fn mark_file_viewed(
        &self,
        session_id: &str,
        path: &str,
        snapshot_hash: &str,
        viewed: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();

        if viewed {
            conn.execute(
                "INSERT INTO reviewed_files (session_id, path, snapshot_hash, viewed_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(session_id, path) DO UPDATE SET snapshot_hash = ?3, viewed_at = ?4",
                params![session_id, path, snapshot_hash, now],
            )?;
        } else {
            conn.execute(
                "DELETE FROM reviewed_files WHERE session_id = ?1 AND path = ?2",
                params![session_id, path],
            )?;
        }

        Ok(())
    }

    pub fn mark_range_claim(
        &self,
        session_id: &str,
        path: &str,
        block_id: &str,
        block_label: &str,
        snapshot_hash: &str,
        ranges: &[LineRange],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let claim_id = format!("{}_{}_{}", session_id, path, block_id);
        let ranges_json = serde_json::to_string(ranges).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO review_range_claims (id, session_id, path, block_id, block_label, snapshot_hash, ranges_json, viewed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET snapshot_hash = ?6, ranges_json = ?7, viewed_at = ?8",
            params![claim_id, session_id, path, block_id, block_label, snapshot_hash, ranges_json, now],
        )?;

        Ok(())
    }

    pub fn unmark_range_claim(
        &self,
        session_id: &str,
        path: &str,
        block_id: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let claim_id = format!("{}_{}_{}", session_id, path, block_id);

        conn.execute(
            "DELETE FROM review_range_claims WHERE id = ?1",
            params![claim_id],
        )?;

        Ok(())
    }

    pub fn get_file_claims(&self, session_id: &str, path: &str) -> Result<Vec<ReviewClaim>> {
        let conn = self.conn.lock().unwrap();
        let mut claims = Vec::new();

        // 1. Whole file claim
        let file_claim: Option<(String, i64)> = conn
            .query_row(
                "SELECT snapshot_hash, viewed_at FROM reviewed_files WHERE session_id = ?1 AND path = ?2",
                params![session_id, path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        if let Some((hash, viewed_at)) = file_claim {
            claims.push(ReviewClaim {
                id: format!("{}_{}_file", session_id, path),
                session_id: session_id.to_string(),
                path: path.to_string(),
                source: ReviewSource::File,
                snapshot_hash: hash,
                snapshot_content: String::new(),
                ranges: None,
                viewed_at,
            });
        }

        // 2. Range claims
        let mut stmt = conn.prepare(
            "SELECT id, block_id, block_label, snapshot_hash, ranges_json, viewed_at
             FROM review_range_claims WHERE session_id = ?1 AND path = ?2",
        )?;

        let rows = stmt.query_map(params![session_id, path], |row| {
            let id: String = row.get(0)?;
            let block_id: String = row.get(1)?;
            let block_label: String = row.get(2)?;
            let snapshot_hash: String = row.get(3)?;
            let ranges_json: String = row.get(4)?;
            let viewed_at: i64 = row.get(5)?;
            let ranges: Option<Vec<LineRange>> = serde_json::from_str(&ranges_json).ok();

            Ok(ReviewClaim {
                id,
                session_id: session_id.to_string(),
                path: path.to_string(),
                source: ReviewSource::Range {
                    block_id,
                    block_label,
                },
                snapshot_hash,
                snapshot_content: String::new(),
                ranges,
                viewed_at,
            })
        })?;

        for claim in rows.flatten() {
            claims.push(claim);
        }

        Ok(claims)
    }

    pub fn get_session_overview(&self, session_id: &str) -> Result<Vec<FileReviewState>> {
        let conn = self.conn.lock().unwrap();
        let mut map: std::collections::HashMap<String, FileReviewState> = std::collections::HashMap::new();

        // 1. Reviewed files
        let mut stmt = conn.prepare(
            "SELECT path, snapshot_hash, viewed_at FROM reviewed_files WHERE session_id = ?1",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;

        for r in rows.flatten() {
            map.insert(
                r.0.clone(),
                FileReviewState {
                    path: r.0,
                    reviewed: true,
                    viewed_at: Some(r.2),
                    snapshot_hash: Some(r.1),
                    claims_count: 1,
                },
            );
        }

        // 2. Range claims
        let mut stmt_claims = conn.prepare(
            "SELECT path, COUNT(*) FROM review_range_claims WHERE session_id = ?1 GROUP BY path",
        )?;
        let rows_claims = stmt_claims.query_map(params![session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
        })?;

        for r in rows_claims.flatten() {
            map.entry(r.0.clone())
                .and_modify(|e| e.claims_count += r.1)
                .or_insert(FileReviewState {
                    path: r.0,
                    reviewed: false,
                    viewed_at: None,
                    snapshot_hash: None,
                    claims_count: r.1,
                });
        }

        Ok(map.into_values().collect())
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM review_sessions WHERE id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    pub fn prune_sessions_older_than(&self, timestamp: i64) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute(
            "DELETE FROM review_sessions WHERE updated_at < ?1",
            params![timestamp],
        )?;
        Ok(deleted)
    }

    pub fn add_comment(
        &self,
        session_id: &str,
        path: &str,
        side: &str,
        line: usize,
        end_line: Option<usize>,
        snapshot_hash: &str,
        comment: &str,
    ) -> Result<ReviewComment> {
        let conn = self.conn.lock().unwrap();
        let id = format!("rc_{}", uuid_v4());
        let now = chrono::Utc::now().timestamp_millis();
        let status = "pending";

        conn.execute(
            "INSERT INTO review_comments (id, session_id, path, side, line, end_line, snapshot_hash, comment, created_at, updated_at, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                session_id,
                path,
                side,
                line as i64,
                end_line.map(|l| l as i64),
                snapshot_hash,
                comment,
                now,
                now,
                status
            ],
        )?;

        Ok(ReviewComment {
            id,
            session_id: session_id.to_string(),
            path: path.to_string(),
            side: side.to_string(),
            line,
            end_line,
            snapshot_hash: snapshot_hash.to_string(),
            comment: comment.to_string(),
            created_at: now,
            updated_at: now,
            status: status.to_string(),
        })
    }

    pub fn get_session_comments(&self, session_id: &str) -> Result<Vec<ReviewComment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, path, side, line, end_line, snapshot_hash, comment, created_at, updated_at, status
             FROM review_comments WHERE session_id = ?1 ORDER BY path ASC, line ASC, created_at ASC",
        )?;

        let rows = stmt.query_map(params![session_id], |row| {
            let line_i64: i64 = row.get(4)?;
            let end_line_i64: Option<i64> = row.get(5)?;
            Ok(ReviewComment {
                id: row.get(0)?,
                session_id: row.get(1)?,
                path: row.get(2)?,
                side: row.get(3)?,
                line: line_i64 as usize,
                end_line: end_line_i64.map(|l| l as usize),
                snapshot_hash: row.get(6)?,
                comment: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                status: row.get(10)?,
            })
        })?;

        Ok(rows.flatten().collect())
    }

    pub fn get_file_comments(&self, session_id: &str, path: &str) -> Result<Vec<ReviewComment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, path, side, line, end_line, snapshot_hash, comment, created_at, updated_at, status
             FROM review_comments WHERE session_id = ?1 AND path = ?2 ORDER BY line ASC, created_at ASC",
        )?;

        let rows = stmt.query_map(params![session_id, path], |row| {
            let line_i64: i64 = row.get(4)?;
            let end_line_i64: Option<i64> = row.get(5)?;
            Ok(ReviewComment {
                id: row.get(0)?,
                session_id: row.get(1)?,
                path: row.get(2)?,
                side: row.get(3)?,
                line: line_i64 as usize,
                end_line: end_line_i64.map(|l| l as usize),
                snapshot_hash: row.get(6)?,
                comment: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                status: row.get(10)?,
            })
        })?;

        Ok(rows.flatten().collect())
    }

    pub fn delete_comment(&self, session_id: &str, comment_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM review_comments WHERE session_id = ?1 AND id = ?2",
            params![session_id, comment_id],
        )?;
        Ok(())
    }

    pub fn update_comment(&self, session_id: &str, comment_id: &str, comment: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE review_comments SET comment = ?1, updated_at = ?2 WHERE session_id = ?3 AND id = ?4",
            params![comment, now, session_id, comment_id],
        )?;
        Ok(())
    }
}

fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).unwrap_or_default();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_session_and_claims_lifecycle() {
        let db = ReviewDb::open_in_memory().unwrap();

        let session = db
            .open_session("C:\\repo", "worktree", Some("main"), Some("feature"))
            .unwrap();

        assert_eq!(session.repo_root, "C:\\repo");
        assert_eq!(session.target, "worktree");

        // Mark file viewed
        db.mark_file_viewed(&session.id, "src/main.rs", "hash_abc", true)
            .unwrap();

        let claims = db.get_file_claims(&session.id, "src/main.rs").unwrap();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].source, ReviewSource::File);
        assert_eq!(claims[0].snapshot_hash, "hash_abc");

        // Add range claim
        db.mark_range_claim(
            &session.id,
            "src/main.rs",
            "block_1",
            "Refactor main",
            "hash_abc",
            &[LineRange {
                start_line: 10,
                end_line: 20,
            }],
        )
        .unwrap();

        let claims_after = db.get_file_claims(&session.id, "src/main.rs").unwrap();
        assert_eq!(claims_after.len(), 2);

        // Overview check
        let overview = db.get_session_overview(&session.id).unwrap();
        assert_eq!(overview.len(), 1);
        assert_eq!(overview[0].path, "src/main.rs");
        assert!(overview[0].reviewed);
        assert_eq!(overview[0].claims_count, 2);

        // Add review comment
        let comment = db
            .add_comment(
                &session.id,
                "src/main.rs",
                "new",
                15,
                Some(18),
                "hash_abc",
                "Check potential panic on unwrap here",
            )
            .unwrap();
        assert_eq!(comment.line, 15);
        assert_eq!(comment.end_line, Some(18));
        assert_eq!(comment.comment, "Check potential panic on unwrap here");

        let file_comments = db.get_file_comments(&session.id, "src/main.rs").unwrap();
        assert_eq!(file_comments.len(), 1);
        assert_eq!(file_comments[0].id, comment.id);

        let all_comments = db.get_session_comments(&session.id).unwrap();
        assert_eq!(all_comments.len(), 1);

        // Update comment
        db.update_comment(&session.id, &comment.id, "Updated comment")
            .unwrap();
        let updated = db.get_file_comments(&session.id, "src/main.rs").unwrap();
        assert_eq!(updated[0].comment, "Updated comment");

        // Delete comment
        db.delete_comment(&session.id, &comment.id).unwrap();
        let comments_after_del = db.get_file_comments(&session.id, "src/main.rs").unwrap();
        assert_eq!(comments_after_del.len(), 0);

        // Unmark range
        db.unmark_range_claim(&session.id, "src/main.rs", "block_1")
            .unwrap();
        let claims_after_unmark = db.get_file_claims(&session.id, "src/main.rs").unwrap();
        assert_eq!(claims_after_unmark.len(), 1);

        // Test pruning
        let deleted = db.prune_sessions_older_than(session.updated_at + 1000).unwrap();
        assert_eq!(deleted, 1);
        let overview_after_prune = db.get_session_overview(&session.id).unwrap();
        assert_eq!(overview_after_prune.len(), 0);
    }
}

