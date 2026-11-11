use super::*;
use crate::RemoteServer;
use std::fs;
use std::os::unix::fs::symlink;
use tempfile::tempdir;
use voktty_remote_protocol::{METHOD_HANDSHAKE, PROTOCOL_VERSION};

fn request(method: &str, params: Value) -> RemoteRequest {
    RemoteRequest {
        protocol: PROTOCOL_VERSION,
        id: "team-test".into(),
        method: method.into(),
        params,
    }
}

fn server(root: &Path) -> RemoteServer {
    let mut server = RemoteServer::new();
    let reply = server.handle(request(METHOD_HANDSHAKE, json!({"workspaceRoot":root})));
    assert!(reply.ok);
    assert!(reply.result.unwrap()["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!(METHOD)));
    server
}

fn call(
    server: &mut RemoteServer,
    operation: &str,
    path: &str,
    content: Option<&str>,
) -> RemoteResponse {
    let mut params = json!({"operation":operation,"path":path});
    if let Some(content) = content {
        params["content"] = json!(content);
    }
    server.handle(request(METHOD, params))
}

#[test]
fn imports_without_modifying_legacy_and_creates_team_directories_atomically() {
    let root = tempdir().unwrap();
    fs::create_dir_all(root.path().join("PROMPTS/sesiones/roles")).unwrap();
    fs::write(root.path().join("PROMPTS/sesiones/agentes.json"), "legacy").unwrap();
    fs::write(root.path().join("PROMPTS/sesiones/roles/worker.md"), "role").unwrap();
    let mut server = server(root.path());
    for (source, destination) in [
        ("PROMPTS/sesiones/agentes.json", ".voktty/team/agents.json"),
        (
            "PROMPTS/sesiones/roles/worker.md",
            ".voktty/team/roles/worker.md",
        ),
    ] {
        let reply = call(&mut server, "read", source, None);
        assert!(reply.ok, "{:?}", reply.error);
        let content = reply.result.unwrap()["content"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(call(&mut server, "write", destination, Some(&content)).ok);
        assert_eq!(
            fs::read_to_string(root.path().join(source)).unwrap(),
            content
        );
        assert_eq!(
            fs::read_to_string(root.path().join(destination)).unwrap(),
            content
        );
        assert!(!call(&mut server, "write", source, Some("changed")).ok);
    }
    assert!(call(&mut server, "mkdir", ".voktty/state", None).ok);
    assert!(call(&mut server, "mkdir", ".voktty/state", None).ok);
    assert!(
        call(
            &mut server,
            "write",
            ".voktty/state/agents.json",
            Some("one")
        )
        .ok
    );
    assert!(
        call(
            &mut server,
            "write",
            ".voktty/state/agents.json",
            Some("two")
        )
        .ok
    );
    assert_eq!(
        fs::read_to_string(root.path().join(".voktty/state/agents.json")).unwrap(),
        "two"
    );
    let identity = call(&mut server, "identity", ".", None);
    assert_eq!(
        identity.result.unwrap()["root"],
        json!(fs::canonicalize(root.path()).unwrap())
    );
}

#[test]
fn rejects_symlink_directories_and_files_on_reads_writes_and_creation() {
    for prefix in [
        ".voktty",
        ".voktty/team",
        ".voktty/state",
        ".voktty/mailbox",
        "PROMPTS",
        "PROMPTS/sesiones/roles",
    ] {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let link = root.path().join(prefix);
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        fs::write(outside.path().join("file.json"), "outside").unwrap();
        symlink(outside.path(), &link).unwrap();
        let mut server = server(root.path());
        for operation in ["read", "write", "mkdir", "list"] {
            assert!(
                !call(
                    &mut server,
                    operation,
                    &format!("{prefix}/file.json"),
                    Some("forged")
                )
                .ok,
                "{prefix} {operation}"
            );
        }
        assert_eq!(
            fs::read_to_string(outside.path().join("file.json")).unwrap(),
            "outside"
        );
    }
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir_all(root.path().join(".voktty/team")).unwrap();
    fs::write(outside.path().join("roster.json"), "outside").unwrap();
    symlink(
        outside.path().join("roster.json"),
        root.path().join(".voktty/team/agents.json"),
    )
    .unwrap();
    let mut server = server(root.path());
    assert!(!call(&mut server, "read", ".voktty/team/agents.json", None).ok);
    assert!(
        !call(
            &mut server,
            "write",
            ".voktty/team/agents.json",
            Some("changed")
        )
        .ok
    );
    assert_eq!(
        fs::read_to_string(outside.path().join("roster.json")).unwrap(),
        "outside"
    );
}

#[test]
fn validates_scope_parameters_size_and_handshake_before_io() {
    let root = tempdir().unwrap();
    let mut disconnected = RemoteServer::new();
    assert!(!call(&mut disconnected, "mkdir", ".voktty/team", None).ok);
    let mut server = server(root.path());
    for path in [
        "../outside",
        "/tmp/outside",
        ".voktty/team/../../outside",
        ".voktty//team",
        ".voktty/./state",
        ".voktty/team/.env",
        ".voktty/secrets/key",
        "PROMPTS/sesiones/../../outside",
        ".voktty\\team",
        ".voktty/team/nul\0",
    ] {
        assert!(
            !call(&mut server, "write", path, Some("forged")).ok,
            "{path}"
        );
    }
    assert!(!root.path().join(".voktty").exists());
    assert!(
        !call(
            &mut server,
            "write",
            ".voktty/team/agents.json",
            Some(&"x".repeat(LIMIT + 1))
        )
        .ok
    );
    let error = call(&mut server, "read", ".voktty/team/missing.json", None)
        .error
        .unwrap();
    assert_eq!(error.code, "not_found");
    assert!(
        !server
            .handle(request(
                METHOD,
                json!({"operation":"read","path":".voktty/team/agents.json","token":"forged"})
            ))
            .ok
    );
}
