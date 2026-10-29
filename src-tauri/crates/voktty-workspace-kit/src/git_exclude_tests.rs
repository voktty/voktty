use super::*;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[test]
fn root_and_nested_proposals_preserve_every_existing_byte_and_are_idempotent() {
    for current in [
        None,
        Some(""),
        Some("# owner rules\n*.log"),
        Some("# owner\r\n*.log\r\n"),
        Some("# café\n*.log\r\n# mixed\n"),
    ] {
        let plan = plan_git_memory_exclusion(&["tools", "ui"], current).unwrap();
        assert_eq!(plan.pattern, "/tools/ui/.voktty/");
        assert_eq!(plan.expected.as_deref(), current);
        assert!(plan.proposed.starts_with(current.unwrap_or_default()));
        assert_eq!(
            plan.action,
            if current.is_none() {
                DeploymentAction::Create
            } else {
                DeploymentAction::Migrate
            }
        );
        let next = plan_git_memory_exclusion(&["tools", "ui"], Some(&plan.proposed)).unwrap();
        assert_eq!(next.action, DeploymentAction::Skip);
        assert_eq!(next.proposed, plan.proposed);
    }
    let root = plan_git_memory_exclusion(&[], None).unwrap();
    assert_eq!(root.pattern, "/.voktty/");
    assert_eq!(root.proposed, format!("{MARKER}\n/.voktty/\n"));
    let crlf = plan_git_memory_exclusion(&[], Some("# owner\r\n*.log")).unwrap();
    assert_eq!(
        crlf.proposed,
        format!("# owner\r\n*.log\r\n\r\n{MARKER}\r\n/.voktty/\r\n")
    );
}

#[test]
fn a_later_negation_requires_an_append_but_trailing_comments_do_not() {
    for current in ["/.voktty/\n", "/.voktty/\r\n# owner notes\r\n\r\n"] {
        let plan = plan_git_memory_exclusion(&[], Some(current)).unwrap();
        assert_eq!(plan.action, DeploymentAction::Skip);
        assert_eq!(plan.proposed, current);
    }
    for current in [
        "/.voktty/\n!/.voktty/\n",
        "/.voktty/\n!/.voktty/**\n",
        "/.voktty/   \n",
        "/.voktty/\nother-rule\n",
    ] {
        let plan = plan_git_memory_exclusion(&[], Some(current)).unwrap();
        assert_eq!(plan.action, DeploymentAction::Migrate);
        assert!(plan.proposed.starts_with(current));
        assert!(plan.proposed.ends_with("\n/.voktty/\n"));
    }
}

#[test]
fn components_are_literal_git_filenames_not_path_expressions_or_globs() {
    let plan =
        plan_git_memory_exclusion(&[" space [a]*?", "literal\\name", "#notes!"], None).unwrap();
    assert_eq!(
        plan.pattern,
        "/\\ space\\ \\[a\\]\\*\\?/literal\\\\name/#notes!/.voktty/"
    );
    for invalid in [
        "",
        ".",
        "..",
        "dir/child",
        "/absolute",
        "line\nbreak",
        "line\rbreak",
        "nul\0",
        "tab\t",
        "delete\u{007f}",
    ] {
        let errors = plan_git_memory_exclusion(&["good", invalid], None).unwrap_err();
        assert_eq!(errors[0].code, "KIT_GIT_EXCLUDE_PATH_INVALID");
        assert_eq!(
            errors[0].path,
            vec![serde_json::json!("projectComponents"), serde_json::json!(1)]
        );
    }
}

#[test]
fn limits_count_utf8_bytes_and_never_truncate_the_existing_exclude() {
    assert!(plan_git_memory_exclusion(&["x"; 129], None).is_err());
    assert!(plan_git_memory_exclusion(&[&"x".repeat(4096)], None).is_err());
    assert!(plan_git_memory_exclusion(&[&"é".repeat(2048)], None).is_err());
    let text = "#".repeat(MAX_EXCLUDE_BYTES + 1);
    let errors = plan_git_memory_exclusion(&[], Some(&text)).unwrap_err();
    assert_eq!(errors[0].code, "KIT_GIT_EXCLUDE_TOO_LARGE");
    assert_eq!(errors[0].path, vec![serde_json::json!("expected")]);
    let full = "#".repeat(MAX_EXCLUDE_BYTES);
    let errors = plan_git_memory_exclusion(&[], Some(&full)).unwrap_err();
    assert_eq!(errors[0].path, vec![serde_json::json!("proposed")]);
    assert_eq!(full.len(), MAX_EXCLUDE_BYTES);
    assert_eq!(
        plan_git_memory_exclusion(&[], Some("owner\0data")).unwrap_err()[0].code,
        "KIT_GIT_EXCLUDE_CONTENT_INVALID"
    );
}

struct Repo(PathBuf);
impl Repo {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "voktty-kit-exclude-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let repo = Self(root);
        fs::write(repo.0.join("empty-config"), "").unwrap();
        repo.run(&["init", "--quiet"], None, 0);
        repo
    }
    fn run(&self, args: &[&str], input: Option<&[u8]>, expected: i32) -> Output {
        let mut command = Command::new("git");
        for name in [
            "GIT_DIR",
            "GIT_COMMON_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
            "GIT_CONFIG_PARAMETERS",
            "GIT_CONFIG",
            "GIT_TEMPLATE_DIR",
        ] {
            command.env_remove(name);
        }
        let mut child = command
            .arg("-C")
            .arg(&self.0)
            .args(["-c", "init.templateDir=", "-c", "core.fsmonitor=false"])
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", self.0.join("empty-config"))
            .env("GIT_CONFIG_COUNT", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_AUTHOR_NAME", "Fixture")
            .env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
            .env("GIT_COMMITTER_NAME", "Fixture")
            .env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Git is required for exclude integration tests");
        if let Some(input) = input {
            child.stdin.take().unwrap().write_all(input).unwrap();
        } else {
            drop(child.stdin.take());
        }
        let started = Instant::now();
        while child.try_wait().unwrap().is_none() {
            if started.elapsed() >= Duration::from_secs(5) {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("Git fixture command exceeded its deadline");
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let output = child.wait_with_output().unwrap();
        assert_eq!(
            output.status.code(),
            Some(expected),
            "Git fixture failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }
    fn memory(&self, components: &[&str]) -> String {
        let mut dir = self.0.clone();
        for part in components {
            dir.push(part);
        }
        fs::create_dir_all(dir.join(".voktty")).unwrap();
        fs::write(dir.join(".voktty/kit.json"), "{}\n").unwrap();
        format!(
            "{}.voktty/kit.json",
            if components.is_empty() {
                String::new()
            } else {
                format!("{}/", components.join("/"))
            }
        )
    }
    fn publish(&self, plan: &GitMemoryExcludePlan) {
        fs::create_dir_all(self.0.join(".git/info")).unwrap();
        fs::write(self.0.join(".git/info/exclude"), &plan.proposed).unwrap();
    }
    fn ignored(&self, path: &str, expected: bool) {
        let input = format!("{path}\0");
        let output = self.run(
            &["check-ignore", "-z", "--stdin"],
            Some(input.as_bytes()),
            if expected { 0 } else { 1 },
        );
        assert_eq!(
            output.stdout,
            if expected {
                input.into_bytes()
            } else {
                Vec::new()
            }
        );
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn git_hides_only_the_selected_root_or_nested_memory_and_preserves_other_excludes() {
    for components in [vec![], vec!["tools", "ui"]] {
        let repo = Repo::new();
        let target = repo.memory(&components);
        let sibling = repo.memory(&["sibling"]);
        let current = "# owner data\r\n*.secret\r\n!/.voktty/\r\n";
        let plan = plan_git_memory_exclusion(&components, Some(current)).unwrap();
        repo.publish(&plan);
        repo.ignored(&target, true);
        repo.ignored(&sibling, false);
        repo.ignored("owned.secret", true);
        assert!(fs::read(repo.0.join(".git/info/exclude"))
            .unwrap()
            .starts_with(current.as_bytes()));
        let next = plan_git_memory_exclusion(&components, Some(&plan.proposed)).unwrap();
        assert_eq!(next.action, DeploymentAction::Skip);
    }
}

#[cfg(unix)]
#[test]
fn git_treats_escaped_glob_space_unicode_and_backslash_names_literally() {
    for name in [
        "a[b]*?",
        "trailing space ",
        "literal\\name",
        "#notes!",
        "café-漢字",
    ] {
        let repo = Repo::new();
        let target = repo.memory(&[name]);
        let sibling = repo.memory(&["ab-match"]);
        repo.publish(&plan_git_memory_exclusion(&[name], None).unwrap());
        repo.ignored(&target, true);
        repo.ignored(&sibling, false);
    }
}

#[test]
fn an_exclude_proposal_cannot_claim_privacy_for_tracked_files_or_higher_priority_gitignore_rules() {
    let repo = Repo::new();
    let target = repo.memory(&[]);
    let plan = plan_git_memory_exclusion(&[], None).unwrap();
    repo.publish(&plan);
    repo.ignored(&target, true);
    fs::write(repo.0.join(".gitignore"), "!/.voktty/\n!/.voktty/**\n").unwrap();
    repo.ignored(&target, false);
    fs::remove_file(repo.0.join(".gitignore")).unwrap();
    repo.run(&["add", "--force", "--", &target], None, 0);
    repo.ignored(&target, false);
}

#[test]
fn git_common_excludes_apply_to_both_the_main_checkout_and_its_linked_worktree() {
    let repo = Repo::new();
    fs::write(repo.0.join("tracked.txt"), "initial\n").unwrap();
    repo.run(&["add", "--", "tracked.txt"], None, 0);
    repo.run(
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Initial fixture",
        ],
        None,
        0,
    );
    repo.run(
        &["worktree", "add", "--quiet", "--detach", "linked"],
        None,
        0,
    );
    assert!(repo.0.join("linked/.git").is_file());
    fs::create_dir(repo.0.join("linked/.voktty")).unwrap();
    fs::write(repo.0.join("linked/.voktty/kit.json"), "{}\n").unwrap();
    repo.memory(&[]);
    let common = repo.run(&["-C", "linked", "rev-parse", "--git-common-dir"], None, 0);
    let common = PathBuf::from(String::from_utf8(common.stdout).unwrap().trim());
    assert_eq!(
        fs::canonicalize(common).unwrap(),
        fs::canonicalize(repo.0.join(".git")).unwrap()
    );
    repo.publish(&plan_git_memory_exclusion(&[], None).unwrap());
    repo.ignored(".voktty/kit.json", true);
    let input = b".voktty/kit.json\0";
    let output = repo.run(
        &["-C", "linked", "check-ignore", "-z", "--stdin"],
        Some(input),
        0,
    );
    assert_eq!(output.stdout, input);
}
