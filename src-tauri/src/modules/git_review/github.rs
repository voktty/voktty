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

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrBranchStatus {
    pub default_branch: String,
    pub pull_request: Option<GithubPullRequest>,
    pub ahead_by: Option<u32>,
    pub behind_by: Option<u32>,
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
    let (owner, repo) = owner_repo
        .split_once('/')
        .filter(|(owner, repo)| !owner.is_empty() && !repo.is_empty())
        .ok_or_else(|| format!("Invalid owner/repo: {owner_repo}"))?;
    if !valid_repo_segment(owner) || !valid_repo_segment(repo) {
        return Err("Invalid GitHub repository name".into());
    }
    Ok((owner, repo))
}

fn valid_repo_segment(value: &str) -> bool {
    value.len() <= 100
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_' | '.'))
}

fn valid_git_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value.starts_with('-')
        && !value.ends_with(['.', '/'])
        && !value.contains("..")
        && !value.contains("@{")
        && !value.chars().any(|char| {
            char.is_control() || matches!(char, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\')
        })
        && !value
            .split('/')
            .any(|part| part.is_empty() || part.starts_with('.') || part.ends_with(".lock"))
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

#[derive(Deserialize)]
struct GithubRepository {
    default_branch: String,
}

#[derive(Deserialize)]
struct GithubBranchComparison {
    ahead_by: u32,
    behind_by: u32,
}

pub fn pull_request_branch_status(
    token: &str,
    owner: &str,
    repo: &str,
    head: &str,
) -> Result<GithubPrBranchStatus, String> {
    pull_request_branch_status_at(GITHUB_API_BASE, token, owner, repo, head)
}

fn pull_request_branch_status_at(
    api_base: &str,
    token: &str,
    owner: &str,
    repo: &str,
    head: &str,
) -> Result<GithubPrBranchStatus, String> {
    if !valid_git_ref(head) {
        return Err("Invalid Git branch name".into());
    }

    let repository_url = format!("{api_base}/repos/{owner}/{repo}");
    let repository = github_get(token, &repository_url)?;
    let repository: GithubRepository =
        serde_json::from_str(&repository).map_err(|error| error.to_string())?;
    if !valid_git_ref(&repository.default_branch) {
        return Err("GitHub returned an invalid default branch name".into());
    }

    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("head", &format!("{owner}:{head}"))
        .append_pair("state", "open")
        .append_pair("per_page", "1")
        .finish();
    let pulls_url = format!("{repository_url}/pulls?{query}");
    let pulls = github_get(token, &pulls_url)?;
    let pulls: Vec<PrApiRow> = serde_json::from_str(&pulls).map_err(|error| error.to_string())?;
    let pull_request = pulls
        .into_iter()
        .map(GithubPullRequest::from)
        .find(|pull| pull.head_ref == head && pull.state == "open");

    let comparison = if head == repository.default_branch {
        Some((0, 0))
    } else {
        compare_github_branches(
            api_base,
            token,
            owner,
            repo,
            &repository.default_branch,
            head,
        )?
    };

    Ok(GithubPrBranchStatus {
        default_branch: repository.default_branch,
        pull_request,
        ahead_by: comparison.map(|(ahead, _)| ahead),
        behind_by: comparison.map(|(_, behind)| behind),
    })
}

fn github_get(token: &str, url: &str) -> Result<String, String> {
    match agent()
        .get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", USER_AGENT)
        .call()
    {
        Ok(response) => response.into_string().map_err(|error| error.to_string()),
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(map_status_error(status, &body))
        }
        Err(error) => Err(format!("Network error: {error}")),
    }
}

fn compare_github_branches(
    api_base: &str,
    token: &str,
    owner: &str,
    repo: &str,
    base: &str,
    head: &str,
) -> Result<Option<(u32, u32)>, String> {
    let compare = format!("{base}...{owner}:{head}");
    let mut url = url::Url::parse(api_base).map_err(|error| error.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "Invalid GitHub API base URL")?
        .extend(["repos", owner, repo, "compare", &compare]);

    match agent()
        .get(url.as_str())
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", USER_AGENT)
        .call()
    {
        Ok(response) => {
            let body = response.into_string().map_err(|error| error.to_string())?;
            let comparison: GithubBranchComparison =
                serde_json::from_str(&body).map_err(|error| error.to_string())?;
            Ok(Some((comparison.ahead_by, comparison.behind_by)))
        }
        Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(map_status_error(status, &body))
        }
        Err(error) => Err(format!("Network error: {error}")),
    }
}

pub struct CreatePullRequestInput<'a> {
    pub owner: &'a str,
    pub repo: &'a str,
    pub title: &'a str,
    pub body: &'a str,
    pub base: &'a str,
    pub head: &'a str,
}

fn validate_create_pull_request(input: &CreatePullRequestInput<'_>) -> Result<(), String> {
    if !valid_repo_segment(input.owner) || !valid_repo_segment(input.repo) {
        return Err("Invalid GitHub repository name".into());
    }
    if input.title.trim().is_empty()
        || input.title.chars().count() > 256
        || input.title.contains(['\n', '\r'])
    {
        return Err("Pull request title must be one line with at most 256 characters".into());
    }
    if input.body.chars().count() > 65_536 {
        return Err("Pull request description exceeds 65536 characters".into());
    }
    if !valid_git_ref(input.base) || !valid_git_ref(input.head) || input.base == input.head {
        return Err("Invalid pull request base or head branch".into());
    }
    Ok(())
}

#[derive(Deserialize)]
struct GithubCreatedPullRequest {
    html_url: String,
}

pub fn create_pull_request(
    token: &str,
    input: &CreatePullRequestInput<'_>,
) -> Result<String, String> {
    create_pull_request_at(GITHUB_API_BASE, token, input)
}

fn create_pull_request_at(
    api_base: &str,
    token: &str,
    input: &CreatePullRequestInput<'_>,
) -> Result<String, String> {
    validate_create_pull_request(input)?;
    let url = format!("{api_base}/repos/{}/{}/pulls", input.owner, input.repo);
    let payload = json!({
        "title": input.title.trim(),
        "body": input.body,
        "base": input.base,
        "head": input.head,
    })
    .to_string();
    let response = agent()
        .post(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("Content-Type", "application/json")
        .set("X-GitHub-Api-Version", API_VERSION)
        .set("User-Agent", USER_AGENT)
        .send_string(&payload);

    match response {
        Ok(response) => {
            let body = response.into_string().map_err(|error| error.to_string())?;
            let created: GithubCreatedPullRequest =
                serde_json::from_str(&body).map_err(|error| error.to_string())?;
            let parsed_url = url::Url::parse(&created.html_url)
                .map_err(|_| "GitHub returned an invalid pull request URL")?;
            if parsed_url.scheme() != "https" || parsed_url.host_str() != Some("github.com") {
                return Err("GitHub returned an invalid pull request URL".into());
            }
            Ok(created.html_url)
        }
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(map_status_error(status, &body))
        }
        Err(error) => Err(format!("Network error: {error}")),
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
pub async fn git_review_github_branch_status(
    owner_repo: String,
    head: String,
    app: AppHandle,
    state: State<'_, SecretsState>,
) -> Result<GithubPrBranchStatus, String> {
    let token = read_token(&app, &state)?;
    let (owner, repo) = split_owner_repo(&owner_repo)?;
    pull_request_branch_status(&token, owner, repo, &head)
}

#[tauri::command]
pub async fn git_review_github_create_pr(
    owner_repo: String,
    title: String,
    body: String,
    base: String,
    head: String,
    app: AppHandle,
    state: State<'_, SecretsState>,
) -> Result<String, String> {
    let token = read_token(&app, &state)?;
    let (owner, repo) = split_owner_repo(&owner_repo)?;
    create_pull_request(
        &token,
        &CreatePullRequestInput {
            owner,
            repo,
            title: &title,
            body: &body,
            base: &base,
            head: &head,
        },
    )
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
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    #[test]
    fn splits_valid_owner_repo() {
        assert_eq!(split_owner_repo("acme/widgets"), Ok(("acme", "widgets")));
    }

    #[test]
    fn rejects_malformed_owner_repo() {
        assert!(split_owner_repo("no-slash").is_err());
        assert!(split_owner_repo("/widgets").is_err());
        assert!(split_owner_repo("acme/").is_err());
        assert!(split_owner_repo("acme/widgets?state=all").is_err());
        assert!(split_owner_repo("acme/widgets/extra").is_err());
    }

    #[test]
    fn validates_pull_request_inputs_before_network_access() {
        let valid = CreatePullRequestInput {
            owner: "acme",
            repo: "widgets",
            title: "Add widgets",
            body: "Summary",
            base: "main",
            head: "feature/widgets",
        };
        assert!(validate_create_pull_request(&valid).is_ok());

        let empty_title = CreatePullRequestInput {
            title: "  ",
            ..valid
        };
        assert!(validate_create_pull_request(&empty_title).is_err());

        let same_branch = CreatePullRequestInput {
            base: "main",
            head: "main",
            ..valid
        };
        assert!(validate_create_pull_request(&same_branch).is_err());

        let invalid_ref = CreatePullRequestInput {
            head: "feature\n--force",
            ..valid
        };
        assert!(validate_create_pull_request(&invalid_ref).is_err());

        let long_body = "x".repeat(65_537);
        let oversized = CreatePullRequestInput {
            body: &long_body,
            ..valid
        };
        assert!(validate_create_pull_request(&oversized).is_err());
    }

    #[test]
    fn validates_git_refs_used_for_pull_requests() {
        assert!(valid_git_ref("feature/a-b"));
        assert!(!valid_git_ref("-option"));
        assert!(!valid_git_ref("feature..branch"));
        assert!(!valid_git_ref("feature/"));
        assert!(!valid_git_ref("feature/.hidden"));
    }

    #[test]
    fn creates_pull_request_with_the_requested_branches_and_content() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut request_line = String::new();
            reader.read_line(&mut request_line).unwrap();
            assert!(request_line.starts_with("POST /repos/acme/widgets/pulls HTTP/1.1"));

            let mut content_length = 0;
            let mut authorization = String::new();
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header == "\r\n" {
                    break;
                }
                if let Some(value) = header.strip_prefix("Content-Length: ") {
                    content_length = value.trim().parse::<usize>().unwrap();
                }
                if let Some(value) = header.strip_prefix("Authorization: ") {
                    authorization = value.trim().to_string();
                }
            }
            assert_eq!(authorization, "Bearer test-token");
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).unwrap();
            let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(payload["title"], "Add widgets");
            assert_eq!(payload["body"], "Summary");
            assert_eq!(payload["base"], "main");
            assert_eq!(payload["head"], "feature/widgets");

            let response = r#"{"html_url":"https://github.com/acme/widgets/pull/42"}"#;
            write!(
                reader.get_mut(),
                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response
            )
            .unwrap();
        });

        let input = CreatePullRequestInput {
            owner: "acme",
            repo: "widgets",
            title: "Add widgets",
            body: "Summary",
            base: "main",
            head: "feature/widgets",
        };
        let result = create_pull_request_at(&format!("http://{address}"), "test-token", &input);
        assert_eq!(
            result.as_deref(),
            Ok("https://github.com/acme/widgets/pull/42")
        );
        server.join().unwrap();
    }

    #[test]
    fn loads_default_branch_open_pr_and_remote_comparison() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let requests = [
                (
                    "/repos/acme/widgets HTTP/1.1",
                    r#"{"default_branch":"main"}"#,
                ),
                (
                    "/repos/acme/widgets/pulls?head=acme%3Afeature%2Fwidgets&state=open&per_page=1 HTTP/1.1",
                    r#"[{"number":42,"title":"Add widgets","user":{"login":"octocat"},"state":"open","draft":false,"base":{"ref":"main","sha":"aaa"},"head":{"ref":"feature/widgets","sha":"bbb"},"html_url":"https://github.com/acme/widgets/pull/42","updated_at":"2026-09-08T00:00:00Z"}]"#,
                ),
                (
                    "/repos/acme/widgets/compare/main...acme:feature%2Fwidgets HTTP/1.1",
                    r#"{"ahead_by":2,"behind_by":0}"#,
                ),
            ];

            for (expected_path, body) in requests {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream);
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                assert!(request_line.contains(expected_path), "{request_line}");
                loop {
                    let mut header = String::new();
                    reader.read_line(&mut header).unwrap();
                    if header == "\r\n" {
                        break;
                    }
                }
                write!(
                    reader.get_mut(),
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            }
        });

        let status = pull_request_branch_status_at(
            &format!("http://{address}"),
            "test-token",
            "acme",
            "widgets",
            "feature/widgets",
        )
        .unwrap();
        assert_eq!(status.default_branch, "main");
        assert_eq!(status.ahead_by, Some(2));
        assert_eq!(status.behind_by, Some(0));
        assert_eq!(status.pull_request.unwrap().number, 42);
        server.join().unwrap();
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
