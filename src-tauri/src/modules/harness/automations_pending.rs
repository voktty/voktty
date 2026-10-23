use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;

use super::{
    apply_run_summary, parse_automation, validate_id, write_automation, write_run, Automation,
    AutomationRun, DueAutomationRun,
};

const PAGE_ROWS: usize = 16;
const PAGE_BYTES: usize = 4 * 1024 * 1024;
pub(super) const STATUS_SQL: &str =
    "CASE WHEN json_valid(run_json) THEN json_extract(run_json, '$.status') ELSE 'pending' END";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAutomationPage {
    runs: Vec<DueAutomationRun>,
    next_after: Option<String>,
}

pub(super) fn validate_cursor(after: Option<&str>) -> Result<(), String> {
    if let Some(after) = after {
        if after.len() > 256 {
            return Err("Invalid automation cursor.".into());
        }
        validate_id(after, "automation cursor")?;
    }
    Ok(())
}

pub(super) fn validate_start(run_id: &str, session_id: &str) -> Result<(), String> {
    if run_id.len() > 256 || session_id.len() > 256 {
        return Err("Invalid automation start identity.".into());
    }
    validate_id(run_id, "automation run")?;
    validate_id(session_id, "session")
}

pub(super) fn start(
    conn: &mut Connection,
    run_id: &str,
    session_id: &str,
    now: i64,
) -> Result<Option<AutomationRun>, String> {
    validate_start(run_id, session_id)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "Could not claim pending automation.")?;
    let raw: Option<Option<String>> = tx
        .query_row(
            "SELECT length(CAST(run_json AS BLOB)), run_json FROM automation_runs WHERE id = ?1",
            [run_id],
            |row| {
                let length: usize = row.get(0)?;
                if length > PAGE_BYTES {
                    Ok(None)
                } else {
                    row.get(1).map(Some)
                }
            },
        )
        .optional()
        .map_err(|_| "Could not claim pending automation.")?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    let raw = raw.ok_or("Stored automation run exceeds the pending page budget.")?;
    let mut run: AutomationRun =
        serde_json::from_str(&raw).map_err(|_| "Invalid stored automation run.")?;
    if run.id != run_id {
        return Err("Invalid stored automation run.".into());
    }
    if run.status != "pending" {
        return Ok(None);
    }
    if run.trigger == "event"
        && run
            .prompt
            .as_deref()
            .is_none_or(|prompt| prompt.trim().is_empty())
    {
        return Err("Automation event prompt is unavailable.".into());
    }
    if run.session_id.as_deref().unwrap_or(&run.id) != session_id {
        return Err("Automation session identity changed.".into());
    }
    let mut automation = definition(&tx, &run.automation_id)?.ok_or("Automation not found.")?;
    if automation.id != run.automation_id {
        return Err("Invalid stored automation definition.".into());
    }
    run.status = "running".into();
    run.started_at = Some(now);
    run.completed_at = None;
    run.session_id = Some(session_id.into());
    run.error = None;
    apply_run_summary(&mut automation, &run);
    write_run(&tx, &run)?;
    write_automation(&tx, &automation)?;
    tx.commit()
        .map_err(|_| "Could not claim pending automation.")?;
    Ok(Some(run))
}

pub(super) fn page(
    conn: &Connection,
    after: Option<&str>,
) -> Result<PendingAutomationPage, String> {
    validate_cursor(after)?;
    let query = format!(
        "SELECT id, run_json, length(CAST(run_json AS BLOB)) FROM automation_runs
         WHERE {STATUS_SQL} = 'pending' AND id > ?1 ORDER BY id LIMIT ?2"
    );
    let mut statement = conn
        .prepare(&query)
        .map_err(|_| "Could not read pending automations.")?;
    let mut rows = statement
        .query(rusqlite::params![
            after.unwrap_or(""),
            (PAGE_ROWS + 1) as i64
        ])
        .map_err(|_| "Could not read pending automations.")?;
    let mut page = PendingAutomationPage {
        runs: Vec::new(),
        next_after: None,
    };
    // Reserve the response envelope, commas and the bounded continuation id.
    let mut bytes = 1024;
    let mut last = None;
    for _ in 0..PAGE_ROWS {
        let Some(row) = rows
            .next()
            .map_err(|_| "Could not read pending automations.")?
        else {
            return Ok(page);
        };
        let id: String = row.get(0).map_err(|_| "Invalid stored automation run.")?;
        validate_cursor(Some(&id))?;
        let length: usize = row.get(2).map_err(|_| "Invalid stored automation run.")?;
        if length > PAGE_BYTES {
            return Err("Stored automation run exceeds the pending page budget.".into());
        }
        let raw: String = row.get(1).map_err(|_| "Invalid stored automation run.")?;
        let run: AutomationRun =
            serde_json::from_str(&raw).map_err(|_| "Invalid stored automation run.")?;
        if run.id != id {
            return Err("Invalid stored automation run.".into());
        }
        if run.status == "pending" {
            if let Some(automation) = definition(conn, &run.automation_id)? {
                if automation.id != run.automation_id {
                    return Err("Invalid stored automation definition.".into());
                }
                let due = DueAutomationRun { automation, run };
                let size = serde_json::to_vec(&due)
                    .map_err(|_| "Invalid stored automation run.")?
                    .len()
                    + 1;
                if size > PAGE_BYTES - 1024 {
                    return Err("Stored automation run exceeds the pending page budget.".into());
                }
                if bytes + size > PAGE_BYTES {
                    page.next_after = last;
                    return Ok(page);
                }
                bytes += size;
                page.runs.push(due);
            }
        }
        last = Some(id);
    }
    if rows
        .next()
        .map_err(|_| "Could not read pending automations.")?
        .is_some()
    {
        page.next_after = last;
    }
    Ok(page)
}

fn definition(conn: &Connection, id: &str) -> Result<Option<Automation>, String> {
    let mut statement = conn.prepare(
        "SELECT length(CAST(definition_json AS BLOB)), definition_json FROM automations WHERE id = ?1"
    ).map_err(|_| "Could not read pending automation definition.")?;
    let mut rows = statement
        .query([id])
        .map_err(|_| "Could not read pending automation definition.")?;
    let Some(row) = rows
        .next()
        .map_err(|_| "Could not read pending automation definition.")?
    else {
        return Ok(None);
    };
    let length: usize = row
        .get(0)
        .map_err(|_| "Invalid stored automation definition.")?;
    if length > PAGE_BYTES {
        return Err("Stored automation definition exceeds the pending page budget.".into());
    }
    let raw: String = row
        .get(1)
        .map_err(|_| "Invalid stored automation definition.")?;
    parse_automation(raw)
        .map(Some)
        .map_err(|_| "Invalid stored automation definition.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::harness::automations::{ensure_tables, new_event_run, new_run};

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        ensure_tables(&conn).unwrap();
        let automation: Automation = serde_json::from_value(serde_json::json!({
            "id": "automation-one", "name": "Task", "prompt": "Default task",
            "harness": "claude", "model": "default", "cwd": "/work/one",
            "workspaceMode": "current", "reuseSession": false, "runtimeMode": "auto",
            "scheduleKind": "hourly", "minute": 0, "time": "09:00", "dayOfWeek": 1,
            "missedRunGraceMinutes": 720, "enabled": true, "nextRunAt": 100,
            "createdAt": 1, "updatedAt": 1
        }))
        .unwrap();
        write_automation(&conn, &automation).unwrap();
        conn
    }

    fn insert(conn: &Connection, id: &str, status: &str) {
        let mut run = new_run("automation-one", "scheduled", 1, 1, "Scheduled prompt");
        run.id = id.into();
        run.status = status.into();
        write_run(conn, &run).unwrap();
    }

    #[test]
    fn preserves_event_prompt_and_never_changes_running_or_history() {
        let conn = database();
        let mut event = new_event_run(
            "automation-one",
            "github:pr:acme/web:12",
            "github",
            "pull_request_opened",
            1,
            1,
            "Exact event context",
        );
        event.id = "event-one".into();
        write_run(&conn, &event).unwrap();
        insert(&conn, "running-one", "running");
        insert(&conn, "terminal-one", "succeeded");
        let before: Vec<String> = conn
            .prepare("SELECT run_json FROM automation_runs ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        let result = page(&conn, None).unwrap();
        assert_eq!(result.runs.len(), 1);
        assert_eq!(
            result.runs[0].run.prompt.as_deref(),
            Some("Exact event context")
        );
        assert_eq!(result.runs[0].automation.prompt, "Default task");
        let after: Vec<String> = conn
            .prepare("SELECT run_json FROM automation_runs ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(before, after);
    }

    #[test]
    fn reaches_pending_beyond_history_limit_without_paging_through_terminal_runs() {
        let conn = database();
        for index in 0..120 {
            insert(&conn, &format!("run-{index:03}"), "succeeded");
        }
        insert(&conn, "run-999", "pending");
        let mut after = None;
        let mut ids = Vec::new();
        let mut pages = 0;
        loop {
            let result = page(&conn, after.as_deref()).unwrap();
            assert!(result.runs.len() <= PAGE_ROWS);
            ids.extend(result.runs.iter().map(|due| due.run.id.clone()));
            pages += 1;
            match result.next_after {
                Some(next) => {
                    assert!(after.as_ref().is_none_or(|prior| prior < &next));
                    after = Some(next);
                }
                None => break,
            }
        }
        assert_eq!(pages, 1);
        assert_eq!(ids, vec!["run-999"]);
    }

    #[test]
    fn splits_by_serialized_bytes_without_skipping_the_first_unreturned_run() {
        let conn = database();
        let mut automation = definition(&conn, "automation-one").unwrap().unwrap();
        automation.prompt = "\n".repeat(1_000_000);
        write_automation(&conn, &automation).unwrap();
        for id in ["run-one", "run-two"] {
            let mut run = new_run("automation-one", "manual", 1, 1, &"\n".repeat(1_000_000));
            run.id = id.into();
            write_run(&conn, &run).unwrap();
        }
        let first = page(&conn, None).unwrap();
        assert_eq!(first.runs.len(), 1);
        assert_eq!(first.next_after.as_deref(), Some("run-one"));
        assert!(serde_json::to_vec(&first).unwrap().len() <= PAGE_BYTES);
        let second = page(&conn, first.next_after.as_deref()).unwrap();
        assert_eq!(second.runs[0].run.id, "run-two");
        assert!(second.next_after.is_none());
    }

    #[test]
    fn rejects_bad_cursors_before_reading_storage() {
        let conn = Connection::open_in_memory().unwrap();
        for cursor in ["".to_string(), "../run".to_string(), "x".repeat(257)] {
            assert!(page(&conn, Some(&cursor)).unwrap_err().contains("cursor"));
        }
    }

    #[test]
    fn rejects_an_oversized_record_without_exposing_its_content() {
        let conn = database();
        let mut run = new_run(
            "automation-one",
            "manual",
            1,
            1,
            &"private-content".repeat(PAGE_BYTES / 10),
        );
        run.id = "run-one".into();
        write_run(&conn, &run).unwrap();
        let error = page(&conn, None).unwrap_err();
        assert!(error.contains("budget"));
        assert!(!error.contains("private-content"));
    }

    #[test]
    fn uses_the_pending_index_and_advances_across_multiple_pending_pages() {
        let conn = database();
        for index in 0..35 {
            insert(&conn, &format!("run-{index:03}"), "pending");
        }
        let query = format!("EXPLAIN QUERY PLAN SELECT id FROM automation_runs WHERE {STATUS_SQL} = 'pending' AND id > ?1 ORDER BY id LIMIT 17");
        let plan: String = conn.query_row(&query, [""], |row| row.get(3)).unwrap();
        assert!(plan.contains("automation_runs_pending_idx"), "{plan}");
        let first = page(&conn, None).unwrap();
        assert_eq!(first.runs.len(), 16);
        let second = page(&conn, first.next_after.as_deref()).unwrap();
        assert_eq!(second.runs.len(), 16);
        assert_eq!(second.runs[0].run.id, "run-016");
        let third = page(&conn, second.next_after.as_deref()).unwrap();
        assert_eq!(third.runs.len(), 3);
        assert!(third.next_after.is_none());
    }

    #[test]
    fn reports_corrupt_pending_json_without_exposing_it() {
        let conn = database();
        conn.execute("INSERT INTO automation_runs(id, automation_id, created_at, run_json) VALUES ('bad-run', 'automation-one', 1, 'private-invalid-json')", []).unwrap();
        conn.execute("DROP INDEX automation_runs_pending_idx", [])
            .unwrap();
        ensure_tables(&conn).unwrap();
        ensure_tables(&conn).unwrap();
        assert_eq!(
            page(&conn, None).unwrap_err(),
            "Invalid stored automation run."
        );
    }

    #[test]
    fn start_consumes_pending_once_and_preserves_the_event_payload() {
        let mut conn = database();
        let mut run = new_event_run(
            "automation-one",
            "github:pr:acme/web:12",
            "github",
            "pull_request_opened",
            1,
            1,
            "Exact event context",
        );
        run.id = "event-one".into();
        run.session_id = Some("session-one".into());
        run.completed_at = Some(10);
        write_run(&conn, &run).unwrap();
        let started = start(&mut conn, "event-one", "session-one", 20)
            .unwrap()
            .unwrap();
        assert_eq!(started.status, "running");
        assert_eq!(started.session_id.as_deref(), Some("session-one"));
        assert_eq!(started.started_at, Some(20));
        assert!(started.completed_at.is_none());
        assert_eq!(started.prompt, run.prompt);
        assert!(start(&mut conn, "event-one", "other-session", 30)
            .unwrap()
            .is_none());
        assert!(page(&conn, None).unwrap().runs.is_empty());
        let current: AutomationRun = serde_json::from_str(
            &conn
                .query_row(
                    "SELECT run_json FROM automation_runs WHERE id = 'event-one'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(current.session_id.as_deref(), Some("session-one"));
        assert_eq!(current.started_at, Some(20));
    }

    #[test]
    fn competing_database_connections_can_start_only_one_owner() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("automations.db");
        let seeded = database();
        let definition: String = seeded
            .query_row("SELECT definition_json FROM automations", [], |row| {
                row.get(0)
            })
            .unwrap();
        let conn = Connection::open(&path).unwrap();
        ensure_tables(&conn).unwrap();
        write_automation(&conn, &parse_automation(definition).unwrap()).unwrap();
        insert(&conn, "run-one", "pending");
        drop(conn);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = ["run-one", "run-one"]
            .into_iter()
            .map(|session| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let mut conn = Connection::open(path).unwrap();
                    conn.busy_timeout(std::time::Duration::from_secs(5))
                        .unwrap();
                    barrier.wait();
                    start(&mut conn, "run-one", session, 20).unwrap().is_some()
                })
            })
            .collect();
        let successes = handles
            .into_iter()
            .map(|handle| usize::from(handle.join().unwrap()))
            .sum::<usize>();
        assert_eq!(successes, 1);
    }

    #[test]
    fn start_refuses_terminal_missing_and_invalid_identities() {
        let mut conn = database();
        insert(&conn, "run-one", "succeeded");
        assert!(start(&mut conn, "run-one", "session-one", 20)
            .unwrap()
            .is_none());
        assert!(start(&mut conn, "absent-run", "session-one", 20)
            .unwrap()
            .is_none());
        assert!(start(&mut conn, "../run", "session-one", 20).is_err());
        assert!(start(&mut conn, "run-one", &"x".repeat(257), 20).is_err());
        insert(&conn, "pending-one", "pending");
        assert!(start(&mut conn, "pending-one", "foreign-session", 20).is_err());
        assert_eq!(page(&conn, None).unwrap().runs[0].run.id, "pending-one");
        let mut missing = new_event_run(
            "automation-one",
            "github:pr:acme/web:12",
            "github",
            "pull_request_opened",
            1,
            1,
            "",
        );
        missing.id = "missing-event".into();
        write_run(&conn, &missing).unwrap();
        assert!(start(&mut conn, "missing-event", "missing-event", 20).is_err());
    }
}
