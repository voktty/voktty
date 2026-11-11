use super::*;
use serde_json::json;
use std::io::Write;

const ROOT: &str = "/srv/team/webserver";

fn write_session(home: &Path, pid: u32, value: Value) {
    let dir = home.join("sessions");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(format!("{pid}.json")), value.to_string()).unwrap();
}

fn transcript(home: &Path, cwd: &str, session: &str, rows: &[Value]) -> PathBuf {
    let dir = home.join("projects").join(project_dir_name(cwd));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("{session}.jsonl"));
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .unwrap();
    for row in rows {
        writeln!(file, "{row}").unwrap();
    }
    path
}

fn send(ts: &str, uuid: &str, to: &str, summary: &str, message: &str) -> Value {
    json!({
        "type": "assistant", "uuid": uuid, "timestamp": ts,
        "message": {"content": [
            {"type": "thinking", "thinking": "hidden"},
            {"type": "tool_use", "id": format!("tu-{uuid}"), "name": "SendMessage",
             "input": {"to": to, "summary": summary, "message": message}}
        ]}
    })
}

fn recv(ts: &str, uuid: &str, from_pid: u32, from_name: &str, text: &str) -> Value {
    json!({
        "type": "user", "uuid": uuid, "timestamp": ts, "isMeta": true,
        "origin": {"kind": "peer"},
        "message": {"content": format!(
            "Another Claude session sent a message: <cross-session-message from=\"uds:/run/user/0/cc-socks/{from_pid}.sock\" from-name=\"{from_name}\" from-mode=\"bypass\">\n{text}\n</cross-session-message>"
        )}
    })
}

fn note(ts: &str, uuid: &str, text: &str) -> Value {
    json!({"type": "assistant", "uuid": uuid, "timestamp": ts,
        "message": {"content": [{"type": "text", "text": text}]}})
}

fn human(ts: &str, uuid: &str, text: &str) -> Value {
    json!({"type": "user", "uuid": uuid, "timestamp": ts, "origin": {"kind": "human"},
        "message": {"content": text}})
}

fn request(cursor: Option<FeedCursor>) -> FeedRequest {
    FeedRequest {
        root: ROOT.to_string(),
        since_ms: 0,
        cursor,
    }
}

#[test]
fn project_dir_name_matches_claude_code() {
    assert_eq!(
        project_dir_name("/mnt/DATOS1TB/proyectos/proyectos-composers/docker_projects/webserver"),
        "-mnt-DATOS1TB-proyectos-proyectos-composers-docker-projects-webserver"
    );
    assert_eq!(
        project_dir_name("C:\\proyectos\\proyectos-composers\\terax-ai"),
        "C--proyectos-proyectos-composers-terax-ai"
    );
    assert_eq!(
        project_dir_name("/srv/team/webserver/"),
        "-srv-team-webserver"
    );
}

#[test]
fn reads_a_three_agent_thread_with_notes_and_human_prompts() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    write_session(
        home,
        100,
        json!({"pid": 100, "sessionId": "orch", "name": "orquestador",
        "cwd": ROOT, "status": "idle", "tmux": "forgenex:@1.%1", "version": "2.1.322"}),
    );
    transcript(
        home,
        ROOT,
        "orch",
        &[
            human(
                "2026-11-11T11:50:00.000Z",
                "h1",
                "vale, sigue en automático",
            ),
            send(
                "2026-11-11T11:51:10.000Z",
                "o1",
                "panel-crm",
                "Encargo CRM 279",
                "Encargo nuevo: CRM 279",
            ),
            recv(
                "2026-11-11T12:42:04.500Z",
                "o2",
                300,
                "panel-crm",
                "CRM 279 lista para nodo",
            ),
            note(
                "2026-11-11T12:53:50.000Z",
                "o3",
                "Se la he pasado a nodo para las pruebas.",
            ),
            send(
                "2026-11-11T12:53:41.000Z",
                "o4",
                "uds:/run/user/0/cc-socks/200.sock",
                "",
                "Encargo: probar 279",
            ),
        ],
    );
    // panel-crm ran in a worktree next to the project and has already exited.
    transcript(
        home,
        "/srv/team/webserver-crm-279",
        "panel",
        &[
            recv(
                "2026-11-11T11:51:10.300Z",
                "p1",
                100,
                "orquestador",
                "Encargo nuevo: CRM 279",
            ),
            send(
                "2026-11-11T12:42:04.000Z",
                "p2",
                "orquestador [09434a]",
                "279 lista",
                "CRM 279 lista para nodo",
            ),
        ],
    );

    let feed = poll(home, &request(None));
    assert!(feed.available);
    assert_eq!(feed.unrecognized, 0);
    let kinds: Vec<_> = feed
        .records
        .iter()
        .map(|r| (r.kind, r.session_id.as_str(), r.peer.as_str()))
        .collect();
    assert_eq!(
        kinds,
        vec![
            (RecordKind::Human, "orch", ""),
            (RecordKind::Send, "orch", "panel-crm"),
            (RecordKind::Recv, "panel", "orquestador"),
            (RecordKind::Send, "panel", "orquestador"),
            (RecordKind::Recv, "orch", "panel-crm"),
            (
                RecordKind::Send,
                "orch",
                "uds:/run/user/0/cc-socks/200.sock"
            ),
            (RecordKind::Note, "orch", ""),
        ]
    );
    assert_eq!(feed.records[5].peer_pid, Some(200));
    assert_eq!(feed.records[5].summary, None);
    assert_eq!(feed.records[4].peer_pid, Some(300));
    assert_eq!(feed.sessions.len(), 1);
    assert_eq!(feed.sessions[0].name.as_deref(), Some("orquestador"));
    assert_eq!(feed.transcripts.len(), 2);
}

#[test]
fn follows_a_live_session_outside_the_project_that_talks_to_it() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    write_session(
        home,
        200,
        json!({"sessionId": "nodo", "name": "nodo", "cwd": "/srv/team", "status": "busy"}),
    );
    write_session(
        home,
        999,
        json!({"sessionId": "other", "name": "unrelated", "cwd": "/home/me/else"}),
    );
    transcript(
        home,
        ROOT,
        "orch",
        &[send(
            "2026-11-11T12:53:41.000Z",
            "o1",
            "nodo",
            "Encargo",
            "probar 279",
        )],
    );
    transcript(
        home,
        "/srv/team",
        "nodo",
        &[recv(
            "2026-11-11T12:53:41.200Z",
            "n1",
            100,
            "orquestador",
            "probar 279",
        )],
    );
    transcript(
        home,
        "/home/me/else",
        "other",
        &[note("2026-11-11T12:00:00.000Z", "x", "private")],
    );

    let feed = poll(home, &request(None));
    let sessions: Vec<_> = feed.records.iter().map(|r| r.session_id.as_str()).collect();
    assert_eq!(sessions, vec!["orch", "nodo"]);
    let names: Vec<_> = feed
        .sessions
        .iter()
        .filter_map(|s| s.name.as_deref())
        .collect();
    assert_eq!(names, vec!["nodo"]);
    // The cursor keeps following nodo on the next poll.
    assert!(feed.cursor.files.keys().any(|k| k.ends_with("/nodo.jsonl")));
}

#[test]
fn resumes_from_the_cursor_without_duplicates() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    let path = transcript(
        home,
        ROOT,
        "orch",
        &[note("2026-11-11T10:00:00.000Z", "a", "uno")],
    );
    let first = poll(home, &request(None));
    assert_eq!(first.records.len(), 1);

    let again = poll(home, &request(Some(first.cursor.clone())));
    assert!(again.records.is_empty());

    // A partially written line is not consumed until it is complete.
    let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
    write!(file, "{}", note("2026-11-11T10:01:00.000Z", "b", "dos")).unwrap();
    let partial = poll(home, &request(Some(first.cursor.clone())));
    assert!(partial.records.is_empty());
    writeln!(file).unwrap();
    let complete = poll(home, &request(Some(partial.cursor)));
    assert_eq!(complete.records.len(), 1);
    assert_eq!(complete.records[0].text, "dos");
}

#[test]
fn a_rewritten_transcript_restarts_from_the_beginning() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    let path = transcript(
        home,
        ROOT,
        "orch",
        &[note("2026-11-11T10:00:00.000Z", "a", "uno")],
    );
    let mut cursor = poll(home, &request(None)).cursor;
    let key = cursor.files.keys().next().unwrap().clone();
    cursor.files.insert(key, 10_000_000);
    fs::write(
        &path,
        format!("{}\n", note("2026-11-11T11:00:00.000Z", "z", "nuevo")),
    )
    .unwrap();
    let feed = poll(home, &request(Some(cursor)));
    assert_eq!(feed.records.len(), 1);
    assert_eq!(feed.records[0].text, "nuevo");
}

#[test]
fn bad_rows_slash_commands_sidechains_and_tool_results_are_skipped() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    let dir = home.join("projects").join(project_dir_name(ROOT));
    fs::create_dir_all(&dir).unwrap();
    let rows = [
        "{not json but mentions \"SendMessage\"".to_string(),
        human("2026-11-11T10:00:00.000Z", "c", "<command-name>/model</command-name>").to_string(),
        json!({"type":"assistant","isSidechain":true,"timestamp":"2026-11-11T10:00:01.000Z",
               "message":{"content":[{"type":"text","text":"subagent"}]}})
        .to_string(),
        json!({"type":"user","timestamp":"2026-11-11T10:00:02.000Z",
               "message":{"content":[{"type":"tool_result","content":"ok","tool_use_id":"x"}]}})
        .to_string(),
        json!({"type":"user","timestamp":"2026-11-11T10:00:03.000Z","origin":{"kind":"peer"},
               "message":{"content":"<cross-session-message from=\"uds:/x/1.sock\">no name</cross-session-message>"}})
        .to_string(),
        human("2026-11-11T10:00:04.000Z", "ok", "manda el veredicto al orquestador").to_string(),
    ];
    fs::write(dir.join("orch.jsonl"), rows.join("\n") + "\n").unwrap();
    let feed = poll(home, &request(None));
    assert_eq!(feed.unrecognized, 2);
    assert_eq!(feed.records.len(), 1);
    assert_eq!(feed.records[0].kind, RecordKind::Human);
}

#[test]
fn never_reads_messaging_keys_or_unrelated_files() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    let sessions = home.join("sessions");
    fs::create_dir_all(&sessions).unwrap();
    fs::write(sessions.join("100.a29f.key"), "SECRET").unwrap();
    fs::write(
        sessions.join("notes.json"),
        json!({"sessionId": "x", "name": "fake"}).to_string(),
    )
    .unwrap();
    write_session(
        home,
        100,
        json!({"sessionId": "orch", "name": "orquestador", "cwd": ROOT}),
    );
    let live = read_live_sessions(home);
    assert_eq!(live.len(), 1);
    assert_eq!(live[0].name.as_deref(), Some("orquestador"));

    // A cursor cannot point outside the projects folder.
    let mut cursor = FeedCursor::default();
    cursor
        .files
        .insert("../sessions/100.a29f.key".to_string(), 0);
    cursor.files.insert("x/../../secret.jsonl".to_string(), 0);
    let feed = poll(home, &request(Some(cursor)));
    assert!(feed.records.is_empty());
    assert!(feed.cursor.files.is_empty());
}

#[cfg(unix)]
#[test]
fn symlinked_transcripts_are_not_followed() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    let outside = home.join("outside.jsonl");
    fs::write(
        &outside,
        format!("{}\n", note("2026-11-11T10:00:00.000Z", "a", "leak")),
    )
    .unwrap();
    let dir = home.join("projects").join(project_dir_name(ROOT));
    fs::create_dir_all(&dir).unwrap();
    std::os::unix::fs::symlink(&outside, dir.join("link.jsonl")).unwrap();
    assert!(poll(home, &request(None)).records.is_empty());
}

#[test]
fn since_filters_old_records_and_long_text_is_truncated() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    let long = "x".repeat(MAX_TEXT_CHARS + 10);
    transcript(
        home,
        ROOT,
        "orch",
        &[
            note("2026-11-10T10:00:00.000Z", "old", "ayer"),
            note("2026-11-11T10:00:00.000Z", "new", &long),
        ],
    );
    let since = record_ms("2026-11-11T00:00:00.000Z").unwrap();
    let feed = poll(
        home,
        &FeedRequest {
            root: ROOT.into(),
            since_ms: since,
            cursor: None,
        },
    );
    assert_eq!(feed.records.len(), 1);
    assert!(feed.records[0].truncated);
    assert_eq!(feed.records[0].text.chars().count(), MAX_TEXT_CHARS);
}

#[test]
fn record_ms_parses_claude_timestamps() {
    assert_eq!(record_ms("1970-01-01T00:00:01.500Z"), Some(1_500));
    assert_eq!(
        record_ms("2026-11-11T12:53:41.123Z"),
        Some(1_794_401_621_123)
    );
    assert_eq!(record_ms("nope"), None);
}

#[test]
fn missing_claude_home_is_reported_not_an_error() {
    let feed = poll(Path::new("/definitely/not/here/.claude"), &request(None));
    assert!(!feed.available);
    assert!(feed.records.is_empty());
}

#[test]
fn recipient_and_socket_helpers() {
    assert_eq!(clean_recipient("orquestador [09434a]"), "orquestador");
    assert_eq!(clean_recipient("team [lead]"), "team [lead]");
    assert_eq!(
        socket_pid("uds:/run/user/0/cc-socks/2607137.sock"),
        Some(2607137)
    );
    assert_eq!(socket_pid("nodo"), None);
}
