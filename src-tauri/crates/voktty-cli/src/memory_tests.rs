use super::*;
use std::fs;
#[test]
fn marker_authority_grants_no_instruction_or_sibling_content() {
    let project = tempfile::tempdir().unwrap();
    let access = MarkerAccess {
        root: fs::canonicalize(project.path()).unwrap(),
    };
    assert!(access.allows_read(&access.root.join(".voktty/kit.json")));
    for target in [".voktty/INIT.md", "AGENTS.md", ".env", ".voktty/PROJECT.md"] {
        assert!(!access.allows_read(&access.root.join(target)));
    }
    assert!(!access.allows_enumeration(&access.root.join(".voktty/sessions")));
    assert!(!access.allows_metadata(&access.root.join("sibling")));
}

#[cfg(unix)]
#[test]
fn non_utf8_subcommands_are_usage_errors_without_io() {
    use std::os::unix::ffi::OsStringExt;
    let error = parse(vec![OsString::from_vec(vec![255])]).unwrap_err();
    assert_eq!(error.code, "usage");
}
