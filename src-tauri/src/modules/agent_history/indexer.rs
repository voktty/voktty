use super::adapters::{
    claude_adapter::ClaudeAdapter, codex_adapter::CodexAdapter,
    cursor_adapter::CursorAdapter, gemini_adapter::GeminiAdapter,
    voktty_adapter::VokttyAdapter, AgentHistoryAdapter,
};
use super::db::HistoryDb;
use super::models::{HistorySession, HistoryStats};
use super::sanitizer::Sanitizer;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct HistoryIndexer {
    db: Arc<HistoryDb>,
    adapters: Vec<Box<dyn AgentHistoryAdapter>>,
    last_scan: std::sync::atomic::AtomicI64,
}

impl HistoryIndexer {
    pub fn new(db: Arc<HistoryDb>) -> Self {
        let adapters: Vec<Box<dyn AgentHistoryAdapter>> = vec![
            Box::new(VokttyAdapter::new()),
            Box::new(ClaudeAdapter::new()),
            Box::new(CodexAdapter::new()),
            Box::new(GeminiAdapter::new()),
            Box::new(CursorAdapter::new()),
        ];

        Self {
            db,
            adapters,
            last_scan: std::sync::atomic::AtomicI64::new(0),
        }
    }

    pub fn rescan_all(&self) -> Result<HistoryStats, String> {
        let start_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        for adapter in &self.adapters {
            if !adapter.is_installed() {
                continue;
            }

            let locations = adapter.scan();
            for loc in locations {
                // Parse session from file
                if let Some((mut session, mut messages)) = adapter.parse_session(&loc.path) {
                    // Check if existing session in DB has identical source_hash
                    if let Ok(Some(existing_session)) = self.db.get_session(&session.id) {
                        if existing_session.source_hash.as_deref() == session.source_hash.as_deref() {
                            // No change, skip re-parsing
                            continue;
                        }
                    }

                    // Saneamiento de secretos y tokens en los mensajes
                    for msg in &mut messages {
                        let (sanitized_content, was_redacted) = Sanitizer::sanitize_text(&msg.content);
                        msg.content = sanitized_content;
                        msg.redacted = was_redacted;

                        if let Some(ref input) = msg.tool_input {
                            let (sanitized_input, was_red) = Sanitizer::sanitize_text(input);
                            msg.tool_input = Some(sanitized_input);
                            if was_red {
                                msg.redacted = true;
                            }
                        }

                        if let Some(ref output) = msg.tool_output {
                            let (sanitized_output, was_red) = Sanitizer::sanitize_text(output);
                            msg.tool_output = Some(sanitized_output);
                            if was_red {
                                msg.redacted = true;
                            }
                        }
                    }

                    session.message_count = messages.len() as u32;

                    // Write to DB
                    let _ = self.db.upsert_session(&session);
                    let _ = self.db.replace_session_messages(&session.id, &messages);
                }
            }
        }

        self.last_scan
            .store(start_ts, std::sync::atomic::Ordering::SeqCst);

        self.db
            .get_stats(start_ts)
            .map_err(|e| format!("Failed to get history stats: {}", e))
    }

    pub fn get_resume_command(&self, session: &HistorySession) -> Option<String> {
        for adapter in &self.adapters {
            if adapter.id() == session.agent {
                return adapter.resume_command(session);
            }
        }
        session.resume_command.clone()
    }
}