//! Optional remote GitHub provider for git-review (Fase 4 of
//! `PROMPTS/planes/PLAN_REVIEW_GITHUB_AGENTICO_CRITTER.md`).
//!
//! Deliberately independent of the `gh` CLI (`modules::harness::fs::gh_run`):
//! that path stays for the harness's issue/PR inbox, but git-review's remote
//! provider must work without any external binary installed, so it talks to
//! the GitHub REST API directly over `ureq` with a stored personal access
//! token. Every command degrades to a clear `Err` (never a panic) when no
//! token is configured, so the caller can fall back to local-only review.

use std::io::Read;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, State};

use crate::identity::KEYRING_SERVICE;
use crate::modules::secrets::{get_secret, SecretsState};

const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_ACCOUNT: &str = "github-pat";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const USER_AGENT: &str = "voktty-app";
const API_VERSION: &str = "2022-11-28";
/// Matches the limit the existing `gh`-based `git_github_pr_diff` already
/// enforces (`modules::harness::fs::MAX_PR_DIFF_BYTES`) so both providers
/// give the review UI the same truncation contract.
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequest {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub state: String,
    pub draft: bool,
    pub base_ref: String,
    pub head_ref: String,
    pub head_sha: String,
    pub html_url: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrDiff {
    pub diff: String,
    pub truncated: bool,
    pub head_sha: String,
}

#[derive(Deserialize)]
struct PrApiRow {
    number: u64,
    title: String,
    user: Option<PrUser>,
    state: String,
    draft: Option<bool>,
    base: PrRef,
    head: PrRef,
    html_url: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct PrUser {
    login: String,
}

#[derive(Deserialize)]
struct PrRef {
    #[serde(rename = "ref")]
    git_ref: String,
    sha: String,
}

impl From<PrApiRow> for GithubPullRequest {
    fn from(row: PrApiRow) -> Self {
        Self {
            number: row.number,
            title: row.title,
            author: row.user.map(|u| u.login).unwrap_or_default(),
            state: row.state,
            draft: row.draft.unwrap_or(false),
            base_ref: row.base.git_ref,
            head_ref: row.head.git_ref,
            head_sha: row.head.sha,
            html_url: row.html_url,
            updated_at: row.updated_at,
        }
    }
}

fn read_token(app: &AppHandle, state: &SecretsState) -> Result<String, String> {
    get_secret(app, state, KEYRING_SERVICE, GITHUB_ACCOUNT)?.ok_or_else(|| {
        "GitHub is not connected. Add a personal access token in Settings to review remote pull requests.".to_string()
    })
}

/// Parses `owner/repo` out of a GitHub remote URL in either form:
/// `https://github.com/owner/repo(.git)` or `git@github.com:owner/repo(.git)`.
/// Returns `None` for a non-GitHub remote (GitLab, Bitbucket, a bare local
/// path, ...) rather than erroring — detection is best-effort, callers
/// degrade to "no remote provider" when it comes back empty.
fn parse_github_owner_repo(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim().trim_end_matches(".git");
    let rest = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("git@github.com:"))
        .or_else(|| trimmed.strip_prefix("ssh://git@github.com/"))?;
    let mut parts = rest.splitn(2, '/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() || repo.contains('/') {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn detect_repo_for(cwd: &std::path::Path) -> Result<Option<String>, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(["remote", "get-url", "origin"]).current_dir(cwd);
    crate::modules::proc::hide_console(&mut cmd);
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Ok(None);
    }
    let url = String::from_utf8_lossy(&output.stdout);
    Ok(parse_github_owner_repo(&url))
}

#[tauri::command]
pub async fn git_review_github_detect_repo(cwd: String) -> Result<Option<String>, String> {
    let path = std::path::PathBuf::from(cwd);
    tauri::async_runtime::spawn_blocking(move || detect_repo_for(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Splits `owner/repo` as accepted from the frontend, resolved via
/// `git_review_github_detect_repo` above (plain `git remote`, never `gh`).
fn split_owner_repo(owner_repo: &str) -> Result<(&str, &str), String> {
    owner_repo
        .split_once('/')
        .filter(|(owner, repo)| !owner.is_empty() && !repo.is_empty())
        .ok_or_else(|| format!("Invalid owner/repo: {owner_repo}"))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build()
}

fn map_status_error(status: u16, body: &str) -> String {
    match status {
        401 => "GitHub token is invalid or expired. Reconnect in Settings.".to_string(),
        403 if body.to_ascii_lowercase().contains("rate limit") => {
            "GitHub API rate limit reached. Try again later.".to_string()
        }
        403 => "GitHub token lacks permission for this action.".to_string(),
        404 => "Not found on GitHub (repo, pull request, or line no longer exists).".to_string(),
        422 => format!("GitHub rejected the request: {body}"),
        other => format!("GitHub API error {other}: {body}"),
    }
}

pub fn list_pull_requests(
    token: &str,
    owner: &str,
    repo: &str,
) -> Result<Vec<GithubPullRequest>, String> {
    let url = format!("{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls?state=open&per_page=50");
    let resp = agent()
        .get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", USER_AGENT)
        .call();

    match resp {
        Ok(response) => {
            let body = response.into_string().map_err(|e| e.to_string())?;
            let rows: Vec<PrApiRow> = serde_json::from_str(&body).map_err(|e| e.to_string())?;
            Ok(rows.into_iter().map(GithubPullRequest::from).collect())
        }
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(map_status_error(status, &body))
        }
        Err(e) => Err(format!("Network error: {e}")),
    }
}

pub fn pull_request_diff(
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<GithubPrDiff, String> {
    // Two requests: the JSON resource for head_sha (the diff media type
    // response has no headers we can trust for that), then the raw diff.
    let meta_url = format!("{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls/{number}");
    let meta_resp = agent()
        .get(&meta_url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", USER_AGENT)
        .call();

    let head_sha = match meta_resp {
        Ok(response) => {
            let body = response.into_string().map_err(|e| e.to_string())?;
            let row: PrApiRow = serde_json::from_str(&body).map_err(|e| e.to_string())?;
            row.head.sha
        }
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            return Err(map_status_error(status, &body));
        }
        Err(e) => return Err(format!("Network error: {e}")),
    };

    let diff_resp = agent()
        .get(&meta_url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github.v3.diff")
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", USER_AGENT)
        .call();

    match diff_resp {
        Ok(response) => {
            let mut buf = Vec::new();
            response
                .into_reader()
                .take((MAX_DIFF_BYTES + 1) as u64)
                .read_to_end(&mut buf)
                .map_err(|e| e.to_string())?;
            let truncated = buf.len() > MAX_DIFF_BYTES;
            if truncated {
                buf.truncate(MAX_DIFF_BYTES);
            }
            let diff = String::from_utf8_lossy(&buf).into_owned();
            Ok(GithubPrDiff {
                diff,
                truncated,
                head_sha,
            })
        }
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(map_status_error(status, &body))
        }
        Err(e) => Err(format!("Network error: {e}")),
    }
}

pub struct ReviewCommentInput<'a> {
    pub owner: &'a str,
    pub repo: &'a str,
    pub number: u64,
    pub commit_id: &'a str,
    pub path: &'a str,
    pub line: u32,
    pub side: &'a str,
    pub body: &'a str,
}

pub fn post_review_comment(token: &str, input: &ReviewCommentInput<'_>) -> Result<(), String> {
    let ReviewCommentInput {
        owner,
        repo,
        number,
        commit_id,
        path,
        line,
        side,
        body,
    } = *input;
    let url = format!("{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls/{number}/comments");
    let payload = json!({
        "commit_id": commit_id,
        "path": path,
        "line": line,
        "side": side,
        "body": body,
    })
    .to_string();
    let resp = agent()
        .post(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("Content-Type", "application/json")
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", USER_AGENT)
        .send_string(&payload);

    match resp {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(map_status_error(status, &body))
        }
        Err(e) => Err(format!("Network error: {e}")),
    }
}

/// `event` must be one of `APPROVE`, `REQUEST_CHANGES`, `COMMENT` — validated
/// by the Tauri command below so an invalid value never reaches GitHub.
pub fn submit_review(
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    commit_id: &str,
    event: &str,
    body: Option<&str>,
) -> Result<(), String> {
    let url = format!("{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls/{number}/reviews");
    let payload = json!({
        "commit_id": commit_id,
        "event": event,
        "body": body.unwrap_or(""),
    })
    .to_string();
    let resp = agent()
        .post(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("Content-Type", "application/json")
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", USER_AGENT)
        .send_string(&payload);

    match resp {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(map_status_error(status, &body))
        }
        Err(e) => Err(format!("Network error: {e}")),
    }
}

fn valid_review_event(event: &str) -> bool {
    matches!(event, "APPROVE" | "REQUEST_CHANGES" | "COMMENT")
}

// ─── Tauri commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn git_review_github_is_connected(
    app: AppHandle,
    state: State<'_, SecretsState>,
) -> Result<bool, String> {
    Ok(get_secret(&app, &state, KEYRING_SERVICE, GITHUB_ACCOUNT)?.is_some())
}

#[tauri::command]
pub async fn git_review_github_list_prs(
    owner_repo: String,
    app: AppHandle,
    state: State<'_, SecretsState>,
) -> Result<Vec<GithubPullRequest>, String> {
    let token = read_token(&app, &state)?;
    let (owner, repo) = split_owner_repo(&owner_repo)?;
    list_pull_requests(&token, owner, repo)
}

#[tauri::command]
pub async fn git_review_github_pr_diff(
    owner_repo: String,
    number: u64,
    app: AppHandle,
    state: State<'_, SecretsState>,
) -> Result<GithubPrDiff, String> {
    let token = read_token(&app, &state)?;
    let (owner, repo) = split_owner_repo(&owner_repo)?;
    pull_request_diff(&token, owner, repo, number)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostReviewCommentPayload {
    pub owner_repo: String,
    pub number: u64,
    pub commit_id: String,
    pub path: String,
    pub line: u32,
    pub side: String,
    pub body: String,
}

#[tauri::command]
pub async fn git_review_github_post_comment(
    payload: PostReviewCommentPayload,
    app: AppHandle,
    state: State<'_, SecretsState>,
) -> Result<(), String> {
    if payload.side != "LEFT" && payload.side != "RIGHT" {
        return Err(format!(
            "Invalid side: {} (expected LEFT or RIGHT)",
            payload.side
        ));
    }
    let token = read_token(&app, &state)?;
    let (owner, repo) = split_owner_repo(&payload.owner_repo)?;
    post_review_comment(
        &token,
        &ReviewCommentInput {
            owner,
            repo,
            number: payload.number,
            commit_id: &payload.commit_id,
            path: &payload.path,
            line: payload.line,
            side: &payload.side,
            body: &payload.body,
        },
    )
}

#[tauri::command]
pub async fn git_review_github_submit_review(
    owner_repo: String,
    number: u64,
    commit_id: String,
    event: String,
    body: Option<String>,
    app: AppHandle,
    state: State<'_, SecretsState>,
) -> Result<(), String> {
    if !valid_review_event(&event) {
        return Err(format!(
            "Invalid review event: {event} (expected APPROVE, REQUEST_CHANGES, or COMMENT)"
        ));
    }
    let token = read_token(&app, &state)?;
    let (owner, repo) = split_owner_repo(&owner_repo)?;
    submit_review(
        &token,
        owner,
        repo,
        number,
        &commit_id,
        &event,
        body.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_valid_owner_repo() {
        assert_eq!(split_owner_repo("acme/widgets"), Ok(("acme", "widgets")));
    }

    #[test]
    fn rejects_malformed_owner_repo() {
        assert!(split_owner_repo("no-slash").is_err());
        assert!(split_owner_repo("/widgets").is_err());
        assert!(split_owner_repo("acme/").is_err());
    }

    #[test]
    fn parses_https_and_ssh_github_remotes() {
        assert_eq!(
            parse_github_owner_repo("https://github.com/acme/widgets.git\n"),
            Some("acme/widgets".to_string())
        );
        assert_eq!(
            parse_github_owner_repo("https://github.com/acme/widgets"),
            Some("acme/widgets".to_string())
        );
        assert_eq!(
            parse_github_owner_repo("git@github.com:acme/widgets.git\n"),
            Some("acme/widgets".to_string())
        );
        assert_eq!(
            parse_github_owner_repo("ssh://git@github.com/acme/widgets.git"),
            Some("acme/widgets".to_string())
        );
    }

    #[test]
    fn rejects_non_github_remotes() {
        assert_eq!(
            parse_github_owner_repo("https://gitlab.com/acme/widgets.git"),
            None
        );
        assert_eq!(parse_github_owner_repo("/local/bare/repo.git"), None);
        assert_eq!(
            parse_github_owner_repo("git@github.com:acme/widgets/extra.git"),
            None
        );
    }

    #[test]
    fn validates_review_events() {
        assert!(valid_review_event("APPROVE"));
        assert!(valid_review_event("REQUEST_CHANGES"));
        assert!(valid_review_event("COMMENT"));
        assert!(!valid_review_event("approve"));
        assert!(!valid_review_event("MERGE"));
        assert!(!valid_review_event(""));
    }

    #[test]
    fn maps_known_status_codes_to_actionable_messages() {
        assert!(map_status_error(401, "").contains("invalid or expired"));
        assert!(map_status_error(404, "").contains("Not found"));
        assert!(map_status_error(403, "API rate limit exceeded").contains("rate limit"));
        assert!(map_status_error(403, "no scope").contains("permission"));
    }

    #[test]
    fn deserializes_pr_row_into_public_shape() {
        let raw = r#"{
            "number": 42,
            "title": "Add feature",
            "user": {"login": "octocat"},
            "state": "open",
            "draft": false,
            "base": {"ref": "main", "sha": "aaa"},
            "head": {"ref": "feature", "sha": "bbb"},
            "html_url": "https://github.com/acme/widgets/pull/42",
            "updated_at": "2026-09-08T00:00:00Z"
        }"#;
        let row: PrApiRow = serde_json::from_str(raw).unwrap();
        let pr: GithubPullRequest = row.into();
        assert_eq!(pr.number, 42);
        assert_eq!(pr.author, "octocat");
        assert_eq!(pr.head_sha, "bbb");
        assert!(!pr.draft);
    }
}
