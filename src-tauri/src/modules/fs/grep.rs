use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::{WalkBuilder, WalkState};
use serde::Serialize;

use super::to_canon;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const FILE_SIZE_CAP: u64 = 5 * 1024 * 1024;
const DEFAULT_MAX_RESULTS: usize = 200;
const HARD_MAX_RESULTS: usize = 2000;
const PREVIEW_CONTEXT_BYTES: usize = 1024;

/// Supersession counter for interactive content search. Each new interactive
/// query bumps the generation; in-flight walks observe the change and quit,
/// so fast typing stops superseded searches server-side instead of letting
/// them run to completion.
#[derive(Default)]
pub struct ContentSearchState {
    interactive_generation: AtomicU64,
    workspace_generation: AtomicU64,
}

#[derive(Serialize)]
pub struct GrepHit {
    pub path: String,
    pub rel: String,
    pub line: u64,
    pub column: usize,
    pub match_length: usize,
    pub preview_column: usize,
    pub text: String,
}

#[derive(Serialize)]
pub struct GrepResponse {
    pub hits: Vec<GrepHit>,
    pub truncated: bool,
    pub files_scanned: usize,
}

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        let g = Glob::new(p).map_err(|e| format!("bad glob {p:?}: {e}"))?;
        b.add(g);
    }
    let set = b.build().map_err(|e| format!("globset build: {e}"))?;
    Ok(Some(set))
}

fn escape_literal(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        if "\\.+*?()|[]{}^$".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
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

#[allow(clippy::too_many_arguments)]
fn search_tree(
    root_path: &Path,
    root_display: &str,
    workspace: &WorkspaceEnv,
    matcher: &RegexMatcher,
    include: &Option<GlobSet>,
    exclude: &Option<GlobSet>,
    show_hidden: bool,
    cap: usize,
    cancel: &(dyn Fn() -> bool + Sync),
) -> GrepResponse {
    let walker = WalkBuilder::new(root_path)
        .hidden(!show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build_parallel();

    let hits: Arc<Mutex<Vec<GrepHit>>> = Arc::new(Mutex::new(Vec::new()));
    let scanned = Arc::new(AtomicUsize::new(0));
    let truncated = Arc::new(AtomicBool::new(false));

    walker.run(|| {
        let matcher = matcher.clone();
        let include = include.clone();
        let exclude = exclude.clone();
        let hits = hits.clone();
        let scanned = scanned.clone();
        let truncated = truncated.clone();
        let root_path = root_path.to_path_buf();
        let root_display = root_display.to_string();
        let workspace = workspace.clone();

        Box::new(move |dent_res| {
            if truncated.load(Ordering::Relaxed) || cancel() {
                return WalkState::Quit;
            }
            let dent = match dent_res {
                Ok(d) => d,
                Err(_) => return WalkState::Continue,
            };
            if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
                return WalkState::Continue;
            }
            let path = dent.path();
            let rel = match path.strip_prefix(&root_path) {
                Ok(r) => to_canon(r),
                Err(_) => return WalkState::Continue,
            };
            if let Some(set) = include.as_ref() {
                if !set.is_match(&rel) {
                    return WalkState::Continue;
                }
            }
            if exclude.as_ref().is_some_and(|set| set.is_match(&rel)) {
                return WalkState::Continue;
            }
            if let Ok(meta) = std::fs::metadata(path) {
                if meta.len() > FILE_SIZE_CAP {
                    return WalkState::Continue;
                }
            }

            scanned.fetch_add(1, Ordering::Relaxed);

            let abs = display_path(path, &root_path, &root_display, &workspace);
            let rel_clone = rel.clone();
            let mut searcher = SearcherBuilder::new()
                .binary_detection(BinaryDetection::quit(b'\x00'))
                .line_number(true)
                .build();

            let _ = searcher.search_path(
                &matcher,
                path,
                UTF8(|line_num, text| {
                    let line_text = text.trim_end_matches(&['\r', '\n'][..]);
                    let (column, match_length, preview_column, text) =
                        match_preview(&matcher, line_text);
                    let mut guard = hits.lock().unwrap();
                    if guard.len() >= cap {
                        truncated.store(true, Ordering::Relaxed);
                        return Ok(false);
                    }
                    guard.push(GrepHit {
                        path: abs.clone(),
                        rel: rel_clone.clone(),
                        line: line_num,
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

    let mut final_hits = Arc::try_unwrap(hits)
        .map(|m| m.into_inner().unwrap())
        .unwrap_or_default();
    final_hits.sort_by(|left, right| {
        left.rel
            .cmp(&right.rel)
            .then(left.line.cmp(&right.line))
            .then(left.column.cmp(&right.column))
    });

    GrepResponse {
        hits: final_hits,
        truncated: truncated.load(Ordering::Relaxed),
        files_scanned: scanned.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn fs_grep(
    pattern: String,
    root: String,
    glob: Option<Vec<String>>,
    case_insensitive: Option<bool>,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GrepResponse, String> {
    if pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let cap = max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive.unwrap_or(false))
        .line_terminator(Some(b'\n'))
        .build(&pattern)
        .map_err(|e| format!("bad regex: {e}"))?;

    let globs = build_globset(glob.as_deref().unwrap_or(&[]))?;

    Ok(search_tree(
        &root_path,
        &root,
        &workspace,
        &matcher,
        &globs,
        &None,
        false,
        cap,
        &|| false,
    ))
}

/// Interactive content search for the command palette. Treats the query as a
/// literal (smart-case), and self-cancels when a newer query arrives.
#[tauri::command]
pub fn fs_grep_interactive(
    state: tauri::State<'_, ContentSearchState>,
    pattern: String,
    root: String,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GrepResponse, String> {
    if pattern.trim().is_empty() {
        return Err("empty pattern".into());
    }
    let my_gen = state.interactive_generation.fetch_add(1, Ordering::SeqCst) + 1;

    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let cap = max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);

    let matcher = RegexMatcherBuilder::new()
        .case_smart(true)
        .line_terminator(Some(b'\n'))
        .build(&escape_literal(&pattern))
        .map_err(|e| format!("bad pattern: {e}"))?;

    let cancel = || state.interactive_generation.load(Ordering::SeqCst) != my_gen;
    Ok(search_tree(
        &root_path, &root, &workspace, &matcher, &None, &None, false, cap, &cancel,
    ))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn fs_grep_workspace(
    state: tauri::State<'_, ContentSearchState>,
    pattern: String,
    root: String,
    include: Option<Vec<String>>,
    exclude: Option<Vec<String>>,
    case_sensitive: Option<bool>,
    regex: Option<bool>,
    whole_word: Option<bool>,
    show_hidden: Option<bool>,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GrepResponse, String> {
    if pattern.trim().is_empty() {
        return Err("empty pattern".into());
    }
    let my_gen = state.workspace_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let cap = max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);
    let pattern = search_pattern(
        &pattern,
        regex.unwrap_or(false),
        whole_word.unwrap_or(false),
    );
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive.unwrap_or(false))
        .line_terminator(Some(b'\n'))
        .build(&pattern)
        .map_err(|error| format!("bad pattern: {error}"))?;
    let include = build_globset(include.as_deref().unwrap_or(&[]))?;
    let exclude = build_globset(exclude.as_deref().unwrap_or(&[]))?;
    let cancel = || state.workspace_generation.load(Ordering::SeqCst) != my_gen;
    Ok(search_tree(
        &root_path,
        &root,
        &workspace,
        &matcher,
        &include,
        &exclude,
        show_hidden.unwrap_or(false),
        cap,
        &cancel,
    ))
}

#[tauri::command]
pub fn fs_grep_workspace_cancel(state: tauri::State<'_, ContentSearchState>) {
    state.workspace_generation.fetch_add(1, Ordering::SeqCst);
}

#[derive(Serialize)]
pub struct GlobHit {
    pub path: String,
    pub rel: String,
}

#[derive(Serialize)]
pub struct GlobResponse {
    pub hits: Vec<GlobHit>,
    pub truncated: bool,
}

#[tauri::command]
pub fn fs_glob(
    pattern: String,
    root: String,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GlobResponse, String> {
    if pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let cap = max_results.unwrap_or(500).clamp(1, HARD_MAX_RESULTS);

    let glob = Glob::new(&pattern).map_err(|e| format!("bad glob: {e}"))?;
    let mut gb = GlobSetBuilder::new();
    gb.add(glob);
    let set = gb.build().map_err(|e| format!("globset build: {e}"))?;

    let walker = WalkBuilder::new(&root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build();

    let mut hits: Vec<GlobHit> = Vec::new();
    let mut truncated = false;
    for dent in walker.flatten() {
        if hits.len() >= cap {
            truncated = true;
            break;
        }
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = dent.path();
        let rel = match path.strip_prefix(&root_path) {
            Ok(r) => to_canon(r),
            Err(_) => continue,
        };
        if !set.is_match(&rel) {
            continue;
        }
        hits.push(GlobHit {
            path: display_path(path, &root_path, &root, &workspace),
            rel,
        });
    }

    Ok(GlobResponse { hits, truncated })
}

fn display_path(
    path: &std::path::Path,
    root_path: &std::path::Path,
    root_display: &str,
    workspace: &WorkspaceEnv,
) -> String {
    if workspace.is_wsl() {
        if let Ok(rel) = path.strip_prefix(root_path) {
            let rel = to_canon(rel);
            return if rel.is_empty() {
                root_display.to_string()
            } else if root_display.ends_with('/') {
                format!("{root_display}{rel}")
            } else {
                format!("{root_display}/{rel}")
            };
        }
    }
    to_canon(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_literal_escapes_regex_meta() {
        assert_eq!(escape_literal("a.b(c)"), "a\\.b\\(c\\)");
        assert_eq!(escape_literal("plain text"), "plain text");
    }

    #[test]
    fn search_tree_respects_cancellation() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "hello\nfind me here\n").unwrap();
        let matcher = RegexMatcherBuilder::new().build("find").unwrap();
        let ws = WorkspaceEnv::from_option(None);
        let root_display = dir.path().to_string_lossy().to_string();

        let live = search_tree(
            dir.path(),
            &root_display,
            &ws,
            &matcher,
            &None,
            &None,
            false,
            100,
            &|| false,
        );
        assert_eq!(live.hits.len(), 1, "uncancelled search finds the match");

        let stopped = search_tree(
            dir.path(),
            &root_display,
            &ws,
            &matcher,
            &None,
            &None,
            false,
            100,
            &|| true,
        );
        assert!(stopped.hits.is_empty(), "cancelled search yields nothing");
    }

    #[test]
    fn search_tree_applies_filters_and_reports_utf16_locations() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("src")).unwrap();
        std::fs::create_dir(dir.path().join("dist")).unwrap();
        std::fs::write(dir.path().join("src/main.ts"), "a😀widgetz\n").unwrap();
        std::fs::write(dir.path().join("dist/main.ts"), "widget\n").unwrap();
        let matcher = RegexMatcherBuilder::new().build("widget").unwrap();
        let include = build_globset(&["**/*.ts".to_string()]).unwrap();
        let exclude = build_globset(&["dist/**".to_string()]).unwrap();
        let ws = WorkspaceEnv::from_option(None);
        let root_display = dir.path().to_string_lossy().to_string();

        let response = search_tree(
            dir.path(),
            &root_display,
            &ws,
            &matcher,
            &include,
            &exclude,
            false,
            100,
            &|| false,
        );

        assert_eq!(response.hits.len(), 1);
        assert_eq!(response.hits[0].rel, "src/main.ts");
        assert_eq!(response.hits[0].column, 4);
        assert_eq!(response.hits[0].match_length, 6);
        assert_eq!(response.hits[0].preview_column, 4);
        assert_eq!(response.hits[0].text, "a😀widgetz");
    }

    #[test]
    fn search_tree_bounds_long_line_previews_without_losing_editor_location() {
        let dir = tempfile::tempdir().unwrap();
        let prefix = "😀".repeat(2_000);
        std::fs::write(dir.path().join("long.js"), format!("{prefix}needle tail\n")).unwrap();
        let matcher = RegexMatcherBuilder::new().build("needle").unwrap();
        let ws = WorkspaceEnv::from_option(None);
        let root_display = dir.path().to_string_lossy().to_string();

        let response = search_tree(
            dir.path(),
            &root_display,
            &ws,
            &matcher,
            &None,
            &None,
            false,
            100,
            &|| false,
        );

        let hit = &response.hits[0];
        assert_eq!(hit.column, 4_001);
        assert!(hit.preview_column < hit.column);
        assert!(hit.text.len() <= PREVIEW_CONTEXT_BYTES * 2 + "needle".len());
        assert!(hit.text.contains("needle"));
    }

    #[test]
    fn search_pattern_supports_literal_regex_and_whole_word_modes() {
        assert_eq!(search_pattern("a.b", false, false), "a\\.b");
        assert_eq!(search_pattern("a.+b", true, false), "a.+b");
        assert_eq!(search_pattern("item", false, true), r"\b(?:item)\b");
    }
}
