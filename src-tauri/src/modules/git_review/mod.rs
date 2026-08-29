pub mod blob_store;
pub mod db;
pub mod diff;
pub mod models;
pub mod reconcile;

use blob_store::BlobStore;
use db::ReviewDb;
use models::{
    Reconciliation, ReviewSession, SessionReviewOverview,
};
use std::sync::Arc;
use tauri::State;

pub struct GitReviewState {
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
        let db_path =
            ReviewDb::default_db_path().unwrap_or_else(|| std::path::PathBuf::from("review.db"));
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let db = Arc::new(
            ReviewDb::open(&db_path).unwrap_or_else(|_| ReviewDb::open_in_memory().unwrap()),
        );
        let blob_store = Arc::new(
            BlobStore::default_store()
                .unwrap_or_else(|| BlobStore::new(std::path::PathBuf::from("review_blobs"))),
        );

        Self { db, blob_store }
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
        .db
        .open_session(&repo_root, &target, base_ref.as_deref(), head_ref.as_deref())
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
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    let hash = if viewed {
        state.blob_store.store(&content)?
    } else {
        String::new()
    };

    state
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
        .db
        .open_session(&payload.repo_root, &payload.target, None, None)
        .map_err(|e| e.to_string())?;

    let hash = state.blob_store.store(&payload.content)?;

    state
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
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    state
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
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    let mut claims = state
        .db
        .get_file_claims(&session.id, &path)
        .map_err(|e| e.to_string())?;

    // Hydrate snapshot content for each claim from blob store
    for claim in &mut claims {
        if let Ok(content) = state.blob_store.read(&claim.snapshot_hash) {
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
        .db
        .open_session(&repo_root, &target, None, None)
        .map_err(|e| e.to_string())?;

    let files = state
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
