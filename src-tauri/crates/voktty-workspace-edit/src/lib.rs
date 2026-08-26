use std::collections::HashSet;
use std::fmt;

use regex::{Captures, NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_TRANSACTION_FILES: usize = 200;
pub const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_REPLACEMENTS: usize = 10_000;
pub const MAX_WORKSPACE_TEXT_EDITS: usize = 5_000;
const MAX_PREVIEW_OCCURRENCES_PER_FILE: usize = 200;
const MAX_CONTEXT_CHARS: usize = 80;
const MAX_PREVIEW_TEXT_CHARS: usize = 240;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceSpec {
    pub pattern: String,
    pub replacement: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiskFile {
    pub content: String,
    pub mtime: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceTarget {
    pub path: String,
    pub expected_mtime: u64,
    pub expected_hash: String,
    pub expected_replacements: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceOccurrence {
    pub line: usize,
    pub column: usize,
    pub before: String,
    pub matched: String,
    pub replacement: String,
    pub after: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceFilePreview {
    pub path: String,
    pub mtime: u64,
    pub hash: String,
    pub replacements: usize,
    pub occurrences: Vec<ReplaceOccurrence>,
    pub preview_truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePreview {
    pub files: Vec<ReplaceFilePreview>,
    pub total_replacements: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextEditPosition {
    pub line: usize,
    pub character: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextEditRange {
    pub start: WorkspaceTextEditPosition,
    pub end: WorkspaceTextEditPosition,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextEdit {
    pub range: WorkspaceTextEditRange,
    pub new_text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextDocumentEdit {
    pub path: String,
    pub edits: Vec<WorkspaceTextEdit>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextEditTarget {
    pub path: String,
    pub edits: Vec<WorkspaceTextEdit>,
    pub expected_mtime: u64,
    pub expected_hash: String,
    pub expected_result_hash: String,
    pub expected_edits: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextEditOccurrence {
    pub line: usize,
    pub column: usize,
    pub before: String,
    pub replaced: String,
    pub replacement: String,
    pub after: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextEditFilePreview {
    pub path: String,
    pub mtime: u64,
    pub hash: String,
    pub result_hash: String,
    pub edits: usize,
    pub occurrences: Vec<WorkspaceTextEditOccurrence>,
    pub preview_truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTextEditPreview {
    pub files: Vec<WorkspaceTextEditFilePreview>,
    pub total_edits: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceTextEditPlan {
    pub preview: WorkspaceTextEditFilePreview,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceTextEditOutcome {
    Applied {
        files: usize,
        edits: usize,
    },
    Conflict {
        conflicts: Vec<String>,
        rolled_back: bool,
        rollback_failures: Vec<String>,
    },
    Failed {
        error: String,
        rolled_back: bool,
        rollback_failures: Vec<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FilePlan {
    pub preview: ReplaceFilePreview,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReplaceError {
    EmptyPattern,
    EmptyMatch,
    InvalidPattern(String),
    FileTooLarge,
    TooManyReplacements,
}

impl fmt::Display for ReplaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyPattern => formatter.write_str("replacement pattern is empty"),
            Self::EmptyMatch => formatter.write_str("replacement pattern can match empty text"),
            Self::InvalidPattern(error) => {
                write!(formatter, "invalid replacement pattern: {error}")
            }
            Self::FileTooLarge => formatter.write_str("file exceeds the replacement size limit"),
            Self::TooManyReplacements => {
                formatter.write_str("replacement count exceeds the transaction limit")
            }
        }
    }
}

impl std::error::Error for ReplaceError {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ApplyOutcome {
    Applied {
        files: usize,
        replacements: usize,
    },
    Conflict {
        conflicts: Vec<String>,
        rolled_back: bool,
        rollback_failures: Vec<String>,
    },
    Failed {
        error: String,
        rolled_back: bool,
        rollback_failures: Vec<String>,
    },
}

pub trait WorkspaceEditFs {
    fn read(&mut self, path: &str) -> Result<DiskFile, String>;
    fn write_atomic(&mut self, path: &str, content: &str) -> Result<(), String>;
}

pub fn content_hash(content: &str) -> String {
    hex::encode(Sha256::digest(content.as_bytes()))
}

pub fn compile_spec(spec: &ReplaceSpec) -> Result<Regex, ReplaceError> {
    if spec.pattern.is_empty() {
        return Err(ReplaceError::EmptyPattern);
    }
    let pattern = if spec.regex {
        spec.pattern.clone()
    } else {
        regex::escape(&spec.pattern)
    };
    let pattern = if spec.whole_word {
        format!(r"\b(?:{pattern})\b")
    } else {
        pattern
    };
    let regex = RegexBuilder::new(&pattern)
        .case_insensitive(!spec.case_sensitive)
        .multi_line(true)
        .build()
        .map_err(|error| ReplaceError::InvalidPattern(error.to_string()))?;
    if regex.is_match("") {
        return Err(ReplaceError::EmptyMatch);
    }
    Ok(regex)
}

pub fn plan_file(
    path: &str,
    file: &DiskFile,
    spec: &ReplaceSpec,
) -> Result<Option<FilePlan>, ReplaceError> {
    if file.content.len() > MAX_FILE_BYTES {
        return Err(ReplaceError::FileTooLarge);
    }
    let regex = compile_spec(spec)?;
    let mut occurrences = Vec::new();
    let mut replacements = 0usize;
    for captures in regex.captures_iter(&file.content) {
        replacements = replacements
            .checked_add(1)
            .ok_or(ReplaceError::TooManyReplacements)?;
        if replacements > MAX_REPLACEMENTS {
            return Err(ReplaceError::TooManyReplacements);
        }
        if occurrences.len() < MAX_PREVIEW_OCCURRENCES_PER_FILE {
            occurrences.push(preview_occurrence(&file.content, &captures, spec));
        }
    }
    if replacements == 0 {
        return Ok(None);
    }
    let content = if spec.regex {
        regex.replace_all(&file.content, spec.replacement.as_str())
    } else {
        regex.replace_all(&file.content, NoExpand(spec.replacement.as_str()))
    }
    .into_owned();
    Ok(Some(FilePlan {
        preview: ReplaceFilePreview {
            path: path.to_string(),
            mtime: file.mtime,
            hash: content_hash(&file.content),
            replacements,
            preview_truncated: replacements > occurrences.len(),
            occurrences,
        },
        content,
    }))
}

pub fn preview_transaction(
    fs: &mut impl WorkspaceEditFs,
    spec: &ReplaceSpec,
    paths: &[String],
) -> Result<ReplacePreview, String> {
    compile_spec(spec).map_err(|error| error.to_string())?;
    if paths.len() > MAX_TRANSACTION_FILES {
        return Err("replacement preview exceeds the file limit".to_string());
    }
    let mut paths = paths.to_vec();
    paths.sort();
    paths.dedup();
    let mut total_bytes = 0usize;
    let mut total_replacements = 0usize;
    let mut files = Vec::new();
    for path in paths {
        let file = fs.read(&path)?;
        total_bytes = total_bytes
            .checked_add(file.content.len())
            .filter(|total| *total <= MAX_TOTAL_BYTES)
            .ok_or_else(|| "replacement preview exceeds the byte limit".to_string())?;
        let Some(plan) = plan_file(&path, &file, spec).map_err(|error| error.to_string())? else {
            continue;
        };
        total_replacements = total_replacements
            .checked_add(plan.preview.replacements)
            .filter(|total| *total <= MAX_REPLACEMENTS)
            .ok_or_else(|| "replacement count exceeds the transaction limit".to_string())?;
        files.push(plan.preview);
    }
    Ok(ReplacePreview {
        files,
        total_replacements,
    })
}

pub fn apply_transaction(
    fs: &mut impl WorkspaceEditFs,
    spec: &ReplaceSpec,
    targets: &[ReplaceTarget],
) -> ApplyOutcome {
    if targets.is_empty() {
        return ApplyOutcome::Failed {
            error: "replacement transaction has no targets".to_string(),
            rolled_back: true,
            rollback_failures: Vec::new(),
        };
    }
    if targets.len() > MAX_TRANSACTION_FILES {
        return ApplyOutcome::Failed {
            error: "replacement transaction exceeds the file limit".to_string(),
            rolled_back: true,
            rollback_failures: Vec::new(),
        };
    }

    let mut targets = targets.to_vec();
    targets.sort_by(|left, right| left.path.cmp(&right.path));
    let mut seen = HashSet::new();
    let mut total_bytes = 0usize;
    let mut total_replacements = 0usize;
    let mut prepared = Vec::with_capacity(targets.len());
    let mut conflicts = Vec::new();

    for target in targets {
        if !seen.insert(target.path.clone()) {
            conflicts.push(target.path);
            continue;
        }
        let file = match fs.read(&target.path) {
            Ok(file) => file,
            Err(_) => {
                conflicts.push(target.path);
                continue;
            }
        };
        total_bytes = match total_bytes.checked_add(file.content.len()) {
            Some(total) if total <= MAX_TOTAL_BYTES => total,
            _ => return failed_without_writes("replacement transaction exceeds the byte limit"),
        };
        let hash = content_hash(&file.content);
        let plan = match plan_file(&target.path, &file, spec) {
            Ok(Some(plan)) => plan,
            Ok(None) | Err(_) => {
                conflicts.push(target.path);
                continue;
            }
        };
        if file.mtime != target.expected_mtime
            || hash != target.expected_hash
            || plan.preview.replacements != target.expected_replacements
        {
            conflicts.push(target.path);
            continue;
        }
        total_replacements += plan.preview.replacements;
        if total_replacements > MAX_REPLACEMENTS {
            return failed_without_writes("replacement count exceeds the transaction limit");
        }
        prepared.push(PreparedWrite {
            path: target.path,
            original: file,
            content: plan.content,
        });
    }

    if !conflicts.is_empty() {
        conflicts.sort();
        return ApplyOutcome::Conflict {
            conflicts,
            rolled_back: true,
            rollback_failures: Vec::new(),
        };
    }

    let mut applied = Vec::new();
    for write in prepared {
        let current = match fs.read(&write.path) {
            Ok(current) => current,
            Err(_) => {
                let rollback_failures = rollback(fs, &applied);
                return ApplyOutcome::Conflict {
                    conflicts: vec![write.path],
                    rolled_back: rollback_failures.is_empty(),
                    rollback_failures,
                };
            }
        };
        if current.mtime != write.original.mtime
            || content_hash(&current.content) != content_hash(&write.original.content)
        {
            let rollback_failures = rollback(fs, &applied);
            return ApplyOutcome::Conflict {
                conflicts: vec![write.path],
                rolled_back: rollback_failures.is_empty(),
                rollback_failures,
            };
        }
        if let Err(error) = fs.write_atomic(&write.path, &write.content) {
            let rollback_failures = rollback(fs, &applied);
            return ApplyOutcome::Failed {
                error,
                rolled_back: rollback_failures.is_empty(),
                rollback_failures,
            };
        }
        applied.push(AppliedWrite {
            path: write.path.clone(),
            original: write.original,
            written_hash: content_hash(&write.content),
        });
        match fs.read(&write.path) {
            Ok(current) if content_hash(&current.content) == content_hash(&write.content) => {}
            Ok(_) | Err(_) => {
                let rollback_failures = rollback(fs, &applied);
                return ApplyOutcome::Failed {
                    error: format!("written file could not be verified: {}", write.path),
                    rolled_back: rollback_failures.is_empty(),
                    rollback_failures,
                };
            }
        }
    }

    ApplyOutcome::Applied {
        files: applied.len(),
        replacements: total_replacements,
    }
}

pub fn plan_text_document(
    document: &WorkspaceTextDocumentEdit,
    file: &DiskFile,
) -> Result<WorkspaceTextEditPlan, String> {
    if document.edits.is_empty() {
        return Err("workspace text edit document has no edits".to_string());
    }
    if document.edits.len() > MAX_WORKSPACE_TEXT_EDITS {
        return Err("workspace text edit exceeds the edit limit".to_string());
    }
    if file.content.len() > MAX_FILE_BYTES {
        return Err("file exceeds the workspace text edit size limit".to_string());
    }

    let mut resolved = Vec::with_capacity(document.edits.len());
    for edit in &document.edits {
        let from = utf16_position_to_offset(&file.content, &edit.range.start)?;
        let to = utf16_position_to_offset(&file.content, &edit.range.end)?;
        if to < from {
            return Err("workspace text edit range is inverted".to_string());
        }
        resolved.push(ResolvedTextEdit {
            from,
            to,
            edit: edit.clone(),
        });
    }
    resolved.sort_by(|left, right| {
        left.from
            .cmp(&right.from)
            .then_with(|| left.to.cmp(&right.to))
    });
    for pair in resolved.windows(2) {
        if pair[1].from < pair[0].to || pair[1].from == pair[0].from {
            return Err("workspace text edit ranges overlap".to_string());
        }
    }

    let mut content = file.content.clone();
    for resolved_edit in resolved.iter().rev() {
        content.replace_range(
            resolved_edit.from..resolved_edit.to,
            &resolved_edit.edit.new_text,
        );
    }
    if content.len() > MAX_FILE_BYTES {
        return Err("edited file exceeds the workspace text edit size limit".to_string());
    }

    let mut preview_truncated = resolved.len() > MAX_PREVIEW_OCCURRENCES_PER_FILE;
    let occurrences = resolved
        .iter()
        .take(MAX_PREVIEW_OCCURRENCES_PER_FILE)
        .map(|resolved_edit| {
            let replaced = &file.content[resolved_edit.from..resolved_edit.to];
            let (replaced, replaced_truncated) = bounded_preview_text(replaced);
            let (replacement, replacement_truncated) =
                bounded_preview_text(&resolved_edit.edit.new_text);
            preview_truncated |= replaced_truncated || replacement_truncated;
            let line_start = logical_line_start(&file.content, resolved_edit.from);
            let line_end = logical_line_end(&file.content, resolved_edit.to);
            WorkspaceTextEditOccurrence {
                line: resolved_edit.edit.range.start.line + 1,
                column: resolved_edit.edit.range.start.character + 1,
                before: tail_chars(
                    &file.content[line_start..resolved_edit.from],
                    MAX_CONTEXT_CHARS,
                ),
                replaced,
                replacement,
                after: head_chars(&file.content[resolved_edit.to..line_end], MAX_CONTEXT_CHARS),
            }
        })
        .collect();

    Ok(WorkspaceTextEditPlan {
        preview: WorkspaceTextEditFilePreview {
            path: document.path.clone(),
            mtime: file.mtime,
            hash: content_hash(&file.content),
            result_hash: content_hash(&content),
            edits: resolved.len(),
            occurrences,
            preview_truncated,
        },
        content,
    })
}

pub fn preview_text_edits(
    fs: &mut impl WorkspaceEditFs,
    documents: &[WorkspaceTextDocumentEdit],
) -> Result<WorkspaceTextEditPreview, String> {
    if documents.is_empty() {
        return Err("workspace text edit preview has no documents".to_string());
    }
    if documents.len() > MAX_TRANSACTION_FILES {
        return Err("workspace text edit preview exceeds the file limit".to_string());
    }
    let mut documents = documents.to_vec();
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    let mut seen = HashSet::new();
    let mut input_bytes = 0usize;
    let mut output_bytes = 0usize;
    let mut total_edits = 0usize;
    let mut files = Vec::with_capacity(documents.len());
    for document in documents {
        if !seen.insert(document.path.clone()) {
            return Err("workspace text edit contains a duplicate document".to_string());
        }
        let file = fs.read(&document.path)?;
        input_bytes = bounded_total_bytes(
            input_bytes,
            file.content.len(),
            "workspace text edit preview exceeds the byte limit",
        )?;
        let plan = plan_text_document(&document, &file)?;
        output_bytes = bounded_total_bytes(
            output_bytes,
            plan.content.len(),
            "workspace text edit preview exceeds the output byte limit",
        )?;
        total_edits = total_edits
            .checked_add(plan.preview.edits)
            .filter(|total| *total <= MAX_WORKSPACE_TEXT_EDITS)
            .ok_or_else(|| "workspace text edit exceeds the edit limit".to_string())?;
        files.push(plan.preview);
    }
    Ok(WorkspaceTextEditPreview { files, total_edits })
}

pub fn apply_text_edits(
    fs: &mut impl WorkspaceEditFs,
    targets: &[WorkspaceTextEditTarget],
) -> WorkspaceTextEditOutcome {
    if targets.is_empty() {
        return text_edit_failed_without_writes("workspace text edit transaction has no targets");
    }
    if targets.len() > MAX_TRANSACTION_FILES {
        return text_edit_failed_without_writes(
            "workspace text edit transaction exceeds the file limit",
        );
    }

    let mut targets = targets.to_vec();
    targets.sort_by(|left, right| left.path.cmp(&right.path));
    let mut seen = HashSet::new();
    let mut input_bytes = 0usize;
    let mut output_bytes = 0usize;
    let mut total_edits = 0usize;
    let mut prepared = Vec::with_capacity(targets.len());
    let mut conflicts = Vec::new();

    for target in targets {
        if !seen.insert(target.path.clone()) {
            conflicts.push(target.path);
            continue;
        }
        let file = match fs.read(&target.path) {
            Ok(file) => file,
            Err(_) => {
                conflicts.push(target.path);
                continue;
            }
        };
        input_bytes = match bounded_total_bytes(
            input_bytes,
            file.content.len(),
            "workspace text edit transaction exceeds the byte limit",
        ) {
            Ok(total) => total,
            Err(error) => return text_edit_failed_without_writes(&error),
        };
        let document = WorkspaceTextDocumentEdit {
            path: target.path.clone(),
            edits: target.edits,
        };
        let plan = match plan_text_document(&document, &file) {
            Ok(plan) => plan,
            Err(error) => return text_edit_failed_without_writes(&error),
        };
        output_bytes = match bounded_total_bytes(
            output_bytes,
            plan.content.len(),
            "workspace text edit transaction exceeds the output byte limit",
        ) {
            Ok(total) => total,
            Err(error) => return text_edit_failed_without_writes(&error),
        };
        if file.mtime != target.expected_mtime
            || plan.preview.hash != target.expected_hash
            || plan.preview.result_hash != target.expected_result_hash
            || plan.preview.edits != target.expected_edits
        {
            conflicts.push(target.path);
            continue;
        }
        total_edits = match total_edits.checked_add(plan.preview.edits) {
            Some(total) if total <= MAX_WORKSPACE_TEXT_EDITS => total,
            _ => {
                return text_edit_failed_without_writes(
                    "workspace text edit exceeds the edit limit",
                )
            }
        };
        prepared.push(PreparedWrite {
            path: target.path,
            original: file,
            content: plan.content,
        });
    }

    if !conflicts.is_empty() {
        conflicts.sort();
        return WorkspaceTextEditOutcome::Conflict {
            conflicts,
            rolled_back: true,
            rollback_failures: Vec::new(),
        };
    }

    let mut applied = Vec::new();
    for write in prepared {
        let current = match fs.read(&write.path) {
            Ok(current) => current,
            Err(_) => {
                let rollback_failures = rollback(fs, &applied);
                return WorkspaceTextEditOutcome::Conflict {
                    conflicts: vec![write.path],
                    rolled_back: rollback_failures.is_empty(),
                    rollback_failures,
                };
            }
        };
        if current.mtime != write.original.mtime
            || content_hash(&current.content) != content_hash(&write.original.content)
        {
            let rollback_failures = rollback(fs, &applied);
            return WorkspaceTextEditOutcome::Conflict {
                conflicts: vec![write.path],
                rolled_back: rollback_failures.is_empty(),
                rollback_failures,
            };
        }
        if let Err(error) = fs.write_atomic(&write.path, &write.content) {
            let rollback_failures = rollback(fs, &applied);
            return WorkspaceTextEditOutcome::Failed {
                error,
                rolled_back: rollback_failures.is_empty(),
                rollback_failures,
            };
        }
        applied.push(AppliedWrite {
            path: write.path.clone(),
            original: write.original,
            written_hash: content_hash(&write.content),
        });
        match fs.read(&write.path) {
            Ok(current) if content_hash(&current.content) == content_hash(&write.content) => {}
            Ok(_) | Err(_) => {
                let rollback_failures = rollback(fs, &applied);
                return WorkspaceTextEditOutcome::Failed {
                    error: format!("written file could not be verified: {}", write.path),
                    rolled_back: rollback_failures.is_empty(),
                    rollback_failures,
                };
            }
        }
    }

    WorkspaceTextEditOutcome::Applied {
        files: applied.len(),
        edits: total_edits,
    }
}

#[derive(Clone)]
struct ResolvedTextEdit {
    from: usize,
    to: usize,
    edit: WorkspaceTextEdit,
}

fn utf16_position_to_offset(
    content: &str,
    position: &WorkspaceTextEditPosition,
) -> Result<usize, String> {
    let (start, end) = logical_line_bounds(content, position.line)
        .ok_or_else(|| "workspace text edit line is outside the document".to_string())?;
    let line = &content[start..end];
    let mut utf16 = 0usize;
    for (byte, character) in line.char_indices() {
        if utf16 == position.character {
            return Ok(start + byte);
        }
        let next = utf16 + character.len_utf16();
        if position.character < next {
            return Err("workspace text edit splits a UTF-16 surrogate pair".to_string());
        }
        utf16 = next;
    }
    if utf16 == position.character {
        Ok(end)
    } else {
        Err("workspace text edit column is outside the line".to_string())
    }
}

fn logical_line_bounds(content: &str, wanted: usize) -> Option<(usize, usize)> {
    let bytes = content.as_bytes();
    let mut line = 0usize;
    let mut start = 0usize;
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'\n' => {
                if line == wanted {
                    return Some((start, index));
                }
                line += 1;
                index += 1;
                start = index;
            }
            b'\r' => {
                if line == wanted {
                    return Some((start, index));
                }
                line += 1;
                index += usize::from(bytes.get(index + 1) == Some(&b'\n')) + 1;
                start = index;
            }
            _ => index += 1,
        }
    }
    (line == wanted).then_some((start, bytes.len()))
}

fn logical_line_start(content: &str, offset: usize) -> usize {
    content[..offset]
        .rfind(['\n', '\r'])
        .map_or(0, |index| index + 1)
}

fn logical_line_end(content: &str, offset: usize) -> usize {
    content[offset..]
        .find(['\n', '\r'])
        .map_or(content.len(), |index| offset + index)
}

fn bounded_preview_text(value: &str) -> (String, bool) {
    let mut characters = value.chars();
    let bounded: String = characters.by_ref().take(MAX_PREVIEW_TEXT_CHARS).collect();
    (bounded, characters.next().is_some())
}

fn bounded_total_bytes(current: usize, added: usize, error: &str) -> Result<usize, String> {
    current
        .checked_add(added)
        .filter(|total| *total <= MAX_TOTAL_BYTES)
        .ok_or_else(|| error.to_string())
}

fn text_edit_failed_without_writes(error: &str) -> WorkspaceTextEditOutcome {
    WorkspaceTextEditOutcome::Failed {
        error: error.to_string(),
        rolled_back: true,
        rollback_failures: Vec::new(),
    }
}

struct PreparedWrite {
    path: String,
    original: DiskFile,
    content: String,
}

struct AppliedWrite {
    path: String,
    original: DiskFile,
    written_hash: String,
}

fn rollback(fs: &mut impl WorkspaceEditFs, applied: &[AppliedWrite]) -> Vec<String> {
    let mut failures = Vec::new();
    for write in applied.iter().rev() {
        let unchanged = fs
            .read(&write.path)
            .map(|file| content_hash(&file.content) == write.written_hash)
            .unwrap_or(false);
        if !unchanged
            || fs
                .write_atomic(&write.path, &write.original.content)
                .is_err()
        {
            failures.push(write.path.clone());
        }
    }
    failures.sort();
    failures
}

fn failed_without_writes(error: &str) -> ApplyOutcome {
    ApplyOutcome::Failed {
        error: error.to_string(),
        rolled_back: true,
        rollback_failures: Vec::new(),
    }
}

fn preview_occurrence(
    content: &str,
    captures: &Captures<'_>,
    spec: &ReplaceSpec,
) -> ReplaceOccurrence {
    let matched = captures.get(0).expect("capture zero always exists");
    let line_start = content[..matched.start()]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    let line_end = content[matched.end()..]
        .find('\n')
        .map_or(content.len(), |index| matched.end() + index);
    let line = content[..line_start]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1;
    let column = content[line_start..matched.start()].encode_utf16().count() + 1;
    let before = tail_chars(&content[line_start..matched.start()], MAX_CONTEXT_CHARS);
    let after = head_chars(&content[matched.end()..line_end], MAX_CONTEXT_CHARS);
    let replacement = if spec.regex {
        let mut replacement = String::new();
        captures.expand(&spec.replacement, &mut replacement);
        replacement
    } else {
        spec.replacement.clone()
    };
    ReplaceOccurrence {
        line,
        column,
        before,
        matched: matched.as_str().to_string(),
        replacement,
        after,
    }
}

fn head_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn tail_chars(value: &str, limit: usize) -> String {
    let mut chars: Vec<char> = value.chars().rev().take(limit).collect();
    chars.reverse();
    chars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryFs {
        files: HashMap<String, DiskFile>,
        fail_write: Option<String>,
        mutate_after_write: Option<String>,
    }

    impl WorkspaceEditFs for MemoryFs {
        fn read(&mut self, path: &str) -> Result<DiskFile, String> {
            self.files
                .get(path)
                .cloned()
                .ok_or_else(|| "missing file".to_string())
        }

        fn write_atomic(&mut self, path: &str, content: &str) -> Result<(), String> {
            if self.fail_write.as_deref() == Some(path) {
                return Err("injected write failure".to_string());
            }
            let file = self.files.get_mut(path).ok_or("missing file")?;
            file.content = content.to_string();
            file.mtime += 1;
            if self.mutate_after_write.as_deref() == Some(path) {
                file.content.push_str(" external");
            }
            Ok(())
        }
    }

    fn literal(pattern: &str, replacement: &str) -> ReplaceSpec {
        ReplaceSpec {
            pattern: pattern.to_string(),
            replacement: replacement.to_string(),
            regex: false,
            case_sensitive: true,
            whole_word: false,
        }
    }

    fn file(content: &str, mtime: u64) -> DiskFile {
        DiskFile {
            content: content.to_string(),
            mtime,
        }
    }

    #[test]
    fn literal_replacement_replaces_every_occurrence_and_keeps_dollars_literal() {
        let plan = plan_file("src/a.ts", &file("foo foo", 7), &literal("foo", "$1"))
            .expect("valid plan")
            .expect("matches");

        assert_eq!(plan.content, "$1 $1");
        assert_eq!(plan.preview.replacements, 2);
    }

    #[test]
    fn regex_replacement_expands_captures_and_reports_utf16_columns() {
        let spec = ReplaceSpec {
            pattern: "(foo)(\\d+)".to_string(),
            replacement: "$2-$1".to_string(),
            regex: true,
            case_sensitive: false,
            whole_word: true,
        };
        let plan = plan_file("src/a.ts", &file("😀 FOO12", 4), &spec)
            .expect("valid plan")
            .expect("matches");

        assert_eq!(plan.content, "😀 12-FOO");
        assert_eq!(plan.preview.occurrences[0].column, 4);
        assert_eq!(plan.preview.occurrences[0].replacement, "12-FOO");
    }

    #[test]
    fn rejects_patterns_that_can_match_empty_text() {
        let spec = ReplaceSpec {
            pattern: "a*".to_string(),
            replacement: "x".to_string(),
            regex: true,
            case_sensitive: true,
            whole_word: false,
        };

        assert_eq!(compile_spec(&spec).unwrap_err(), ReplaceError::EmptyMatch);
    }

    #[test]
    fn conflict_before_commit_writes_nothing() {
        let mut fs = MemoryFs::default();
        fs.files.insert("a".into(), file("foo", 2));
        let target = ReplaceTarget {
            path: "a".into(),
            expected_mtime: 1,
            expected_hash: content_hash("foo"),
            expected_replacements: 1,
        };

        let outcome = apply_transaction(&mut fs, &literal("foo", "bar"), &[target]);

        assert!(matches!(outcome, ApplyOutcome::Conflict { .. }));
        assert_eq!(fs.files["a"].content, "foo");
    }

    #[test]
    fn later_write_failure_rolls_back_prior_files() {
        let mut fs = MemoryFs::default();
        fs.files.insert("a".into(), file("foo", 1));
        fs.files.insert("b".into(), file("foo", 1));
        fs.fail_write = Some("b".into());
        let targets = ["a", "b"].map(|path| ReplaceTarget {
            path: path.into(),
            expected_mtime: 1,
            expected_hash: content_hash("foo"),
            expected_replacements: 1,
        });

        let outcome = apply_transaction(&mut fs, &literal("foo", "bar"), &targets);

        assert!(matches!(
            outcome,
            ApplyOutcome::Failed {
                rolled_back: true,
                ..
            }
        ));
        assert_eq!(fs.files["a"].content, "foo");
        assert_eq!(fs.files["b"].content, "foo");
    }

    #[test]
    fn rollback_never_clobbers_a_third_party_change() {
        let mut fs = MemoryFs::default();
        fs.files.insert("a".into(), file("foo", 1));
        fs.files.insert("b".into(), file("foo", 1));
        fs.mutate_after_write = Some("a".into());
        fs.fail_write = Some("b".into());
        let targets = ["a", "b"].map(|path| ReplaceTarget {
            path: path.into(),
            expected_mtime: 1,
            expected_hash: content_hash("foo"),
            expected_replacements: 1,
        });

        let outcome = apply_transaction(&mut fs, &literal("foo", "bar"), &targets);

        assert!(matches!(
            outcome,
            ApplyOutcome::Failed {
                rolled_back: false,
                ref rollback_failures,
                ..
            } if rollback_failures == &["a"]
        ));
        assert_eq!(fs.files["a"].content, "bar external");
    }

    #[test]
    fn preview_collects_only_matching_files_and_enforces_deterministic_order() {
        let mut fs = MemoryFs::default();
        fs.files.insert("b".into(), file("no match", 1));
        fs.files.insert("a".into(), file("foo foo", 2));

        let preview =
            preview_transaction(&mut fs, &literal("foo", "bar"), &["b".into(), "a".into()])
                .expect("preview");

        assert_eq!(preview.total_replacements, 2);
        assert_eq!(preview.files.len(), 1);
        assert_eq!(preview.files[0].path, "a");
    }

    fn text_edit(
        start_line: usize,
        start_character: usize,
        end_line: usize,
        end_character: usize,
        new_text: &str,
    ) -> WorkspaceTextEdit {
        WorkspaceTextEdit {
            range: WorkspaceTextEditRange {
                start: WorkspaceTextEditPosition {
                    line: start_line,
                    character: start_character,
                },
                end: WorkspaceTextEditPosition {
                    line: end_line,
                    character: end_character,
                },
            },
            new_text: new_text.to_string(),
        }
    }

    #[test]
    fn structural_edits_use_utf16_positions_and_support_multiline_ranges() {
        let document = WorkspaceTextDocumentEdit {
            path: "src/a.ts".into(),
            edits: vec![text_edit(0, 3, 0, 6, "next"), text_edit(1, 0, 2, 3, "tail")],
        };
        let plan = plan_text_document(&document, &file("😀 old\nremove\nend", 7))
            .expect("valid structural plan");

        assert_eq!(plan.content, "😀 next\ntail");
        assert_eq!(plan.preview.edits, 2);
        assert_eq!(plan.preview.occurrences[0].line, 1);
        assert_eq!(plan.preview.occurrences[0].column, 4);
        assert_eq!(plan.preview.occurrences[0].replaced, "old");
    }

    #[test]
    fn structural_edits_reject_surrogate_splits_invalid_lines_and_overlap() {
        for edits in [
            vec![text_edit(0, 1, 0, 2, "x")],
            vec![text_edit(3, 0, 3, 1, "x")],
            vec![text_edit(0, 0, 0, 3, "x"), text_edit(0, 2, 0, 4, "y")],
        ] {
            let document = WorkspaceTextDocumentEdit {
                path: "a".into(),
                edits,
            };
            assert!(plan_text_document(&document, &file("😀abcd", 1)).is_err());
        }
    }

    #[test]
    fn structural_preview_and_commit_share_snapshot_guards() {
        let mut fs = MemoryFs::default();
        fs.files.insert("a".into(), file("old", 1));
        fs.files.insert("b".into(), file("old", 2));
        let documents = ["a", "b"].map(|path| WorkspaceTextDocumentEdit {
            path: path.into(),
            edits: vec![text_edit(0, 0, 0, 3, "next")],
        });
        let preview = preview_text_edits(&mut fs, &documents).expect("preview");
        assert_eq!(preview.total_edits, 2);

        let targets = preview
            .files
            .iter()
            .zip(documents)
            .map(|(file, document)| WorkspaceTextEditTarget {
                path: file.path.clone(),
                edits: document.edits,
                expected_mtime: file.mtime,
                expected_hash: file.hash.clone(),
                expected_result_hash: file.result_hash.clone(),
                expected_edits: file.edits,
            })
            .collect::<Vec<_>>();
        fs.files.get_mut("b").expect("b").content = "changed".into();

        let outcome = apply_text_edits(&mut fs, &targets);

        assert!(matches!(outcome, WorkspaceTextEditOutcome::Conflict { .. }));
        assert_eq!(fs.files["a"].content, "old");
        assert_eq!(fs.files["b"].content, "changed");
    }

    #[test]
    fn structural_commit_rejects_edits_that_differ_from_the_preview() {
        let mut fs = MemoryFs::default();
        fs.files.insert("a".into(), file("old", 1));
        let documents = [WorkspaceTextDocumentEdit {
            path: "a".into(),
            edits: vec![text_edit(0, 0, 0, 3, "next")],
        }];
        let preview = preview_text_edits(&mut fs, &documents).expect("preview");
        let file = &preview.files[0];
        let target = WorkspaceTextEditTarget {
            path: "a".into(),
            edits: vec![text_edit(0, 0, 0, 3, "different")],
            expected_mtime: file.mtime,
            expected_hash: file.hash.clone(),
            expected_result_hash: file.result_hash.clone(),
            expected_edits: file.edits,
        };

        let outcome = apply_text_edits(&mut fs, &[target]);

        assert!(matches!(outcome, WorkspaceTextEditOutcome::Conflict { .. }));
        assert_eq!(fs.files["a"].content, "old");
    }

    #[test]
    fn structural_commit_rolls_back_an_earlier_write_failure() {
        let mut fs = MemoryFs::default();
        fs.files.insert("a".into(), file("old", 1));
        fs.files.insert("b".into(), file("old", 1));
        fs.fail_write = Some("b".into());
        let targets = ["a", "b"].map(|path| WorkspaceTextEditTarget {
            path: path.into(),
            edits: vec![text_edit(0, 0, 0, 3, "next")],
            expected_mtime: 1,
            expected_hash: content_hash("old"),
            expected_result_hash: content_hash("next"),
            expected_edits: 1,
        });

        let outcome = apply_text_edits(&mut fs, &targets);

        assert!(matches!(
            outcome,
            WorkspaceTextEditOutcome::Failed {
                rolled_back: true,
                ..
            }
        ));
        assert_eq!(fs.files["a"].content, "old");
        assert_eq!(fs.files["b"].content, "old");
    }
}
