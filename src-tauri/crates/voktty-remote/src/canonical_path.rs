use std::fs;
use std::path::Path;

use serde::Deserialize;
use serde_json::json;
use voktty_remote_protocol::{RemoteRequest, RemoteResponse};

const MAX_PATH_BYTES: usize = 32_768;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Params {
    path: String,
}

fn valid_path(path: &str) -> bool {
    !path.is_empty() && path.len() <= MAX_PATH_BYTES && !path.chars().any(char::is_control)
}

fn canonicalize(root: &Path, path: &str) -> Result<String, String> {
    if !valid_path(path) {
        return Err(
            "canonical path must be nonempty, bounded and free of control characters".into(),
        );
    }
    let candidate = super::workspace_candidate(root, path)?;
    let canonical = fs::canonicalize(candidate).map_err(|_| "cannot resolve canonical path")?;
    if !canonical.starts_with(root) {
        return Err("canonical path is outside the authenticated workspace".into());
    }
    let value = canonical.to_str().ok_or("canonical path is not UTF-8")?;
    if !valid_path(value) {
        return Err("invalid canonical path".into());
    }
    Ok(value.to_owned())
}

pub(super) fn handle(root: Option<&Path>, request: RemoteRequest) -> RemoteResponse {
    let Some(root) = root else {
        return RemoteResponse::failure(request.id, "invalid_path", "handshake is required");
    };
    let params = match serde_json::from_value::<Params>(request.params) {
        Ok(params) => params,
        Err(_) => {
            return RemoteResponse::failure(request.id, "invalid_params", "expected a path string")
        }
    };
    match canonicalize(root, &params.path) {
        Ok(path) => RemoteResponse::success(request.id, json!({ "path": path })),
        Err(error) => RemoteResponse::failure(request.id, "invalid_path", error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RemoteServer;
    use tempfile::tempdir;
    use voktty_remote_protocol::{METHOD_CANONICALIZE, METHOD_HANDSHAKE, PROTOCOL_VERSION};

    fn request(method: &str, params: serde_json::Value) -> RemoteRequest {
        RemoteRequest {
            protocol: PROTOCOL_VERSION,
            id: "canonical-test".into(),
            method: method.into(),
            params,
        }
    }

    fn server(root: &Path) -> RemoteServer {
        let mut server = RemoteServer::new();
        let response = server.handle(request(METHOD_HANDSHAKE, json!({"workspaceRoot": root})));
        assert!(response.ok);
        assert!(response.result.unwrap()["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == METHOD_CANONICALIZE));
        server
    }

    #[test]
    fn canonicalizes_existing_files_and_directories_only_after_handshake() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("note.txt"), "fixture").unwrap();
        let mut disconnected = RemoteServer::new();
        assert!(
            !disconnected
                .handle(request(METHOD_CANONICALIZE, json!({"path": "."})))
                .ok
        );
        let mut server = server(dir.path());
        for path in [".", "note.txt"] {
            let response = server.handle(request(METHOD_CANONICALIZE, json!({"path": path})));
            assert!(response.ok, "{:?}", response.error);
            assert_eq!(
                response.result.unwrap(),
                json!({"path": fs::canonicalize(dir.path().join(path)).unwrap()})
            );
        }
        assert!(
            !server
                .handle(request(METHOD_CANONICALIZE, json!({"path": "missing"})))
                .ok
        );
    }

    #[test]
    fn rejects_invalid_parameters_and_lexical_escapes() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let mut server = server(dir.path());
        for params in [
            json!({}),
            json!({"path": null}),
            json!({"path": ".", "extra": true}),
        ] {
            let response = server.handle(request(METHOD_CANONICALIZE, params));
            assert_eq!(response.error.unwrap().code, "invalid_params");
        }
        for path in [
            "".to_owned(),
            "../escape".into(),
            "nul\0path".into(),
            "new\nline".into(),
            "x".repeat(MAX_PATH_BYTES + 1),
            outside.path().to_str().unwrap().into(),
        ] {
            let response = server.handle(request(METHOD_CANONICALIZE, json!({"path": path})));
            assert_eq!(response.error.unwrap().code, "invalid_path");
        }
    }

    #[cfg(unix)]
    #[test]
    fn resolves_sensitive_targets_and_rejects_symlink_escapes_and_dangling_links() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(dir.path().join(".env.local"), "fixture").unwrap();
        fs::write(outside.path().join("outside"), "fixture").unwrap();
        symlink(".env.local", dir.path().join("innocent.txt")).unwrap();
        symlink(outside.path(), dir.path().join("escape")).unwrap();
        symlink("missing", dir.path().join("dangling")).unwrap();
        let mut server = server(dir.path());
        let response = server.handle(request(
            METHOD_CANONICALIZE,
            json!({"path": "innocent.txt"}),
        ));
        assert!(response.ok);
        assert_eq!(
            response.result.unwrap()["path"],
            fs::canonicalize(dir.path().join(".env.local"))
                .unwrap()
                .to_str()
                .unwrap()
        );
        for path in ["escape/outside", "dangling"] {
            let response = server.handle(request(METHOD_CANONICALIZE, json!({"path": path})));
            assert_eq!(response.error.unwrap().code, "invalid_path");
        }
    }
}
