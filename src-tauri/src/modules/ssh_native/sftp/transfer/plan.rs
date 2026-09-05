//! Turning a walked source tree into an ordered list of transfer steps, and
//! deciding what to do when the destination already holds something.
//!
//! Pure: no filesystem, no network. The engine walks and copies; this decides
//! what should happen, which is the part worth testing exhaustively.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::super::paths;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// Stop and let the user decide. The default, because silently destroying
    /// a file is never the safe guess.
    #[default]
    Ask,
    Overwrite,
    Skip,
    /// Keep both, giving the incoming file a free name.
    Rename,
    /// Continue a partial copy from where it stopped.
    Resume,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WalkEntry {
    /// Path relative to the walk root, always with forward slashes.
    pub relative: String,
    pub is_dir: bool,
    pub size: u64,
    #[serde(default)]
    pub modified_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransferStep {
    pub source: String,
    pub destination: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExistingFile {
    pub size: u64,
    #[serde(default)]
    pub modified_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ConflictOutcome {
    /// Write the whole file, to this destination.
    Transfer {
        destination: String,
    },
    /// Continue an interrupted copy from `offset`.
    Resume {
        destination: String,
        offset: u64,
    },
    Skip,
    /// The user has to choose; nothing is written until they do.
    Ask,
}

/// Order the steps so every directory exists before anything lands inside it.
///
/// Directories come first in depth order, then files. A file whose parent was
/// never walked still works, because the engine creates parents on demand.
pub fn plan_steps(
    source_root: &str,
    destination_root: &str,
    entries: &[WalkEntry],
) -> Vec<TransferStep> {
    let source_root = paths::normalize(source_root);
    let destination_root = paths::normalize(destination_root);

    let mut directories: Vec<TransferStep> = Vec::new();
    let mut files: Vec<TransferStep> = Vec::new();

    for entry in entries {
        let relative = entry.relative.trim_matches('/');
        if relative.is_empty() {
            continue;
        }
        let step = TransferStep {
            source: join(&source_root, relative),
            destination: join(&destination_root, relative),
            size: if entry.is_dir { 0 } else { entry.size },
            is_dir: entry.is_dir,
        };
        if entry.is_dir {
            directories.push(step);
        } else {
            files.push(step);
        }
    }

    directories.sort_by_key(|step| depth(&step.destination));
    directories.extend(files);
    directories
}

fn join(root: &str, relative: &str) -> String {
    if root == "/" {
        format!("/{relative}")
    } else {
        format!("{root}/{relative}")
    }
}

fn depth(path: &str) -> usize {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .count()
}

/// Total bytes a plan will move, directories excluded.
pub fn total_bytes(steps: &[TransferStep]) -> u64 {
    steps
        .iter()
        .filter(|step| !step.is_dir)
        .map(|step| step.size)
        .sum()
}

/// Decide what to do about one file whose destination may already exist.
///
/// `taken` holds destinations already claimed by this run, so renaming twice in
/// the same batch cannot pick the same free name twice.
pub fn resolve_conflict(
    policy: ConflictPolicy,
    step: &TransferStep,
    source_modified_ms: Option<u64>,
    existing: Option<&ExistingFile>,
    taken: &HashSet<String>,
) -> ConflictOutcome {
    let Some(existing) = existing else {
        return ConflictOutcome::Transfer {
            destination: step.destination.clone(),
        };
    };

    match policy {
        ConflictPolicy::Ask => ConflictOutcome::Ask,
        ConflictPolicy::Skip => ConflictOutcome::Skip,
        ConflictPolicy::Overwrite => ConflictOutcome::Transfer {
            destination: step.destination.clone(),
        },
        ConflictPolicy::Rename => ConflictOutcome::Transfer {
            destination: unique_destination(&step.destination, taken),
        },
        ConflictPolicy::Resume => resume_or_restart(step, source_modified_ms, existing),
    }
}

/// Resuming is only safe when the destination is a strict prefix of a source
/// that has not changed since. Anything else restarts, because appending to a
/// stale partial file would produce a corrupt result that looks complete.
fn resume_or_restart(
    step: &TransferStep,
    source_modified_ms: Option<u64>,
    existing: &ExistingFile,
) -> ConflictOutcome {
    let destination = step.destination.clone();
    let changed = match (source_modified_ms, existing.modified_ms) {
        (Some(source), Some(recorded)) => source > recorded,
        // Without both timestamps there is no evidence the partial file matches.
        _ => true,
    };

    if changed || existing.size >= step.size {
        return ConflictOutcome::Transfer { destination };
    }
    ConflictOutcome::Resume {
        destination,
        offset: existing.size,
    }
}

/// `report.txt` becomes `report (1).txt`, then `report (2).txt`.
pub fn unique_destination(destination: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(destination) {
        return destination.to_string();
    }
    let (stem, extension) = split_extension(destination);
    for index in 1..=9_999 {
        let candidate = format!("{stem} ({index}){extension}");
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    destination.to_string()
}

/// A leading dot is part of the name, not an extension: `.bashrc` has none.
fn split_extension(path: &str) -> (&str, &str) {
    let name_start = path.rfind('/').map_or(0, |index| index + 1);
    let name = &path[name_start..];
    match name.rfind('.') {
        Some(dot) if dot > 0 => path.split_at(name_start + dot),
        _ => (path, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(relative: &str, is_dir: bool, size: u64) -> WalkEntry {
        WalkEntry {
            relative: relative.into(),
            is_dir,
            size,
            modified_ms: None,
        }
    }

    fn step(destination: &str, size: u64) -> TransferStep {
        TransferStep {
            source: "/src/file".into(),
            destination: destination.into(),
            size,
            is_dir: false,
        }
    }

    fn taken(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|p| (*p).to_string()).collect()
    }

    #[test]
    fn a_plan_pairs_every_entry_with_its_destination() {
        let steps = plan_steps("/src", "/dst", &[entry("a.txt", false, 10)]);
        assert_eq!(
            steps,
            vec![TransferStep {
                source: "/src/a.txt".into(),
                destination: "/dst/a.txt".into(),
                size: 10,
                is_dir: false,
            }]
        );
    }

    #[test]
    fn directories_come_before_files_and_shallowest_first() {
        let steps = plan_steps(
            "/src",
            "/dst",
            &[
                entry("deep/nested/file.txt", false, 1),
                entry("deep/nested", true, 0),
                entry("deep", true, 0),
            ],
        );
        let order: Vec<&str> = steps.iter().map(|s| s.destination.as_str()).collect();
        assert_eq!(
            order,
            vec!["/dst/deep", "/dst/deep/nested", "/dst/deep/nested/file.txt"]
        );
    }

    #[test]
    fn a_root_of_slash_does_not_double_its_separator() {
        let steps = plan_steps("/", "/", &[entry("a.txt", false, 1)]);
        assert_eq!(steps[0].source, "/a.txt");
        assert_eq!(steps[0].destination, "/a.txt");
    }

    #[test]
    fn empty_and_slash_only_entries_are_dropped() {
        let steps = plan_steps("/src", "/dst", &[entry("", false, 1), entry("/", false, 1)]);
        assert!(steps.is_empty());
    }

    #[test]
    fn a_directory_contributes_no_bytes() {
        let steps = plan_steps(
            "/src",
            "/dst",
            &[
                entry("d", true, 4096),
                entry("a", false, 10),
                entry("b", false, 5),
            ],
        );
        assert_eq!(total_bytes(&steps), 15);
    }

    #[test]
    fn a_free_destination_transfers_whatever_the_policy() {
        for policy in [
            ConflictPolicy::Ask,
            ConflictPolicy::Skip,
            ConflictPolicy::Overwrite,
            ConflictPolicy::Rename,
            ConflictPolicy::Resume,
        ] {
            assert_eq!(
                resolve_conflict(policy, &step("/dst/a", 10), None, None, &taken(&[])),
                ConflictOutcome::Transfer {
                    destination: "/dst/a".into()
                }
            );
        }
    }

    #[test]
    fn the_default_policy_asks_rather_than_destroying() {
        assert_eq!(ConflictPolicy::default(), ConflictPolicy::Ask);
        assert_eq!(
            resolve_conflict(
                ConflictPolicy::Ask,
                &step("/dst/a", 10),
                None,
                Some(&ExistingFile {
                    size: 4,
                    modified_ms: None
                }),
                &taken(&[])
            ),
            ConflictOutcome::Ask
        );
    }

    #[test]
    fn skip_and_overwrite_do_what_they_say() {
        let existing = ExistingFile {
            size: 4,
            modified_ms: None,
        };
        assert_eq!(
            resolve_conflict(
                ConflictPolicy::Skip,
                &step("/dst/a", 10),
                None,
                Some(&existing),
                &taken(&[])
            ),
            ConflictOutcome::Skip
        );
        assert_eq!(
            resolve_conflict(
                ConflictPolicy::Overwrite,
                &step("/dst/a", 10),
                None,
                Some(&existing),
                &taken(&[])
            ),
            ConflictOutcome::Transfer {
                destination: "/dst/a".into()
            }
        );
    }

    #[test]
    fn rename_picks_a_free_name_and_keeps_the_extension() {
        let existing = ExistingFile {
            size: 4,
            modified_ms: None,
        };
        assert_eq!(
            resolve_conflict(
                ConflictPolicy::Rename,
                &step("/dst/report.txt", 10),
                None,
                Some(&existing),
                &taken(&["/dst/report.txt"])
            ),
            ConflictOutcome::Transfer {
                destination: "/dst/report (1).txt".into()
            }
        );
    }

    #[test]
    fn rename_twice_in_one_run_does_not_collide() {
        let claimed = taken(&["/dst/report.txt", "/dst/report (1).txt"]);
        assert_eq!(
            unique_destination("/dst/report.txt", &claimed),
            "/dst/report (2).txt"
        );
    }

    #[test]
    fn a_dotfile_has_no_extension_to_preserve() {
        assert_eq!(
            unique_destination("/dst/.bashrc", &taken(&["/dst/.bashrc"])),
            "/dst/.bashrc (1)"
        );
    }

    #[test]
    fn a_name_without_an_extension_just_gets_a_suffix() {
        assert_eq!(
            unique_destination("/dst/README", &taken(&["/dst/README"])),
            "/dst/README (1)"
        );
    }

    #[test]
    fn resume_continues_a_strict_prefix_of_an_unchanged_source() {
        assert_eq!(
            resolve_conflict(
                ConflictPolicy::Resume,
                &step("/dst/a", 100),
                Some(1_000),
                Some(&ExistingFile {
                    size: 40,
                    modified_ms: Some(1_000)
                }),
                &taken(&[])
            ),
            ConflictOutcome::Resume {
                destination: "/dst/a".into(),
                offset: 40
            }
        );
    }

    #[test]
    fn resume_restarts_when_the_source_changed_after_the_partial_copy() {
        assert_eq!(
            resolve_conflict(
                ConflictPolicy::Resume,
                &step("/dst/a", 100),
                Some(2_000),
                Some(&ExistingFile {
                    size: 40,
                    modified_ms: Some(1_000)
                }),
                &taken(&[])
            ),
            ConflictOutcome::Transfer {
                destination: "/dst/a".into()
            }
        );
    }

    #[test]
    fn resume_restarts_without_both_timestamps() {
        for (source, recorded) in [(None, Some(1_000)), (Some(1_000), None), (None, None)] {
            assert_eq!(
                resolve_conflict(
                    ConflictPolicy::Resume,
                    &step("/dst/a", 100),
                    source,
                    Some(&ExistingFile {
                        size: 40,
                        modified_ms: recorded
                    }),
                    &taken(&[])
                ),
                ConflictOutcome::Transfer {
                    destination: "/dst/a".into()
                }
            );
        }
    }

    #[test]
    fn a_destination_at_or_past_the_source_size_restarts_instead_of_appending() {
        for existing_size in [100, 140] {
            assert_eq!(
                resolve_conflict(
                    ConflictPolicy::Resume,
                    &step("/dst/a", 100),
                    Some(1_000),
                    Some(&ExistingFile {
                        size: existing_size,
                        modified_ms: Some(1_000)
                    }),
                    &taken(&[])
                ),
                ConflictOutcome::Transfer {
                    destination: "/dst/a".into()
                }
            );
        }
    }
}
