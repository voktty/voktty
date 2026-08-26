#![cfg(windows)]

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
fn windows_background_process_captures_output() {
    let process = background::spawn(
        "Write-Output 'VOKTTY_TASK_WINDOWS_OK'".into(),
        None,
        WorkspaceEnv::Local,
    )
    .expect("spawn PowerShell task");
    assert!(wait_until(Duration::from_secs(10), || process
        .read_logs(0)
        .exited));
    let logs = process.read_logs(0);
    assert!(logs.bytes.contains("VOKTTY_TASK_WINDOWS_OK"));
    assert_eq!(logs.exit_code, Some(0));
}

#[test]
fn windows_background_process_is_cancelable() {
    let process = background::spawn("Start-Sleep -Seconds 30".into(), None, WorkspaceEnv::Local)
        .expect("spawn PowerShell task");
    process.kill();
    assert!(wait_until(Duration::from_secs(10), || process
        .read_logs(0)
        .exited));
}

#[test]
#[ignore = "requires an Ubuntu WSL distribution"]
fn wsl_background_process_captures_output() {
    let process = background::spawn(
        "printf 'VOKTTY_TASK_WSL_OK\\n'".into(),
        None,
        WorkspaceEnv::Wsl {
            distro: "Ubuntu".into(),
        },
    )
    .expect("spawn WSL task");
    assert!(wait_until(Duration::from_secs(15), || process
        .read_logs(0)
        .exited));
    let logs = process.read_logs(0);
    assert!(logs.bytes.contains("VOKTTY_TASK_WSL_OK"));
    assert_eq!(logs.exit_code, Some(0));
}
