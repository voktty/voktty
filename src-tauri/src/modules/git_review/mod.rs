pub mod blob_store;
pub mod db;
pub mod diff;
pub mod github;
pub mod models;
pub mod reconcile;

use blob_store::BlobStore;
use db::ReviewDb;
use models::{
    AddReviewCommentPayload, Reconciliation, ReviewComment, ReviewSession, SessionReviewOverview,
    UpdateReviewCommentPayload,
};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tauri::State;

pub struct GitReviewState {
    db_path: PathBuf,
    blob_path: PathBuf,
    resources: OnceLock<Result<ReviewResources, String>>,
}

struct ReviewResources {
    db: Arc<ReviewDb>,
    blob_store: Arc<BlobStore>,
}

impl Default for GitReviewState {
    fn default() -> Self {
        Self::new()
    }
}

impl GitReviewState {
    pub fn new() -> Self {
        let db_path = ReviewDb::default_db_path().unwrap_or_else(|| PathBuf::from("review.db"));
        let blob_path = dirs::data_dir()
            .map(|dir| dir.join("voktty").join("review_blobs"))
            .unwrap_or_else(|| PathBuf::from("review_blobs"));
        Self::with_paths(db_path, blob_path)
    }

    fn with_paths(db_path: PathBuf, blob_path: PathBuf) -> Self {
        Self {
            db_path,
            blob_path,
            resources: OnceLock::new(),
        }
    }

    fn resources(&self) -> Result<&ReviewResources, String> {
        self.resources
            .get_or_init(|| {
                let db = ReviewDb::open(&self.db_path).or_else(|primary| {
                    ReviewDb::open_in_memory().map_err(|fallback| {
                        format!("Could not open review database: {primary}; fallback: {fallback}")
                    })
                })?;
                Ok(ReviewResources {
                    db: Arc::new(db),
                    blob_store: Arc::new(BlobStore::new(&self.blob_path)),
                })
            })
            .as_ref()
            .map_err(Clone::clone)
    }
}

#[tauri::command]
pub async fn git_review_open_session(
    repo_root: String,
    target: String,
    base_ref: Option<String>,
    head_ref: Option<String>,
    state: State<'_, GitReviewState>,
) -> Result<ReviewSession, String> {
    state
        .resources()?
        .db
        .open_session(
            &repo_root,
            &target,
            base_ref.as_deref(),
            head_ref.as_deref(),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_review_mark_file(
    repo_root: String,
    target: String,
    path: String,
    content: String,
    viewed: bool,
    state: State<'_, GitReviewState>,
) -> Result<(), String> {
    let session = state
        .resources()?
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    let hash = if viewed {
        state.resources()?.blob_store.store(&content)?
    } else {
        String::new()
    };

    state
        .resources()?
        .db
        .mark_file_viewed(&session.id, &path, &hash, viewed)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_review_mark_range(
    payload: models::MarkRangePayload,
    state: State<'_, GitReviewState>,
) -> Result<(), String> {
    let session = state
        .resources()?
        .db
        .open_session(&payload.repo_root, &payload.target, None, None)
        .map_err(|e| e.to_string())?;

    let hash = state.resources()?.blob_store.store(&payload.content)?;

    state
        .resources()?
        .db
        .mark_range_claim(
            &session.id,
            &payload.path,
            &payload.block_id,
            &payload.block_label,
            &hash,
            &payload.ranges,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_review_unmark_range(
    repo_root: String,
    target: String,
    path: String,
    block_id: String,
    state: State<'_, GitReviewState>,
) -> Result<(), String> {
    let session = state
        .resources()?
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    state
        .resources()?
        .db
        .unmark_range_claim(&session.id, &path, &block_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_review_reconcile_file(
    repo_root: String,
    target: String,
    path: String,
    base_content: String,
    head_content: String,
    state: State<'_, GitReviewState>,
) -> Result<Reconciliation, String> {
    let session = state
        .resources()?
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    let mut claims = state
        .resources()?
        .db
        .get_file_claims(&session.id, &path)
        .map_err(|e| e.to_string())?;

    // Hydrate snapshot content for each claim from blob store
    for claim in &mut claims {
        if let Ok(content) = state.resources()?.blob_store.read(&claim.snapshot_hash) {
            claim.snapshot_content = content;
        }
    }

    Ok(reconcile::reconcile(&base_content, &head_content, &claims))
}

#[tauri::command]
pub async fn git_review_get_session_overview(
    repo_root: String,
    target: String,
    state: State<'_, GitReviewState>,
) -> Result<SessionReviewOverview, String> {
    let session = state
        .resources()?
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    let files = state
        .resources()?
        .db
        .get_session_overview(&session.id)
        .map_err(|e| e.to_string())?;

    Ok(SessionReviewOverview {
        session_id: session.id,
        repo_root,
        target,
        files,
    })
}

#[tauri::command]
pub async fn git_review_prune_sessions(
    older_than_days: u32,
    state: State<'_, GitReviewState>,
) -> Result<usize, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    let threshold = now - (older_than_days as i64 * 86_400_000);
    state
        .resources()?
        .db
        .prune_sessions_older_than(threshold)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_review_add_comment(
    payload: AddReviewCommentPayload,
    state: State<'_, GitReviewState>,
) -> Result<ReviewComment, String> {
    let session = state
        .resources()?
        .db
        .open_session(&payload.repo_root, &payload.target, None, None)
        .map_err(|e| e.to_string())?;

    let hash = state.resources()?.blob_store.store(&payload.content)?;

    state
        .resources()?
        .db
        .add_comment(
            &session.id,
            &payload.path,
            &payload.side,
            payload.line,
            payload.end_line,
            &hash,
            &payload.comment,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_review_get_comments(
    repo_root: String,
    target: String,
    path: Option<String>,
    state: State<'_, GitReviewState>,
) -> Result<Vec<ReviewComment>, String> {
    let session = state
        .resources()?
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    if let Some(p) = path {
        state
            .resources()?
            .db
            .get_file_comments(&session.id, &p)
            .map_err(|e| e.to_string())
    } else {
        state
            .resources()?
            .db
            .get_session_comments(&session.id)
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn git_review_delete_comment(
    repo_root: String,
    target: String,
    comment_id: String,
    state: State<'_, GitReviewState>,
) -> Result<(), String> {
    let session = state
        .resources()?
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    state
        .resources()?
        .db
        .delete_comment(&session.id, &comment_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_review_update_comment(
    payload: UpdateReviewCommentPayload,
    state: State<'_, GitReviewState>,
) -> Result<(), String> {
    let session = state
        .resources()?
        .db
        .open_session(&payload.repo_root, &payload.target, None, None)
        .map_err(|e| e.to_string())?;

    state
        .resources()?
        .db
        .update_comment(&session.id, &payload.comment_id, &payload.comment)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::GitReviewState;

    #[test]
    fn state_constructor_defers_review_database_creation() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let path = temp.path().join("review.db");
        let state = GitReviewState::with_paths(path.clone(), temp.path().join("blobs"));

        assert!(!path.exists());
        let first = state.resources().expect("open review database") as *const _;
        let second = state.resources().expect("reuse review database") as *const _;
        assert!(path.exists());
        assert_eq!(first, second);
    }

    #[test]
    fn concurrent_access_opens_one_resource_set() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let state =
            GitReviewState::with_paths(temp.path().join("review.db"), temp.path().join("blobs"));
        let (first, second) = std::thread::scope(|scope| {
            let first = scope.spawn(|| {
                state
                    .resources()
                    .map(|resources| resources as *const _ as usize)
            });
            let second = scope.spawn(|| {
                state
                    .resources()
                    .map(|resources| resources as *const _ as usize)
            });
            (
                first
                    .join()
                    .expect("first worker")
                    .expect("first resources"),
                second
                    .join()
                    .expect("second worker")
                    .expect("second resources"),
            )
        });
        assert_eq!(first, second);
    }
}
