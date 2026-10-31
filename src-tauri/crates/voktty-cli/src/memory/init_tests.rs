use super::*;
use std::io::Cursor;

#[test]
fn interactive_acceptance_requires_the_complete_yes_word() {
    for (answer, expected) in [
        ("", false),
        ("no\n", false),
        ("y\n", false),
        ("YES\n", false),
        ("yes please\n", false),
        ("yes\n", true),
        (" yes \r\n", true),
    ] {
        let mut output = Vec::new();
        assert_eq!(
            confirm(&mut Cursor::new(answer), &mut output).unwrap(),
            expected
        );
        assert!(String::from_utf8(output)
            .unwrap()
            .contains("exactly this reviewed plan"));
    }
}

#[test]
fn oversized_acceptance_is_bounded_and_never_accepted() {
    let mut input = Cursor::new(vec![b'y'; 4096]);
    let error = confirm(&mut input, &mut Vec::new()).unwrap_err();
    assert_eq!(error.code, "usage");
    assert_eq!(input.position(), 1025);
}

#[test]
fn publication_authority_grants_only_reviewed_paths_and_their_parents() {
    let root = std::env::temp_dir().join("native-inventory-fixture");
    let access = AcceptedWriteAccess {
        requirements: PublicationWriteRequirements {
            root: root.clone(),
            create: vec![".voktty/plans/INDEX.md".into()],
            replace: vec!["AGENTS.md".into()],
            recovery: vec![".voktty/.voktty-migration-fixture".into()],
        },
    };
    assert!(access.allows_create(&root.join(".voktty/plans")));
    assert!(access.allows_create(&root.join(".voktty/plans/INDEX.md")));
    assert!(access.allows_create(
        &root.join(".voktty/plans/.voktty-stage-11111111-1111-4111-8111-111111111111")
    ));
    assert!(!access.allows_create(&root.join(".voktty/plans/.voktty-stage-not-a-uuid")));
    assert!(!access
        .allows_create(&root.join(".voktty/.voktty-stage-11111111-1111-4111-8111-111111111111")));
    assert!(!access.allows_create(&root.join(".voktty/unknown.md")));
    assert!(!access.allows_create(&root.with_extension("sibling")));
    assert!(!access.allows_replace(&root.join(".voktty/plans/INDEX.md")));
    assert!(access.allows_replace(&root.join("AGENTS.md")));
    assert!(!access.allows_replace(&root.join("CLAUDE.md")));
    assert!(access.allows_remove_staging(&root.join(".voktty/.voktty-migration-fixture")));
    assert!(!access.allows_remove_staging(&root.join(".voktty/plans/INDEX.md")));
}

#[test]
fn initialization_reads_do_not_grant_secret_or_ancestor_instruction_access() {
    let root = std::env::temp_dir().join("native-read-fixture");
    let access = InitReadAccess {
        marker: MarkerAccess { root: root.clone() },
    };
    assert!(access.allows_read(&root.join(".voktty/INIT.md")));
    assert!(!access.allows_read(&root.join(".env")));
    assert!(!access.allows_read(&root.parent().unwrap().join("AGENTS.md")));
    assert!(!access.allows_read(&root.with_extension("sibling").join(".voktty/INIT.md")));
}
