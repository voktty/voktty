mod parse;

pub use parse::HistEntry;
use parse::{
    build_index, complete_commands, demetafy, list_entries, parse_bash, parse_fish,
    parse_powershell, parse_zsh, sort_recent, suggest,
};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

struct Index {
    entries: Vec<HistEntry>,
    path_cmds: Vec<String>,
}

#[derive(Default)]
pub struct HistoryState {
    inner: Mutex<Option<Index>>,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn history_file_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".voktty").join("history.json"))
}

fn load_persisted_history() -> Option<Vec<HistEntry>> {
    let path = history_file_path()?;
    if !path.exists() {
        return None;
    }
    let data = std::fs::read_to_string(path).ok()?;
    let mut entries: Vec<HistEntry> = serde_json::from_str(&data).ok()?;
    sort_recent(&mut entries);
    Some(entries)
}

fn save_persisted_history(entries: &[HistEntry]) {
    if let Some(path) = history_file_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let slice = if entries.len() > 5000 {
            &entries[..5000]
        } else {
            entries
        };
        if let Ok(json) = serde_json::to_string_pretty(slice) {
            let _ = std::fs::write(path, json);
        }
    }
}

fn read_histories() -> Vec<(String, i64, Option<String>)> {
    let mut all = Vec::new();
    let home = dirs::home_dir();

    if let Some(path) = zsh_histfile(home.as_ref()) {
        if let Ok(bytes) = std::fs::read(&path) {
            let content = String::from_utf8_lossy(&demetafy(&bytes)).into_owned();
            all.extend(parse_zsh(&content));
        }
    }
    if let Some(home) = home.as_ref() {
        if let Ok(content) = std::fs::read_to_string(home.join(".bash_history")) {
            all.extend(parse_bash(&content));
        }
    }
    if let Some(path) = fish_histfile(home.as_ref()) {
        if let Ok(content) = std::fs::read_to_string(&path) {
            all.extend(parse_fish(&content));
        }
    }
    if let Some(path) = powershell_histfile(home.as_ref()) {
        if let Ok(content) = std::fs::read_to_string(&path) {
            all.extend(parse_powershell(&content));
        }
    }
    all
}

fn powershell_histfile(home: Option<&PathBuf>) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let pb = PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("PowerShell")
                .join("PSReadLine")
                .join("ConsoleHost_history.txt");
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    if let Some(h) = home {
        let pb = h.join(".local/share/powershell/PSReadLine/ConsoleHost_history.txt");
        if pb.exists() {
            return Some(pb);
        }
        #[cfg(windows)]
        {
            let pb = h
                .join("AppData")
                .join("Roaming")
                .join("Microsoft")
                .join("Windows")
                .join("PowerShell")
                .join("PSReadLine")
                .join("ConsoleHost_history.txt");
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    None
}

fn zsh_histfile(home: Option<&PathBuf>) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HISTFILE") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    home.map(|h| h.join(".zsh_history"))
}

fn fish_histfile(home: Option<&PathBuf>) -> Option<PathBuf> {
    if let Ok(data) = std::env::var("XDG_DATA_HOME") {
        let pb = PathBuf::from(data).join("fish/fish_history");
        if pb.exists() {
            return Some(pb);
        }
    }
    home.map(|h| h.join(".local/share/fish/fish_history"))
}

fn scan_path() -> Vec<String> {
    use std::collections::HashSet;
    let mut set: HashSet<String> = HashSet::new();
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let Ok(rd) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in rd.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                if is_executable(&entry) {
                    if let Some(name) = entry.file_name().to_str() {
                        set.insert(name.to_string());
                    }
                }
            }
        }
    }
    let mut v: Vec<String> = set.into_iter().collect();
    v.sort();
    v
}

#[cfg(unix)]
fn is_executable(entry: &std::fs::DirEntry) -> bool {
    use std::os::unix::fs::PermissionsExt;
    entry
        .metadata()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(entry: &std::fs::DirEntry) -> bool {
    match entry.file_name().to_str() {
        Some(name) => {
            let lower = name.to_ascii_lowercase();
            [".exe", ".cmd", ".bat", ".com", ".ps1"]
                .iter()
                .any(|e| lower.ends_with(e))
        }
        None => false,
    }
}

fn ensure(state: &HistoryState) -> std::sync::MutexGuard<'_, Option<Index>> {
    let mut guard = state.inner.lock().unwrap();
    if guard.is_none() {
        let entries = if let Some(saved) = load_persisted_history() {
            saved
        } else {
            let bootstrapped = build_index(read_histories());
            save_persisted_history(&bootstrapped);
            bootstrapped
        };

        *guard = Some(Index {
            entries,
            path_cmds: scan_path(),
        });
    }
    guard
}

#[tauri::command]
pub fn history_suggest(
    state: tauri::State<'_, HistoryState>,
    line: String,
    shell_type: Option<String>,
) -> Option<String> {
    let guard = ensure(&state);
    suggest(&guard.as_ref()?.entries, &line, shell_type.as_deref())
}

#[tauri::command]
pub fn history_commands(
    state: tauri::State<'_, HistoryState>,
    prefix: String,
    limit: Option<usize>,
) -> Vec<String> {
    let guard = ensure(&state);
    match guard.as_ref() {
        Some(idx) => complete_commands(&idx.entries, &idx.path_cmds, &prefix, limit.unwrap_or(50)),
        None => Vec::new(),
    }
}

#[tauri::command]
pub fn history_list(
    state: tauri::State<'_, HistoryState>,
    query: String,
    shell_type: Option<String>,
    limit: Option<usize>,
) -> Vec<HistEntry> {
    let guard = ensure(&state);
    match guard.as_ref() {
        Some(idx) => list_entries(
            &idx.entries,
            &query,
            shell_type.as_deref(),
            limit.unwrap_or(200),
        ),
        None => Vec::new(),
    }
}

#[tauri::command]
pub fn history_record(
    state: tauri::State<'_, HistoryState>,
    command: String,
    shell_type: Option<String>,
    category: Option<String>,
) {
    let cmd = command.trim();
    if cmd.is_empty() {
        return;
    }
    let mut guard = ensure(&state);
    if let Some(idx) = guard.as_mut() {
        let n = now();
        match idx.entries.iter_mut().find(|e| e.cmd == cmd) {
            Some(e) => {
                e.count += 1;
                e.last = n;
                if e.shell_type.is_none() && shell_type.is_some() {
                    e.shell_type = shell_type;
                }
                if e.category.is_none() && category.is_some() {
                    e.category = category;
                }
            }
            None => idx.entries.push(HistEntry {
                cmd: cmd.to_string(),
                count: 1,
                last: n,
                shell_type,
                category,
            }),
        }
        sort_recent(&mut idx.entries);
        save_persisted_history(&idx.entries);
    }
}

#[tauri::command]
pub fn history_export(state: tauri::State<'_, HistoryState>) -> Result<String, String> {
    let guard = ensure(&state);
    match guard.as_ref() {
        Some(idx) => serde_json::to_string_pretty(&idx.entries).map_err(|e| e.to_string()),
        None => Ok("[]".to_string()),
    }
}

#[tauri::command]
pub fn history_import(
    state: tauri::State<'_, HistoryState>,
    json_data: String,
) -> Result<usize, String> {
    let imported: Vec<HistEntry> =
        serde_json::from_str(&json_data).map_err(|e| format!("Formato JSON inválido: {e}"))?;
    if imported.is_empty() {
        return Ok(0);
    }

    let mut guard = ensure(&state);
    let mut imported_count = 0;
    if let Some(idx) = guard.as_mut() {
        for item in imported {
            let cmd = item.cmd.trim();
            if cmd.is_empty() {
                continue;
            }
            match idx.entries.iter_mut().find(|e| e.cmd == cmd) {
                Some(existing) => {
                    existing.count = existing.count.max(item.count);
                    existing.last = existing.last.max(item.last);
                    if existing.shell_type.is_none() {
                        existing.shell_type = item.shell_type;
                    }
                    if existing.category.is_none() {
                        existing.category = item.category;
                    }
                }
                None => {
                    idx.entries.push(item);
                    imported_count += 1;
                }
            }
        }
        sort_recent(&mut idx.entries);
        save_persisted_history(&idx.entries);
    }
    Ok(imported_count)
}

#[tauri::command]
pub fn history_delete_entry(state: tauri::State<'_, HistoryState>, command: String) -> bool {
    let cmd = command.trim();
    if cmd.is_empty() {
        return false;
    }
    let mut guard = ensure(&state);
    if let Some(idx) = guard.as_mut() {
        let initial_len = idx.entries.len();
        idx.entries.retain(|e| e.cmd != cmd);
        if idx.entries.len() != initial_len {
            save_persisted_history(&idx.entries);
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn history_clear(state: tauri::State<'_, HistoryState>, shell_type: Option<String>) -> usize {
    let mut guard = ensure(&state);
    if let Some(idx) = guard.as_mut() {
        let initial_len = idx.entries.len();
        if let Some(st) = shell_type.filter(|s| !s.is_empty() && s != "all") {
            let norm = parse::normalize_shell_type(&st);
            idx.entries.retain(|e| {
                e.shell_type
                    .as_deref()
                    .map(parse::normalize_shell_type)
                    .unwrap_or("generic")
                    != norm
            });
        } else {
            idx.entries.clear();
        }
        let cleared = initial_len - idx.entries.len();
        save_persisted_history(&idx.entries);
        return cleared;
    }
    0
}
