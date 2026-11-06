use std::fs;
use tempfile::tempdir;
use voktty_memory_local::{
    acquire_claims_guard, acquire_reservation, complete_mailbox_note, list_mailbox_inbox,
    list_reservations, release_claims_guard, release_reservation, send_mailbox_note,
    with_claims_guard, CoordinationError, MailboxNote, NoteKind, ReservationConflict,
    WorkReservation,
};

#[test]
fn two_simultaneous_guard_acquisitions_guarantee_mutual_exclusion() {
    let temp = tempdir().unwrap();
    let root = temp.path();

    // First agent acquires guard
    let guard_path =
        acquire_claims_guard(root, "agent-alice-owner", Some("2030-01-01T10:00:00Z")).unwrap();
    assert!(guard_path.exists());

    // Second agent attempts to acquire guard and is immediately rejected
    let second = acquire_claims_guard(root, "agent-bob-owner", Some("2030-01-01T10:01:00Z"));
    match second {
        Err(CoordinationError::GuardOccupied {
            current_owner,
            acquired_at,
        }) => {
            assert_eq!(current_owner, "agent-alice-owner");
            assert_eq!(acquired_at, "2030-01-01T10:00:00Z");
        }
        other => panic!("expected GuardOccupied, got {:?}", other),
    }

    // Alice releases guard
    release_claims_guard(root, "agent-alice-owner").unwrap();
    assert!(!guard_path.exists());

    // Now Bob can acquire it
    let bob_path =
        acquire_claims_guard(root, "agent-bob-owner", Some("2030-01-01T10:02:00Z")).unwrap();
    assert!(bob_path.exists());
    release_claims_guard(root, "agent-bob-owner").unwrap();
}

#[test]
fn release_authorization_protects_guard_and_reservation_against_foreign_owners() {
    let temp = tempdir().unwrap();
    let root = temp.path();

    // Guard authorization
    acquire_claims_guard(root, "real-guard-owner", Some("2030-01-01T10:00:00Z")).unwrap();
    let bad_release = release_claims_guard(root, "imposter-owner");
    assert!(matches!(
        bad_release,
        Err(CoordinationError::UnauthorizedOwner {
            ref expected,
            ref actual
        }) if expected == "real-guard-owner" && actual == "imposter-owner"
    ));
    release_claims_guard(root, "real-guard-owner").unwrap();

    // Reservation authorization
    let res = WorkReservation {
        agent: "coder-1".into(),
        owner: "session-abc-claim-1".into(),
        task: "T-100: fix bug".into(),
        paths: vec!["src/lib.rs".into()],
        resources: vec![],
        updated_at: "2030-01-01T10:00:00Z".into(),
    };
    acquire_reservation(root, "T-100", &res).unwrap();

    let foreign_release = release_reservation(root, "T-100", "session-xyz-claim-2");
    assert!(matches!(
        foreign_release,
        Err(CoordinationError::UnauthorizedOwner {
            ref expected,
            ref actual
        }) if expected == "session-abc-claim-1" && actual == "session-xyz-claim-2"
    ));

    // Proper owner can release
    release_reservation(root, "T-100", "session-abc-claim-1").unwrap();
}

#[test]
fn overlapping_paths_and_shared_resources_are_blocked_while_disjoint_scopes_succeed() {
    let temp = tempdir().unwrap();
    let root = temp.path();

    let res_editor = WorkReservation {
        agent: "developer-a".into(),
        owner: "owner-a".into(),
        task: "T-1: refactor editor stack".into(),
        paths: vec!["src/editor/".into()],
        resources: vec!["heavy-tests".into()],
        updated_at: "2030-01-01T10:00:00Z".into(),
    };
    acquire_reservation(root, "T-1", &res_editor).unwrap();

    // Candidate 1: overlaps path (file inside reserved directory)
    let res_child_file = WorkReservation {
        agent: "developer-b".into(),
        owner: "owner-b".into(),
        task: "T-2: fix editor keymap".into(),
        paths: vec!["src/editor/keymap.ts".into()],
        resources: vec![],
        updated_at: "2030-01-01T10:05:00Z".into(),
    };
    let err_path = acquire_reservation(root, "T-2", &res_child_file);
    assert!(matches!(
        err_path,
        Err(CoordinationError::Conflict(ReservationConflict::Path {
            ref holder_agent,
            ref existing_path,
            ..
        })) if holder_agent == "developer-a" && existing_path == "src/editor/"
    ));

    // Candidate 2: overlaps resource "heavy-tests"
    let res_resource = WorkReservation {
        agent: "developer-c".into(),
        owner: "owner-c".into(),
        task: "T-3: e2e test suite".into(),
        paths: vec!["tests/e2e/".into()],
        resources: vec!["heavy-tests".into()],
        updated_at: "2030-01-01T10:06:00Z".into(),
    };
    let err_res = acquire_reservation(root, "T-3", &res_resource);
    assert!(matches!(
        err_res,
        Err(CoordinationError::Conflict(ReservationConflict::Resource {
            ref holder_agent,
            ref resource,
            ..
        })) if holder_agent == "developer-a" && resource == "heavy-tests"
    ));

    // Candidate 3: disjoint path and resources succeeds concurrently
    let res_disjoint = WorkReservation {
        agent: "developer-d".into(),
        owner: "owner-d".into(),
        task: "T-4: update docs".into(),
        paths: vec!["docs/".into()],
        resources: vec!["docs-build".into()],
        updated_at: "2030-01-01T10:07:00Z".into(),
    };
    let path_d = acquire_reservation(root, "T-4", &res_disjoint).unwrap();
    assert!(path_d.exists());

    // Clean up
    release_reservation(root, "T-1", "owner-a").unwrap();
    release_reservation(root, "T-4", "owner-d").unwrap();
}

#[test]
fn with_claims_guard_ensures_guard_release_even_on_inner_failure() {
    let temp = tempdir().unwrap();
    let root = temp.path();

    let result: Result<(), CoordinationError> = with_claims_guard(root, "tx-owner", || {
        // Confirm guard is currently held
        let probe = acquire_claims_guard(root, "other-owner", None);
        assert!(matches!(
            probe,
            Err(CoordinationError::GuardOccupied { .. })
        ));

        // Simulate an error inside the transaction
        Err(CoordinationError::Validation("simulated failure".into()))
    });

    assert!(matches!(result, Err(CoordinationError::Validation(_))));

    // Guard must have been released despite the inner Err!
    let check = acquire_claims_guard(root, "next-owner", Some("2030-01-01T11:00:00Z"));
    assert!(check.is_ok());
    release_claims_guard(root, "next-owner").unwrap();
}

#[test]
fn mailbox_lifecycle_and_cross_agent_isolation() {
    let temp = tempdir().unwrap();
    let root = temp.path();

    let note_to_bob = MailboxNote {
        from: "alice".into(),
        to: "bob".into(),
        kind: NoteKind::Task,
        text: "Please review src/editor/extensions.ts after PR 42".into(),
        sent_at: "2030-01-01T12:00:00Z".into(),
    };

    let note_to_charlie = MailboxNote {
        from: "alice".into(),
        to: "charlie".into(),
        kind: NoteKind::Question,
        text: "Is the documentation build passing?".into(),
        sent_at: "2030-01-01T12:01:00Z".into(),
    };

    send_mailbox_note(root, "20300101-bob-task", &note_to_bob).unwrap();
    send_mailbox_note(root, "20300101-charlie-q", &note_to_charlie).unwrap();

    // Bob only sees their own notes
    let bob_inbox = list_mailbox_inbox(root, "bob").unwrap();
    assert_eq!(bob_inbox.len(), 1);
    assert_eq!(bob_inbox[0].note, note_to_bob);

    // Charlie only sees their own notes
    let charlie_inbox = list_mailbox_inbox(root, "charlie").unwrap();
    assert_eq!(charlie_inbox.len(), 1);
    assert_eq!(charlie_inbox[0].note, note_to_charlie);

    // Alice has empty inbox
    let alice_inbox = list_mailbox_inbox(root, "alice").unwrap();
    assert!(alice_inbox.is_empty());

    // Bob completes their note
    let done_file = complete_mailbox_note(root, "bob", "20300101-bob-task.json").unwrap();
    assert!(done_file.exists());
    assert!(done_file.to_string_lossy().contains("done"));

    // Bob's inbox is now empty
    let bob_inbox_after = list_mailbox_inbox(root, "bob").unwrap();
    assert!(bob_inbox_after.is_empty());

    // Completing an already done note fails with NotFound
    let re_done = complete_mailbox_note(root, "bob", "20300101-bob-task.json");
    assert!(matches!(re_done, Err(CoordinationError::NotFound)));
}

#[test]
fn safe_name_validation_rejects_path_traversal() {
    let temp = tempdir().unwrap();
    let root = temp.path();

    let bad_note = MailboxNote {
        from: "alice".into(),
        to: "bob".into(),
        kind: NoteKind::Status,
        text: "ok".into(),
        sent_at: "2030-01-01T12:00:00Z".into(),
    };

    // Traversal in note_id
    assert!(matches!(
        send_mailbox_note(root, "../malicious", &bad_note),
        Err(CoordinationError::InvalidName(_))
    ));
    assert!(matches!(
        send_mailbox_note(root, "subdir/name", &bad_note),
        Err(CoordinationError::InvalidName(_))
    ));
    assert!(matches!(
        send_mailbox_note(root, "..", &bad_note),
        Err(CoordinationError::InvalidName(_))
    ));

    // Traversal in recipient
    assert!(matches!(
        list_mailbox_inbox(root, "../sneaky"),
        Err(CoordinationError::InvalidName(_))
    ));
    assert!(matches!(
        complete_mailbox_note(root, "../sneaky", "task.json"),
        Err(CoordinationError::InvalidName(_))
    ));
}

#[test]
fn oversized_coordination_file_is_rejected() {
    let temp = tempdir().unwrap();
    let root = temp.path();

    let locks_dir = root.join(".voktty").join("locks");
    fs::create_dir_all(&locks_dir).unwrap();

    // Create an oversized lock file (> 64 KiB)
    let oversized_path = locks_dir.join("giant.lock");
    let filler = vec![b' '; 70 * 1024];
    fs::write(&oversized_path, filler).unwrap();

    // list_reservations fails closed on corrupted/oversized files
    let result = list_reservations(root);
    assert!(matches!(result, Err(CoordinationError::Parse(_))));
}
