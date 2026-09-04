#![cfg_attr(target_os = "android", allow(dead_code))]

#[cfg(windows)]
use std::path::PathBuf;

use portable_pty::CommandBuilder;

use crate::modules::control::ShellControlEnv;
use crate::modules::workspace::{self, WorkspaceEnv};

#[cfg(windows)]
const BASHRC_SCRIPT: &str = include_str!("scripts/bashrc.bash");
#[cfg(windows)]
const ZSHENV_SCRIPT: &str = include_str!("scripts/zshenv.zsh");
#[cfg(windows)]
const ZPROFILE_SCRIPT: &str = include_str!("scripts/zprofile.zsh");
#[cfg(windows)]
const ZLOGIN_SCRIPT: &str = include_str!("scripts/zlogin.zsh");
#[cfg(windows)]
const ZSHRC_SCRIPT: &str = include_str!("scripts/zshrc.zsh");
#[cfg(windows)]
const FISH_INIT_SCRIPT: &str = include_str!("scripts/init.fish");
const FISH_REINSTALL_PROMPT: &str =
    "functions -q __voktty_install_prompt; and __voktty_install_prompt";

#[cfg(windows)]
fn bashrc_script() -> &'static str {
    BASHRC_SCRIPT
}

#[cfg(windows)]
fn zshenv_script() -> &'static str {
    ZSHENV_SCRIPT
}

#[cfg(windows)]
fn zprofile_script() -> &'static str {
    ZPROFILE_SCRIPT
}

#[cfg(windows)]
fn zlogin_script() -> &'static str {
    ZLOGIN_SCRIPT
}

#[cfg(windows)]
fn zshrc_script() -> &'static str {
    ZSHRC_SCRIPT
}

#[cfg(windows)]
fn fish_init_script() -> &'static str {
    FISH_INIT_SCRIPT
}

pub fn build_command(
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    blocks: bool,
    shell: Option<String>,
    control: Option<ShellControlEnv>,
) -> Result<CommandBuilder, String> {
    if let WorkspaceEnv::Docker {
        container_id,
        shell: docker_shell,
        user,
        workdir,
        ..
    } = workspace
    {
        return build_docker_exec(container_id, docker_shell.or(shell), user, workdir);
    }
    let shell = sanitize_shell_override(shell);
    #[cfg(unix)]
    {
        if let WorkspaceEnv::Ssh { connection, .. } = workspace {
            return unix::build_ssh(cwd, connection, blocks);
        }
        let _ = workspace;
        unix::build(cwd, blocks, shell, control)
    }
    #[cfg(windows)]
    {
        if let WorkspaceEnv::Ssh { connection, .. } = workspace {
            return windows::build_ssh(cwd, connection, blocks);
        }
        windows::build(cwd, workspace, blocks, shell, control)
    }
}

// Honor the override only if it matches an enumerated shell, so a tampered
// setting can't spawn an arbitrary binary across the IPC boundary.
fn sanitize_shell_override(shell: Option<String>) -> Option<String> {
    let candidate = shell
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    let target = std::fs::canonicalize(&candidate).ok();
    let allowed = list_shells().into_iter().any(|s| {
        s.path == candidate || (target.is_some() && std::fs::canonicalize(&s.path).ok() == target)
    });
    if allowed {
        Some(candidate)
    } else {
        log::warn!("ignoring non-enumerated shell override '{candidate}'");
        None
    }
}

pub fn detect_shell_name() -> String {
    #[cfg(unix)]
    {
        let (_, path) = unix::Shell::detect();
        path.rsplit('/').next().unwrap_or("").to_string()
    }
    #[cfg(windows)]
    {
        windows_shell_path()
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default()
    }
}

#[derive(serde::Serialize)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    /// True when Voktty injects OSC 7/133 integration for this shell (cwd
    /// tracking, command blocks, agent detection). Others spawn bare.
    pub integrated: bool,
}

pub fn list_shells() -> Vec<ShellInfo> {
    #[cfg(unix)]
    {
        unix::list_shells()
    }
    #[cfg(windows)]
    {
        windows::list_shells()
    }
}

fn ensure_utf8_locale(cmd: &mut CommandBuilder) {
    let is_utf8 = |v: &str| {
        let up = v.to_ascii_uppercase();
        up.contains("UTF-8") || up.contains("UTF8")
    };
    let already_utf8 = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|k| std::env::var(k).ok().as_deref().is_some_and(is_utf8));
    if already_utf8 {
        return;
    }
    #[cfg(target_os = "macos")]
    let fallback = "en_US.UTF-8";
    #[cfg(all(unix, not(target_os = "macos")))]
    let fallback = "C.UTF-8";
    #[cfg(windows)]
    let fallback = "en_US.UTF-8";
    cmd.env("LANG", fallback);
}

fn apply_common(
    cmd: &mut CommandBuilder,
    cwd: Option<String>,
    blocks: bool,
    control: Option<&ShellControlEnv>,
) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("VOKTTY_TERMINAL", "1");
    cmd.env("TERAX_TERMINAL", "1");
    if blocks {
        cmd.env("VOKTTY_BLOCKS", "1");
        cmd.env("TERAX_BLOCKS", "1");
    }
    let appimage_overrides = workspace::appimage_env_overrides();
    let clean_path = match appimage_overrides.iter().find(|(key, _)| *key == "PATH") {
        Some((_, value)) => value.clone(),
        None => std::env::var_os("PATH"),
    };
    for (key, value) in appimage_overrides {
        match value {
            Some(v) => {
                cmd.env(key, v);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
    if let Some(control) = control {
        cmd.env("VOKTTY_CONTROL_ADDR", &control.address);
        cmd.env("VOKTTY_CONTROL_TOKEN", &control.token);
        cmd.env("VOKTTY_PANE_ID", control.pane_id.to_string());
        cmd.env("TERAX_CONTROL_ADDR", &control.address);
        cmd.env("TERAX_CONTROL_TOKEN", &control.token);
        cmd.env("TERAX_PANE_ID", control.pane_id.to_string());
        if let Some(path) = &control.cli_path {
            cmd.env("VOKTTY_CLI", path);
            cmd.env("TERAX_CLI", path);
        }
        if let Some(bin_dir) = &control.cli_bin_dir {
            let paths = std::iter::once(bin_dir.clone()).chain(
                clean_path
                    .as_deref()
                    .into_iter()
                    .flat_map(std::env::split_paths),
            );
            if let Ok(path) = std::env::join_paths(paths) {
                cmd.env("PATH", path);
            }
        }
    }
    ensure_utf8_locale(cmd);

    #[cfg(target_os = "android")]
    {
        let home = crate::modules::bootstrap::home_dir();
        let prefix = crate::modules::bootstrap::prefix_dir();
        let lib_dir = crate::modules::bootstrap::lib_dir();
        let termux_path = crate::modules::bootstrap::shell_path();
        let bash = crate::modules::bootstrap::bash_path();

        cmd.env("HOME", home.to_string_lossy().to_string());
        cmd.env("PREFIX", prefix.to_string_lossy().to_string());
        cmd.env(
            "TMPDIR",
            crate::modules::bootstrap::tmp_dir()
                .to_string_lossy()
                .to_string(),
        );
        cmd.env("PATH", termux_path);
        cmd.env("SHELL", bash.to_string_lossy().to_string());
        cmd.env("LD_LIBRARY_PATH", lib_dir.to_string_lossy().to_string());

        let path_translate = lib_dir.join("libvoktty-path-translate.so");
        if path_translate.exists() {
            cmd.env("LD_PRELOAD", path_translate.to_string_lossy().to_string());
        }
    }

    let cwd = workspace::native_spawn_dir(cwd.as_deref());
    #[cfg(windows)]
    let cwd = {
        let s = cwd.to_string_lossy();
        let cleaned = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = s.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            s.to_string()
        };
        PathBuf::from(cleaned.replace('/', "\\"))
    };
    log::info!("pty cwd: {}", cwd.display());
    cmd.cwd(cwd);
}

fn build_remote_ssh(
    cwd: Option<String>,
    connection: crate::modules::remote::RemoteSshConnection,
    blocks: bool,
) -> Result<CommandBuilder, String> {
    validate_remote_connection(&connection)?;
    let mut cmd = CommandBuilder::new("ssh");
    apply_common(&mut cmd, None, blocks, None);
    cmd.arg("-tt");

    let user_extra = connection
        .extra_args
        .as_deref()
        .map(crate::modules::remote::parse_extra_args)
        .unwrap_or_default();

    if !crate::modules::remote::has_ssh_option(&user_extra, "ServerAliveInterval") {
        cmd.arg("-o");
        cmd.arg("ServerAliveInterval=15");
    }
    if !crate::modules::remote::has_ssh_option(&user_extra, "ServerAliveCountMax") {
        cmd.arg("-o");
        cmd.arg("ServerAliveCountMax=3");
    }
    if !crate::modules::remote::has_ssh_option(&user_extra, "TCPKeepAlive") {
        cmd.arg("-o");
        cmd.arg("TCPKeepAlive=yes");
    }
    if !crate::modules::remote::has_ssh_option(&user_extra, "ConnectTimeout") {
        cmd.arg("-o");
        cmd.arg("ConnectTimeout=10");
    }
    if !crate::modules::remote::has_ssh_option(&user_extra, "StrictHostKeyChecking") {
        cmd.arg("-o");
        cmd.arg("StrictHostKeyChecking=accept-new");
    }

    if let Some(port) = connection.port.filter(|port| *port != 22) {
        cmd.arg("-p");
        cmd.arg(port.to_string());
    }
    if let Some(identity_file) = connection
        .identity_file
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        cmd.arg("-i");
        cmd.arg(crate::modules::remote::expand_tilde(identity_file));
    }
    for arg in user_extra {
        cmd.arg(arg);
    }
    let destination = connection
        .user
        .as_deref()
        .filter(|user| !user.is_empty())
        .map(|user| format!("{user}@{}", connection.host.trim()))
        .unwrap_or_else(|| connection.host.trim().to_string());
    cmd.arg(destination);
    cmd.arg(remote_shell_command(
        cwd.as_deref(),
        blocks,
        Some(&connection),
    )?);
    Ok(cmd)
}

fn build_docker_exec(
    container_id: String,
    shell: Option<String>,
    user: Option<String>,
    workdir: Option<String>,
) -> Result<CommandBuilder, String> {
    let docker_bin = which::which("docker")
        .or_else(|_| which::which("podman"))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "docker".to_string());

    let mut cmd = CommandBuilder::new(docker_bin);
    cmd.arg("exec");
    cmd.arg("-it");

    if let Some(u) = user {
        let trimmed = u.trim();
        if !trimmed.is_empty() {
            cmd.arg("-u");
            cmd.arg(trimmed);
        }
    }

    if let Some(w) = workdir {
        let trimmed = w.trim();
        if !trimmed.is_empty() {
            cmd.arg("-w");
            cmd.arg(trimmed);
        }
    }

    cmd.arg(&container_id);

    let shell_to_use = shell
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string());
    cmd.arg(shell_to_use);

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    Ok(cmd)
}

fn validate_remote_connection(
    connection: &crate::modules::remote::RemoteSshConnection,
) -> Result<(), String> {
    let invalid = |value: &str| {
        value.is_empty()
            || value
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
    };
    if invalid(connection.host.trim()) {
        return Err("SSH host is invalid".to_string());
    }
    if connection.user.as_deref().is_some_and(invalid) {
        return Err("SSH user is invalid".to_string());
    }
    if connection
        .identity_file
        .as_deref()
        .is_some_and(|path| path.chars().any(char::is_control))
        || connection
            .extra_args
            .as_deref()
            .is_some_and(|args| args.chars().any(char::is_control))
        || connection
            .initial_directory
            .as_deref()
            .is_some_and(|path| path.chars().any(char::is_control))
    {
        return Err("SSH arguments contain control characters".to_string());
    }
    Ok(())
}

fn remote_shell_command(
    cwd: Option<&str>,
    blocks: bool,
    connection: Option<&crate::modules::remote::RemoteSshConnection>,
) -> Result<String, String> {
    let effective_cwd = cwd
        .filter(|path| !path.trim().is_empty())
        .or_else(|| {
            connection
                .and_then(|c| c.initial_directory.as_deref())
                .filter(|path| !path.trim().is_empty())
        });
    if effective_cwd.is_some_and(|path| path.chars().any(char::is_control)) {
        return Err("remote cwd contains control characters".to_string());
    }
    let mut base_cmd = String::new();
    if let Some(cwd) = effective_cwd {
        base_cmd.push_str("cd -- ");
        base_cmd.push_str(&shell_quote(cwd));
        base_cmd.push_str(" && ");
    }
    if blocks {
        base_cmd.push_str("export VOKTTY_BLOCKS=1; ");
    }
    base_cmd.push_str("export VOKTTY_TERMINAL=1; ");
    base_cmd.push_str("_voktty_shell=\"${SHELL:-/bin/sh}\"; ");
    base_cmd.push_str(&format!(
        "_voktty_integration=\"$HOME/.voktty/shell-integration/{}\"; ",
        crate::modules::remote::REMOTE_SHELL_INTEGRATION_VERSION
    ));
    base_cmd.push_str("case \"${_voktty_shell##*/}\" in ");
    base_cmd.push_str(
        "bash) if [ -r \"$_voktty_integration/bashrc\" ]; then exec \"$_voktty_shell\" --rcfile \"$_voktty_integration/bashrc\" -i; fi ;; ",
    );
    base_cmd.push_str(
        "zsh) if [ -r \"$_voktty_integration/zsh/.zshrc\" ]; then export VOKTTY_USER_ZDOTDIR=\"${ZDOTDIR:-$HOME}\" ZDOTDIR=\"$_voktty_integration/zsh\"; exec \"$_voktty_shell\" -l; fi ;; ",
    );
    base_cmd.push_str(&format!(
        "fish) if [ -r \"$_voktty_integration/init.fish\" ]; then export fish_features=no-mark-prompt; exec \"$_voktty_shell\" -i -C 'functions -q __voktty_install_prompt; or source \"$HOME/.voktty/shell-integration/{}/init.fish\"; functions -q __voktty_install_prompt; and __voktty_install_prompt'; fi ;; ",
        crate::modules::remote::REMOTE_SHELL_INTEGRATION_VERSION
    ));
    base_cmd.push_str("esac; exec \"$_voktty_shell\" -l");

    let mux_mode = connection
        .map(|c| c.multiplexer_mode.as_deref().unwrap_or("auto"))
        .unwrap_or("none");
    let has_active_session = connection
        .and_then(|c| c.active_multiplexer_session.as_deref())
        .is_some();

    if (mux_mode == "none" || mux_mode.trim().is_empty()) && !has_active_session {
        return Ok(base_cmd);
    }

    let session_name = connection
        .and_then(|c| {
            c.active_multiplexer_session
                .as_deref()
                .or(c.tmux_session_name.as_deref())
        })
        .filter(|s| !s.trim().is_empty())
        .map(sanitize_session_name)
        .unwrap_or_else(|| "voktty".to_string());

    let action = connection
        .and_then(|c| c.multiplexer_action.as_deref())
        .unwrap_or("auto");

    let s = shell_quote(&session_name);
    let cwd_flag = if let Some(cwd) = effective_cwd {
        format!("-c {} ", shell_quote(cwd))
    } else {
        String::new()
    };

    let sh_cmd = format!("/bin/sh -c {}", shell_quote(&base_cmd));
    let sh_cmd_quoted = shell_quote(&sh_cmd);

    let tmux_cmd = match action {
        "attach_force" => format!("tmux attach -d -t {s} 2>/dev/null || tmux new-session {cwd_flag}-s {s} {sh_cmd_quoted}"),
        "new" => format!("tmux new-session {cwd_flag}-s {s} {sh_cmd_quoted} 2>/dev/null || tmux new-session {cwd_flag}{sh_cmd_quoted}"),
        _ => format!("tmux new-session -A {cwd_flag}-s {s} {sh_cmd_quoted}"),
    };

    let screen_cmd = match action {
        "attach_force" => format!("screen -d -r {s} 2>/dev/null || screen -S {s} {sh_cmd_quoted}"),
        "new" => format!("screen -S {s} {sh_cmd_quoted} 2>/dev/null || screen {sh_cmd_quoted}"),
        _ => format!("screen -xRR -S {s} {sh_cmd_quoted}"),
    };

    let cd_prefix = if let Some(cwd) = effective_cwd {
        format!("cd -- {} 2>/dev/null || true; ", shell_quote(cwd))
    } else {
        String::new()
    };

    let default_cmd = format!("tmux set -g default-command {} 2>/dev/null || true; ", shell_quote(&sh_cmd));

    let full_command = format!(
        "{cd_prefix}if command -v tmux >/dev/null 2>&1; then tmux set -g allow-passthrough on 2>/dev/null || true; {default_cmd}exec {tmux_cmd}; elif command -v screen >/dev/null 2>&1; then exec {screen_cmd}; else {base_cmd}; fi"
    );

    Ok(full_command)
}

fn sanitize_session_name(raw: &str) -> String {
    let sanitized: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.trim().is_empty() {
        "voktty".to_string()
    } else {
        sanitized
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(unix)]
mod unix {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use portable_pty::CommandBuilder;

    const ZSHENV: &str = include_str!("scripts/zshenv.zsh");
    const ZPROFILE: &str = include_str!("scripts/zprofile.zsh");
    const ZLOGIN: &str = include_str!("scripts/zlogin.zsh");
    const ZSHRC: &str = include_str!("scripts/zshrc.zsh");
    const BASHRC: &str = include_str!("scripts/bashrc.bash");
    const FISH_INIT: &str = include_str!("scripts/init.fish");

    pub enum Shell {
        Zsh,
        Bash,
        Fish,
        Other,
    }

    impl Shell {
        pub fn classify(path: &str) -> Shell {
            match path.rsplit('/').next().unwrap_or("") {
                "zsh" => Shell::Zsh,
                "bash" => Shell::Bash,
                "fish" => Shell::Fish,
                _ => Shell::Other,
            }
        }

        pub fn detect() -> (Shell, String) {
            #[cfg(target_os = "android")]
            {
                let bash = crate::modules::bootstrap::bash_path();
                if bash.exists() {
                    return (Shell::Bash, bash.to_string_lossy().to_string());
                }
                return (Shell::Other, "/system/bin/sh".into());
            }
            #[cfg(not(target_os = "android"))]
            {
                let path = login_shell()
                    .or_else(|| std::env::var("SHELL").ok())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "/bin/zsh".into());
                (Self::classify(&path), path)
            }
        }

        // A configured override wins only when it points at a real file;
        // otherwise fall back to the user's login shell.
        pub fn resolve(shell_override: Option<String>) -> (Shell, String) {
            if let Some(path) = shell_override
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            {
                if Path::new(&path).is_file() {
                    return (Self::classify(&path), path);
                }
                log::warn!("configured shell '{path}' not found, using auto-detect");
            }
            Self::detect()
        }
    }

    fn login_shell() -> Option<String> {
        use std::ffi::CStr;
        unsafe {
            let uid = libc::getuid();
            let pw = libc::getpwuid(uid);
            if pw.is_null() {
                return None;
            }
            let shell_ptr = (*pw).pw_shell;
            if shell_ptr.is_null() {
                return None;
            }
            CStr::from_ptr(shell_ptr).to_str().ok().map(String::from)
        }
    }

    pub fn list_shells() -> Vec<super::ShellInfo> {
        use std::collections::HashSet;
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let (_, login) = Shell::detect();
        let mut candidates = vec![login];
        if let Ok(content) = fs::read_to_string("/etc/shells") {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                candidates.push(line.to_string());
            }
        }
        for path in candidates {
            if !seen.insert(path.clone()) || !Path::new(&path).is_file() {
                continue;
            }
            let integrated = !matches!(Shell::classify(&path), Shell::Other);
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            out.push(super::ShellInfo {
                name,
                path,
                integrated,
            });
        }
        out
    }

    pub fn build(
        cwd: Option<String>,
        blocks: bool,
        shell_override: Option<String>,
        control: Option<super::ShellControlEnv>,
    ) -> Result<CommandBuilder, String> {
        let (shell, shell_path) = Shell::resolve(shell_override);
        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd, blocks, control.as_ref());
        apply_shell_init(&mut cmd, &shell, &shell_path);
        Ok(cmd)
    }

    pub fn build_ssh(
        cwd: Option<String>,
        connection: crate::modules::remote::RemoteSshConnection,
        blocks: bool,
    ) -> Result<CommandBuilder, String> {
        super::build_remote_ssh(cwd, connection, blocks)
    }

    fn apply_shell_init(cmd: &mut CommandBuilder, shell: &Shell, shell_path: &str) {
        match shell {
            Shell::Zsh => {
                match prepare_zdotdir() {
                    Ok(zdotdir) => {
                        // Guard against Voktty-in-Voktty :)
                        if let Ok(user_zd) = std::env::var("ZDOTDIR") {
                            if Path::new(&user_zd) != zdotdir.as_path() {
                                cmd.env("VOKTTY_USER_ZDOTDIR", user_zd);
                            }
                        }
                        cmd.env("ZDOTDIR", &zdotdir);
                    }
                    Err(e) => {
                        log::warn!("zsh shell integration disabled: {e}");
                    }
                }
                // Login shell so /etc/zprofile runs path_helper on macOS — without
                // this, GUI-launched apps get a minimal PATH missing Homebrew.
                cmd.arg("-l");
            }
            Shell::Bash => {
                match prepare_bash_rcfile() {
                    Ok(rc) => {
                        cmd.arg("--rcfile");
                        cmd.arg(rc);
                    }
                    Err(e) => {
                        log::warn!("bash shell integration disabled: {e}");
                    }
                }
                // bash ignores --rcfile under -l, so we use -i and source
                // /etc/profile from inside our rcfile to emulate login init.
                cmd.arg("-i");
            }
            Shell::Fish => {
                if let Err(e) = prepare_fish_conf_d() {
                    log::warn!("fish shell integration disabled: {e}");
                }
                // fish 4.0+ writes its own OSC 133 A/B; ours would double it.
                cmd.env("fish_features", "no-mark-prompt");
                cmd.arg("-i");
                // Re-assert our prompt after config.fish (-C runs last), so a
                // framework prompt (starship etc.) loaded there can't override
                // the markers and break cwd tracking.
                cmd.arg("-C");
                cmd.arg(super::FISH_REINSTALL_PROMPT);
            }
            Shell::Other => {
                log::info!(
                    "unsupported shell '{}', spawning without integration",
                    shell_path
                );
            }
        }
    }

    fn integration_root() -> Result<PathBuf, String> {
        #[cfg(target_os = "android")]
        let home = crate::modules::bootstrap::home_dir();
        #[cfg(not(target_os = "android"))]
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;

        let root = home.join(".cache").join("voktty").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_zdotdir() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("zsh");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join(".zshenv"), ZSHENV)?;
        write_if_changed(&dir.join(".zprofile"), ZPROFILE)?;
        write_if_changed(&dir.join(".zshrc"), ZSHRC)?;
        write_if_changed(&dir.join(".zlogin"), ZLOGIN)?;
        Ok(dir)
    }

    fn prepare_bash_rcfile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("bash");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let rc = dir.join("bashrc");
        write_if_changed(&rc, BASHRC)?;
        Ok(rc)
    }

    fn prepare_fish_conf_d() -> Result<(), String> {
        #[cfg(target_os = "android")]
        let home = crate::modules::bootstrap::home_dir();
        #[cfg(not(target_os = "android"))]
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;

        let dir = home.join(".config").join("fish").join("conf.d");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join("voktty.fish"), FISH_INIT)?;
        Ok(())
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        // Atomic replace: a parallel shell startup must never source a half-written file.
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__voktty_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn classify_maps_known_shells() {
            assert!(matches!(Shell::classify("/bin/zsh"), Shell::Zsh));
            assert!(matches!(Shell::classify("/usr/bin/bash"), Shell::Bash));
            assert!(matches!(
                Shell::classify("/opt/homebrew/bin/fish"),
                Shell::Fish
            ));
            assert!(matches!(Shell::classify("/bin/sh"), Shell::Other));
            assert!(matches!(Shell::classify("/usr/bin/nu"), Shell::Other));
        }

        #[test]
        fn resolve_uses_an_existing_override() {
            let exe = std::env::current_exe().unwrap();
            let path = exe.to_string_lossy().into_owned();
            let (_, resolved) = Shell::resolve(Some(path.clone()));
            assert_eq!(resolved, path);
        }

        #[test]
        fn resolve_falls_back_when_override_missing() {
            let (_, path) = Shell::resolve(Some("/no/such/shell/xyz".into()));
            assert!(!path.is_empty());
            assert_ne!(path, "/no/such/shell/xyz");
        }

        #[test]
        fn resolve_falls_back_on_empty_override() {
            let (_, fallback) = Shell::resolve(Some("   ".into()));
            let (_, detected) = Shell::detect();
            assert_eq!(fallback, detected);
        }

        #[test]
        fn builds_unix_fish_launch_with_post_config_rewrap() {
            let mut cmd = CommandBuilder::new("/usr/bin/fish");
            apply_shell_init(&mut cmd, &Shell::Fish, "/usr/bin/fish");
            let argv: Vec<_> = cmd
                .get_argv()
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            assert_eq!(
                argv,
                vec![
                    "/usr/bin/fish".to_string(),
                    "-i".to_string(),
                    "-C".to_string(),
                    super::super::FISH_REINSTALL_PROMPT.to_string(),
                ]
            );
        }
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use crate::modules::workspace::WorkspaceEnv;
    use portable_pty::CommandBuilder;

    const PROFILE_PS1: &str = include_str!("scripts/profile.ps1");

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ShellKind {
        Zsh,
        Bash,
        Fish,
        Other,
    }

    impl ShellKind {
        fn from_path(path: &str) -> Self {
            match path.rsplit('/').next().unwrap_or("") {
                "zsh" => Self::Zsh,
                "bash" => Self::Bash,
                "fish" => Self::Fish,
                _ => Self::Other,
            }
        }
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    enum WslShellIntegration {
        Zsh {
            zdotdir: String,
            user_zdotdir: Option<String>,
        },
        Bash {
            rcfile: String,
        },
        Fish,
        None,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    struct WslLaunchSpec {
        args: Vec<String>,
    }

    pub fn build(
        cwd: Option<String>,
        workspace: WorkspaceEnv,
        blocks: bool,
        shell: Option<String>,
        control: Option<super::ShellControlEnv>,
    ) -> Result<CommandBuilder, String> {
        if let WorkspaceEnv::Wsl { distro } = workspace {
            let _ = (blocks, shell, control);
            return build_wsl(cwd, distro);
        }
        let shell_path = shell
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .unwrap_or_else(super::windows_shell_path);
        let shell_name = shell_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_powershell = shell_name == "pwsh.exe" || shell_name == "powershell.exe";
        let is_bash = shell_name == "bash.exe";

        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd, blocks, control.as_ref());

        if is_powershell {
            match prepare_ps_profile() {
                Ok(profile) => {
                    cmd.arg("-NoLogo");
                    cmd.arg("-NoExit");
                    cmd.arg("-ExecutionPolicy");
                    cmd.arg("Bypass");
                    cmd.arg("-File");
                    cmd.arg(profile);
                }
                Err(e) => {
                    log::warn!("powershell shell integration disabled: {e}");
                }
            }
        } else if is_bash {
            // git-bash's /etc/profile cd's to $HOME unless CHERE_INVOKING is
            // set; keep the cwd we configured in apply_common.
            cmd.env("CHERE_INVOKING", "1");
            // Native git-bash: same OSC 7/133 rcfile as Unix bash, in the
            // forward-slash form MSYS bash accepts.
            match prepare_bash_rcfile() {
                Ok(rc) => {
                    cmd.arg("--rcfile");
                    cmd.arg(rc.to_string_lossy().replace('\\', "/"));
                    cmd.arg("-i");
                }
                Err(e) => {
                    log::warn!("bash shell integration disabled: {e}");
                }
            }
        } else {
            log::info!("spawning {} without shell integration", shell_name);
        }

        log::info!("spawning Windows shell: {}", shell_path.display());
        Ok(cmd)
    }

    pub fn build_ssh(
        cwd: Option<String>,
        connection: crate::modules::remote::RemoteSshConnection,
        blocks: bool,
    ) -> Result<CommandBuilder, String> {
        super::build_remote_ssh(cwd, connection, blocks)
    }

    fn build_wsl(cwd: Option<String>, distro: String) -> Result<CommandBuilder, String> {
        crate::modules::workspace::validate_wsl_distro_name(&distro)?;
        let shell_path = crate::modules::workspace::wsl_login_shell(distro.clone())?;
        let shell_kind = ShellKind::from_path(&shell_path);
        let integration = match shell_kind {
            ShellKind::Zsh => match prepare_wsl_zdotdir(&distro) {
                Ok(zdotdir) => {
                    let user_zdotdir = match probe_wsl_zdotdir(&distro, &shell_path) {
                        Ok(path) if !path.is_empty() && path != zdotdir => Some(path),
                        Ok(_) => None,
                        Err(e) => {
                            log::warn!("WSL zsh ZDOTDIR probe failed for {distro}: {e}");
                            None
                        }
                    };
                    WslShellIntegration::Zsh {
                        zdotdir,
                        user_zdotdir,
                    }
                }
                Err(e) => {
                    log::warn!("WSL zsh shell integration disabled for {distro}: {e}");
                    WslShellIntegration::None
                }
            },
            ShellKind::Bash => match prepare_wsl_bash_rcfile(&distro) {
                Ok(rcfile) => WslShellIntegration::Bash { rcfile },
                Err(e) => {
                    log::warn!("WSL bash shell integration disabled for {distro}: {e}");
                    WslShellIntegration::None
                }
            },
            ShellKind::Fish => match prepare_wsl_fish_conf_d(&distro) {
                Ok(()) => WslShellIntegration::Fish,
                Err(e) => {
                    log::warn!("WSL fish shell integration disabled for {distro}: {e}");
                    WslShellIntegration::None
                }
            },
            ShellKind::Other => {
                log::info!(
                    "unsupported WSL shell '{}', spawning without integration",
                    shell_path
                );
                WslShellIntegration::None
            }
        };
        let spec = build_wsl_launch_spec(
            cwd.as_deref(),
            &distro,
            &shell_path,
            shell_kind,
            integration,
        );
        let mut cmd = CommandBuilder::new("wsl.exe");
        for arg in &spec.args {
            cmd.arg(arg);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("VOKTTY_TERMINAL", "1");
        super::ensure_utf8_locale(&mut cmd);
        log::info!("spawning WSL shell: {distro} ({shell_path})");
        Ok(cmd)
    }

    fn build_wsl_launch_spec(
        cwd: Option<&str>,
        distro: &str,
        shell_path: &str,
        shell_kind: ShellKind,
        integration: WslShellIntegration,
    ) -> WslLaunchSpec {
        let mut args = vec![
            "-d".to_string(),
            distro.to_string(),
            "--cd".to_string(),
            cwd.filter(|s| !s.is_empty()).unwrap_or("~").to_string(),
            "--exec".to_string(),
        ];
        match (shell_kind, integration) {
            (
                ShellKind::Zsh,
                WslShellIntegration::Zsh {
                    zdotdir,
                    user_zdotdir,
                },
            ) => {
                args.push("env".to_string());
                if let Some(user_zdotdir) = user_zdotdir {
                    args.push(format!("VOKTTY_USER_ZDOTDIR={user_zdotdir}"));
                }
                args.push(format!("ZDOTDIR={zdotdir}"));
                args.push(shell_path.to_string());
                args.push("-l".to_string());
            }
            (ShellKind::Bash, WslShellIntegration::Bash { rcfile }) => {
                args.push(shell_path.to_string());
                args.push("--rcfile".to_string());
                args.push(rcfile);
                args.push("-i".to_string());
            }
            (ShellKind::Fish, WslShellIntegration::Fish) => {
                args.push("env".to_string());
                args.push("fish_features=no-mark-prompt".to_string());
                args.push(shell_path.to_string());
                args.push("-i".to_string());
                args.push("-C".to_string());
                args.push(super::FISH_REINSTALL_PROMPT.to_string());
            }
            (ShellKind::Zsh, WslShellIntegration::None) => {
                args.push(shell_path.to_string());
                args.push("-l".to_string());
            }
            (ShellKind::Bash, WslShellIntegration::None)
            | (ShellKind::Fish, WslShellIntegration::None) => {
                args.push(shell_path.to_string());
                args.push("-i".to_string());
            }
            (ShellKind::Other, _) => args.push(shell_path.to_string()),
            _ => {
                args.push(shell_path.to_string());
            }
        }
        WslLaunchSpec { args }
    }

    fn probe_wsl_zdotdir(distro: &str, shell_path: &str) -> Result<String, String> {
        let out = crate::modules::workspace::wsl_exec_capture(
            distro,
            shell_path,
            &["-c", r#"printf %s "${ZDOTDIR:-$HOME}""#],
        )?;
        Ok(crate::modules::workspace::normalize_wsl_value(out, ""))
    }

    fn prepare_wsl_integration_dir(distro: &str, shell: &str) -> Result<(String, PathBuf), String> {
        let home = crate::modules::workspace::wsl_home(distro.to_string())?;
        let linux_dir = format!(
            "{}/.cache/voktty/shell-integration/{shell}",
            home.trim_end_matches('/')
        );
        let unc_dir = crate::modules::workspace::wsl_path_to_unc(distro, &linux_dir);
        fs::create_dir_all(&unc_dir).map_err(|e| format!("create {}: {e}", unc_dir.display()))?;
        Ok((linux_dir, unc_dir))
    }

    fn normalize_script(content: &str) -> String {
        content.replace("\r\n", "\n")
    }

    fn prepare_wsl_zdotdir(distro: &str) -> Result<String, String> {
        let (linux_dir, unc_dir) = prepare_wsl_integration_dir(distro, "zsh")?;
        write_if_changed(
            &unc_dir.join(".zshenv"),
            &normalize_script(super::zshenv_script()),
        )?;
        write_if_changed(
            &unc_dir.join(".zprofile"),
            &normalize_script(super::zprofile_script()),
        )?;
        write_if_changed(
            &unc_dir.join(".zshrc"),
            &normalize_script(super::zshrc_script()),
        )?;
        write_if_changed(
            &unc_dir.join(".zlogin"),
            &normalize_script(super::zlogin_script()),
        )?;
        Ok(linux_dir)
    }

    fn prepare_wsl_bash_rcfile(distro: &str) -> Result<String, String> {
        let (linux_dir, _unc_dir) = prepare_wsl_integration_dir(distro, "bash")?;
        let linux_rc = format!("{linux_dir}/bashrc");
        let unc_file = crate::modules::workspace::wsl_path_to_unc(distro, &linux_rc);
        let content = normalize_script(super::bashrc_script());
        write_if_changed(&unc_file, &content)?;
        Ok(linux_rc)
    }

    fn prepare_wsl_fish_conf_d(distro: &str) -> Result<(), String> {
        let home = crate::modules::workspace::wsl_home(distro.to_string())?;
        let linux_dir = format!("{}/.config/fish/conf.d", home.trim_end_matches('/'));
        let unc_dir = crate::modules::workspace::wsl_path_to_unc(distro, &linux_dir);
        fs::create_dir_all(&unc_dir).map_err(|e| format!("create {}: {e}", unc_dir.display()))?;
        let unc_file = unc_dir.join("voktty.fish");
        let content = normalize_script(super::fish_init_script());
        write_if_changed(&unc_file, &content)?;
        Ok(())
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let root = home.join(".cache").join("voktty").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_ps_profile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("powershell");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let file = dir.join("profile.ps1");
        write_if_changed(&file, PROFILE_PS1)?;
        Ok(file)
    }

    fn prepare_bash_rcfile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("bash");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let rc = dir.join("bashrc");
        write_if_changed(&rc, &normalize_script(super::bashrc_script()))?;
        Ok(rc)
    }

    pub fn list_shells() -> Vec<super::ShellInfo> {
        fn add(out: &mut Vec<super::ShellInfo>, name: &str, path: PathBuf, integrated: bool) {
            if path.is_file() {
                out.push(super::ShellInfo {
                    name: name.to_string(),
                    path: path.to_string_lossy().into_owned(),
                    integrated,
                });
            }
        }

        let mut out = Vec::new();
        if let Some(p) = super::which_in_path("pwsh.exe") {
            add(&mut out, "PowerShell", p, true);
        } else if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
            add(
                &mut out,
                "PowerShell",
                pf.join("PowerShell").join("7").join("pwsh.exe"),
                true,
            );
        }
        let system32 = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("System32");
        add(
            &mut out,
            "Windows PowerShell",
            system32
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe"),
            true,
        );
        add(&mut out, "Command Prompt", system32.join("cmd.exe"), false);
        if let Some(p) = git_bash_path() {
            add(&mut out, "Git Bash", p, true);
        }
        out
    }

    fn git_bash_path() -> Option<PathBuf> {
        // Git for Windows install locations only. A bash.exe on PATH is usually
        // the WSL launcher in System32, which is the separate WSL switcher.
        for var in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
            if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
                for rel in [
                    r"Git\bin\bash.exe",
                    r"Git\usr\bin\bash.exe",
                    r"Programs\Git\bin\bash.exe",
                ] {
                    let candidate = base.join(rel);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
        None
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__voktty_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn builds_wsl_zsh_launch_spec_with_env_and_login() {
            let spec = build_wsl_launch_spec(
                Some("/home/devuser/repo"),
                "Ubuntu",
                "/usr/bin/zsh",
                ShellKind::Zsh,
                WslShellIntegration::Zsh {
                    zdotdir: "/home/devuser/.cache/voktty/shell-integration/zsh".into(),
                    user_zdotdir: None,
                },
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/devuser/repo".to_string(),
                    "--exec".to_string(),
                    "env".to_string(),
                    "ZDOTDIR=/home/devuser/.cache/voktty/shell-integration/zsh".to_string(),
                    "/usr/bin/zsh".to_string(),
                    "-l".to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_zsh_launch_spec_with_user_zdotdir_probe() {
            let spec = build_wsl_launch_spec(
                Some("/home/devuser/repo"),
                "Ubuntu",
                "/usr/bin/zsh",
                ShellKind::Zsh,
                WslShellIntegration::Zsh {
                    zdotdir: "/home/devuser/.cache/voktty/shell-integration/zsh".into(),
                    user_zdotdir: Some("/home/devuser/.config/zsh".into()),
                },
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/devuser/repo".to_string(),
                    "--exec".to_string(),
                    "env".to_string(),
                    "VOKTTY_USER_ZDOTDIR=/home/devuser/.config/zsh".to_string(),
                    "ZDOTDIR=/home/devuser/.cache/voktty/shell-integration/zsh".to_string(),
                    "/usr/bin/zsh".to_string(),
                    "-l".to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_zsh_launch_spec_without_integration_still_uses_login_shell() {
            let spec = build_wsl_launch_spec(
                Some("/home/devuser/repo"),
                "Ubuntu",
                "/usr/bin/zsh",
                ShellKind::Zsh,
                WslShellIntegration::None,
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/devuser/repo".to_string(),
                    "--exec".to_string(),
                    "/usr/bin/zsh".to_string(),
                    "-l".to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_bash_launch_spec_with_rcfile() {
            let spec = build_wsl_launch_spec(
                Some("/home/devuser/repo"),
                "Ubuntu",
                "/bin/bash",
                ShellKind::Bash,
                WslShellIntegration::Bash {
                    rcfile: "/home/devuser/.cache/voktty/shell-integration/bash/bashrc".into(),
                },
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/devuser/repo".to_string(),
                    "--exec".to_string(),
                    "/bin/bash".to_string(),
                    "--rcfile".to_string(),
                    "/home/devuser/.cache/voktty/shell-integration/bash/bashrc".to_string(),
                    "-i".to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_fish_launch_spec_without_init_command() {
            let spec = build_wsl_launch_spec(
                Some("/home/devuser/repo"),
                "Ubuntu",
                "/usr/bin/fish",
                ShellKind::Fish,
                WslShellIntegration::Fish,
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "/home/devuser/repo".to_string(),
                    "--exec".to_string(),
                    "env".to_string(),
                    "fish_features=no-mark-prompt".to_string(),
                    "/usr/bin/fish".to_string(),
                    "-i".to_string(),
                    "-C".to_string(),
                    super::super::FISH_REINSTALL_PROMPT.to_string(),
                ]
            );
        }

        #[test]
        fn builds_wsl_other_shell_without_integration() {
            let spec = build_wsl_launch_spec(
                None,
                "Ubuntu",
                "/usr/bin/nu",
                ShellKind::Other,
                WslShellIntegration::None,
            );
            assert_eq!(
                spec.args,
                vec![
                    "-d".to_string(),
                    "Ubuntu".to_string(),
                    "--cd".to_string(),
                    "~".to_string(),
                    "--exec".to_string(),
                    "/usr/bin/nu".to_string(),
                ]
            );
        }
    }
}

#[cfg(windows)]
pub fn windows_shell_path() -> PathBuf {
    if let Some(p) = which_in_path("pwsh.exe") {
        return p;
    }

    if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        let candidate = pf.join("PowerShell").join("7").join("pwsh.exe");
        if candidate.is_file() {
            return candidate;
        }
    }

    let system32 = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    let ps5 = system32
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if ps5.is_file() {
        return ps5;
    }

    system32.join("cmd.exe")
}

#[cfg(windows)]
fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use portable_pty::CommandBuilder;

    use super::{
        apply_common, build_remote_ssh, remote_shell_command, sanitize_shell_override,
        ShellControlEnv,
    };
    use crate::modules::remote::RemoteSshConnection;

    #[test]
    fn rejects_non_enumerated_override() {
        let exe = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(sanitize_shell_override(Some(exe)), None);
    }

    #[test]
    fn empty_or_missing_override_is_none() {
        assert_eq!(sanitize_shell_override(Some("   ".into())), None);
        assert_eq!(sanitize_shell_override(None), None);
    }

    #[test]
    fn remote_shell_command_quotes_cwd_and_preserves_blocks() {
        let command = remote_shell_command(Some("/srv/user's project"), true, None).unwrap();
        assert!(command.starts_with(
            "cd -- '/srv/user'\\''s project' && export VOKTTY_BLOCKS=1; export VOKTTY_TERMINAL=1;"
        ));
        assert!(command.contains("--rcfile \"$_voktty_integration/bashrc\" -i"));
        assert!(command.contains("ZDOTDIR=\"$_voktty_integration/zsh\""));
        assert!(command.contains("source \"$HOME/.voktty/shell-integration/2/init.fish\""));
        assert!(command.ends_with("exec \"$_voktty_shell\" -l"));
    }

    #[test]
    fn remote_shell_command_wraps_in_tmux_when_configured() {
        let conn = RemoteSshConnection {
            host: "server.example".into(),
            user: Some("ubuntu".into()),
            port: Some(22),
            identity_file: None,
            extra_args: None,
            initial_directory: None,
            multiplexer_mode: Some("auto".into()),
            tmux_session_name: Some("my-work".into()),
            active_multiplexer_session: None,
            multiplexer_action: Some("attach_force".into()),
        };
        let command = remote_shell_command(Some("/srv/work"), false, Some(&conn)).unwrap();
        assert!(command.contains("if command -v tmux >/dev/null 2>&1; then tmux set -g allow-passthrough on 2>/dev/null || true; tmux set -g default-command"));
        assert!(command.contains("exec tmux attach -d -t 'my-work' 2>/dev/null || tmux new-session -c '/srv/work' -s 'my-work'"));
        assert!(command.contains("elif command -v screen >/dev/null 2>&1; then exec screen -d -r 'my-work' 2>/dev/null || screen -S 'my-work'"));
        assert!(command.contains("else cd -- '/srv/work' && export VOKTTY_TERMINAL=1;"));
    }

    #[test]
    fn remote_ssh_command_keeps_connection_values_as_arguments() {
        let connection = RemoteSshConnection {
            host: "server.example".into(),
            user: Some("ubuntu".into()),
            port: Some(2222),
            identity_file: Some("C:/keys/id_ed25519".into()),
            extra_args: Some("-o ConnectTimeout=5".into()),
            initial_directory: None,
            multiplexer_mode: Some("none".into()),
            tmux_session_name: None,
            active_multiplexer_session: None,
            multiplexer_action: None,
        };
        let command = build_remote_ssh(Some("/srv/project".into()), connection, false).unwrap();
        let args: Vec<String> = command
            .get_argv()
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-p" && pair[1] == "2222"));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-i" && pair[1] == "C:/keys/id_ed25519"));
        assert!(
            args[args.len() - 1].starts_with("cd -- '/srv/project' && export VOKTTY_TERMINAL=1;")
        );
        assert!(args[args.len() - 1].contains("shell-integration/2"));
        assert_eq!(args[args.len() - 2], "ubuntu@server.example");
    }

    #[test]
    fn common_env_includes_authenticated_caller_context() {
        let mut command = CommandBuilder::new("shell");
        let control = ShellControlEnv {
            address: "127.0.0.1:1234".into(),
            token: "secret".into(),
            pane_id: 42,
            cli_path: Some("/app/voktty-cli".into()),
            cli_bin_dir: Some(std::path::PathBuf::from("/app/bin")),
        };
        apply_common(&mut command, None, false, Some(&control));

        assert_eq!(
            command.get_env("VOKTTY_CONTROL_ADDR"),
            Some(OsStr::new("127.0.0.1:1234"))
        );
        assert_eq!(
            command.get_env("VOKTTY_CONTROL_TOKEN"),
            Some(OsStr::new("secret"))
        );
        assert_eq!(command.get_env("VOKTTY_PANE_ID"), Some(OsStr::new("42")));
        assert_eq!(
            command.get_env("VOKTTY_CLI"),
            Some(OsStr::new("/app/voktty-cli"))
        );
        assert_eq!(
            command
                .get_env("PATH")
                .and_then(|path| std::env::split_paths(path).next()),
            Some(std::path::PathBuf::from("/app/bin"))
        );
    }
}
