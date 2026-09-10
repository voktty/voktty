use super::ResumeOutcome;
use crate::models::{AgentId, SessionMeta};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalApp {}

impl TerminalApp {
    pub fn display_name(&self) -> &'static str {
        match *self {}
    }

    pub fn id(&self) -> &'static str {
        match *self {}
    }

    pub fn brand_icon(&self) -> Option<&'static str> {
        match *self {}
    }
}

pub(super) fn probe_clis(_missing: &[&str]) -> HashMap<String, String> {
    HashMap::new()
}

pub(super) fn compose_command(
    _term: TerminalApp,
    cli: &str,
    args: &[String],
    cwd: Option<&str>,
) -> String {
    super::sh_command_line(cli, args, cwd)
}

pub(super) fn deep_link_resume(_meta: &SessionMeta, _term: TerminalApp) -> Option<ResumeOutcome> {
    None
}

pub fn installed_terminals() -> &'static [TerminalApp] {
    &[]
}

pub fn terminals_for(_agent: AgentId) -> Vec<TerminalApp> {
    Vec::new()
}

pub(super) fn launch_shell(_term: TerminalApp, _command: &str) -> anyhow::Result<()> {
    anyhow::bail!("Terminal launch is unavailable on Android")
}

pub fn ensure_app_icons(_cache_dir: &Path) -> HashMap<String, PathBuf> {
    HashMap::new()
}

pub(super) fn copy_to_clipboard(_text: &str) -> bool {
    false
}

pub(super) fn trash_existing(_paths: &[&str]) -> anyhow::Result<()> {
    anyhow::bail!("Moving files to Trash is unavailable on Android")
}

pub(super) fn alert_dialog(message: &str) {
    eprintln!("[wake] fatal: {message}");
}

pub(super) fn open_dir(_path: &str) {}

pub(super) fn reveal_path(_path: &str) {}
