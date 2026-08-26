#![cfg(unix)]

use std::time::{Duration, Instant};

use voktty_lib::modules::shell::background;
use voktty_lib::modules::workspace::WorkspaceEnv;

fn wait_until<F: Fn() -> bool>(timeout: Duration, check: F) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    check()
}

#[test]
fn spawn_empty_command_errors() {
    assert!(background::spawn("   ".into(), None, WorkspaceEnv::Local).is_err());
}

#[test]
fn spawn_invalid_cwd_errors() {
    let err = background::spawn(
        "true".into(),
        Some("/no/such/dir".into()),
        WorkspaceEnv::Local,
    );
    assert!(err.is_err());
}

#[test]
fn spawn_captures_stdout_and_exits_zero() {
    let proc =
        background::spawn("printf 'hello\\n'".into(), None, WorkspaceEnv::Local).expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).exited
    }));

    let logs = proc.read_logs(0);
    assert!(logs.bytes.contains("hello"));
    assert!(logs.exited);
    assert_eq!(logs.exit_code, Some(0));
}

#[test]
fn spawn_captures_nonzero_exit() {
    let proc = background::spawn("exit 42".into(), None, WorkspaceEnv::Local).expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).exited
    }));
    assert_eq!(proc.read_logs(0).exit_code, Some(42));
}

#[test]
fn kill_terminates_a_running_process() {
    let proc = background::spawn("sleep 30".into(), None, WorkspaceEnv::Local).expect("spawn");

    proc.kill();

    assert!(
        wait_until(Duration::from_secs(5), || { proc.read_logs(0).exited }),
        "killed process must reach exited state",
    );
}

#[test]
fn kill_terminates_the_process_group() {
    let temp = tempfile::tempdir().expect("tempdir");
    let pid_path = temp.path().join("child.pid");
    let command = format!(
        "sleep 30 & echo $! > '{}'; wait",
        pid_path.to_string_lossy()
    );
    let proc = background::spawn(command, None, WorkspaceEnv::Local).expect("spawn");
    assert!(wait_until(Duration::from_secs(5), || pid_path.exists()));
    let child_pid: libc::pid_t = std::fs::read_to_string(&pid_path)
        .expect("pid file")
        .trim()
        .parse()
        .expect("child pid");

    proc.kill();

    assert!(wait_until(Duration::from_secs(5), || unsafe {
        libc::kill(child_pid, 0) != 0
    }));
}

#[test]
fn read_logs_advances_offset() {
    let proc = background::spawn(
        "printf 'one\\n'; printf 'two\\n'".into(),
        None,
        WorkspaceEnv::Local,
    )
    .expect("spawn");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).exited
    }));

    let first = proc.read_logs(0);
    assert!(first.next_offset > 0);

    let next = proc.read_logs(first.next_offset);
    assert!(
        next.bytes.is_empty(),
        "consumed offset must return no bytes"
    );
    assert_eq!(next.next_offset, first.next_offset);
}

#[test]
fn info_reflects_command_and_exit() {
    let proc = background::spawn("true".into(), None, WorkspaceEnv::Local).expect("spawn");
    let info_running = proc.info(7);
    assert_eq!(info_running.handle, 7);
    assert_eq!(info_running.command, "true");

    assert!(wait_until(Duration::from_secs(5), || {
        proc.read_logs(0).exited
    }));
    let info_done = proc.info(7);
    assert!(info_done.exited);
    assert_eq!(info_done.exit_code, Some(0));
}
