use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use ignore::WalkBuilder;
use voktty_collab_protocol::{FileMatch, MAX_FILE_CONTENT_BYTES, MAX_FILE_RESULTS};

const MAX_SCANNED_ENTRIES: usize = 50_000;
const MAX_QUERY_BYTES: usize = 256;
const MAX_PATH_BYTES: usize = 4_096;
const MAX_DEPTH: usize = 16;

const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
];

#[derive(Clone)]
pub(super) struct CitationFiles {
    root: PathBuf,
}

pub(super) struct SearchResponse {
    pub files: Vec<FileMatch>,
    pub truncated: bool,
}

#[derive(Debug)]
pub(super) struct ReadResponse {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct CitationError {
    pub code: &'static str,
    pub message: &'static str,
}

impl CitationError {
    const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl CitationFiles {
    pub fn new(root: &Path) -> Result<Self, String> {
        let canonical = std::fs::canonicalize(root)
            .map_err(|_| "file citation root is not accessible".to_string())?;
        if !canonical.is_dir() {
            return Err("file citation root is not a directory".to_string());
        }
        if is_sensitive_path(&canonical) {
            return Err("file citation root is protected".to_string());
        }
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn search(&self, query: &str, limit: u16) -> Result<SearchResponse, CitationError> {
        if query.len() > MAX_QUERY_BYTES || query.chars().any(char::is_control) {
            return Err(CitationError::new(
                "invalid_query",
                "file search query is invalid",
            ));
        }
        if limit == 0 || limit > MAX_FILE_RESULTS {
            return Err(CitationError::new(
                "invalid_limit",
                "file search limit is invalid",
            ));
        }

        let needle = query.trim().to_lowercase();
        let walker = WalkBuilder::new(&self.root)
            .hidden(true)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .ignore(true)
            .parents(true)
            .follow_links(false)
            .max_depth(Some(MAX_DEPTH))
            .filter_entry(|entry| {
                if entry.depth() == 0 {
                    return true;
                }
                let Some(name) = entry.file_name().to_str() else {
                    return false;
                };
                !PRUNE_DIRS.contains(&name) && !is_protected_directory_name(name)
            })
            .build();

        let mut scanned = 0usize;
        let mut matches = Vec::new();
        let mut scan_truncated = false;
        for entry in walker.flatten() {
            scanned += 1;
            if scanned > MAX_SCANNED_ENTRIES {
                scan_truncated = true;
                break;
            }
            if !entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
            {
                continue;
            }
            let Ok(relative) = entry.path().strip_prefix(&self.root) else {
                continue;
            };
            if is_sensitive_path(relative) {
                continue;
            }
            let path = crate::modules::fs::to_canon(relative);
            let lowered = path.to_lowercase();
            if needle.is_empty() || lowered.contains(&needle) {
                let basename = lowered.rsplit('/').next().unwrap_or(&lowered);
                let score = if lowered.starts_with(&needle) {
                    0
                } else if basename.starts_with(&needle) {
                    1
                } else {
                    2
                };
                matches.push((score, lowered, path));
            }
        }

        matches.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.len().cmp(&right.1.len()))
                .then_with(|| left.1.cmp(&right.1))
        });
        let truncated = scan_truncated || matches.len() > limit as usize;
        let files = matches
            .into_iter()
            .take(limit as usize)
            .map(|(_, _, path)| FileMatch { path })
            .collect();
        Ok(SearchResponse { files, truncated })
    }

    pub fn read(&self, relative_path: &str) -> Result<ReadResponse, CitationError> {
        let relative = validate_relative_path(relative_path)?;
        if is_sensitive_path(relative) {
            return Err(CitationError::new(
                "protected_path",
                "file citation path is protected",
            ));
        }

        let joined = self.root.join(relative);
        let canonical = std::fs::canonicalize(&joined)
            .map_err(|_| CitationError::new("file_not_found", "file citation is not available"))?;
        if !canonical.starts_with(&self.root) || is_sensitive_path(&canonical) {
            return Err(CitationError::new(
                "protected_path",
                "file citation path is protected",
            ));
        }
        let metadata = std::fs::symlink_metadata(&canonical)
            .map_err(|_| CitationError::new("file_not_found", "file citation is not available"))?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(CitationError::new(
                "not_text_file",
                "file citation must be a regular text file",
            ));
        }

        let truncated = metadata.len() > MAX_FILE_CONTENT_BYTES as u64;
        let mut bytes = Vec::with_capacity((metadata.len() as usize).min(MAX_FILE_CONTENT_BYTES));
        File::open(&canonical)
            .and_then(|file| {
                file.take(MAX_FILE_CONTENT_BYTES as u64)
                    .read_to_end(&mut bytes)
            })
            .map_err(|_| CitationError::new("read_failed", "file citation could not be read"))?;

        if bytes[..bytes.len().min(8 * 1024)].contains(&0) {
            return Err(CitationError::new(
                "not_text_file",
                "binary files cannot be cited",
            ));
        }
        let content = match String::from_utf8(bytes) {
            Ok(content) => content,
            Err(error) if truncated && error.utf8_error().error_len().is_none() => {
                let valid = error.utf8_error().valid_up_to();
                String::from_utf8(error.into_bytes()[..valid].to_vec()).map_err(|_| {
                    CitationError::new("not_text_file", "file is not valid UTF-8 text")
                })?
            }
            Err(_) => {
                return Err(CitationError::new(
                    "not_text_file",
                    "file is not valid UTF-8 text",
                ));
            }
        };

        Ok(ReadResponse {
            path: crate::modules::fs::to_canon(relative),
            content,
            truncated,
        })
    }
}

fn validate_relative_path(path: &str) -> Result<&Path, CitationError> {
    if path.is_empty()
        || path.len() > MAX_PATH_BYTES
        || path.chars().any(char::is_control)
        || Path::new(path).is_absolute()
    {
        return Err(CitationError::new(
            "invalid_path",
            "file citation path is invalid",
        ));
    }
    let relative = Path::new(path);
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(CitationError::new(
            "invalid_path",
            "file citation path is invalid",
        ));
    }
    Ok(relative)
}

fn is_protected_directory_name(name: &str) -> bool {
    matches!(
        normalize_segment(name).as_str(),
        ".ssh"
            | ".gnupg"
            | ".aws"
            | ".azure"
            | ".kube"
            | ".docker"
            | ".git"
            | ".terraform.d"
            | "etc"
            | "proc"
            | "sys"
    )
}

fn normalize_segment(segment: &str) -> String {
    segment
        .split(':')
        .next()
        .unwrap_or(segment)
        .trim_end_matches(['.', ' '])
        .to_lowercase()
}

fn is_sensitive_path(path: &Path) -> bool {
    let segments: Vec<String> = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(normalize_segment(&value.to_string_lossy())),
            _ => None,
        })
        .collect();
    if segments
        .iter()
        .any(|segment| is_protected_directory_name(segment))
    {
        return true;
    }
    for pair in segments.windows(2) {
        if pair[0] == ".config" && matches!(pair[1].as_str(), "gh" | "git" | "gcloud" | "op") {
            return true;
        }
        if (pair[0] == "var" && matches!(pair[1].as_str(), "db" | "root"))
            || (pair[0] == "library" && matches!(pair[1].as_str(), "keychains" | "cookies"))
            || (pair[0] == "appdata" && pair[1] == "gcloud")
        {
            return true;
        }
    }
    for parts in segments.windows(4) {
        if parts[0] == "appdata"
            && matches!(parts[1].as_str(), "roaming" | "local")
            && parts[2] == "microsoft"
            && parts[3] == "credentials"
        {
            return true;
        }
    }
    for parts in segments.windows(3) {
        if parts[0] == "appdata" && parts[1] == "roaming" && parts[2] == "gcloud" {
            return true;
        }
    }
    segments
        .last()
        .is_some_and(|name| is_sensitive_basename(name))
}

fn is_sensitive_basename(name: &str) -> bool {
    let extension = name.rsplit_once('.').map(|(_, extension)| extension);
    name == ".env"
        || name.starts_with(".env.")
        || matches!(
            extension,
            Some("pem" | "key" | "p12" | "pfx" | "asc" | "gpg" | "keystore" | "jks")
        )
        || ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"]
            .iter()
            .any(|prefix| {
                name == *prefix
                    || name.starts_with(&format!("{prefix}."))
                    || name.starts_with(&format!("{prefix}_"))
                    || name.starts_with(&format!("{prefix}-"))
            })
        || [
            "known_hosts",
            "authorized_keys",
            "htpasswd",
            ".netrc",
            "_netrc",
            "credentials",
            ".pgpass",
            ".npmrc",
            ".pypirc",
        ]
        .iter()
        .any(|prefix| name == *prefix || name.starts_with(&format!("{prefix}.")))
        || matches!(
            name,
            "secret.json"
                | "secrets.json"
                | "secret.yml"
                | "secrets.yml"
                | "secret.yaml"
                | "secrets.yaml"
                | "secret.toml"
                | "secrets.toml"
                | "secret.env"
                | "secrets.env"
        )
        || ((name.starts_with("service-account") || name.starts_with("service_account"))
            && name.ends_with(".json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_honors_ignore_rules_and_filters_secrets() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("visible.rs"), "fn main() {}").expect("visible file");
        std::fs::write(temp.path().join(".env"), "TOKEN=secret").expect("secret file");
        std::fs::write(temp.path().join("ignored.log"), "ignored").expect("ignored file");
        std::fs::write(temp.path().join(".gitignore"), "ignored.log\n").expect("gitignore");
        std::fs::create_dir(temp.path().join(".git")).expect("git marker");
        let files = CitationFiles::new(temp.path()).expect("service");

        let result = files.search("", 20).expect("search");

        assert!(result.files.iter().any(|item| item.path == "visible.rs"));
        assert!(!result.files.iter().any(|item| item.path == ".env"));
        assert!(!result.files.iter().any(|item| item.path == "ignored.log"));
    }

    #[test]
    fn read_is_bounded_and_refuses_traversal_and_binary_data() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(
            temp.path().join("large.txt"),
            vec![b'a'; MAX_FILE_CONTENT_BYTES + 8],
        )
        .expect("large file");
        std::fs::write(temp.path().join("binary.bin"), [0, 1, 2, 3]).expect("binary file");
        let files = CitationFiles::new(temp.path()).expect("service");

        let large = files.read("large.txt").expect("large text");
        assert!(large.truncated);
        assert_eq!(large.content.len(), MAX_FILE_CONTENT_BYTES);
        assert_eq!(
            files.read("../outside.txt").expect_err("traversal").code,
            "invalid_path"
        );
        assert_eq!(
            files.read("binary.bin").expect_err("binary").code,
            "not_text_file"
        );
    }

    #[test]
    fn sensitive_path_matching_covers_common_credentials() {
        for path in [
            ".env.production",
            "deploy/private.key",
            ".ssh/config",
            ".config/gh/hosts.yml",
            "config/service-account-prod.json",
            "etc/hosts",
            "AppData/Roaming/Microsoft/Credentials/item",
        ] {
            assert!(is_sensitive_path(Path::new(path)), "{path}");
        }
        assert!(!is_sensitive_path(Path::new("src/config.ts")));
    }

    #[cfg(unix)]
    #[test]
    fn read_refuses_symlink_escape() {
        let root = tempfile::tempdir().expect("root");
        let outside = tempfile::NamedTempFile::new().expect("outside");
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape.txt"))
            .expect("symlink");
        let files = CitationFiles::new(root.path()).expect("service");
        assert_eq!(
            files.read("escape.txt").expect_err("escape").code,
            "protected_path"
        );
    }
}
