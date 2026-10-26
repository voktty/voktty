use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use ignore::WalkBuilder;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::search::resolve_search_root_literal;

const MAX_SCANNED: usize = 50_000;
const MAX_RETAINED_BYTES: usize = 8 * 1024 * 1024;
const MAX_PATH_BYTES: usize = 32_768;
const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Params {
    query: String,
    cwd: Option<String>,
    max_results: Option<usize>,
    show_hidden: Option<bool>,
}

#[derive(Eq, PartialEq, Ord, PartialOrd, Serialize)]
struct Hit {
    rel: String,
    name: String,
    is_dir: bool,
}

impl Hit {
    fn bytes(&self) -> usize {
        self.rel.len() + self.name.len()
    }
}

type RankedHit = (u32, Reverse<usize>, Reverse<usize>, Hit);

pub struct FilenameSearch {
    root: PathBuf,
    pattern: Pattern,
    cap: usize,
    show_hidden: bool,
}

impl FilenameSearch {
    pub fn prepare(root: &Path, value: Value) -> Result<Self, String> {
        let params: Params = serde_json::from_value(value).map_err(|error| error.to_string())?;
        let query = params.query.trim();
        if query.is_empty() || params.query.len() > 4096 || params.query.contains('\0') {
            return Err("filename query is empty, invalid or exceeds 4096 bytes".into());
        }
        let cap = params.max_results.unwrap_or(200);
        if !(1..=1000).contains(&cap) {
            return Err("filename result limit must be between 1 and 1000".into());
        }
        let (_, root) = resolve_search_root_literal(root, params.cwd.as_deref())?;
        Ok(Self {
            root,
            pattern: Pattern::parse(query, CaseMatching::Smart, Normalization::Smart),
            cap,
            show_hidden: params.show_hidden.unwrap_or(false),
        })
    }

    pub fn run(
        self,
        deadline: Instant,
        stopped: &impl Fn() -> bool,
        admit: &impl Fn(usize) -> bool,
    ) -> Result<Value, String> {
        self.run_bounded(deadline, stopped, admit, MAX_SCANNED, MAX_RETAINED_BYTES)
    }

    fn run_bounded(
        self,
        deadline: Instant,
        stopped: &impl Fn() -> bool,
        admit: &impl Fn(usize) -> bool,
        scan_limit: usize,
        retained_limit: usize,
    ) -> Result<Value, String> {
        let walker = WalkBuilder::new(&self.root)
            .hidden(!self.show_hidden)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .ignore(true)
            .parents(true)
            .follow_links(false)
            .filter_entry(move |entry| {
                Instant::now() < deadline
                    && (entry.depth() == 0
                        || !entry
                            .file_name()
                            .to_str()
                            .is_some_and(|name| PRUNE_DIRS.contains(&name)))
            })
            .build();
        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        let mut buffer = Vec::new();
        let mut retained: BinaryHeap<Reverse<RankedHit>> = BinaryHeap::new();
        let mut bytes = 0;
        let mut matched = 0;
        let mut truncated = false;
        for (scanned, entry) in walker.enumerate() {
            if stopped() || Instant::now() >= deadline {
                return Err("filename search exceeded its deadline".into());
            }
            if scanned >= scan_limit {
                truncated = true;
                break;
            }
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.depth() == 0 {
                continue;
            }
            let Some(kind) = entry
                .file_type()
                .filter(|kind| kind.is_file() || kind.is_dir())
            else {
                continue;
            };
            let relative = entry
                .path()
                .strip_prefix(&self.root)
                .map_err(|error| error.to_string())?;
            let rel = relative.to_str().ok_or("filename is not valid UTF-8")?;
            if rel.len() > MAX_PATH_BYTES {
                return Err("filename path exceeds the search limit".into());
            }
            let Some(score) = self
                .pattern
                .score(Utf32Str::new(rel, &mut buffer), &mut matcher)
            else {
                continue;
            };
            matched += 1;
            let rank = (score, Reverse(rel.len()), Reverse(scanned));
            if retained.len() == self.cap
                && retained
                    .peek()
                    .is_some_and(|Reverse((score, length, order, _))| {
                        rank <= (*score, *length, *order)
                    })
            {
                continue;
            }
            if retained.len() == self.cap {
                if let Some(Reverse((_, _, _, removed))) = retained.pop() {
                    bytes -= removed.bytes();
                }
            }
            let hit = Hit {
                rel: rel.to_string(),
                name: entry
                    .file_name()
                    .to_str()
                    .ok_or("filename is not valid UTF-8")?
                    .to_string(),
                is_dir: kind.is_dir(),
            };
            bytes += hit.bytes();
            if bytes > retained_limit {
                return Err("filename search exceeded its retained result budget".into());
            }
            retained.push(Reverse((score, Reverse(rel.len()), Reverse(scanned), hit)));
        }
        let mut ranked = retained
            .into_iter()
            .map(|Reverse(hit)| hit)
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| right.cmp(left));
        let mut hits = Vec::with_capacity(ranked.len());
        for (_, _, _, hit) in ranked {
            if stopped() || Instant::now() >= deadline || !admit(hit.bytes()) {
                return Err("filename search exceeded its time or response budget".into());
            }
            hits.push(hit);
        }
        if stopped() || Instant::now() >= deadline {
            return Err("filename search exceeded its deadline".into());
        }
        Ok(json!({"hits":hits, "truncated":truncated || matched > self.cap}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn scan_and_retained_memory_limits_are_enforced() {
        let directory = tempdir().unwrap();
        for name in ["note-one.txt", "note-two.txt", "note-three.txt"] {
            std::fs::write(directory.path().join(name), "").unwrap();
        }
        let make = || FilenameSearch::prepare(directory.path(), json!({"query":"note"})).unwrap();
        let deadline = Instant::now() + std::time::Duration::from_secs(30);
        let result = make()
            .run_bounded(deadline, &|| false, &|_| true, 2, MAX_RETAINED_BYTES)
            .unwrap();
        assert_eq!(result["hits"].as_array().unwrap().len(), 1);
        assert_eq!(result["truncated"], true);
        assert!(make()
            .run_bounded(deadline, &|| false, &|_| true, MAX_SCANNED, 1)
            .is_err());
        assert!(make().run(deadline, &|| true, &|_| true).is_err());
        assert!(make().run(deadline, &|| false, &|_| false).is_err());
        assert!(make().run(Instant::now(), &|| false, &|_| true).is_err());
    }
}
