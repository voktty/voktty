#![cfg(target_os = "linux")]

use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::ExitStatusExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

struct Fixture {
    _owned: tempfile::TempDir,
    project: PathBuf,
    data: PathBuf,
    bin: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let owned = tempfile::tempdir().unwrap();
        fs::set_permissions(owned.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let project = owned.path().join("project space");
        let bin = owned.path().join("bin");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&bin).unwrap();
        let script = "#!/usr/bin/python3\nimport os,sys,json,signal\nsignal.alarm(5)\nif os.getenv('RUN_WAIT'):\n print('READY',flush=True)\n signal.pause()\nif os.getenv('RUN_SIGNAL'):\n os.kill(os.getpid(),signal.SIGUSR1)\nprint(json.dumps({'args':[os.fsencode(s).hex() for s in sys.argv[1:]],'cwd':os.getcwd(),'pid':os.getpid(),'input':sys.stdin.buffer.read().hex()}))\nprint('AGENT STDERR',file=sys.stderr)\nsys.exit(int(os.getenv('RUN_EXIT','0')))\n";
        for name in ["codex", "claude", "agy"] {
            let path = bin.join(name);
            fs::write(&path, script).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        Self {
            data: owned.path().join("data"),
            project,
            bin,
            _owned: owned,
        }
    }
    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_voktty-cli"));
        command
            .current_dir(&self.project)
            .env("XDG_DATA_HOME", &self.data)
            .env("PATH", &self.bin)
            .env("VOKTTY_CONTROL_ADDR", "invalid-fixture")
            .env_remove("VOKTTY_CONTROL_TOKEN")
            .args(args)
            .stdin(Stdio::null());
        command
    }
    fn run(&self, args: &[&str]) -> Output {
        self.command(args).output().unwrap()
    }
    fn init(&self) {
        let output = self.run(&["memory", "init", "--project", ".", "--yes"]);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn verified_codex(&self) {
        self.verified_agent("codex", "codex-cli 0.165.0");
    }
    fn verified_claude(&self) {
        self.verified_agent("claude", "2.1.312 (Claude Code)");
    }
    fn verified_agent(&self, name: &str, version: &str) {
        let path = self.bin.join(name);
        let original = fs::read_to_string(&path).unwrap();
        let probe = "import os,sys,json,signal\nif sys.argv[1:]==['--version']:\n assert sys.stdin.buffer.read()==b''\n mode=os.getenv('VERSION_FIXTURE','ok')\n if mode=='flood':\n  while True: os.write(1,b'x'*8192)\n if mode=='hang':\n  if os.fork()==0:\n   open(os.environ['PROBE_PID'],'w').write(str(os.getpid()))\n   while True: signal.pause()\n  sys.exit(0)\n if mode=='edit-document':\n  open(os.environ['PROBE_DOCUMENT'],'w').write('Changed during admission')\n if mode=='mutate': os.chmod(sys.argv[0],0o755)\n print('codex-cli '+('0.166.0' if mode=='wrong' else '0.165.0'),flush=True)\n sys.exit(2 if mode=='nonzero' else 0)\n";
        fs::write(
            path,
            original.replacen(
                "import os,sys,json,signal\n",
                &probe.replace(
                    "'codex-cli '+('0.166.0' if mode=='wrong' else '0.165.0')",
                    &format!("'unqualified' if mode=='wrong' else {version:?}"),
                ),
                1,
            ),
        )
        .unwrap();
    }
    fn legacy_state(&self) -> Vec<u8> {
        let path = self.state();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let bytes = b"legacy state is deliberately unreadable JSON".to_vec();
        fs::write(path, &bytes).unwrap();
        bytes
    }
    fn state(&self) -> PathBuf {
        self.data
            .join("app.voktty.voktty/project-memory/memory-local.json")
    }
}
fn value(output: &Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn absent_memory_launches_all_adapters_without_creating_state_or_modifying_arguments() {
    let f = Fixture::new();
    for adapter in ["codex", "claude", "agy"] {
        let output = f.run(&[
            "memory",
            "run",
            adapter,
            "--",
            "argument with space",
            "$(not-a-shell)",
            "--json",
            "",
        ]);
        let value = value(&output);
        assert_eq!(
            value["args"],
            serde_json::json!([
                hex::encode("argument with space"),
                hex::encode("$(not-a-shell)"),
                hex::encode("--json"),
                ""
            ])
        );
        assert_eq!(value["cwd"].as_str().unwrap(), f.project.to_str().unwrap());
        assert!(String::from_utf8_lossy(&output.stderr).contains("existing rule files"));
        assert!(String::from_utf8_lossy(&output.stderr).contains("AGENT STDERR"));
    }
    assert!(!f.data.exists());
    assert_eq!(fs::read_dir(&f.project).unwrap().count(), 0);
}

#[test]
fn binary_input_output_exit_code_and_non_utf8_arguments_survive_exec() {
    let f = Fixture::new();
    let mut child = f
        .command(&["memory", "run", "codex", "--"])
        .arg(std::ffi::OsString::from_vec(vec![0xff, 0x41]))
        .env("RUN_EXIT", "37")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let pid = child.id();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&[0, 1, 255, b'\n'])
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(37));
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["args"], serde_json::json!(["ff41"]));
    assert_eq!(value["input"], "0001ff0a");
    assert_eq!(value["pid"], pid);
}

#[test]
fn agent_signal_exit_remains_a_signal_exit() {
    let f = Fixture::new();
    let output = f
        .command(&["memory", "run", "claude"])
        .env("RUN_SIGNAL", "1")
        .output()
        .unwrap();
    assert_eq!(output.status.signal(), Some(libc::SIGUSR1));
}

#[test]
fn a_signal_sent_to_the_wrapper_reaches_the_exact_agent_process() {
    let f = Fixture::new();
    let mut child = f
        .command(&["memory", "run", "agy"])
        .env("RUN_WAIT", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut line = String::new();
        BufReader::new(stdout).read_line(&mut line).unwrap();
        let _ = sender.send(line);
    });
    let ready = receiver.recv_timeout(Duration::from_secs(3));
    if ready.as_deref() != Ok("READY\n") {
        let _ = child.kill();
        let _ = child.wait();
    }
    assert_eq!(ready.unwrap(), "READY\n");
    assert_eq!(unsafe { libc::kill(child.id() as i32, libc::SIGTERM) }, 0);
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert_eq!(status.signal(), Some(libc::SIGTERM));
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("agent did not receive SIGTERM");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    reader.join().unwrap();
}

#[test]
fn normal_launch_never_reads_legacy_state_or_instruction_content() {
    let f = Fixture::new();
    f.init();
    let before = f.legacy_state();
    fs::remove_file(f.project.join(".voktty/INIT.md")).unwrap();
    std::os::unix::fs::symlink(
        "/unavailable-secret-fixture",
        f.project.join(".voktty/INIT.md"),
    )
    .unwrap();
    value(&f.run(&["memory", "run", "codex"]));
    assert_eq!(fs::read(f.state()).unwrap(), before);
}

#[test]
fn requested_memory_requires_project_files_but_no_global_storage() {
    let f = Fixture::new();
    let output = f.run(&["memory", "run", "--session", "codex"]);
    assert_eq!(output.status.code(), Some(5));
    assert!(output.stdout.is_empty());
    assert!(!f.data.exists());
    f.init();
    f.verified_codex();
    value(&f.run(&["memory", "run", "--session", "codex"]));
    assert!(!f.data.exists());
    fs::write(&f.data, "global storage cannot be a directory").unwrap();
    value(&f.run(&["memory", "run", "--session", "codex"]));
    value(&f.run(&["memory", "run", "--no-memory", "codex"]));
    assert_eq!(
        fs::read_to_string(&f.data).unwrap(),
        "global storage cannot be a directory"
    );
}

#[test]
fn invalid_requests_missing_executables_and_explicit_project_have_clear_boundaries() {
    let f = Fixture::new();
    for args in [
        vec!["memory", "run"],
        vec!["memory", "run", "bash"],
        vec!["memory", "run", "codex", "unseparated"],
        vec!["memory", "run", "--session", "--no-memory", "codex"],
        vec!["memory", "run", "codex", "--json"],
    ] {
        let output = f.run(&args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
    }
    assert!(!f.data.exists());
    let other = f.project.parent().unwrap().join("other space");
    fs::create_dir(&other).unwrap();
    let result = value(&f.run(&[
        "memory",
        "run",
        "--project",
        other.to_str().unwrap(),
        "codex",
    ]));
    assert_eq!(result["cwd"].as_str().unwrap(), other.to_str().unwrap());
    fs::remove_file(f.bin.join("codex")).unwrap();
    assert_eq!(f.run(&["memory", "run", "codex"]).status.code(), Some(3));
}

#[test]
fn session_packet_reaches_the_initial_user_argument_without_consuming_stdin_or_persisting_permission(
) {
    let f = Fixture::new();
    f.init();
    fs::write(
        f.project.join(".voktty/CONTEXT.md"),
        "SYNTHETIC CONTEXT FACTS",
    )
    .unwrap();
    f.verified_codex();
    let before = f.legacy_state();
    let user = "User request with spaces\n$(literal, never a shell)";
    let mut child = f
        .command(&[
            "memory",
            "run",
            "--session",
            "codex",
            "--",
            "--model",
            "fixture model",
            "--no-alt-screen",
            user,
        ])
        .env("RUN_EXIT", "37")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let pid = child.id();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&[0, 255, b'\n'])
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(
        output.status.code(),
        Some(37),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    let args: Vec<String> = result["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| String::from_utf8(hex::decode(s.as_str().unwrap()).unwrap()).unwrap())
        .collect();
    assert_eq!(&args[..3], &["--model", "fixture model", "--no-alt-screen"]);
    assert_eq!(args.len(), 4);
    assert!(args[3].starts_with("PROJECT MEMORY (.voktty)\n"));
    assert!(args[3].contains("SYNTHETIC CONTEXT FACTS"));
    assert!(args[3].contains(".voktty/INIT.md"));
    assert!(args[3].ends_with(&format!("User request:\n{user}")));
    assert_eq!(result["input"], "00ff0a");
    assert_eq!(result["pid"], pid);
    assert_eq!(result["cwd"].as_str().unwrap(), f.project.to_str().unwrap());
    assert_eq!(fs::read(f.state()).unwrap(), before);
}

#[test]
fn explicit_project_context_uses_current_instructions_and_ignores_legacy_policy() {
    let f = Fixture::new();
    f.init();
    f.verified_codex();
    assert!(f.run(&["memory", "use", "--always"]).status.success());
    let before = fs::read(f.state()).unwrap();
    let native = value(&f.run(&["memory", "run", "codex"]));
    assert_eq!(native["args"], serde_json::json!([]));
    let result = value(&f.run(&["memory", "run", "--session", "codex"]));
    let packet =
        String::from_utf8(hex::decode(result["args"][1].as_str().unwrap()).unwrap()).unwrap();
    assert!(packet.contains(".voktty/INIT.md"));
    assert_eq!(fs::read(f.state()).unwrap(), before);
    fs::write(f.project.join(".voktty/INIT.md"), "Updated project guide").unwrap();
    assert!(f.run(&["memory", "use", "--never"]).status.success());
    let before = fs::read(f.state()).unwrap();
    let result = value(&f.run(&["memory", "run", "--session", "codex"]));
    let packet =
        String::from_utf8(hex::decode(result["args"][1].as_str().unwrap()).unwrap()).unwrap();
    assert!(packet.contains("Updated project guide"));
    assert_eq!(fs::read(f.state()).unwrap(), before);
}

#[test]
fn unverified_versions_and_modes_never_start_an_integrated_agent() {
    let f = Fixture::new();
    f.init();
    f.verified_codex();
    for args in [
        vec!["resume"],
        vec!["exec"],
        vec!["--cd", ".."],
        vec!["--remote", "ws://invalid"],
        vec!["--config", "x=y"],
        vec!["--model", "--remote"],
    ] {
        let mut command = vec!["memory", "run", "--session", "codex", "--"];
        command.extend(args);
        let refused = f.run(&command);
        assert_eq!(refused.status.code(), Some(3));
        assert!(refused.stdout.is_empty());
    }
    for mode in ["wrong", "nonzero", "flood", "mutate"] {
        let output = f
            .command(&["memory", "run", "--session", "codex"])
            .env("VERSION_FIXTURE", mode)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(3), "mode {mode}");
        assert!(output.stdout.is_empty());
    }
    for adapter in ["claude", "agy"] {
        let output = f.run(&["memory", "run", "--session", adapter]);
        assert_eq!(output.status.code(), Some(3));
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn changed_instructions_during_version_admission_block_the_packet() {
    let f = Fixture::new();
    f.init();
    f.verified_codex();
    let output = f
        .command(&["memory", "run", "--session", "codex"])
        .env("VERSION_FIXTURE", "edit-document")
        .env("PROBE_DOCUMENT", f.project.join(".voktty/INIT.md"))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(3));
    assert!(output.stdout.is_empty());
    assert!(!f.data.exists());
}

#[test]
fn bounded_version_probe_kills_descendants_holding_its_pipe() {
    let f = Fixture::new();
    f.init();
    f.verified_codex();
    let pid_file = f.project.parent().unwrap().join("probe.pid");
    let start = Instant::now();
    let output = f
        .command(&["memory", "run", "--session", "codex"])
        .env("VERSION_FIXTURE", "hang")
        .env("PROBE_PID", &pid_file)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(3));
    assert!(output.stdout.is_empty());
    assert!(start.elapsed() < Duration::from_secs(5));
    let pid = fs::read_to_string(pid_file).unwrap();
    assert_descendant_settled(&pid);
}

fn assert_descendant_settled(pid: &str) {
    let deadline = Instant::now() + Duration::from_secs(1);
    // Group SIGKILL delivery can precede the descendant's final scheduler turn.
    loop {
        let status = fs::read_to_string(format!("/proc/{pid}/status"));
        if status
            .as_ref()
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
            || status.as_ref().is_ok_and(|text| {
                text.lines()
                    .any(|line| line.starts_with("State:") && line.contains('Z'))
            })
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "probe descendant did not settle: {status:?}"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn termination_during_probe_settles_its_group_before_preserving_the_signal() {
    let f = Fixture::new();
    f.init();
    f.verified_codex();
    let pid_file = f.project.parent().unwrap().join("cancel-probe.pid");
    let mut child = f
        .command(&["memory", "run", "--session", "codex"])
        .env("VERSION_FIXTURE", "hang")
        .env("PROBE_PID", &pid_file)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let ready = Instant::now() + Duration::from_secs(2);
    let pid = loop {
        if let Ok(pid) = fs::read_to_string(&pid_file) {
            if pid.parse::<i32>().is_ok() {
                break pid;
            }
        }
        if Instant::now() >= ready {
            let _ = child.kill();
            let _ = child.wait();
            panic!("probe did not become ready");
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    assert_eq!(unsafe { libc::kill(child.id() as i32, libc::SIGTERM) }, 0);
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            if status.signal() != Some(libc::SIGTERM) {
                unsafe {
                    libc::kill(pid.parse().unwrap(), libc::SIGKILL);
                }
            }
            assert_eq!(status.signal(), Some(libc::SIGTERM));
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            unsafe {
                libc::kill(pid.parse().unwrap(), libc::SIGKILL);
            }
            panic!("termination did not settle the probe");
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_descendant_settled(&pid);
}

#[test]
fn claude_session_preserves_options_user_request_stdin_pid_and_manual_policy() {
    let f = Fixture::new();
    f.init();
    f.verified_claude();
    fs::write(f.project.join(".voktty/CONTEXT.md"), "Shared Claude facts").unwrap();
    let before = f.legacy_state();
    let user = "Explain the shared facts\nKeep this exact request";
    let mut child = f
        .command(&[
            "memory",
            "run",
            "--session",
            "claude",
            "--",
            "--model",
            "claude-sonnet-4-5",
            "--effort",
            "high",
            "--permission-mode",
            "plan",
            "--name",
            "Fixture label",
            user,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("RUN_EXIT", "23")
        .spawn()
        .unwrap();
    let pid = child.id();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&[255, 0, b'\n'])
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(
        output.status.code(),
        Some(23),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    let args: Vec<String> = result["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| String::from_utf8(hex::decode(s.as_str().unwrap()).unwrap()).unwrap())
        .collect();
    assert_eq!(
        &args[..8],
        &[
            "--model",
            "claude-sonnet-4-5",
            "--effort",
            "high",
            "--permission-mode",
            "plan",
            "--name",
            "Fixture label"
        ]
    );
    assert_eq!(args.len(), 9);
    assert!(args[8].starts_with("PROJECT MEMORY (.voktty)\n"));
    assert!(args[8].contains("Shared Claude facts"));
    assert!(args[8].ends_with(&format!("User request:\n{user}")));
    assert_eq!(result["input"], "ff000a");
    assert_eq!(result["pid"], pid);
    assert_eq!(fs::read(f.state()).unwrap(), before);
}

#[test]
fn claude_session_requires_its_own_version_without_global_trust() {
    let f = Fixture::new();
    f.init();
    f.verified_claude();
    let before = f.legacy_state();
    let result = value(&f.run(&["memory", "run", "--session", "claude"]));
    assert_eq!(result["args"][0], hex::encode("--"));
    let text =
        String::from_utf8(hex::decode(result["args"][1].as_str().unwrap()).unwrap()).unwrap();
    assert!(text.contains(".voktty/INIT.md"));
    assert_eq!(fs::read(f.state()).unwrap(), before);
    let wrong = f
        .command(&["memory", "run", "--session", "claude"])
        .env("VERSION_FIXTURE", "wrong")
        .output()
        .unwrap();
    assert_eq!(wrong.status.code(), Some(3));
    assert!(wrong.stdout.is_empty());
    f.verified_codex();
    fs::copy(f.bin.join("codex"), f.bin.join("claude")).unwrap();
    let wrong_family = f.run(&["memory", "run", "--session", "claude"]);
    assert_eq!(wrong_family.status.code(), Some(3));
    assert!(wrong_family.stdout.is_empty());
    assert_eq!(fs::read(f.state()).unwrap(), before);
}

#[test]
fn claude_unverified_modes_are_refused_and_no_memory_keeps_native_arguments() {
    let f = Fixture::new();
    f.init();
    f.verified_claude();
    for flags in [
        vec!["--print"],
        vec!["-p"],
        vec!["--resume", "fixture"],
        vec!["--continue"],
        vec!["--worktree", "other"],
        vec!["--settings", "{}"],
        vec!["--add-dir", "one", "two"],
        vec!["--agents", "{}"],
        vec!["purge"],
        vec!["auth"],
        vec!["/help"],
    ] {
        let mut args = vec!["memory", "run", "--session", "claude", "--"];
        args.extend(flags);
        let refused = f.run(&args);
        assert_eq!(refused.status.code(), Some(3));
        assert!(refused.stdout.is_empty());
    }
    let native = value(&f.run(&[
        "memory",
        "run",
        "--no-memory",
        "claude",
        "--",
        "--resume",
        "fixture id",
    ]));
    assert_eq!(
        native["args"],
        serde_json::json!([hex::encode("--resume"), hex::encode("fixture id")])
    );
}

#[test]
fn project_context_resolves_ancestors_and_rejects_linked_documents_and_ambiguity() {
    let f = Fixture::new();
    f.init();
    f.verified_codex();
    let nested = f.project.join("source");
    fs::create_dir(&nested).unwrap();
    let output = f
        .command(&["memory", "run", "--session", "codex"])
        .current_dir(&nested)
        .output()
        .unwrap();
    let result = value(&output);
    assert_eq!(result["cwd"].as_str().unwrap(), nested.to_str().unwrap());
    let packet =
        String::from_utf8(hex::decode(result["args"][1].as_str().unwrap()).unwrap()).unwrap();
    assert!(packet.contains(f.project.to_str().unwrap()));
    assert!(!f.data.exists());
    let context = f.project.join(".voktty/CONTEXT.md");
    fs::remove_file(&context).unwrap();
    std::os::unix::fs::symlink("/unavailable-secret-fixture", &context).unwrap();
    let refused = f.run(&["memory", "run", "--session", "codex"]);
    assert!(!refused.status.success());
    assert!(refused.stdout.is_empty());
    fs::remove_file(&context).unwrap();
    fs::write(context, "Current context").unwrap();
    assert!(f
        .run(&["memory", "init", "--project", nested.to_str().unwrap()])
        .status
        .success());
    let refused = f
        .command(&["memory", "run", "--session", "codex"])
        .current_dir(nested)
        .output()
        .unwrap();
    assert_eq!(refused.status.code(), Some(5));
    assert!(refused.stdout.is_empty());
    assert!(!f.data.exists());
}
