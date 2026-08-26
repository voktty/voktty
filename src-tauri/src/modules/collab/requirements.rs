use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use shared_child::SharedChild;

const DOWNLOADS_URL: &str = "https://developers.cloudflare.com/tunnel/downloads/";
const VERSION_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)]
pub enum Platform {
    Windows,
    Macos,
    Linux { asset_arch: &'static str },
}

impl Platform {
    fn current() -> Self {
        #[cfg(target_os = "windows")]
        return Self::Windows;
        #[cfg(target_os = "macos")]
        return Self::Macos;
        #[cfg(target_os = "linux")]
        return Self::Linux {
            asset_arch: linux_asset_arch(),
        };
        #[allow(unreachable_code)]
        Self::Linux {
            asset_arch: "amd64",
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct AvailableManagers {
    pub winget: bool,
    pub scoop: bool,
    pub choco: bool,
    pub brew: bool,
    pub apt: bool,
    pub dnf: bool,
    pub yum: bool,
    pub pacman: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSuggestion {
    pub method: String,
    pub command: String,
    pub documentation_url: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflaredStatus {
    pub installed: bool,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
    pub suggestion: Option<InstallSuggestion>,
}

#[tauri::command]
pub async fn collab_cloudflared_status(
    custom_path: Option<String>,
) -> Result<CloudflaredStatus, String> {
    tauri::async_runtime::spawn_blocking(move || detect_cloudflared(custom_path.as_deref()))
        .await
        .map_err(|error| format!("cloudflared verification failed: {error}"))
}

pub(super) fn detect_cloudflared(custom_path: Option<&str>) -> CloudflaredStatus {
    let suggestion = || Some(install_suggestion(Platform::current(), &detect_managers()));
    let executable = match resolve_executable(custom_path) {
        Ok(Some(path)) => path,
        Ok(None) => {
            return CloudflaredStatus {
                installed: false,
                executable: None,
                version: None,
                error: Some("cloudflared was not found".to_string()),
                suggestion: suggestion(),
            };
        }
        Err(error) => {
            return CloudflaredStatus {
                installed: false,
                executable: None,
                version: None,
                error: Some(error),
                suggestion: suggestion(),
            };
        }
    };
    match read_version(&executable) {
        Ok(version) => CloudflaredStatus {
            installed: true,
            executable: Some(executable.to_string_lossy().into_owned()),
            version: Some(version),
            error: None,
            suggestion: None,
        },
        Err(error) => CloudflaredStatus {
            installed: false,
            executable: Some(executable.to_string_lossy().into_owned()),
            version: None,
            error: Some(error),
            suggestion: suggestion(),
        },
    }
}

fn resolve_executable(custom_path: Option<&str>) -> Result<Option<PathBuf>, String> {
    if let Some(value) = custom_path.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        if !path.is_absolute() {
            return Err("custom cloudflared path must be absolute".to_string());
        }
        if !is_executable_file(&path) {
            return Err("custom cloudflared path is not an executable file".to_string());
        }
        return Ok(Some(path));
    }
    if let Ok(path) = which::which("cloudflared") {
        return Ok(Some(path));
    }
    Ok(known_executable_paths()
        .into_iter()
        .find(|path| is_executable_file(path)))
}

fn known_executable_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(target_os = "windows")]
    if let Some(data_dir) = dirs::data_local_dir() {
        paths.push(data_dir.join("Voktty/bin/cloudflared.exe"));
    }
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("/opt/homebrew/bin/cloudflared"));
        paths.push(PathBuf::from("/usr/local/bin/cloudflared"));
    }
    #[cfg(target_os = "linux")]
    {
        paths.push(PathBuf::from("/usr/local/bin/cloudflared"));
        paths.push(PathBuf::from("/usr/bin/cloudflared"));
    }
    #[cfg(unix)]
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".local/bin/cloudflared"));
    }
    paths
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(windows)]
    {
        path.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    }
}

fn read_version(executable: &Path) -> Result<String, String> {
    let mut command = Command::new(executable);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut command);
    let child = Arc::new(SharedChild::spawn(&mut command).map_err(|error| error.to_string())?);
    let mut stdout = child
        .take_stdout()
        .ok_or_else(|| "cloudflared version output was unavailable".to_string())?;
    let mut stderr = child
        .take_stderr()
        .ok_or_else(|| "cloudflared error output was unavailable".to_string())?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        if started.elapsed() >= VERSION_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cloudflared --version timed out".to_string());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let mut output = String::new();
    let _ = stdout.read_to_string(&mut output);
    if !status.success() {
        let mut error_output = String::new();
        let _ = stderr.read_to_string(&mut error_output);
        return Err(if error_output.trim().is_empty() {
            "cloudflared --version failed".to_string()
        } else {
            format!("cloudflared --version failed: {}", error_output.trim())
        });
    }
    parse_version(&output).ok_or_else(|| "executable is not cloudflared".to_string())
}

pub fn parse_version(output: &str) -> Option<String> {
    let mut words = output.split_whitespace();
    if !words.next()?.eq_ignore_ascii_case("cloudflared") {
        return None;
    }
    if !words.next()?.eq_ignore_ascii_case("version") {
        return None;
    }
    let version = words.next()?.trim();
    (!version.is_empty()).then(|| version.to_string())
}

pub fn detect_managers() -> AvailableManagers {
    AvailableManagers {
        winget: has_command("winget"),
        scoop: has_command("scoop"),
        choco: has_command("choco"),
        brew: has_command("brew"),
        apt: has_command("apt-get"),
        dnf: has_command("dnf"),
        yum: has_command("yum"),
        pacman: has_command("pacman"),
    }
}

fn has_command(command: &str) -> bool {
    which::which(command).is_ok()
}

#[cfg(target_os = "linux")]
fn linux_asset_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "x86" | "i686" | "i586" => "386",
        "aarch64" => "arm64",
        "arm" => "arm",
        _ => "amd64",
    }
}

fn macos_asset_arch() -> &'static str {
    if std::env::consts::ARCH == "aarch64" {
        "arm64"
    } else {
        "amd64"
    }
}

pub fn install_suggestion(platform: Platform, managers: &AvailableManagers) -> InstallSuggestion {
    let (method, command) = match platform {
        Platform::Windows if managers.winget => (
            "winget",
            "winget install --id Cloudflare.cloudflared --exact".to_string(),
        ),
        Platform::Windows if managers.scoop => {
            ("scoop", "scoop install cloudflared".to_string())
        }
        Platform::Windows if managers.choco => {
            ("chocolatey", "choco install cloudflared".to_string())
        }
        Platform::Windows => (
            "official_binary",
            "$dir = Join-Path $env:LOCALAPPDATA 'Voktty\\bin'; New-Item -ItemType Directory -Force -Path $dir | Out-Null; Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile (Join-Path $dir 'cloudflared.exe')".to_string(),
        ),
        Platform::Macos if managers.brew => {
            ("homebrew", "brew install cloudflared".to_string())
        }
        Platform::Macos => (
            "official_binary",
            format!(
                "mkdir -p \"$HOME/.local/bin\" && curl -L \"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-{}\" -o \"$HOME/.local/bin/cloudflared\" && chmod +x \"$HOME/.local/bin/cloudflared\"",
                macos_asset_arch()
            ),
        ),
        Platform::Linux { .. } if managers.brew => {
            ("homebrew", "brew install cloudflared".to_string())
        }
        Platform::Linux { .. } if managers.apt => (
            "apt",
            "sudo mkdir -p --mode=0755 /usr/share/keyrings && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null && sudo apt-get update && sudo apt-get install cloudflared".to_string(),
        ),
        Platform::Linux { .. } if managers.dnf => (
            "dnf",
            "curl -fsSL https://pkg.cloudflare.com/cloudflared.repo | sudo tee /etc/yum.repos.d/cloudflared.repo >/dev/null && sudo dnf install cloudflared".to_string(),
        ),
        Platform::Linux { .. } if managers.yum => (
            "yum",
            "curl -fsSL https://pkg.cloudflare.com/cloudflared.repo | sudo tee /etc/yum.repos.d/cloudflared.repo >/dev/null && sudo yum install cloudflared".to_string(),
        ),
        Platform::Linux { .. } if managers.pacman => (
            "pacman",
            "sudo pacman -Syu cloudflared".to_string(),
        ),
        Platform::Linux { asset_arch } => (
            "official_binary",
            format!(
                "mkdir -p \"$HOME/.local/bin\" && curl -L \"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{asset_arch}\" -o \"$HOME/.local/bin/cloudflared\" && chmod +x \"$HOME/.local/bin/cloudflared\""
            ),
        ),
    };
    InstallSuggestion {
        method: method.to_string(),
        command,
        documentation_url: DOWNLOADS_URL.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_prefers_winget_when_available() {
        let command = install_suggestion(
            Platform::Windows,
            &AvailableManagers {
                winget: true,
                ..AvailableManagers::default()
            },
        );

        assert_eq!(command.method, "winget");
        assert_eq!(
            command.command,
            "winget install --id Cloudflare.cloudflared --exact"
        );
    }

    #[test]
    fn windows_fallback_downloads_the_official_binary() {
        let command = install_suggestion(Platform::Windows, &AvailableManagers::default());

        assert_eq!(command.method, "official_binary");
        assert!(command.command.contains("cloudflared-windows-amd64.exe"));
        assert!(command.command.contains("LOCALAPPDATA"));
    }

    #[test]
    fn macos_prefers_homebrew() {
        let command = install_suggestion(
            Platform::Macos,
            &AvailableManagers {
                brew: true,
                ..AvailableManagers::default()
            },
        );

        assert_eq!(command.command, "brew install cloudflared");
    }

    #[test]
    fn debian_uses_cloudflares_signed_repository() {
        let command = install_suggestion(
            Platform::Linux {
                asset_arch: "amd64",
            },
            &AvailableManagers {
                apt: true,
                ..AvailableManagers::default()
            },
        );

        assert!(command.command.contains("cloudflare-main.gpg"));
        assert!(command
            .command
            .contains("https://pkg.cloudflare.com/cloudflared any main"));
        assert!(command.command.contains("apt-get install cloudflared"));
    }

    #[test]
    fn linux_fallback_uses_the_detected_architecture() {
        let command = install_suggestion(
            Platform::Linux {
                asset_arch: "arm64",
            },
            &AvailableManagers::default(),
        );

        assert!(command.command.contains("cloudflared-linux-arm64"));
        assert!(command.command.contains(".local/bin/cloudflared"));
    }

    #[test]
    fn version_output_must_identify_cloudflared() {
        assert_eq!(
            parse_version("cloudflared version 2026.8.1 (built 2026-08-13)")
                .expect("valid version"),
            "2026.8.1"
        );
        assert!(parse_version("some unrelated executable 1.0").is_none());
    }
}
