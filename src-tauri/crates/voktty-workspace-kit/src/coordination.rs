use crate::{Issue, KitResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkReservation {
    pub agent: String,
    pub owner: String,
    pub task: String,
    pub paths: Vec<String>,
    pub resources: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimsGuard {
    pub owner: String,
    pub acquired_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    Task,
    Verdict,
    Decision,
    Blocker,
    Status,
    Question,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxNote {
    pub from: String,
    pub to: String,
    pub kind: NoteKind,
    pub text: String,
    pub sent_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReservationConflict {
    Resource {
        resource: String,
        holder_agent: String,
        holder_owner: String,
    },
    Path {
        existing_path: String,
        candidate_path: String,
        holder_agent: String,
        holder_owner: String,
    },
}

pub fn normalize_reservation_path(path: &str) -> Option<String> {
    let trimmed = path.trim().replace('\\', "/");
    let stripped = trimmed
        .strip_prefix("./")
        .unwrap_or(&trimmed)
        .trim_start_matches('/');
    if stripped.is_empty() {
        return None;
    }
    let parts: Vec<&str> = stripped.split('/').filter(|p| !p.is_empty()).collect();
    if parts.iter().any(|p| *p == ".." || *p == ".") {
        return None;
    }
    Some(parts.join("/"))
}

pub fn paths_overlap(path_a: &str, path_b: &str) -> bool {
    let Some(norm_a) = normalize_reservation_path(path_a) else {
        return false;
    };
    let Some(norm_b) = normalize_reservation_path(path_b) else {
        return false;
    };

    let lower_a = norm_a.to_ascii_lowercase();
    let lower_b = norm_b.to_ascii_lowercase();

    if lower_a == lower_b {
        return true;
    }

    if lower_a.starts_with(&lower_b) && lower_a.as_bytes().get(lower_b.len()) == Some(&b'/') {
        return true;
    }

    if lower_b.starts_with(&lower_a) && lower_b.as_bytes().get(lower_a.len()) == Some(&b'/') {
        return true;
    }

    false
}

pub fn check_reservation_conflict(
    existing: &[WorkReservation],
    candidate: &WorkReservation,
) -> Option<ReservationConflict> {
    for current in existing {
        if current.owner == candidate.owner {
            continue;
        }

        for cand_res in &candidate.resources {
            let cand_trimmed = cand_res.trim();
            if cand_trimmed.is_empty() {
                continue;
            }
            for curr_res in &current.resources {
                if cand_trimmed.eq_ignore_ascii_case(curr_res.trim()) {
                    return Some(ReservationConflict::Resource {
                        resource: curr_res.clone(),
                        holder_agent: current.agent.clone(),
                        holder_owner: current.owner.clone(),
                    });
                }
            }
        }

        for cand_path in &candidate.paths {
            for curr_path in &current.paths {
                if paths_overlap(cand_path, curr_path) {
                    return Some(ReservationConflict::Path {
                        existing_path: curr_path.clone(),
                        candidate_path: cand_path.clone(),
                        holder_agent: current.agent.clone(),
                        holder_owner: current.owner.clone(),
                    });
                }
            }
        }
    }
    None
}

fn is_valid_identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_valid_timestamp(s: &str) -> bool {
    if s.len() < 20 || s.len() > 35 {
        return false;
    }
    let bytes = s.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || (bytes[10] != b'T' && bytes[10] != b't') {
        return false;
    }
    s.ends_with('Z') || s.ends_with('z')
}

pub fn validate_reservation(res: &WorkReservation) -> KitResult<()> {
    let mut issues = Vec::new();
    if !is_valid_identifier(&res.agent) {
        issues.push(Issue::new(
            "COORDINATION_INVALID_AGENT",
            vec!["agent".into()],
        ));
    }
    if res.owner.trim().is_empty() || res.owner.len() > 256 {
        issues.push(Issue::new(
            "COORDINATION_INVALID_OWNER",
            vec!["owner".into()],
        ));
    }
    if res.task.trim().is_empty() || res.task.len() > 512 {
        issues.push(Issue::new("COORDINATION_INVALID_TASK", vec!["task".into()]));
    }
    if res.paths.is_empty() && res.resources.is_empty() {
        issues.push(Issue::new("COORDINATION_EMPTY_SCOPE", vec!["paths".into()]));
    }
    for (idx, p) in res.paths.iter().enumerate() {
        if normalize_reservation_path(p).is_none() {
            issues.push(Issue::new(
                "COORDINATION_INVALID_PATH",
                vec!["paths".into(), idx.into()],
            ));
        }
    }
    if !is_valid_timestamp(&res.updated_at) {
        issues.push(Issue::new(
            "COORDINATION_INVALID_TIMESTAMP",
            vec!["updatedAt".into()],
        ));
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

pub fn validate_note(note: &MailboxNote) -> KitResult<()> {
    let mut issues = Vec::new();
    if !is_valid_identifier(&note.from) {
        issues.push(Issue::new("MAILBOX_INVALID_SENDER", vec!["from".into()]));
    }
    if !is_valid_identifier(&note.to) {
        issues.push(Issue::new("MAILBOX_INVALID_RECIPIENT", vec!["to".into()]));
    }
    if note.text.trim().is_empty() || note.text.len() > 65536 {
        issues.push(Issue::new("MAILBOX_INVALID_TEXT", vec!["text".into()]));
    }
    if !is_valid_timestamp(&note.sent_at) {
        issues.push(Issue::new(
            "MAILBOX_INVALID_TIMESTAMP",
            vec!["sentAt".into()],
        ));
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

pub fn parse_work_reservation(text: &str) -> KitResult<WorkReservation> {
    if text.len() > 64 * 1024 {
        return Err(vec![Issue::new("COORDINATION_DOCUMENT_TOO_LARGE", vec![])]);
    }
    let res: WorkReservation = serde_json::from_str(text)
        .map_err(|_| vec![Issue::new("COORDINATION_JSON_PARSE_FAILED", vec![])])?;
    validate_reservation(&res)?;
    Ok(res)
}

pub fn parse_mailbox_note(text: &str) -> KitResult<MailboxNote> {
    if text.len() > 64 * 1024 {
        return Err(vec![Issue::new("MAILBOX_DOCUMENT_TOO_LARGE", vec![])]);
    }
    let note: MailboxNote = serde_json::from_str(text)
        .map_err(|_| vec![Issue::new("MAILBOX_JSON_PARSE_FAILED", vec![])])?;
    validate_note(&note)?;
    Ok(note)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_overlap_detects_subdirectories_and_files() {
        assert!(paths_overlap("src/editor/", "src/editor/retry.ts"));
        assert!(paths_overlap("src/editor", "src/editor/retry.ts"));
        assert!(paths_overlap("src/editor/retry.ts", "src/editor/"));
        assert!(paths_overlap("src/", "src/editor/"));
        assert!(paths_overlap("src/editor/retry.ts", "src/editor/retry.ts"));

        // Disjoint paths do not overlap
        assert!(!paths_overlap("src/editor/", "src/search/"));
        assert!(!paths_overlap("src/editor_extra", "src/editor/"));
        assert!(!paths_overlap("src/editor.ts", "src/editor/retry.ts"));
        assert!(!paths_overlap("docs/", "src/"));
    }

    #[test]
    fn reservation_conflicts_are_detected_for_overlapping_paths_and_resources() {
        let existing = vec![WorkReservation {
            agent: "developer-a".into(),
            owner: "owner-a-1".into(),
            task: "T-1: edit editor".into(),
            paths: vec!["src/editor/".into()],
            resources: vec!["memory".into()],
            updated_at: "2030-01-01T12:00:00Z".into(),
        }];

        // Candidate on child path conflicts
        let candidate_path = WorkReservation {
            agent: "developer-b".into(),
            owner: "owner-b-1".into(),
            task: "T-2: edit retry".into(),
            paths: vec!["src/editor/retry.ts".into()],
            resources: vec![],
            updated_at: "2030-01-01T12:05:00Z".into(),
        };
        let conflict = check_reservation_conflict(&existing, &candidate_path);
        assert!(matches!(
            conflict,
            Some(ReservationConflict::Path {
                ref holder_agent,
                ref existing_path,
                ..
            }) if holder_agent == "developer-a" && existing_path == "src/editor/"
        ));

        // Candidate on shared resource conflicts even with disjoint paths
        let candidate_resource = WorkReservation {
            agent: "developer-c".into(),
            owner: "owner-c-1".into(),
            task: "T-3: docs update".into(),
            paths: vec!["docs/".into()],
            resources: vec!["memory".into()],
            updated_at: "2030-01-01T12:06:00Z".into(),
        };
        let conflict = check_reservation_conflict(&existing, &candidate_resource);
        assert!(matches!(
            conflict,
            Some(ReservationConflict::Resource {
                ref holder_agent,
                ref resource,
                ..
            }) if holder_agent == "developer-a" && resource == "memory"
        ));

        // Disjoint paths and resources do not conflict
        let candidate_free = WorkReservation {
            agent: "developer-b".into(),
            owner: "owner-b-1".into(),
            task: "T-4: search".into(),
            paths: vec!["src/search/".into()],
            resources: vec![],
            updated_at: "2030-01-01T12:10:00Z".into(),
        };
        assert!(check_reservation_conflict(&existing, &candidate_free).is_none());

        // Same owner updating their claim does not conflict with themselves
        let candidate_self_update = WorkReservation {
            agent: "developer-a".into(),
            owner: "owner-a-1".into(),
            task: "T-1: edit editor more".into(),
            paths: vec!["src/editor/".into(), "src/editor/extra/".into()],
            resources: vec!["memory".into()],
            updated_at: "2030-01-01T12:15:00Z".into(),
        };
        assert!(check_reservation_conflict(&existing, &candidate_self_update).is_none());
    }

    #[test]
    fn serialization_roundtrip_matches_messaging_spec() {
        let json_text = r#"{
  "agent": "developer-a",
  "owner": "developer-a-session-20300101T120000Z-claim-1",
  "task": "T-2: editor retry",
  "paths": [
    "src/editor/"
  ],
  "resources": [],
  "updatedAt": "2030-01-01T12:00:00Z"
}"#;
        let reservation = parse_work_reservation(json_text).unwrap();
        assert_eq!(reservation.agent, "developer-a");
        assert_eq!(reservation.paths, vec!["src/editor/"]);
        assert!(reservation.resources.is_empty());

        let note_text = r#"{
  "from": "developer-a",
  "to": "developer-b",
  "kind": "verdict",
  "text": "Verdict: T-2 passes on abc1234. Review src/editor/retry.ts",
  "sentAt": "2030-01-01T12:00:00Z"
}"#;
        let note = parse_mailbox_note(note_text).unwrap();
        assert_eq!(note.from, "developer-a");
        assert_eq!(note.to, "developer-b");
        assert_eq!(note.kind, NoteKind::Verdict);
    }
}
