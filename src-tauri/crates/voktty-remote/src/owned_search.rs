use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use globset::Glob;
use ignore::WalkBuilder;
use serde::Deserialize;
use serde_json::{json, Value};
use voktty_remote_protocol::{RemoteRequest, RemoteResponse, METHOD_GLOB, METHOD_GREP_INDEPENDENT};

use crate::search::{
    prepare_independent, resolve_search_root_literal, run_search_bounded, PreparedSearch,
};

const MAX_JOBS: usize = 8;
const MAX_RESULTS: usize = 2_000;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_DURATION: Duration = Duration::from_secs(30);

fn try_add(counter: &AtomicUsize, amount: usize, limit: usize) -> bool {
    let mut current = counter.load(Ordering::SeqCst);
    loop {
        let Some(next) = current.checked_add(amount).filter(|next| *next <= limit) else {
            return false;
        };
        match counter.compare_exchange_weak(current, next, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return true,
            Err(actual) => current = actual,
        }
    }
}

#[derive(Default)]
pub struct OwnedSearchState {
    active: Arc<AtomicUsize>,
}

struct Permit(Arc<AtomicUsize>);

impl Drop for Permit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GlobParams {
    pattern: String,
    cwd: Option<String>,
    max_results: Option<usize>,
}

enum Query {
    Grep(PreparedSearch),
    Glob(PathBuf, globset::GlobMatcher, usize),
}

struct Budget {
    deadline: Instant,
    bytes: AtomicUsize,
    exhausted: AtomicBool,
}

impl Budget {
    fn stopped(&self) -> bool {
        self.exhausted.load(Ordering::Relaxed) || Instant::now() >= self.deadline
    }

    fn admit(&self, bytes: usize) -> bool {
        // Six bytes cover the worst-case JSON escape of one input byte.
        let charge = bytes.saturating_mul(6).saturating_add(256);
        if self.stopped() || !try_add(&self.bytes, charge, MAX_RESPONSE_BYTES) {
            self.exhausted.store(true, Ordering::Relaxed);
            return false;
        }
        true
    }
}

pub struct OwnedSearchJob {
    id: String,
    query: Option<Query>,
    budget: Budget,
    _permit: Permit,
}

impl OwnedSearchState {
    pub fn prepare(
        &self,
        root: Option<&Path>,
        request: RemoteRequest,
    ) -> Result<OwnedSearchJob, RemoteResponse> {
        let fail = |code: &str, message: String| {
            RemoteResponse::failure(request.id.clone(), code, message)
        };
        let root =
            root.ok_or_else(|| fail("handshake_required", "handshake is required".into()))?;
        if !try_add(&self.active, 1, MAX_JOBS) {
            return Err(fail(
                "search_limit",
                "too many unsettled remote searches".into(),
            ));
        }
        let permit = Permit(self.active.clone());
        let budget = Budget {
            deadline: Instant::now() + MAX_DURATION,
            bytes: AtomicUsize::new(256),
            exhausted: AtomicBool::new(false),
        };
        let bytes = serde_json::to_vec(&request.params)
            .map_err(|error| fail("invalid_params", error.to_string()))?;
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err(fail(
                "invalid_params",
                "search parameters exceed the request limit".into(),
            ));
        }
        let query = match request.method.as_str() {
            METHOD_GREP_INDEPENDENT => Query::Grep(
                prepare_independent(root, request.params.clone())
                    .map_err(|error| fail("invalid_params", error))?,
            ),
            METHOD_GLOB => {
                let params: GlobParams = serde_json::from_value(request.params.clone())
                    .map_err(|error| fail("invalid_params", error.to_string()))?;
                if params.pattern.is_empty() {
                    return Err(fail("invalid_params", "empty pattern".into()));
                }
                let (_, search_root) = resolve_search_root_literal(root, params.cwd.as_deref())
                    .map_err(|error| fail("invalid_params", error))?;
                let matcher = Glob::new(&params.pattern)
                    .map_err(|error| fail("invalid_params", error.to_string()))?
                    .compile_matcher();
                Query::Glob(
                    search_root,
                    matcher,
                    params.max_results.unwrap_or(500).clamp(1, MAX_RESULTS),
                )
            }
            _ => {
                return Err(fail(
                    "method_not_found",
                    "unknown remote search method".into(),
                ))
            }
        };
        Ok(OwnedSearchJob {
            id: request.id,
            query: Some(query),
            budget,
            _permit: permit,
        })
    }
}

impl OwnedSearchJob {
    pub fn run(&mut self) -> RemoteResponse {
        let result = match self.query.take() {
            Some(Query::Grep(search)) => {
                run_search_bounded(search, &|| self.budget.stopped(), &|bytes| {
                    self.budget.admit(bytes)
                })
            }
            Some(Query::Glob(root, matcher, cap)) => self.glob(&root, &matcher, cap),
            None => Err("remote search was already executed".into()),
        };
        let result = if self.budget.stopped() {
            Err("remote search exceeded its time or response budget".to_string())
        } else {
            result
        };
        match result {
            Ok(value) => RemoteResponse::success(self.id.clone(), value),
            Err(error) => RemoteResponse::failure(self.id.clone(), "search_failed", error),
        }
    }

    fn glob(
        &self,
        root: &Path,
        matcher: &globset::GlobMatcher,
        cap: usize,
    ) -> Result<Value, String> {
        let walker = WalkBuilder::new(root)
            .hidden(true)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .ignore(true)
            .parents(true)
            .follow_links(false)
            .build();
        let mut hits = Vec::new();
        let mut truncated = false;
        for entry in walker {
            if self.budget.stopped() {
                break;
            }
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                continue;
            }
            let rel = entry
                .path()
                .strip_prefix(root)
                .map_err(|error| error.to_string())?;
            if !matcher.is_match(rel) {
                continue;
            }
            if hits.len() >= cap {
                truncated = true;
                break;
            }
            let path = entry.path().to_string_lossy();
            let rel = rel.to_string_lossy();
            if !self.budget.admit(path.len().saturating_add(rel.len())) {
                break;
            }
            hits.push(json!({ "path": path, "rel": rel }));
        }
        hits.sort_by(|left, right| left["rel"].as_str().cmp(&right["rel"].as_str()));
        Ok(json!({ "hits": hits, "truncated": truncated }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RemoteServer;
    use tempfile::tempdir;
    use voktty_remote_protocol::{METHOD_GREP, METHOD_HANDSHAKE, PROTOCOL_VERSION};

    fn request(method: &str, params: Value) -> RemoteRequest {
        RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "search".into(),
            method: method.into(),
            params,
        }
    }

    #[test]
    fn advertises_and_routes_authenticated_search_methods() {
        let directory = tempdir().unwrap();
        std::fs::write(directory.path().join("empty.bin"), []).unwrap();
        std::fs::write(directory.path().join("binary.bin"), [0, 255]).unwrap();
        let mut server = RemoteServer::new();
        for method in [METHOD_GLOB, METHOD_GREP_INDEPENDENT] {
            assert!(!server.handle(request(method, json!({"pattern": "*"}))).ok);
        }
        let ready = server.handle(request(
            METHOD_HANDSHAKE,
            json!({"workspaceRoot": directory.path()}),
        ));
        let capabilities = ready.result.unwrap()["capabilities"]
            .as_array()
            .unwrap()
            .clone();
        for method in [METHOD_GLOB, METHOD_GREP_INDEPENDENT] {
            assert!(capabilities.iter().any(|value| value == method));
        }
        let result = server.handle(request(METHOD_GLOB, json!({"pattern": "*.bin"})));
        assert!(result.ok, "{:?}", result.error);
        assert_eq!(result.result.unwrap()["hits"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn independent_jobs_neither_cancel_nor_inherit_interactive_searches() {
        let directory = tempdir().unwrap();
        std::fs::write(directory.path().join("note.txt"), "needle\n").unwrap();
        let state = OwnedSearchState::default();
        let mut server = RemoteServer::new();
        assert!(
            server
                .handle(request(
                    METHOD_HANDSHAKE,
                    json!({"workspaceRoot": directory.path()})
                ))
                .ok
        );
        let interactive = server
            .search
            .prepare(directory.path(), json!({"pattern": "needle"}))
            .unwrap();
        let response = server.handle(request(
            METHOD_GREP_INDEPENDENT,
            json!({"pattern": "needle"}),
        ));
        assert!(response.ok, "{:?}", response.error);
        assert_eq!(
            crate::search::run_search(interactive).unwrap()["cancelled"],
            false
        );
        let mut pending = state
            .prepare(
                Some(directory.path()),
                request(METHOD_GREP_INDEPENDENT, json!({"pattern": "needle"})),
            )
            .unwrap();
        server.search.cancel();
        assert!(pending.run().ok);
        assert!(
            server
                .handle(request(METHOD_GREP, json!({"pattern": "needle"})))
                .ok
        );
    }

    #[test]
    fn jobs_retain_capacity_until_their_owner_is_dropped() {
        let directory = tempdir().unwrap();
        let state = OwnedSearchState::default();
        let mut jobs = Vec::new();
        for _ in 0..MAX_JOBS {
            jobs.push(
                state
                    .prepare(
                        Some(directory.path()),
                        request(METHOD_GLOB, json!({"pattern": "*"})),
                    )
                    .unwrap(),
            );
        }
        assert!(jobs[0].run().ok);
        assert!(state
            .prepare(
                Some(directory.path()),
                request(METHOD_GLOB, json!({"pattern": "*"}))
            )
            .is_err());
        jobs.pop();
        assert!(state
            .prepare(
                Some(directory.path()),
                request(METHOD_GLOB, json!({"pattern": "*"}))
            )
            .is_ok());
    }

    #[test]
    fn rejects_escapes_invalid_patterns_and_oversized_requests_without_consuming_slots() {
        let directory = tempdir().unwrap();
        let state = OwnedSearchState::default();
        for method in [METHOD_GLOB, METHOD_GREP_INDEPENDENT] {
            for cwd in ["../outside", "/", "nested/../../outside"] {
                assert!(state
                    .prepare(
                        Some(directory.path()),
                        request(method, json!({"pattern": "*", "cwd": cwd}))
                    )
                    .is_err());
            }
            assert!(state
                .prepare(
                    Some(directory.path()),
                    request(method, json!({"pattern": "x".repeat(MAX_REQUEST_BYTES+1)}))
                )
                .is_err());
        }
        assert!(state
            .prepare(
                Some(directory.path()),
                request(METHOD_GLOB, json!({"pattern": "["}))
            )
            .is_err());
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn caps_results_and_uses_search_root_relative_patterns_and_paths() {
        let directory = tempdir().unwrap();
        std::fs::create_dir(directory.path().join("src")).unwrap();
        for name in ["one.txt", "two.txt"] {
            std::fs::write(directory.path().join("src").join(name), "needle").unwrap();
        }
        std::fs::write(directory.path().join("outside.txt"), "needle").unwrap();
        let state = OwnedSearchState::default();
        for (method, params) in [
            (
                METHOD_GLOB,
                json!({"cwd":"src", "pattern":"*.txt", "maxResults":1}),
            ),
            (
                METHOD_GREP_INDEPENDENT,
                json!({"cwd":"src", "pattern":"needle", "include":["*.txt"], "maxResults":1}),
            ),
        ] {
            let result = state
                .prepare(Some(directory.path()), request(method, params))
                .unwrap()
                .run();
            assert!(result.ok, "{:?}", result.error);
            let result = result.result.unwrap();
            assert_eq!(result["hits"].as_array().unwrap().len(), 1);
            assert!(result["hits"][0]["rel"].as_str().unwrap().ends_with(".txt"));
            assert!(!result["hits"][0]["rel"].as_str().unwrap().contains('/'));
            assert_eq!(result["truncated"], true);
        }
    }

    #[test]
    fn fails_closed_on_expired_deadlines_and_exhausted_response_budgets() {
        let directory = tempdir().unwrap();
        std::fs::write(directory.path().join("note.txt"), "needle").unwrap();
        let state = OwnedSearchState::default();
        for method in [METHOD_GLOB, METHOD_GREP_INDEPENDENT] {
            let params = json!({"pattern": if method == METHOD_GLOB {"*"} else {"needle"}});
            let mut expired = state
                .prepare(Some(directory.path()), request(method, params.clone()))
                .unwrap();
            expired.budget.deadline = Instant::now();
            assert!(!expired.run().ok);
            let mut full = state
                .prepare(Some(directory.path()), request(method, params))
                .unwrap();
            full.budget
                .bytes
                .store(MAX_RESPONSE_BYTES, Ordering::Relaxed);
            assert!(!full.run().ok);
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_root_escapes_and_never_enumerates_symlink_files_or_folders() {
        let directory = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::fs::write(outside.path().join("note.txt"), "needle").unwrap();
        std::os::unix::fs::symlink(outside.path(), directory.path().join("linked")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("note.txt"),
            directory.path().join("linked.txt"),
        )
        .unwrap();
        let state = OwnedSearchState::default();
        for method in [METHOD_GLOB, METHOD_GREP_INDEPENDENT] {
            assert!(state
                .prepare(
                    Some(directory.path()),
                    request(method, json!({"pattern":"needle", "cwd":"linked"}))
                )
                .is_err());
            let params = json!({"pattern": if method == METHOD_GLOB {"**/*"} else {"needle"}});
            let result = state
                .prepare(Some(directory.path()), request(method, params))
                .unwrap()
                .run()
                .result
                .unwrap();
            assert_eq!(result["hits"].as_array().unwrap().len(), 0);
        }
    }

    #[test]
    fn honors_gitignore_and_hidden_files_for_both_methods() {
        let directory = tempdir().unwrap();
        std::fs::create_dir(directory.path().join(".git")).unwrap();
        std::fs::write(directory.path().join(".gitignore"), "ignored.txt\n").unwrap();
        for name in ["visible.txt", ".hidden.txt", "ignored.txt"] {
            std::fs::write(directory.path().join(name), "needle").unwrap();
        }
        let state = OwnedSearchState::default();
        for method in [METHOD_GLOB, METHOD_GREP_INDEPENDENT] {
            let result = state
                .prepare(
                    Some(directory.path()),
                    request(
                        method,
                        json!({"pattern": if method == METHOD_GLOB {"*.txt"} else {"needle"}}),
                    ),
                )
                .unwrap()
                .run();
            assert!(result.ok, "{:?}", result.error);
            let result = result.result.unwrap();
            assert_eq!(result["hits"].as_array().unwrap().len(), 1);
            assert_eq!(result["hits"][0]["rel"], "visible.txt");
        }
    }

    #[test]
    fn rejects_a_large_regex_preview_before_returning_partial_results() {
        let directory = tempdir().unwrap();
        std::fs::write(directory.path().join("large.txt"), "x".repeat(1024 * 1024)).unwrap();
        let mut job = OwnedSearchState::default()
            .prepare(
                Some(directory.path()),
                request(
                    METHOD_GREP_INDEPENDENT,
                    json!({"pattern":".*", "regex":true}),
                ),
            )
            .unwrap();
        let response = job.run();
        assert!(!response.ok);
        assert!(response.result.is_none());
        assert!(job.budget.exhausted.load(Ordering::Relaxed));
    }

    #[test]
    fn async_worker_retains_admission_until_its_output_has_settled() {
        use std::sync::{mpsc, Mutex};
        let directory = tempdir().unwrap();
        let mut server = RemoteServer::new();
        assert!(
            server
                .handle(request(
                    METHOD_HANDSHAKE,
                    json!({"workspaceRoot":directory.path()})
                ))
                .ok
        );
        let (sent, ready) = mpsc::channel();
        let (release, gate) = mpsc::channel();
        let gate = Mutex::new(gate);
        let sink = Arc::new(move |frame| {
            sent.send(frame).unwrap();
            gate.lock().unwrap().recv().unwrap();
            Ok(())
        });
        let mut held = Vec::new();
        for _ in 0..MAX_JOBS - 1 {
            held.push(
                server
                    .owned_search
                    .prepare(
                        Some(directory.path()),
                        request(METHOD_GLOB, json!({"pattern":"*"})),
                    )
                    .unwrap(),
            );
        }
        assert!(server
            .start_owned_search(request(METHOD_GLOB, json!({"pattern":"*"})), sink)
            .is_none());
        let result = ready.recv_timeout(Duration::from_secs(2)).unwrap();
        let voktty_remote_protocol::Frame::Response(response) = result else {
            panic!("expected search response");
        };
        assert!(response.ok);
        let overflow = server.owned_search.prepare(
            Some(directory.path()),
            request(METHOD_GLOB, json!({"pattern":"*"})),
        );
        release.send(()).unwrap();
        assert!(overflow.is_err());
        let deadline = Instant::now() + Duration::from_secs(2);
        while server.owned_search.active.load(Ordering::SeqCst) == MAX_JOBS
            && Instant::now() < deadline
        {
            std::thread::yield_now();
        }
        assert_eq!(
            server.owned_search.active.load(Ordering::SeqCst),
            MAX_JOBS - 1
        );
    }

    #[cfg(unix)]
    #[test]
    fn preserves_literal_posix_backslashes_in_roots_and_result_paths() {
        let directory = tempdir().unwrap();
        let nested = directory.path().join("literal\\folder");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(nested.join("literal\\file.txt"), "needle").unwrap();
        let state = OwnedSearchState::default();
        for method in [METHOD_GLOB, METHOD_GREP_INDEPENDENT] {
            let params = json!({"cwd":"literal\\folder", "pattern": if method == METHOD_GLOB {"*"} else {"needle"}});
            let result = state
                .prepare(Some(directory.path()), request(method, params))
                .unwrap()
                .run();
            assert!(result.ok, "{:?}", result.error);
            let result = result.result.unwrap();
            assert_eq!(result["hits"][0]["rel"], "literal\\file.txt");
            assert_eq!(
                result["hits"][0]["path"],
                nested.join("literal\\file.txt").to_str().unwrap()
            );
        }
    }

    #[test]
    fn independent_regex_can_match_literal_whitespace() {
        let directory = tempdir().unwrap();
        std::fs::write(directory.path().join("note.txt"), "one two").unwrap();
        let mut job = OwnedSearchState::default()
            .prepare(
                Some(directory.path()),
                request(
                    METHOD_GREP_INDEPENDENT,
                    json!({"pattern":" ", "regex":true}),
                ),
            )
            .unwrap();
        let response = job.run();
        assert!(response.ok, "{:?}", response.error);
        assert_eq!(
            response.result.unwrap()["hits"].as_array().unwrap().len(),
            1
        );
    }

    #[cfg(unix)]
    #[test]
    fn never_reinterprets_a_whitespace_directory_as_the_authenticated_root() {
        let directory = tempdir().unwrap();
        std::fs::create_dir(directory.path().join(" ")).unwrap();
        std::fs::write(directory.path().join(" ").join("inside.txt"), "needle").unwrap();
        std::fs::write(directory.path().join("outside.txt"), "needle").unwrap();
        let state = OwnedSearchState::default();
        for method in [METHOD_GLOB, METHOD_GREP_INDEPENDENT] {
            let params =
                json!({"cwd":" ", "pattern": if method == METHOD_GLOB {"*"} else {"needle"}});
            let response = state
                .prepare(Some(directory.path()), request(method, params))
                .unwrap()
                .run();
            assert!(response.ok, "{:?}", response.error);
            let result = response.result.unwrap();
            assert_eq!(result["hits"].as_array().unwrap().len(), 1);
            assert_eq!(result["hits"][0]["rel"], "inside.txt");
        }
    }
}
