use std::path::Path;
use std::time::UNIX_EPOCH;
use std::{fs, io::Write};

use serde::Serialize;
use tauri::Emitter;
use tempfile::NamedTempFile;

use crate::modules::fs::{blocking_fs, is_network_path};
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
/// Ceiling for explicit "open anyway"; mirrored as FORCE_READ_LIMIT in useDocument.ts.
const FORCE_MAX_READ_BYTES: u64 = 50 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
        mtime: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

pub(super) fn mtime_millis(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn fs_pick_file(default_path: Option<String>) -> Result<Option<String>, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let mut dialog = rfd::AsyncFileDialog::new();
        if let Some(ref p) = default_path {
            dialog = dialog.set_directory(p);
        }
        let handle = dialog.pick_file().await;
        Ok(handle.map(|h| h.path().to_string_lossy().into_owned()))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = default_path;
        Ok(None)
    }
}

#[tauri::command]
pub async fn fs_pick_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let mut dialog = rfd::AsyncFileDialog::new();
        if let Some(ref p) = default_path {
            dialog = dialog.set_directory(p);
        }
        let handle = dialog.pick_folder().await;
        Ok(handle.map(|h| h.path().to_string_lossy().into_owned()))
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = default_path;
        Ok(None)
    }
}

#[tauri::command]
pub fn fs_is_network_path(path: String, workspace: Option<WorkspaceEnv>) -> bool {
    let workspace = WorkspaceEnv::from_option(workspace);
    is_network_path(&resolve_path(&path, &workspace))
}

#[tauri::command]
pub async fn fs_read_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
    force: Option<bool>,
) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    let network_path = is_network_path(&target);
    blocking_fs(network_path, move || {
        read_file_sync(&target, force.unwrap_or(false))
    })
    .await
}

fn read_file_sync(p: &Path, force: bool) -> Result<ReadResult, String> {
    let meta = std::fs::metadata(p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    let limit = if force {
        FORCE_MAX_READ_BYTES
    } else {
        MAX_READ_BYTES
    };
    if size > limit {
        return Ok(ReadResult::TooLarge { size, limit });
    }

    let bytes = std::fs::read(p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    match decode_text_bytes(Some(p), &bytes, force) {
        Some(content) => Ok(ReadResult::Text {
            content,
            size,
            mtime: mtime_millis(&meta),
        }),
        None => Ok(ReadResult::Binary { size }),
    }
}

pub(crate) fn is_known_binary_extension(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "bin"
            | "exe"
            | "dll"
            | "so"
            | "dylib"
            | "obj"
            | "o"
            | "a"
            | "lib"
            | "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "ico"
            | "bmp"
            | "tiff"
            | "psd"
            | "pdf"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "zip"
            | "tar"
            | "gz"
            | "tgz"
            | "bz2"
            | "7z"
            | "rar"
            | "xz"
            | "zst"
            | "wasm"
            | "class"
            | "pyc"
            | "pyo"
            | "jar"
            | "war"
            | "ear"
            | "mp3"
            | "mp4"
            | "mkv"
            | "avi"
            | "mov"
            | "wav"
            | "flac"
            | "ogg"
            | "iso"
            | "img"
            | "dmg"
            | "deb"
            | "rpm"
            | "msi"
            | "dat"
            | "db"
            | "sqlite"
            | "sqlite3"
    )
}

pub(crate) fn is_known_text_extension(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "txt"
            | "ini"
            | "cfg"
            | "conf"
            | "config"
            | "properties"
            | "inf"
            | "reg"
            | "env"
            | "editorconfig"
            | "gitconfig"
            | "npmrc"
            | "md"
            | "markdown"
            | "mdx"
            | "json"
            | "jsonc"
            | "csv"
            | "tsv"
            | "log"
            | "xml"
            | "yaml"
            | "yml"
            | "toml"
            | "js"
            | "mjs"
            | "cjs"
            | "jsx"
            | "ts"
            | "tsx"
            | "mts"
            | "cts"
            | "html"
            | "htm"
            | "css"
            | "scss"
            | "sass"
            | "less"
            | "vue"
            | "svelte"
            | "py"
            | "pyw"
            | "rb"
            | "php"
            | "go"
            | "rs"
            | "swift"
            | "dart"
            | "lua"
            | "c"
            | "h"
            | "cpp"
            | "cc"
            | "cxx"
            | "hpp"
            | "hh"
            | "hxx"
            | "cs"
            | "java"
            | "kt"
            | "kts"
            | "gradle"
            | "groovy"
            | "scala"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "bat"
            | "cmd"
            | "ps1"
            | "psm1"
            | "psd1"
            | "sql"
            | "graphql"
            | "gql"
            | "proto"
            | "diff"
            | "patch"
            | "svg"
    )
}

pub(crate) fn is_known_text_filename(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "license"
            | "licence"
            | "readme"
            | "changelog"
            | "dockerfile"
            | "makefile"
            | "gemfile"
            | "rakefile"
            | "procfile"
            | "vagrantfile"
            | "cmakelists.txt"
            | ".gitignore"
            | ".gitattributes"
            | ".gitconfig"
            | ".gitmodules"
            | ".editorconfig"
            | ".env"
            | ".npmrc"
            | ".eslintrc"
            | ".prettierrc"
            | ".babelrc"
    )
}

pub(crate) fn is_known_text_path(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if is_known_text_filename(name) {
            return true;
        }
    }
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        return is_known_text_extension(ext);
    }
    false
}

pub(crate) fn decode_windows_1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| match b {
            0x80 => '€',
            0x82 => '‚',
            0x83 => 'ƒ',
            0x84 => '„',
            0x85 => '…',
            0x86 => '†',
            0x87 => '‡',
            0x88 => 'ˆ',
            0x89 => '‰',
            0x8A => 'Š',
            0x8B => '‹',
            0x8C => 'Œ',
            0x8E => 'Ž',
            0x91 => '‘',
            0x92 => '’',
            0x93 => '“',
            0x94 => '”',
            0x95 => '•',
            0x96 => '–',
            0x97 => '—',
            0x98 => '˜',
            0x99 => '™',
            0x9A => 'š',
            0x9B => '›',
            0x9C => 'œ',
            0x9E => 'ž',
            0x9F => 'Ÿ',
            _ => b as char,
        })
        .collect()
}

pub(crate) fn decode_utf16_le(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 {
        return None;
    }
    let u16s: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    char::decode_utf16(u16s)
        .collect::<Result<String, _>>()
        .ok()
}

pub(crate) fn decode_utf16_be(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 {
        return None;
    }
    let u16s: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect();
    char::decode_utf16(u16s)
        .collect::<Result<String, _>>()
        .ok()
}

pub(crate) fn is_likely_text(s: &str) -> bool {
    if s.is_empty() {
        return true;
    }
    let mut printable_or_ws = 0usize;
    let mut control = 0usize;
    for c in s.chars() {
        if c == '\0' {
            return false;
        }
        if c == '\t' || c == '\n' || c == '\r' || (c >= ' ' && c != '\u{7F}') {
            printable_or_ws += 1;
        } else {
            control += 1;
        }
    }
    let total = printable_or_ws + control;
    if total == 0 {
        return true;
    }
    (printable_or_ws * 100 / total) >= 95 && (control * 100 / total) <= 1
}

pub(crate) fn looks_like_utf16_le(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    let sample_len = bytes.len().min(1024);
    let sample = &bytes[..sample_len];
    let pairs = sample.len() / 2;
    if pairs == 0 {
        return false;
    }
    let mut zero_odd = 0usize;
    let mut printable_even = 0usize;
    for chunk in sample.as_chunks::<2>().0 {
        if chunk[1] == 0 {
            zero_odd += 1;
        }
        if chunk[0] == b'\t'
            || chunk[0] == b'\n'
            || chunk[0] == b'\r'
            || (chunk[0] >= b' ' && chunk[0] <= 126)
        {
            printable_even += 1;
        }
    }
    (zero_odd * 100 / pairs) >= 70 && (printable_even * 100 / pairs) >= 60
}

pub(crate) fn looks_like_utf16_be(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    let sample_len = bytes.len().min(1024);
    let sample = &bytes[..sample_len];
    let pairs = sample.len() / 2;
    if pairs == 0 {
        return false;
    }
    let mut zero_even = 0usize;
    let mut printable_odd = 0usize;
    for chunk in sample.as_chunks::<2>().0 {
        if chunk[0] == 0 {
            zero_even += 1;
        }
        if chunk[1] == b'\t'
            || chunk[1] == b'\n'
            || chunk[1] == b'\r'
            || (chunk[1] >= b' ' && chunk[1] <= 126)
        {
            printable_odd += 1;
        }
    }
    (zero_even * 100 / pairs) >= 70 && (printable_odd * 100 / pairs) >= 60
}

pub(crate) fn trim_trailing_nulls(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1] == 0 {
        end -= 1;
    }
    &bytes[..end]
}

pub(crate) fn looks_like_latin1_text(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    let sample_len = bytes.len().min(4096);
    let sample = &bytes[..sample_len];
    let mut printable_or_ws = 0usize;
    let mut control = 0usize;
    for &b in sample {
        if b == 0 {
            return false;
        }
        if b == b'\t' || b == b'\n' || b == b'\r' || (b >= b' ' && b != 0x7F) {
            printable_or_ws += 1;
        } else {
            control += 1;
        }
    }
    control == 0 && (printable_or_ws * 100 / sample.len()) >= 85
}

pub(crate) fn decode_text_bytes(
    path: Option<&Path>,
    bytes: &[u8],
    force: bool,
) -> Option<String> {
    if bytes.is_empty() {
        return Some(String::new());
    }

    if force {
        if bytes.starts_with(&[0xFF, 0xFE]) {
            let u16s: Vec<u16> = bytes[2..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            return Some(String::from_utf16_lossy(&u16s));
        }
        if bytes.starts_with(&[0xFE, 0xFF]) {
            let u16s: Vec<u16> = bytes[2..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            return Some(String::from_utf16_lossy(&u16s));
        }
        return Some(String::from_utf8_lossy(bytes).into_owned());
    }

    let is_binary_ext = path
        .and_then(|p| p.extension())
        .and_then(|e| e.to_str())
        .map(is_known_binary_extension)
        .unwrap_or(false);

    if is_binary_ext {
        let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
        if bytes[..sniff_len].contains(&0) {
            return None;
        }
        if let Ok(content) = String::from_utf8(bytes.to_vec()) {
            if is_likely_text(&content) {
                return Some(content);
            }
        }
        return None;
    }

    // 1. UTF-8 BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        if let Ok(content) = String::from_utf8(bytes[3..].to_vec()) {
            return Some(content);
        }
    }

    // 2. UTF-16 LE with BOM
    if bytes.starts_with(&[0xFF, 0xFE]) {
        if let Some(content) = decode_utf16_le(&bytes[2..]) {
            if is_likely_text(&content) {
                return Some(content);
            }
        }
    }

    // 3. UTF-16 BE with BOM
    if bytes.starts_with(&[0xFE, 0xFF]) {
        if let Some(content) = decode_utf16_be(&bytes[2..]) {
            if is_likely_text(&content) {
                return Some(content);
            }
        }
    }

    // 4. Strict UTF-8 (when no null bytes exist in content)
    if !bytes.contains(&0) {
        if let Ok(content) = String::from_utf8(bytes.to_vec()) {
            return Some(content);
        }
    }

    // 5. UTF-16 LE / BE without BOM
    if bytes.contains(&0) {
        if looks_like_utf16_le(bytes) {
            if let Some(content) = decode_utf16_le(bytes) {
                if is_likely_text(&content) {
                    return Some(content);
                }
            }
        }
        if looks_like_utf16_be(bytes) {
            if let Some(content) = decode_utf16_be(bytes) {
                if is_likely_text(&content) {
                    return Some(content);
                }
            }
        }
    }

    // 6. Trailing null padding
    let trimmed = trim_trailing_nulls(bytes);
    if !trimmed.is_empty() && trimmed.len() < bytes.len() && !trimmed.contains(&0) {
        if let Ok(content) = String::from_utf8(trimmed.to_vec()) {
            return Some(content);
        }
        let is_text_path = path.map(is_known_text_path).unwrap_or(false);
        if is_text_path || looks_like_latin1_text(trimmed) {
            let content = decode_windows_1252(trimmed);
            if is_likely_text(&content) {
                return Some(content);
            }
        }
    }

    // 7. Windows-1252 / ISO-8859-1 for non-null text (such as Spanish/French/German accents in .ini)
    if !bytes.contains(&0) {
        let is_text_path = path.map(is_known_text_path).unwrap_or(false);
        if is_text_path || looks_like_latin1_text(bytes) {
            let content = decode_windows_1252(bytes);
            if is_likely_text(&content) {
                return Some(content);
            }
        }
    }

    // 8. Known text path fallback (if file has no null bytes and is a known text file, decode lossily)
    if !bytes.contains(&0) && path.map(is_known_text_path).unwrap_or(false) {
        return Some(decode_windows_1252(bytes));
    }

    None
}

#[derive(Serialize, Clone)]
pub(super) struct FileWrittenEvent {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    filesystem: FileWriteFilesystem,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum FileWriteFilesystem {
    Local,
    Wsl { distro: String },
}

impl FileWrittenEvent {
    pub(super) fn new(
        path: String,
        source: Option<String>,
        workspace: &WorkspaceEnv,
    ) -> Option<Self> {
        if path.is_empty() || path.len() > 32_768 || path.chars().any(char::is_control) {
            return None;
        }
        let normalized = path.replace('\\', "/");
        let native_path = normalized.starts_with("//")
            || (normalized.as_bytes().get(1) == Some(&b':')
                && normalized.as_bytes()[0].is_ascii_alphabetic());
        let filesystem = match workspace {
            WorkspaceEnv::Wsl { distro } if !native_path => {
                if distro.is_empty() || distro.len() > 255 || distro.chars().any(char::is_control) {
                    return None;
                }
                FileWriteFilesystem::Wsl {
                    distro: distro.clone(),
                }
            }
            _ => FileWriteFilesystem::Local,
        };
        Some(Self {
            path,
            source: source.filter(|value| {
                !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
            }),
            filesystem,
        })
    }
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
pub(super) fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    if let Ok(metadata) = fs::metadata(target) {
        tmp.as_file().set_permissions(metadata.permissions())?;
    }
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

/// Returns the new mtime so the editor can track disk state for conflict
/// detection without a follow-up stat.
#[tauri::command]
pub async fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    let network_path = is_network_path(&target);
    let mtime = blocking_fs(network_path, move || {
        write_atomic(&target, content.as_bytes()).map_err(|e| {
            log::warn!("fs_write_file({}) failed: {e}", target.display());
            e.to_string()
        })?;
        Ok(fs::metadata(&target).map(|m| mtime_millis(&m)).unwrap_or(0))
    })
    .await?;
    if let Some(event) = FileWrittenEvent::new(path, source, &workspace) {
        let _ = app.emit("fs:file-written", event);
    }

    Ok(mtime)
}

#[tauri::command]
pub async fn fs_canonicalize(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let network_path = is_network_path(&p);
    blocking_fs(network_path, move || {
        let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
        Ok(super::to_canon(&canon))
    })
    .await
}

#[tauri::command]
pub async fn fs_read_binary_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<u8>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let network_path = is_network_path(&p);
    blocking_fs(network_path, move || {
        std::fs::read(&p).map_err(|e| {
            log::warn!("fs_read_binary_file({}) failed: {e}", p.display());
            e.to_string()
        })
    })
    .await
}

#[tauri::command]
pub async fn fs_stat(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let network_path = is_network_path(&p);
    blocking_fs(network_path, move || {
        let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
        let kind = if meta.is_dir() {
            StatKind::Dir
        } else if std::fs::symlink_metadata(&p)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            StatKind::Symlink
        } else {
            StatKind::File
        };
        Ok(FileStat {
            size: meta.len(),
            mtime: mtime_millis(&meta),
            kind,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_events_serialize_only_the_native_filesystem_scope() {
        let local = FileWrittenEvent::new(
            "/work/file.txt".into(),
            Some("editor".into()),
            &WorkspaceEnv::Local,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(local).unwrap(),
            serde_json::json!({
                "path": "/work/file.txt", "source": "editor", "filesystem": {"kind": "local"}
            })
        );
        for distro in ["first", "second"] {
            let event = FileWrittenEvent::new(
                "/work/file.txt".into(),
                None,
                &WorkspaceEnv::Wsl {
                    distro: distro.into(),
                },
            )
            .unwrap();
            assert_eq!(
                serde_json::to_value(event).unwrap(),
                serde_json::json!({
                    "path": "/work/file.txt", "filesystem": {"kind": "wsl", "distro": distro}
                })
            );
        }
    }

    #[test]
    fn write_events_do_not_copy_remote_connection_or_container_fields() {
        for workspace in [
            serde_json::json!({"kind":"ssh", "root":"/work", "sessionId":7, "connection":{"host":"example.test", "user":"fixture", "identityFile":"fixture-key"}}),
            serde_json::json!({"kind":"docker", "containerId":"fixture", "user":"fixture"}),
        ] {
            let workspace: WorkspaceEnv = serde_json::from_value(workspace).unwrap();
            let event = FileWrittenEvent::new("C:/work/file.txt".into(), None, &workspace).unwrap();
            assert_eq!(
                serde_json::to_value(event).unwrap(),
                serde_json::json!({
                    "path":"C:/work/file.txt", "filesystem":{"kind":"local"}
                })
            );
        }
    }

    #[test]
    fn write_events_preserve_native_windows_paths_and_bound_payload_fields() {
        let workspace = WorkspaceEnv::Wsl {
            distro: "fixture".into(),
        };
        for path in [r"C:\work\file.txt", r"\\server\share\file.txt"] {
            let event = FileWrittenEvent::new(path.into(), None, &workspace).unwrap();
            assert_eq!(
                serde_json::to_value(event).unwrap()["filesystem"],
                serde_json::json!({"kind":"local"})
            );
        }
        for path in ["".to_string(), "x".repeat(32_769), "bad\0path".into()] {
            assert!(FileWrittenEvent::new(path, None, &WorkspaceEnv::Local).is_none());
        }
        assert!(FileWrittenEvent::new(
            "/work/file".into(),
            None,
            &WorkspaceEnv::Wsl {
                distro: "x".repeat(256)
            }
        )
        .is_none());
        let event = FileWrittenEvent::new(
            "/work/file".into(),
            Some("x".repeat(129)),
            &WorkspaceEnv::Local,
        )
        .unwrap();
        assert!(serde_json::to_value(event).unwrap().get("source").is_none());
    }

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text {
                content,
                size,
                mtime,
            } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
                assert!(mtime > 0);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 with no null byte: must still classify as binary.
        std::fs::write(&f, [0xff, 0xfe, 0xfd, 0xfc]).unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_opens_utf8_with_bom() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("config.ini");
        let mut data = vec![0xEF, 0xBB, 0xBF];
        data.extend_from_slice(b"[section]\nkey = val\n");
        std::fs::write(&f, &data).unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text { content, .. } => {
                assert_eq!(content, "[section]\nkey = val\n");
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_opens_utf16_le_with_bom() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("settings.ini");
        let mut data = vec![0xFF, 0xFE];
        for c in "[General]\r\nName=Voktty\r\n".encode_utf16() {
            data.extend_from_slice(&c.to_le_bytes());
        }
        std::fs::write(&f, &data).unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text { content, .. } => {
                assert_eq!(content, "[General]\r\nName=Voktty\r\n");
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_opens_utf16_be_with_bom() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("settings_be.ini");
        let mut data = vec![0xFE, 0xFF];
        for c in "[General]\r\nName=Voktty\r\n".encode_utf16() {
            data.extend_from_slice(&c.to_be_bytes());
        }
        std::fs::write(&f, &data).unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text { content, .. } => {
                assert_eq!(content, "[General]\r\nName=Voktty\r\n");
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_opens_utf16_le_without_bom() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("registry.reg");
        let mut data = Vec::new();
        for c in "Windows Registry Editor Version 5.00\r\n[HKEY_CURRENT_USER\\Software]\r\n"
            .encode_utf16()
        {
            data.extend_from_slice(&c.to_le_bytes());
        }
        std::fs::write(&f, &data).unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text { content, .. } => {
                assert_eq!(
                    content,
                    "Windows Registry Editor Version 5.00\r\n[HKEY_CURRENT_USER\\Software]\r\n"
                );
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_opens_windows_1252_ini_with_accents() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("config.ini");
        // Windows-1252 bytes for: [Configuración]\r\nidioma = español\r\n
        // 'ó' = 0xF3, 'ñ' = 0xF1
        let mut data = Vec::new();
        data.extend_from_slice(b"[Configuraci");
        data.push(0xF3); // ó
        data.extend_from_slice(b"n]\r\nidioma = espa");
        data.push(0xF1); // ñ
        data.extend_from_slice(b"ol\r\n");
        std::fs::write(&f, &data).unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text { content, .. } => {
                assert_eq!(content, "[Configuración]\r\nidioma = español\r\n");
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_trims_trailing_null_padding() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("padded.txt");
        let mut data = b"hello padded file\r\n".to_vec();
        data.extend_from_slice(&[0, 0, 0, 0, 0]);
        std::fs::write(&f, &data).unwrap();
        match read_file_sync(&f, false).unwrap() {
            ReadResult::Text { content, .. } => {
                assert_eq!(content, "hello padded file\r\n");
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_force_allows_reading_binary_as_lossy_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("unknown.bin");
        let data = vec![0x89, b'P', b'N', b'G', 0x00, 0xFF, 0xFE];
        std::fs::write(&f, &data).unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::Binary { .. }
        ));
        match read_file_sync(&f, true).unwrap() {
            ReadResult::Text { content, .. } => {
                assert!(content.contains("PNG"));
            }
            _ => panic!("expected text when forced"),
        }
    }

    #[tokio::test]
    async fn read_binary_file_returns_raw_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("test.bin");
        let bytes = vec![0x89, b'P', b'N', b'G', 0x00, 0xff];
        std::fs::write(&f, &bytes).unwrap();
        let result = fs_read_binary_file(f.to_string_lossy().into_owned(), None)
            .await
            .expect("read binary");
        assert_eq!(result, bytes);
    }

    #[test]
    fn force_lifts_the_default_size_limit() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("big.txt");
        std::fs::write(&f, vec![b'a'; (MAX_READ_BYTES + 1) as usize]).unwrap();
        assert!(matches!(
            read_file_sync(&f, false).unwrap(),
            ReadResult::TooLarge { .. }
        ));
        assert!(matches!(
            read_file_sync(&f, true).unwrap(),
            ReadResult::Text { .. }
        ));
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("script.sh");
        std::fs::write(&target, b"old").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();

        write_atomic(&target, b"new").unwrap();

        assert_eq!(
            std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.voktty.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}
