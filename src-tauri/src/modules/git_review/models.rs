use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReviewSource {
    File,
    Range {
        block_id: String,
        block_label: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewClaim {
    pub id: String,
    pub session_id: String,
    pub path: String,
    pub source: ReviewSource,
    pub snapshot_hash: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub snapshot_content: String,
    pub ranges: Option<Vec<LineRange>>,
    pub viewed_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRange {
    pub start_line: usize,
    pub end_line: usize,
    pub status: String, // "reviewed" | "new"
    pub reviewed_via: Option<ReviewSource>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reconciliation {
    pub changed_since_review: bool,
    pub ranges: Vec<ReviewRange>,
    pub reviewed_baseline: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSession {
    pub id: String,
    pub session_key: String,
    pub repo_root: String,
    pub target: String,
    pub base_ref: Option<String>,
    pub head_ref: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReviewState {
    pub path: String,
    pub reviewed: bool,
    pub viewed_at: Option<i64>,
    pub snapshot_hash: Option<String>,
    pub claims_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkRangePayload {
    pub repo_root: String,
    pub target: String,
    pub path: String,
    pub block_id: String,
    pub block_label: String,
    pub content: String,
    pub ranges: Vec<LineRange>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReviewOverview {
    pub session_id: String,
    pub repo_root: String,
    pub target: String,
    pub files: Vec<FileReviewState>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: String,
    pub session_id: String,
    pub path: String,
    pub side: String, // "old" | "new"
    pub line: usize,
    pub end_line: Option<usize>,
    pub snapshot_hash: String,
    pub comment: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub status: String, // "pending" | "resolved" | "submitted"
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddReviewCommentPayload {
    pub repo_root: String,
    pub target: String,
    pub path: String,
    pub side: String, // "old" | "new"
    pub line: usize,
    pub end_line: Option<usize>,
    pub content: String,
    pub comment: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReviewCommentPayload {
    pub repo_root: String,
    pub target: String,
    pub comment_id: String,
    pub comment: String,
}
