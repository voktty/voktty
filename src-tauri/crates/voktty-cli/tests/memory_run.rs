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
        assert!(String::from_utf8_lossy(&output.stderr).contains("not connected"));
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
fn stored_manual_and_never_do_not_read_or_accept_instruction_content() {
    let f = Fixture::new();
    f.init();
    let state = f.data.join("dev.voktty/project-memory/memory-local.json");
    fs::remove_file(f.project.join(".voktty/INIT.md")).unwrap();
    std::os::unix::fs::symlink(
        "/unavailable-secret-fixture",
        f.project.join(".voktty/INIT.md"),
    )
    .unwrap();
    for mode in ["--manual", "--never"] {
        assert!(f.run(&["memory", "use", mode]).status.success());
        let before = fs::read(&state).unwrap();
        value(&f.run(&["memory", "run", "codex"]));
        assert_eq!(fs::read(&state).unwrap(), before);
    }
}

#[test]
fn requested_memory_fails_before_agent_start_and_explicit_disable_is_transparent() {
    let f = Fixture::new();
    let output = f.run(&["memory", "run", "--session", "codex"]);
    assert_eq!(output.status.code(), Some(5));
    assert!(output.stdout.is_empty());
    assert!(!f.data.exists());
    f.init();
    assert!(f.run(&["memory", "use", "--always"]).status.success());
    let output = f.run(&["memory", "run", "codex"]);
    assert_eq!(output.status.code(), Some(3));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("copy a startup message"));
    value(&f.run(&["memory", "run", "--no-memory", "codex"]));
    assert!(f.run(&["memory", "use", "--never"]).status.success());
    assert_eq!(
        f.run(&["memory", "run", "--session", "codex"])
            .status
            .code(),
        Some(5)
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
