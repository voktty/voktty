use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::{WalkBuilder, WalkState};
use serde::Deserialize;
use serde_json::{json, Value};

const FILE_SIZE_CAP: u64 = 5 * 1024 * 1024;
const HARD_MAX_RESULTS: usize = 2_000;
const PREVIEW_CONTEXT_BYTES: usize = 1024;

#[derive(Clone, Default)]
pub struct RemoteSearchState {
    generation: Arc<AtomicU64>,
}

pub struct PreparedSearch {
    root: PathBuf,
    params: SearchParams,
    generation: Arc<AtomicU64>,
    ticket: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchParams {
    pattern: String,
    #[serde(default)]
    include: Vec<String>,
    #[serde(default)]
    exclude: Vec<String>,
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    regex: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    show_hidden: bool,
    #[serde(default = "default_max_results")]
    max_results: usize,
}

#[derive(Clone)]
struct SearchHit {
    path: String,
    rel: String,
    line: u64,
    column: usize,
    match_length: usize,
    preview_column: usize,
    text: String,
}

impl RemoteSearchState {
    pub fn prepare(&self, root: &Path, params: Value) -> Result<PreparedSearch, String> {
        let ticket = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let params: SearchParams = serde_json::from_value(params).map_err(|e| e.to_string())?;
        if params.pattern.trim().is_empty() {
            return Err("empty pattern".to_string());
        }
        Ok(PreparedSearch {
            root: root.to_path_buf(),
            params,
            generation: self.generation.clone(),
            ticket,
        })
    }

    pub fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
}

pub fn run_search(search: PreparedSearch) -> Result<Value, String> {
    let pattern = search_pattern(
        &search.params.pattern,
        search.params.regex,
        search.params.whole_word,
    );
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!search.params.case_sensitive)
        .line_terminator(Some(b'\n'))
        .build(&pattern)
        .map_err(|error| format!("bad pattern: {error}"))?;
    let include = build_globset(&search.params.include)?;
    let exclude = build_globset(&search.params.exclude)?;
    let cap = search.params.max_results.clamp(1, HARD_MAX_RESULTS);
    let walker = WalkBuilder::new(&search.root)
        .hidden(!search.params.show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build_parallel();
    let hits = Arc::new(Mutex::new(Vec::<SearchHit>::new()));
    let scanned = Arc::new(AtomicUsize::new(0));
    let truncated = Arc::new(AtomicBool::new(false));
    let cancelled = || search.generation.load(Ordering::SeqCst) != search.ticket;

    walker.run(|| {
        let root = search.root.clone();
        let matcher = matcher.clone();
        let include = include.clone();
        let exclude = exclude.clone();
        let hits = hits.clone();
        let scanned = scanned.clone();
        let truncated = truncated.clone();
        let generation = search.generation.clone();
        let ticket = search.ticket;
        Box::new(move |entry| {
            if truncated.load(Ordering::Relaxed) || generation.load(Ordering::SeqCst) != ticket {
                return WalkState::Quit;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => return WalkState::Continue,
            };
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                return WalkState::Continue;
            }
            let path = entry.path();
            let rel = match path.strip_prefix(&root) {
                Ok(rel) => canonical_path(rel),
                Err(_) => return WalkState::Continue,
            };
            if include.as_ref().is_some_and(|set| !set.is_match(&rel))
                || exclude.as_ref().is_some_and(|set| set.is_match(&rel))
            {
                return WalkState::Continue;
            }
            if fs_file_too_large(path) {
                return WalkState::Continue;
            }
            scanned.fetch_add(1, Ordering::Relaxed);
            let absolute = canonical_path(path);
            let relative = rel.clone();
            let mut searcher = SearcherBuilder::new()
                .binary_detection(BinaryDetection::quit(b'\0'))
                .line_number(true)
                .build();
            let _ = searcher.search_path(
                &matcher,
                path,
                UTF8(|line, text| {
                    let line_text = text.trim_end_matches(&['\r', '\n'][..]);
                    let (column, match_length, preview_column, text) =
                        match_preview(&matcher, line_text);
                    let mut hits = hits.lock().unwrap();
                    if hits.len() >= cap {
                        truncated.store(true, Ordering::Relaxed);
                        return Ok(false);
                    }
                    hits.push(SearchHit {
                        path: absolute.clone(),
                        rel: relative.clone(),
                        line,
                        column,
                        match_length,
                        preview_column,
                        text,
                    });
                    Ok(true)
                }),
            );
            WalkState::Continue
        })
    });

    let mut hits = Arc::try_unwrap(hits)
        .map(|hits| hits.into_inner().unwrap())
        .unwrap_or_default();
    hits.sort_by(|left, right| {
        left.rel
            .cmp(&right.rel)
            .then(left.line.cmp(&right.line))
            .then(left.column.cmp(&right.column))
    });
    Ok(json!({
        "hits": hits.into_iter().map(|hit| json!({
            "path": hit.path,
            "rel": hit.rel,
            "line": hit.line,
            "column": hit.column,
            "match_length": hit.match_length,
            "preview_column": hit.preview_column,
            "text": hit.text,
        })).collect::<Vec<_>>(),
        "truncated": truncated.load(Ordering::Relaxed),
        "files_scanned": scanned.load(Ordering::Relaxed),
        "cancelled": cancelled(),
    }))
}

fn default_max_results() -> usize {
    200
}

fn fs_file_too_large(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|metadata| metadata.len() > FILE_SIZE_CAP)
        .unwrap_or(false)
}

fn canonical_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern).map_err(|error| format!("bad glob {pattern:?}: {error}"))?);
    }
    builder
        .build()
        .map(Some)
        .map_err(|error| format!("globset build: {error}"))
}

fn escape_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 8);
    for character in value.chars() {
        if "\\.+*?()|[]{}^$".contains(character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn search_pattern(pattern: &str, regex: bool, whole_word: bool) -> String {
    let pattern = if regex {
        pattern.to_string()
    } else {
        escape_literal(pattern)
    };
    if whole_word {
        format!(r"\b(?:{pattern})\b")
    } else {
        pattern
    }
}

fn match_preview(matcher: &RegexMatcher, text: &str) -> (usize, usize, usize, String) {
    let Some(found) = matcher.find(text.as_bytes()).ok().flatten() else {
        return (1, 0, 1, String::new());
    };
    let column = text[..found.start()].encode_utf16().count() + 1;
    let match_length = text[found.start()..found.end()].encode_utf16().count();
    let mut preview_start = found.start().saturating_sub(PREVIEW_CONTEXT_BYTES);
    while preview_start < found.start() && !text.is_char_boundary(preview_start) {
        preview_start += 1;
    }
    let mut preview_end = found
        .end()
        .saturating_add(PREVIEW_CONTEXT_BYTES)
        .min(text.len());
    while preview_end > found.end() && !text.is_char_boundary(preview_end) {
        preview_end -= 1;
    }
    let preview_column = text[preview_start..found.start()].encode_utf16().count() + 1;
    (
        column,
        match_length,
        preview_column,
        text[preview_start..preview_end].to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn searches_inside_workspace_with_filters_and_utf16_locations() {
        let workspace = tempdir().unwrap();
        std::fs::create_dir(workspace.path().join("src")).unwrap();
        std::fs::create_dir(workspace.path().join("dist")).unwrap();
        std::fs::write(workspace.path().join("src/main.ts"), "a😀widgetz\n").unwrap();
        std::fs::write(workspace.path().join("dist/main.ts"), "widget\n").unwrap();
        let state = RemoteSearchState::default();
        let search = state
            .prepare(
                workspace.path(),
                json!({
                    "pattern": "widget",
                    "include": ["**/*.ts"],
                    "exclude": ["dist/**"],
                    "maxResults": 100
                }),
            )
            .unwrap();

        let response = run_search(search).unwrap();
        assert_eq!(response["hits"].as_array().unwrap().len(), 1);
        assert_eq!(response["hits"][0]["rel"], "src/main.ts");
        assert_eq!(response["hits"][0]["column"], 4);
        assert_eq!(response["hits"][0]["match_length"], 6);
        assert_eq!(response["hits"][0]["preview_column"], 4);
    }

    #[test]
    fn bounds_long_line_previews_without_losing_editor_location() {
        let workspace = tempdir().unwrap();
        let prefix = "😀".repeat(2_000);
        std::fs::write(
            workspace.path().join("long.js"),
            format!("{prefix}needle tail\n"),
        )
        .unwrap();
        let search = RemoteSearchState::default()
            .prepare(workspace.path(), json!({ "pattern": "needle" }))
            .unwrap();

        let response = run_search(search).unwrap();
        let hit = &response["hits"][0];
        assert_eq!(hit["column"], 4_001);
        assert!(hit["preview_column"].as_u64().unwrap() < 4_001);
        assert!(hit["text"].as_str().unwrap().contains("needle"));
        assert!(hit["text"].as_str().unwrap().len() <= PREVIEW_CONTEXT_BYTES * 2 + 6);
    }

    #[test]
    fn a_new_request_cancels_the_previous_search() {
        let workspace = tempdir().unwrap();
        let state = RemoteSearchState::default();
        let first = state
            .prepare(workspace.path(), json!({ "pattern": "first" }))
            .unwrap();
        let _second = state
            .prepare(workspace.path(), json!({ "pattern": "second" }))
            .unwrap();

        assert_eq!(run_search(first).unwrap()["cancelled"], true);
    }

    #[test]
    fn invalid_regex_is_reported_without_panicking() {
        let workspace = tempdir().unwrap();
        let search = RemoteSearchState::default()
            .prepare(workspace.path(), json!({ "pattern": "(", "regex": true }))
            .unwrap();

        assert!(run_search(search).unwrap_err().contains("bad pattern"));
    }
}
