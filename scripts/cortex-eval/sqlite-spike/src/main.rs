use std::env;
use std::path::Path;
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant};

#[cfg(feature = "sqlite")]
use rusqlite::{params, Connection};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "baseline".to_string());

    match command.as_str() {
        "platform" => platform_probe(),
        "baseline" => baseline_probe(),
        "launch" => {
            let executable = args.next().ok_or("launch requires an executable")?;
            let iterations = parse_usize(args.next().as_deref(), 20)?;
            let child_args: Vec<String> = args.collect();
            launch_probe(Path::new(&executable), iterations, &child_args)
        }
        #[cfg(feature = "sqlite")]
        "prepare" => {
            let path = args.next().ok_or("prepare requires a database path")?;
            prepare_database(Path::new(&path))
        }
        #[cfg(feature = "sqlite")]
        "ready-sqlite" => {
            let path = args.next().ok_or("ready-sqlite requires a database path")?;
            ready_sqlite_probe(Path::new(&path))
        }
        #[cfg(feature = "sqlite")]
        "sqlite" => {
            let records = parse_usize(args.next().as_deref(), 10_000)?;
            sqlite_probe(records, false)
        }
        #[cfg(feature = "sqlite")]
        "fts5" => {
            let records = parse_usize(args.next().as_deref(), 10_000)?;
            sqlite_probe(records, true)
        }
        _ => Err(format!("unknown command: {command}")),
    }
}

fn platform_probe() -> Result<(), String> {
    println!(
        "{{\"schema\":1,\"mode\":\"platform\",\"os\":\"{}\",\"arch\":\"{}\",\"family\":\"{}\",\"pointerWidth\":{}}}",
        env::consts::OS,
        env::consts::ARCH,
        env::consts::FAMILY,
        usize::BITS
    );
    Ok(())
}

fn parse_usize(value: Option<&str>, default: usize) -> Result<usize, String> {
    value
        .map(|candidate| {
            candidate
                .parse::<usize>()
                .map_err(|error| error.to_string())
        })
        .unwrap_or(Ok(default))
}

fn rss_bytes() -> usize {
    memory_stats::memory_stats()
        .map(|stats| stats.physical_mem)
        .unwrap_or_default()
}

fn baseline_probe() -> Result<(), String> {
    println!(
        "{{\"schema\":1,\"mode\":\"baseline\",\"rssBytes\":{},\"pid\":{}}}",
        rss_bytes(),
        std::process::id()
    );
    Ok(())
}

fn launch_probe(executable: &Path, iterations: usize, child_args: &[String]) -> Result<(), String> {
    if iterations == 0 {
        return Err("launch iterations must be greater than zero".to_string());
    }
    let target = match child_args.first().map(String::as_str) {
        Some("baseline") => "baseline",
        Some("ready-sqlite") => "ready-sqlite",
        _ => return Err("launch target must be baseline or ready-sqlite".to_string()),
    };

    let mut samples = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let started = Instant::now();
        let status = Command::new(executable)
            .args(child_args)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .map_err(|error| format!("failed to launch {}: {error}", executable.display()))?;
        if !status.success() {
            return Err(format!("child exited with {status}"));
        }
        samples.push(started.elapsed());
    }

    samples.sort_unstable();
    println!(
        "{{\"schema\":1,\"mode\":\"launch\",\"target\":\"{}\",\"iterations\":{},\"p50Micros\":{},\"p95Micros\":{}}}",
        target,
        iterations,
        percentile(&samples, 50).as_micros(),
        percentile(&samples, 95).as_micros()
    );
    Ok(())
}

fn percentile(samples: &[Duration], percentile: usize) -> Duration {
    let index = ((samples.len() - 1) * percentile).div_ceil(100);
    samples[index]
}

#[cfg(feature = "sqlite")]
fn open_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=5000;",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

#[cfg(feature = "sqlite")]
fn create_schema(connection: &Connection, with_fts5: bool) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS memories (
                 id INTEGER PRIMARY KEY,
                 workspace_id TEXT NOT NULL,
                 agent_id TEXT NOT NULL,
                 content TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_memories_scope
                 ON memories(workspace_id, agent_id, created_at DESC);",
        )
        .map_err(|error| error.to_string())?;

    if with_fts5 {
        connection
            .execute_batch(
                "CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                     content,
                     content='memories',
                     content_rowid='id',
                     tokenize='unicode61'
                 );
                 CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
                     INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
                 END;
                 CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
                     INSERT INTO memories_fts(memories_fts, rowid, content)
                     VALUES ('delete', old.id, old.content);
                 END;
                 CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
                     INSERT INTO memories_fts(memories_fts, rowid, content)
                     VALUES ('delete', old.id, old.content);
                     INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
                 END;",
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(feature = "sqlite")]
fn prepare_database(path: &Path) -> Result<(), String> {
    let connection = open_database(path)?;
    create_schema(&connection, true)?;
    println!("{{\"schema\":1,\"mode\":\"prepare\",\"fts5\":true}}");
    Ok(())
}

#[cfg(feature = "sqlite")]
fn ready_sqlite_probe(path: &Path) -> Result<(), String> {
    let started = Instant::now();
    let connection = open_database(path)?;
    let _: i64 = connection
        .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    println!(
        "{{\"schema\":1,\"mode\":\"ready-sqlite\",\"readyMicros\":{},\"rssBytes\":{}}}",
        started.elapsed().as_micros(),
        rss_bytes()
    );
    Ok(())
}

#[cfg(feature = "sqlite")]
fn sqlite_probe(records: usize, with_fts5: bool) -> Result<(), String> {
    let unique = format!(
        "voktty-cortex-sqlite-{}-{}.db",
        std::process::id(),
        if with_fts5 { "fts5" } else { "minimal" }
    );
    let path = env::temp_dir().join(unique);
    let _ = std::fs::remove_file(&path);

    let open_started = Instant::now();
    let mut connection = open_database(&path)?;
    create_schema(&connection, with_fts5)?;
    let open_micros = open_started.elapsed().as_micros();

    let insert_started = Instant::now();
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    {
        let mut statement = transaction
            .prepare_cached(
                "INSERT INTO memories(workspace_id, agent_id, content, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|error| error.to_string())?;
        for index in 0..records {
            let marker = if index % 100 == 0 {
                "needle"
            } else {
                "ordinary"
            };
            let content = format!("{marker} memory record {index} for portable retrieval");
            statement
                .execute(params!["workspace-a", "agent-a", content, index as i64])
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    let insert_micros = insert_started.elapsed().as_micros();

    let first_started = Instant::now();
    let first_count: i64 = if with_fts5 {
        connection
            .query_row(
                "SELECT COUNT(*) FROM memories_fts WHERE memories_fts MATCH 'needle'",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?
    } else {
        connection
            .query_row(
                "SELECT COUNT(*) FROM memories WHERE workspace_id=?1 AND agent_id=?2",
                params!["workspace-a", "agent-a"],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?
    };
    let first_query_micros = first_started.elapsed().as_micros();

    let mut query_samples = Vec::with_capacity(100);
    for index in 0..100 {
        let started = Instant::now();
        if with_fts5 {
            let term = if index % 2 == 0 { "needle" } else { "portable" };
            let mut statement = connection
                .prepare_cached(
                    "SELECT rowid FROM memories_fts
                     WHERE memories_fts MATCH ?1 ORDER BY rank LIMIT 20",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([term], |row| row.get::<_, i64>(0))
                .map_err(|error| error.to_string())?;
            for row in rows {
                row.map_err(|error| error.to_string())?;
            }
        } else {
            let _: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM memories WHERE workspace_id=?1 AND agent_id=?2",
                    params!["workspace-a", "agent-a"],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
        }
        query_samples.push(started.elapsed());
    }
    query_samples.sort_unstable();

    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| error.to_string())?;
    let database_bytes = std::fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    let rss = rss_bytes();
    drop(connection);
    remove_database_files(&path);

    println!(
        "{{\"schema\":1,\"mode\":\"{}\",\"records\":{},\"openMicros\":{},\"insertMicros\":{},\"firstQueryMicros\":{},\"queryP50Micros\":{},\"queryP95Micros\":{},\"resultCount\":{},\"rssBytes\":{},\"databaseBytes\":{}}}",
        if with_fts5 { "fts5" } else { "sqlite" },
        records,
        open_micros,
        insert_micros,
        first_query_micros,
        percentile(&query_samples, 50).as_micros(),
        percentile(&query_samples, 95).as_micros(),
        first_count,
        rss,
        database_bytes
    );
    Ok(())
}

#[cfg(feature = "sqlite")]
fn remove_database_files(path: &Path) {
    let _ = std::fs::remove_file(path);
    let path = path.to_string_lossy();
    let _ = std::fs::remove_file(format!("{path}-wal"));
    let _ = std::fs::remove_file(format!("{path}-shm"));
}
