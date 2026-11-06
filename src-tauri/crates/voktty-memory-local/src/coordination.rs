use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub use voktty_workspace_kit::{
    check_reservation_conflict, normalize_reservation_path, parse_mailbox_note,
    parse_work_reservation, paths_overlap, validate_note, validate_reservation, ClaimsGuard,
    MailboxNote, NoteKind, ReservationConflict, WorkReservation,
};

pub const CLAIMS_LOCK_FILE: &str = "claims.lock";
pub const MAX_COORDINATION_DOC_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoordinationError {
    GuardOccupied {
        current_owner: String,
        acquired_at: String,
    },
    Conflict(ReservationConflict),
    NotFound,
    AlreadyExists,
    UnauthorizedOwner {
        expected: String,
        actual: String,
    },
    Validation(String),
    InvalidName(String),
    Parse(String),
    Io(String),
}

impl std::fmt::Display for CoordinationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::GuardOccupied {
                current_owner,
                acquired_at,
            } => write!(
                f,
                "claims.lock guard is occupied by '{}' since '{}'",
                current_owner, acquired_at
            ),
            Self::Conflict(c) => write!(f, "reservation conflict: {:?}", c),
            Self::NotFound => write!(f, "coordination target not found"),
            Self::AlreadyExists => write!(f, "coordination target already exists"),
            Self::UnauthorizedOwner { expected, actual } => write!(
                f,
                "unauthorized owner: expected '{}', got '{}'",
                expected, actual
            ),
            Self::Validation(msg) => write!(f, "validation failed: {}", msg),
            Self::InvalidName(msg) => write!(f, "invalid coordination name: {}", msg),
            Self::Parse(msg) => write!(f, "coordination parse error: {}", msg),
            Self::Io(msg) => write!(f, "coordination IO error: {}", msg),
        }
    }
}

impl std::error::Error for CoordinationError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationEntry {
    pub file_name: String,
    pub path: PathBuf,
    pub reservation: WorkReservation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxEntry {
    pub file_name: String,
    pub path: PathBuf,
    pub note: MailboxNote,
}

pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

pub fn utc_iso_timestamp(time: SystemTime) -> String {
    let dur = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_secs = dur.as_secs();
    let days = (total_secs / 86400) as i64;
    let day_secs = (total_secs % 86400) as u32;

    let hour = day_secs / 3600;
    let minute = (day_secs % 3600) / 60;
    let second = day_secs % 60;

    let (year, month, day) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    )
}

fn validate_safe_name(name: &str) -> Result<(), CoordinationError> {
    if name.is_empty() || name.len() > 128 {
        return Err(CoordinationError::InvalidName(
            "name must be between 1 and 128 characters".into(),
        ));
    }
    if name == "." || name == ".." {
        return Err(CoordinationError::InvalidName(
            "name cannot be relative directory marker".into(),
        ));
    }
    if name
        .chars()
        .any(|c| c == '/' || c == '\\' || c.is_control() || c == ':')
    {
        return Err(CoordinationError::InvalidName(
            "name contains invalid path characters".into(),
        ));
    }
    Ok(())
}

fn normalize_lock_filename(name: &str) -> Result<String, CoordinationError> {
    validate_safe_name(name)?;
    let base = name.trim();
    if base.eq_ignore_ascii_case(CLAIMS_LOCK_FILE) {
        return Err(CoordinationError::InvalidName(
            "claims.lock is reserved for coordination guard".into(),
        ));
    }
    if base.ends_with(".lock") {
        Ok(base.to_string())
    } else {
        Ok(format!("{}.lock", base))
    }
}

fn normalize_json_filename(name: &str) -> Result<String, CoordinationError> {
    validate_safe_name(name)?;
    let base = name.trim();
    if base.ends_with(".json") {
        Ok(base.to_string())
    } else {
        Ok(format!("{}.json", base))
    }
}

fn read_bounded_file(path: &Path) -> Result<String, CoordinationError> {
    let mut file = File::open(path)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", path.display(), e)))?;
    let metadata = file
        .metadata()
        .map_err(|e| CoordinationError::Io(format!("{}: {}", path.display(), e)))?;
    if metadata.len() > MAX_COORDINATION_DOC_BYTES {
        return Err(CoordinationError::Parse(format!(
            "file {} exceeds maximum size of {} bytes",
            path.display(),
            MAX_COORDINATION_DOC_BYTES
        )));
    }
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", path.display(), e)))?;
    Ok(text)
}

pub fn acquire_claims_guard(
    root: &Path,
    owner: &str,
    acquired_at: Option<&str>,
) -> Result<PathBuf, CoordinationError> {
    if owner.trim().is_empty() || owner.len() > 256 {
        return Err(CoordinationError::Validation(
            "owner must be between 1 and 256 characters".into(),
        ));
    }

    let timestamp = match acquired_at {
        Some(ts) => ts.to_string(),
        None => utc_iso_timestamp(SystemTime::now()),
    };

    let guard = ClaimsGuard {
        owner: owner.to_string(),
        acquired_at: timestamp,
    };

    let locks_dir = root.join(".voktty").join("locks");
    fs::create_dir_all(&locks_dir)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", locks_dir.display(), e)))?;

    let guard_path = locks_dir.join(CLAIMS_LOCK_FILE);

    let mut file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&guard_path)
    {
        Ok(f) => f,
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            let (current_owner, acquired_at) = match read_bounded_file(&guard_path) {
                Ok(content) => match serde_json::from_str::<ClaimsGuard>(&content) {
                    Ok(g) => (g.owner, g.acquired_at),
                    Err(_) => ("unknown".to_string(), "unknown".to_string()),
                },
                Err(_) => ("unknown".to_string(), "unknown".to_string()),
            };
            return Err(CoordinationError::GuardOccupied {
                current_owner,
                acquired_at,
            });
        }
        Err(err) => return Err(CoordinationError::Io(err.to_string())),
    };

    let json_bytes =
        serde_json::to_vec_pretty(&guard).map_err(|e| CoordinationError::Parse(e.to_string()))?;
    file.write_all(&json_bytes)
        .map_err(|e| CoordinationError::Io(e.to_string()))?;
    file.write_all(b"\n")
        .map_err(|e| CoordinationError::Io(e.to_string()))?;
    file.flush()
        .map_err(|e| CoordinationError::Io(e.to_string()))?;

    Ok(guard_path)
}

pub fn release_claims_guard(root: &Path, owner: &str) -> Result<(), CoordinationError> {
    let guard_path = root.join(".voktty").join("locks").join(CLAIMS_LOCK_FILE);
    if !guard_path.exists() {
        return Err(CoordinationError::NotFound);
    }

    let content = read_bounded_file(&guard_path)?;
    let guard: ClaimsGuard = serde_json::from_str(&content)
        .map_err(|e| CoordinationError::Parse(format!("malformed claims.lock: {}", e)))?;

    if guard.owner != owner {
        return Err(CoordinationError::UnauthorizedOwner {
            expected: guard.owner,
            actual: owner.to_string(),
        });
    }

    fs::remove_file(&guard_path)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", guard_path.display(), e)))?;

    Ok(())
}

pub struct AutoClaimsGuard<'a> {
    root: &'a Path,
    owner: String,
    released: bool,
}

impl<'a> AutoClaimsGuard<'a> {
    pub fn acquire(
        root: &'a Path,
        owner: &str,
        acquired_at: Option<&str>,
    ) -> Result<Self, CoordinationError> {
        acquire_claims_guard(root, owner, acquired_at)?;
        Ok(Self {
            root,
            owner: owner.to_string(),
            released: false,
        })
    }

    pub fn release(mut self) -> Result<(), CoordinationError> {
        self.released = true;
        release_claims_guard(self.root, &self.owner)
    }
}

impl<'a> Drop for AutoClaimsGuard<'a> {
    fn drop(&mut self) {
        if !self.released {
            let _ = release_claims_guard(self.root, &self.owner);
        }
    }
}

pub fn with_claims_guard<T, F>(root: &Path, owner: &str, f: F) -> Result<T, CoordinationError>
where
    F: FnOnce() -> Result<T, CoordinationError>,
{
    let guard = AutoClaimsGuard::acquire(root, owner, None)?;
    let result = f()?;
    guard.release()?;
    Ok(result)
}

pub fn list_reservations(root: &Path) -> Result<Vec<ReservationEntry>, CoordinationError> {
    let locks_dir = root.join(".voktty").join("locks");
    if !locks_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&locks_dir)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", locks_dir.display(), e)))?;

    let mut reservations = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| CoordinationError::Io(e.to_string()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name == CLAIMS_LOCK_FILE
            || file_name.starts_with('.')
            || !file_name.ends_with(".lock")
        {
            continue;
        }

        let content = read_bounded_file(&path)?;
        let reservation = parse_work_reservation(&content).map_err(|issues| {
            CoordinationError::Parse(format!(
                "invalid reservation at {}: {:?}",
                path.display(),
                issues
            ))
        })?;

        reservations.push(ReservationEntry {
            file_name,
            path,
            reservation,
        });
    }

    reservations.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(reservations)
}

pub fn acquire_reservation(
    root: &Path,
    name: &str,
    reservation: &WorkReservation,
) -> Result<PathBuf, CoordinationError> {
    let file_name = normalize_lock_filename(name)?;
    validate_reservation(reservation)
        .map_err(|issues| CoordinationError::Validation(format!("{:?}", issues)))?;

    let locks_dir = root.join(".voktty").join("locks");
    fs::create_dir_all(&locks_dir)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", locks_dir.display(), e)))?;

    let target_path = locks_dir.join(&file_name);

    let existing_entries = list_reservations(root)?;
    let existing_res: Vec<WorkReservation> = existing_entries
        .into_iter()
        .map(|e| e.reservation)
        .collect();

    if let Some(conflict) = check_reservation_conflict(&existing_res, reservation) {
        return Err(CoordinationError::Conflict(conflict));
    }

    let json_bytes = serde_json::to_vec_pretty(reservation)
        .map_err(|e| CoordinationError::Parse(e.to_string()))?;

    if target_path.exists() {
        let current_text = read_bounded_file(&target_path)?;
        let current_res = parse_work_reservation(&current_text).map_err(|issues| {
            CoordinationError::Parse(format!(
                "cannot update existing reservation {}: {:?}",
                target_path.display(),
                issues
            ))
        })?;

        if current_res.owner != reservation.owner {
            return Err(CoordinationError::UnauthorizedOwner {
                expected: current_res.owner,
                actual: reservation.owner.clone(),
            });
        }

        let mut file = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&target_path)
            .map_err(|e| CoordinationError::Io(e.to_string()))?;
        file.write_all(&json_bytes)
            .map_err(|e| CoordinationError::Io(e.to_string()))?;
        file.write_all(b"\n")
            .map_err(|e| CoordinationError::Io(e.to_string()))?;
        file.flush()
            .map_err(|e| CoordinationError::Io(e.to_string()))?;
    } else {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target_path)
            .map_err(|err| {
                if err.kind() == std::io::ErrorKind::AlreadyExists {
                    CoordinationError::AlreadyExists
                } else {
                    CoordinationError::Io(err.to_string())
                }
            })?;
        file.write_all(&json_bytes)
            .map_err(|e| CoordinationError::Io(e.to_string()))?;
        file.write_all(b"\n")
            .map_err(|e| CoordinationError::Io(e.to_string()))?;
        file.flush()
            .map_err(|e| CoordinationError::Io(e.to_string()))?;
    }

    Ok(target_path)
}

pub fn release_reservation(root: &Path, name: &str, owner: &str) -> Result<(), CoordinationError> {
    let file_name = normalize_lock_filename(name)?;
    let target_path = root.join(".voktty").join("locks").join(&file_name);

    if !target_path.exists() {
        return Err(CoordinationError::NotFound);
    }

    let content = read_bounded_file(&target_path)?;
    let reservation = parse_work_reservation(&content).map_err(|issues| {
        CoordinationError::Parse(format!(
            "invalid reservation at {}: {:?}",
            target_path.display(),
            issues
        ))
    })?;

    if reservation.owner != owner {
        return Err(CoordinationError::UnauthorizedOwner {
            expected: reservation.owner,
            actual: owner.to_string(),
        });
    }

    fs::remove_file(&target_path)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", target_path.display(), e)))?;

    Ok(())
}

pub fn send_mailbox_note(
    root: &Path,
    note_id: &str,
    note: &MailboxNote,
) -> Result<PathBuf, CoordinationError> {
    validate_note(note).map_err(|issues| CoordinationError::Validation(format!("{:?}", issues)))?;
    let file_name = normalize_json_filename(note_id)?;

    let inbox_dir = root
        .join(".voktty")
        .join("mailbox")
        .join(&note.to)
        .join("inbox");
    fs::create_dir_all(&inbox_dir)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", inbox_dir.display(), e)))?;

    let note_path = inbox_dir.join(&file_name);

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&note_path)
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::AlreadyExists {
                CoordinationError::AlreadyExists
            } else {
                CoordinationError::Io(err.to_string())
            }
        })?;

    let json_bytes =
        serde_json::to_vec_pretty(note).map_err(|e| CoordinationError::Parse(e.to_string()))?;
    file.write_all(&json_bytes)
        .map_err(|e| CoordinationError::Io(e.to_string()))?;
    file.write_all(b"\n")
        .map_err(|e| CoordinationError::Io(e.to_string()))?;
    file.flush()
        .map_err(|e| CoordinationError::Io(e.to_string()))?;

    Ok(note_path)
}

pub fn list_mailbox_inbox(
    root: &Path,
    recipient: &str,
) -> Result<Vec<MailboxEntry>, CoordinationError> {
    validate_safe_name(recipient)?;
    let inbox_dir = root
        .join(".voktty")
        .join("mailbox")
        .join(recipient)
        .join("inbox");

    if !inbox_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&inbox_dir)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", inbox_dir.display(), e)))?;

    let mut notes = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| CoordinationError::Io(e.to_string()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();

        if file_name.starts_with('.') || !file_name.ends_with(".json") {
            continue;
        }

        let content = read_bounded_file(&path)?;
        let note = parse_mailbox_note(&content).map_err(|issues| {
            CoordinationError::Parse(format!(
                "invalid mailbox note at {}: {:?}",
                path.display(),
                issues
            ))
        })?;

        notes.push(MailboxEntry {
            file_name,
            path,
            note,
        });
    }

    notes.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(notes)
}

pub fn complete_mailbox_note(
    root: &Path,
    recipient: &str,
    filename: &str,
) -> Result<PathBuf, CoordinationError> {
    validate_safe_name(recipient)?;
    let file_name = normalize_json_filename(filename)?;

    let src = root
        .join(".voktty")
        .join("mailbox")
        .join(recipient)
        .join("inbox")
        .join(&file_name);

    if !src.exists() {
        return Err(CoordinationError::NotFound);
    }

    let done_dir = root
        .join(".voktty")
        .join("mailbox")
        .join(recipient)
        .join("done");
    fs::create_dir_all(&done_dir)
        .map_err(|e| CoordinationError::Io(format!("{}: {}", done_dir.display(), e)))?;

    let dest = done_dir.join(&file_name);
    if dest.exists() {
        return Err(CoordinationError::AlreadyExists);
    }

    fs::rename(&src, &dest).map_err(|e| CoordinationError::Io(e.to_string()))?;

    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_from_days_computes_exact_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2000-01-01 is 10957 days after 1970-01-01
        assert_eq!(civil_from_days(10957), (2000, 1, 1));
        // 2024-02-29 is a leap day
        assert_eq!(civil_from_days(19782), (2024, 2, 29));
    }

    #[test]
    fn claims_guard_lifecycle_and_mutual_exclusion() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        let path =
            acquire_claims_guard(root, "agent-1-owner", Some("2030-01-01T12:00:00Z")).unwrap();
        assert!(path.exists());

        // Concurrent acquisition by another agent fails with GuardOccupied
        let conflict = acquire_claims_guard(root, "agent-2-owner", Some("2030-01-01T12:01:00Z"));
        assert!(matches!(
            conflict,
            Err(CoordinationError::GuardOccupied {
                ref current_owner,
                ref acquired_at
            }) if current_owner == "agent-1-owner" && acquired_at == "2030-01-01T12:00:00Z"
        ));

        // Wrong owner cannot release guard
        let err = release_claims_guard(root, "agent-2-owner");
        assert!(matches!(
            err,
            Err(CoordinationError::UnauthorizedOwner { .. })
        ));
        assert!(path.exists());

        // Right owner releases guard
        release_claims_guard(root, "agent-1-owner").unwrap();
        assert!(!path.exists());

        // Now agent-2 can acquire it
        acquire_claims_guard(root, "agent-2-owner", Some("2030-01-01T12:02:00Z")).unwrap();
        release_claims_guard(root, "agent-2-owner").unwrap();
    }

    #[test]
    fn auto_claims_guard_cleans_up_on_drop() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        {
            let _guard =
                AutoClaimsGuard::acquire(root, "auto-owner", Some("2030-01-01T12:00:00Z")).unwrap();
            let check = acquire_claims_guard(root, "other", None);
            assert!(matches!(
                check,
                Err(CoordinationError::GuardOccupied { .. })
            ));
        }

        // After dropping, guard is free
        let check_after = acquire_claims_guard(root, "other", Some("2030-01-01T12:01:00Z"));
        assert!(check_after.is_ok());
        release_claims_guard(root, "other").unwrap();
    }

    #[test]
    fn reservation_lifecycle_conflict_and_owner_protection() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        let res_a = WorkReservation {
            agent: "agent-a".into(),
            owner: "owner-a-1".into(),
            task: "T-1: edit editor".into(),
            paths: vec!["src/editor/".into()],
            resources: vec!["memory".into()],
            updated_at: "2030-01-01T12:00:00Z".into(),
        };

        // Acquire res_a
        let path_a = acquire_reservation(root, "T-1", &res_a).unwrap();
        assert!(path_a.exists());

        // Check listing
        let list = list_reservations(root).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].file_name, "T-1.lock");
        assert_eq!(list[0].reservation, res_a);

        // Conflicting reservation B on overlapping path
        let res_b_conflict = WorkReservation {
            agent: "agent-b".into(),
            owner: "owner-b-1".into(),
            task: "T-2: edit retry".into(),
            paths: vec!["src/editor/retry.ts".into()],
            resources: vec![],
            updated_at: "2030-01-01T12:05:00Z".into(),
        };
        let err = acquire_reservation(root, "T-2", &res_b_conflict);
        assert!(matches!(
            err,
            Err(CoordinationError::Conflict(
                ReservationConflict::Path { .. }
            ))
        ));

        // Disjoint reservation C succeeds
        let res_c = WorkReservation {
            agent: "agent-c".into(),
            owner: "owner-c-1".into(),
            task: "T-3: search".into(),
            paths: vec!["src/search/".into()],
            resources: vec![],
            updated_at: "2030-01-01T12:06:00Z".into(),
        };
        let path_c = acquire_reservation(root, "T-3", &res_c).unwrap();
        assert!(path_c.exists());

        // Agent-a can update their own reservation
        let mut res_a_updated = res_a.clone();
        res_a_updated.updated_at = "2030-01-01T12:10:00Z".into();
        acquire_reservation(root, "T-1", &res_a_updated).unwrap();

        // Agent-b cannot release agent-a's reservation
        let release_err = release_reservation(root, "T-1", "owner-b-1");
        assert!(matches!(
            release_err,
            Err(CoordinationError::UnauthorizedOwner { .. })
        ));
        assert!(path_a.exists());

        // Agent-a releases their reservation
        release_reservation(root, "T-1", "owner-a-1").unwrap();
        assert!(!path_a.exists());

        // Now res_b_conflict can be acquired because T-1 was released!
        let path_b = acquire_reservation(root, "T-2", &res_b_conflict).unwrap();
        assert!(path_b.exists());

        release_reservation(root, "T-2", "owner-b-1").unwrap();
        release_reservation(root, "T-3", "owner-c-1").unwrap();
    }

    #[test]
    fn mailbox_send_list_and_complete_workflow() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        let note = MailboxNote {
            from: "agent-a".into(),
            to: "agent-b".into(),
            kind: NoteKind::Verdict,
            text: "Verdict: tests pass on git abc1234".into(),
            sent_at: "2030-01-01T12:00:00Z".into(),
        };

        // Send note
        let note_path = send_mailbox_note(root, "20300101-01", &note).unwrap();
        assert!(note_path.exists());

        // Listing inbox finds note
        let inbox = list_mailbox_inbox(root, "agent-b").unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].file_name, "20300101-01.json");
        assert_eq!(inbox[0].note, note);

        // Inbox for other agent is empty
        let other_inbox = list_mailbox_inbox(root, "agent-c").unwrap();
        assert!(other_inbox.is_empty());

        // Complete note: moves from inbox to done
        let done_path = complete_mailbox_note(root, "agent-b", "20300101-01.json").unwrap();
        assert!(done_path.exists());
        assert!(!note_path.exists());

        // Inbox is now empty
        let inbox_after = list_mailbox_inbox(root, "agent-b").unwrap();
        assert!(inbox_after.is_empty());

        // Completing again fails with NotFound
        let again = complete_mailbox_note(root, "agent-b", "20300101-01.json");
        assert!(matches!(again, Err(CoordinationError::NotFound)));
    }
}
