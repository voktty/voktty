//! Remote path handling and the authorized-root boundary.
//!
//! Remote paths are POSIX. Unlike the frontend's local paths, a backslash is
//! **not** a separator here: it is a legal character in a POSIX filename, and
//! treating it as one would let `a\../b` read outside the root.

use super::super::types::{SshErrorCode, SshNativeError};

/// A path deeper than this is a traversal attempt or a symlink loop, not a
/// real tree the user is browsing.
const MAX_SEGMENTS: usize = 128;
/// SFTP servers reject far longer, but the cap keeps a hostile listing from
/// growing paths without bound.
const MAX_LEN: usize = 4096;

/// Collapse `.`, `..` and repeated separators without touching the filesystem.
///
/// Purely lexical: it cannot follow symlinks, so it is a boundary check and not
/// a substitute for the server's own permission enforcement.
pub fn normalize(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut segments: Vec<&str> = Vec::new();

    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                // A leading `..` on an absolute path stays at the root, which
                // is what every POSIX resolver does.
                if segments.last().is_some_and(|last| *last != "..") {
                    segments.pop();
                } else if !absolute {
                    segments.push("..");
                }
            }
            other => segments.push(other),
        }
    }

    let joined = segments.join("/");
    if absolute {
        format!("/{joined}")
    } else if joined.is_empty() {
        ".".to_string()
    } else {
        joined
    }
}

/// True when `path` is the root itself or sits underneath it. Both sides are
/// normalized first, so `/srv/../etc` never counts as inside `/srv`.
pub fn is_within(root: &str, path: &str) -> bool {
    let root = normalize(root);
    let path = normalize(path);
    if root == "/" {
        return path.starts_with('/');
    }
    path == root || path.starts_with(&format!("{root}/"))
}

/// Resolve `candidate` against `root` and refuse anything that escapes it.
///
/// An absolute candidate is honoured as-is when it already lies inside the
/// root; a relative one is joined onto the root.
pub fn resolve_within(root: &str, candidate: &str) -> Result<String, SshNativeError> {
    if candidate.trim().is_empty() {
        return Err(refused("empty path"));
    }
    if candidate.len() > MAX_LEN || root.len() > MAX_LEN {
        return Err(refused("path is too long"));
    }
    if candidate.contains('\0') {
        return Err(refused("path contains a null byte"));
    }

    let root = normalize(root);
    let resolved = if candidate.starts_with('/') {
        normalize(candidate)
    } else {
        normalize(&format!("{root}/{candidate}"))
    };

    if resolved.split('/').filter(|s| !s.is_empty()).count() > MAX_SEGMENTS {
        return Err(refused("path is too deep"));
    }
    if !is_within(&root, &resolved) {
        return Err(refused(format!("{resolved} is outside {root}")));
    }
    Ok(resolved)
}

/// The last segment of a remote path, or the path itself when it has none.
pub fn file_name(path: &str) -> &str {
    path.rsplit('/').find(|s| !s.is_empty()).unwrap_or(path)
}

/// The containing directory of a remote path.
pub fn parent(path: &str) -> String {
    let normalized = normalize(path);
    match normalized.rfind('/') {
        None | Some(0) => "/".to_string(),
        Some(index) => normalized[..index].to_string(),
    }
}

fn refused(detail: impl std::fmt::Display) -> SshNativeError {
    SshNativeError::new(SshErrorCode::Config, format!("refused path: {detail}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_dots_and_repeated_separators() {
        assert_eq!(normalize("/srv//app/./logs"), "/srv/app/logs");
        assert_eq!(normalize("/srv/app/../data"), "/srv/data");
        assert_eq!(normalize("/srv/"), "/srv");
        assert_eq!(normalize("/"), "/");
        assert_eq!(normalize(""), ".");
    }

    #[test]
    fn a_leading_parent_on_an_absolute_path_stays_at_the_root() {
        assert_eq!(normalize("/../../etc"), "/etc");
        assert_eq!(normalize("/.."), "/");
    }

    #[test]
    fn a_relative_path_keeps_its_leading_parents() {
        assert_eq!(normalize("../sibling"), "../sibling");
        assert_eq!(normalize("a/../../b"), "../b");
    }

    #[test]
    fn a_backslash_is_a_filename_character_not_a_separator() {
        assert_eq!(normalize("/srv/we\\ird"), "/srv/we\\ird");
        // The traversal only works if backslash is misread as a separator.
        assert_eq!(
            resolve_within("/srv", "a\\..\\..\\etc").expect("stays inside"),
            "/srv/a\\..\\..\\etc"
        );
    }

    #[test]
    fn containment_accepts_the_root_and_its_descendants() {
        assert!(is_within("/srv", "/srv"));
        assert!(is_within("/srv", "/srv/app/logs"));
        assert!(is_within("/", "/anything/at/all"));
    }

    #[test]
    fn containment_rejects_a_sibling_with_a_shared_prefix() {
        assert!(!is_within("/srv", "/srvother"));
        assert!(!is_within("/srv/app", "/srv/application"));
    }

    #[test]
    fn resolve_joins_a_relative_path_onto_the_root() {
        assert_eq!(
            resolve_within("/srv/app", "logs/today.txt").expect("inside"),
            "/srv/app/logs/today.txt"
        );
    }

    #[test]
    fn resolve_accepts_an_absolute_path_already_inside_the_root() {
        assert_eq!(
            resolve_within("/srv", "/srv/app").expect("inside"),
            "/srv/app"
        );
    }

    #[test]
    fn resolve_refuses_an_escape_through_parent_segments() {
        let error = resolve_within("/srv/app", "../../etc/shadow").expect_err("escapes");
        assert_eq!(error.code, SshErrorCode::Config);
        assert!(error.message.contains("outside"));
    }

    #[test]
    fn resolve_refuses_an_absolute_path_outside_the_root() {
        assert!(resolve_within("/srv", "/etc/shadow").is_err());
    }

    #[test]
    fn resolve_refuses_empty_null_and_oversized_paths() {
        assert!(resolve_within("/srv", "").is_err());
        assert!(resolve_within("/srv", "   ").is_err());
        assert!(resolve_within("/srv", "a\0b").is_err());
        assert!(resolve_within("/srv", &"a".repeat(MAX_LEN + 1)).is_err());
    }

    #[test]
    fn resolve_refuses_an_absurdly_deep_path() {
        let deep = "a/".repeat(MAX_SEGMENTS + 2);
        assert!(resolve_within("/", &deep).is_err());
    }

    #[test]
    fn a_root_of_slash_accepts_everything_absolute() {
        assert_eq!(
            resolve_within("/", "/etc/hosts").expect("inside"),
            "/etc/hosts"
        );
        assert_eq!(
            resolve_within("/", "etc/hosts").expect("inside"),
            "/etc/hosts"
        );
    }

    #[test]
    fn file_name_and_parent_split_a_remote_path() {
        assert_eq!(file_name("/srv/app/main.rs"), "main.rs");
        assert_eq!(file_name("/srv/app/"), "app");
        assert_eq!(file_name("/"), "/");
        assert_eq!(parent("/srv/app/main.rs"), "/srv/app");
        assert_eq!(parent("/srv"), "/");
        assert_eq!(parent("/"), "/");
    }
}
