use super::*;
use tempfile::tempdir;

#[test]
fn remote_approvals_and_host_links_use_normalized_connection_and_project_keys() {
    let native = tempdir().unwrap();
    let approvals = native.path().join("approvals.json");
    let hosts = native.path().join("hosts.json");
    let first = "remote://voktty-ssh-%6dini/srv/App/";
    let second = "remote://voktty-ssh-mini/srv/App";
    for project in [first, second] {
        approve_generic_command_at(&approvals, project, "worker", "python3 worker.py").unwrap();
        set_team_host_mapping_at(&hosts, project, "backup", "other-profile", "/srv/backup")
            .unwrap();
    }
    assert_eq!(read_store_from_file(&approvals).unwrap().approvals.len(), 1);
    assert_eq!(read_hosts_store_from_file(&hosts).unwrap().hosts.len(), 1);
    assert!(is_generic_command_approved_at(
        &approvals,
        second,
        "worker",
        "python3 worker.py"
    ));
    for other in [
        "remote://voktty-ssh-other/srv/App",
        "remote://voktty-ssh-mini/srv/app",
    ] {
        assert!(!is_generic_command_approved_at(
            &approvals,
            other,
            "worker",
            "python3 worker.py"
        ));
        assert!(read_team_hosts_for_project_at(&hosts, other)
            .unwrap()
            .is_empty());
    }
    assert!(get_team_host_mapping_at(&hosts, first, "backup")
        .unwrap()
        .is_some());
    revoke_generic_command_at(&approvals, first, "worker").unwrap();
    remove_team_host_mapping_at(&hosts, first, "backup").unwrap();
    assert!(!is_generic_command_approved_at(
        &approvals,
        second,
        "worker",
        "python3 worker.py"
    ));
    assert!(read_team_hosts_for_project_at(&hosts, second)
        .unwrap()
        .is_empty());
}

#[test]
fn invalid_remote_project_cannot_create_or_read_native_authority() {
    let native = tempdir().unwrap();
    let store = native.path().join("state.json");
    for project in [
        "remote://voktty-ssh-mini/srv/../escape",
        "remote://voktty-ssh-mini/srv//app",
        "remote://voktty-ssh-mini/",
    ] {
        assert!(approve_generic_command_at(&store, project, "worker", "run").is_err());
        assert!(
            set_team_host_mapping_at(&store, project, "backup", "other", "/srv/backup").is_err()
        );
        assert!(read_team_hosts_for_project_at(&store, project).is_err());
        assert!(!is_generic_command_approved_at(
            &store, project, "worker", "run"
        ));
        assert!(!store.exists());
    }
}
