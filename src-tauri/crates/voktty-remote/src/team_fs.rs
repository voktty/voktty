use std::path::Path;

#[cfg(target_os = "linux")]
use serde::Deserialize;
#[cfg(target_os = "linux")]
use serde_json::json;
#[cfg(target_os = "linux")]
use serde_json::Value;
use voktty_remote_protocol::{RemoteRequest, RemoteResponse};

pub const METHOD: &str = "team.fs";
#[cfg(target_os = "linux")]
const LIMIT: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg(target_os = "linux")]
struct Params {
    operation: String,
    path: String,
    content: Option<String>,
}

#[cfg(target_os = "linux")]
fn parts(path: &str, write: bool) -> Result<Vec<&str>, String> {
    if path.is_empty()
        || path.len() > 32768
        || path.chars().any(char::is_control)
        || path.contains('\\')
    {
        return Err("Invalid team path".into());
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() > 128
        || parts
            .iter()
            .any(|p| p.is_empty() || *p == "." || *p == "..")
    {
        return Err("Team paths must be relative without traversal".into());
    }
    let team = parts[0] == ".voktty"
        && (parts.len() == 1 || matches!(parts[1], "team" | "state" | "mailbox" | "RULES.md"));
    let legacy = parts.starts_with(&["PROMPTS", "sesiones"]);
    if !team && (!legacy || write) {
        return Err("Team IO is confined to .voktty; legacy sources are read-only".into());
    }
    if parts
        .iter()
        .any(|p| p.starts_with(".env") || *p == ".ssh" || *p == "credentials.json")
    {
        return Err("Sensitive team path denied".into());
    }
    Ok(parts)
}

#[cfg(all(test, target_os = "linux"))]
#[path = "team_fs_tests.rs"]
mod tests;

#[cfg(target_os = "linux")]
mod native {
    use super::*;
    use std::ffi::CString;
    use std::fs::File;
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};

    fn failure(error: std::io::Error) -> String {
        if error.kind() == std::io::ErrorKind::NotFound {
            "not_found".into()
        } else {
            format!("Team filesystem access refused: {error}")
        }
    }

    fn open(parent: &File, name: &str, flags: i32) -> Result<File, String> {
        let name = CString::new(name).map_err(|_| "Invalid team filename")?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                0o600,
            )
        };
        if fd < 0 {
            return Err(failure(std::io::Error::last_os_error()));
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    fn directory(root: &Path, parts: &[&str], create: bool) -> Result<File, String> {
        let mut parent = File::open("/").map_err(failure)?;
        let root = root.to_str().ok_or("Invalid project root")?;
        if root == "/" || !root.starts_with('/') {
            return Err("A team requires a non-root absolute project".into());
        }
        for name in root.split('/').filter(|part| !part.is_empty()) {
            parent = open(&parent, name, libc::O_RDONLY | libc::O_DIRECTORY)?;
        }
        for name in parts {
            if create {
                let name = CString::new(*name).map_err(|_| "Invalid directory")?;
                let result = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) };
                if result < 0 {
                    let error = std::io::Error::last_os_error();
                    if error.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err(failure(error));
                    }
                }
            }
            parent = open(&parent, name, libc::O_RDONLY | libc::O_DIRECTORY)?;
        }
        Ok(parent)
    }

    pub(super) fn run(root: &Path, params: Params) -> Result<Value, String> {
        if params.operation == "identity" {
            if params.path != "." || params.content.is_some() {
                return Err("Invalid identity request".into());
            }
            return Ok(json!({"root": root}));
        }
        let write = matches!(params.operation.as_str(), "write" | "mkdir");
        let parts = parts(&params.path, write)?;
        if params.operation == "mkdir" {
            directory(root, &parts, true)?;
            return Ok(json!({}));
        }
        if params.operation == "list" {
            let dir = directory(root, &parts, false)?;
            let mut entries = Vec::new();
            for (index, entry) in
                std::fs::read_dir(format!("/proc/self/fd/{}", dir.as_raw_fd())).map_err(failure)?
                    .enumerate()
            {
                if index >= 1000 {
                    return Err("Team directory exceeds 1000 entries".into());
                }
                let entry = entry.map_err(failure)?;
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| "Invalid filename")?;
                let kind = entry.file_type().map_err(failure)?;
                if kind.is_symlink() {
                    continue;
                }
                entries.push(json!({"name":name,"isDir":kind.is_dir()}));
            }
            return Ok(json!({"entries":entries}));
        }
        let (name, parents) = parts.split_last().ok_or("Missing filename")?;
        let parent = directory(root, parents, write)?;
        if params.operation == "read" {
            let file = open(&parent, name, libc::O_RDONLY)?;
            if !file.metadata().map_err(failure)?.is_file() {
                return Err("Team path is not a regular file".into());
            }
            let mut bytes = Vec::new();
            file.take((LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(failure)?;
            if bytes.len() > LIMIT {
                return Err("Team file exceeds 8 MiB".into());
            }
            let content = String::from_utf8(bytes).map_err(|_| "Team file is not UTF-8")?;
            return Ok(json!({"content":content}));
        }
        if params.operation != "write" {
            return Err("Unknown team operation".into());
        }
        let content = params.content.ok_or("Missing team content")?;
        if content.len() > LIMIT {
            return Err("Team file exceeds 8 MiB".into());
        }
        match open(&parent, name, libc::O_RDONLY) {
            Ok(file) if file.metadata().map_err(failure)?.is_file() => {}
            Ok(_) => return Err("Team target is not a regular file".into()),
            Err(error) if error == "not_found" => {}
            Err(error) => return Err(error),
        }
        let temporary = format!(".team-{}", uuid::Uuid::new_v4());
        let mut file = open(
            &parent,
            &temporary,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
        )?;
        let source = CString::new(temporary).map_err(|_| "Invalid temporary name")?;
        let target = CString::new(*name).map_err(|_| "Invalid filename")?;
        let result = (|| {
            file.write_all(content.as_bytes()).map_err(failure)?;
            file.sync_all().map_err(failure)?;
            if unsafe {
                libc::renameat(
                    parent.as_raw_fd(),
                    source.as_ptr(),
                    parent.as_raw_fd(),
                    target.as_ptr(),
                )
            } < 0
            {
                return Err(failure(std::io::Error::last_os_error()));
            }
            Ok(json!({}))
        })();
        if result.is_err() {
            unsafe {
                libc::unlinkat(parent.as_raw_fd(), source.as_ptr(), 0);
            }
        }
        result
    }
}

#[cfg(target_os = "linux")]
pub fn handle(root: Option<&Path>, request: RemoteRequest) -> RemoteResponse {
    let Some(root) = root else {
        return RemoteResponse::failure(request.id, "invalid_path", "handshake is required");
    };
    let params = match serde_json::from_value::<Params>(request.params) {
        Ok(params) => params,
        Err(_) => {
            return RemoteResponse::failure(
                request.id,
                "invalid_params",
                "Invalid team filesystem request",
            )
        }
    };
    let result = native::run(root, params);
    match result {
        Ok(value) => RemoteResponse::success(request.id, value),
        Err(error) => {
            let code = if error == "not_found" {
                "not_found"
            } else {
                "invalid_path"
            };
            RemoteResponse::failure(request.id, code, error)
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn handle(_root: Option<&Path>, request: RemoteRequest) -> RemoteResponse {
    RemoteResponse::failure(
        request.id,
        "unsupported",
        "Team filesystem requires the Linux remote helper",
    )
}
