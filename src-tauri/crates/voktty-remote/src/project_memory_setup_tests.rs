use super::*;
use std::os::unix::fs::PermissionsExt;

#[test]
fn host_storage_failure_has_a_fixed_stage_without_exposing_the_private_parent() {
    let private = tempfile::tempdir().unwrap();
    std::fs::set_permissions(private.path(), std::fs::Permissions::from_mode(0o777)).unwrap();
    let server = MemoryServer {
        parent: Some(private.path().join("application")),
        ..MemoryServer::default()
    };
    let error = server.store(true, &ReadControl::default()).err().unwrap();
    assert_eq!(
        error.value(),
        json!({"code":"denied","storage":{"stage":"application-parent","windowsError":null}})
    );
    assert_eq!(std::fs::read_dir(private.path()).unwrap().count(), 0);
    assert_eq!(
        std::fs::metadata(private.path())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o777
    );
}

#[test]
fn errors_outside_storage_keep_the_original_envelope() {
    assert_eq!(Error::new("denied").value(), json!({"code":"denied"}));
}
