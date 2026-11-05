use super::*;

#[test]
fn recovery_requires_a_single_explicit_review_or_matching_digest_choice() {
    for args in [
        vec![],
        vec!["--yes"],
        vec!["--force"],
        vec!["--preview", "--preview"],
        vec!["--preview", "--accept-review", &"a".repeat(64)],
        vec!["--accept-review", "bad"],
        vec!["--accept-review", &"A".repeat(64)],
        vec!["--preview", "--project"],
        vec!["--preview", "--project", "-unsafe"],
        vec!["--preview", "--project", "one", "--project", "two"],
    ] {
        assert_eq!(
            parse(args.into_iter().map(OsString::from).collect())
                .unwrap_err()
                .code,
            "usage"
        );
    }
    assert!(matches!(
        parse(vec!["--preview".into()]).unwrap(),
        MemoryCommand::Recover(_)
    ));
    assert!(matches!(
        parse(vec!["--accept-review".into(), "a".repeat(64).into()]).unwrap(),
        MemoryCommand::Recover(_)
    ));
    assert_eq!(parse(vec!["--help".into()]).unwrap(), MemoryCommand::Help);
}

#[test]
fn recovery_uses_only_reviewed_publication_paths_parents_and_staging() {
    use voktty_memory_local::{MemoryWriteAccess, PublicationWriteRequirements};
    let root = std::env::temp_dir().join("recovery-authority-fixture");
    let backup = ".voktty/.voktty-migration-00000000-0000-4000-8000-000000000001-0";
    let access = super::super::init::AcceptedWriteAccess {
        requirements: PublicationWriteRequirements {
            root: root.clone(),
            create: vec![".voktty/PROJECT.md".into(), backup.into(), ".env".into()],
            replace: vec!["AGENTS.md".into()],
            recovery: vec![backup.into(), ".ssh/secret".into()],
        },
    };
    assert!(access.allows_create(&root.join(".voktty/PROJECT.md")));
    assert!(access.allows_create(&root.join(".voktty")));
    assert!(access.allows_create(&root.join(backup)));
    assert!(access.allows_replace(&root.join("AGENTS.md")));
    assert!(access
        .allows_create(&root.join(".voktty/.voktty-stage-00000000-0000-4000-8000-000000000001")));
    assert!(access.allows_remove_staging(&root.join(backup)));
    assert!(!access.allows_replace(&root.join(".voktty/.gitignore")));
    for path in [
        root.join(".voktty/.gitignore"),
        root.join("CLAUDE.md"),
        root.join(".env"),
        root.join(".ssh/secret"),
        root.with_extension("sibling"),
        root.join(".voktty/kit.json"),
        root.join(".voktty/.voktty-stage-invalid"),
        root.join(".voktty/.voktty-migration-00000000-0000-4000-8000-000000000001-127"),
    ] {
        assert!(!access.allows_create(&path));
        assert!(!access.allows_replace(&path));
        assert!(!access.allows_remove_staging(&path));
    }
}
