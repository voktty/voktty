use super::{
    map_error, status, usage_error, CliError, MemoryCommand, EXIT_REQUEST, EXIT_UNAVAILABLE,
};
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;
use voktty_memory_local::{resolve_local_memory_directory, DiscoveryControl};

#[derive(Debug, Default, PartialEq)]
pub(crate) struct RunOptions {
    project: Option<PathBuf>,
    session: bool,
    disabled: bool,
    adapter: String,
    args: Vec<OsString>,
}

pub(super) fn parse(args: Vec<OsString>) -> Result<MemoryCommand, CliError> {
    if args == [OsString::from("--help")] {
        return Ok(MemoryCommand::Help);
    }
    let mut options = RunOptions::default();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--project") if options.project.is_none() => {
                let path = args.next().filter(|s| !s.is_empty()).ok_or_else(|| usage_error("--project requires a directory"))?;
                if path.to_str().is_some_and(|s| s.starts_with('-')) { return Err(usage_error("--project requires a directory; use ./ for names beginning with -")); }
                options.project = Some(path.into());
            }
            Some("--session") if !options.session && !options.disabled => options.session = true,
            Some("--no-memory") if !options.disabled && !options.session => options.disabled = true,
            Some("codex" | "claude" | "agy") if options.adapter.is_empty() => options.adapter = arg.to_string_lossy().into_owned(),
            Some("--") if !options.adapter.is_empty() => { options.args = args.collect(); break; }
            _ => return Err(usage_error("run requires codex|claude|agy, optional --project and --session|--no-memory; place agent arguments after --")),
        }
    }
    if options.adapter.is_empty() {
        return Err(usage_error("run requires codex, claude or agy"));
    }
    Ok(MemoryCommand::Run(options))
}

pub(super) fn run(options: RunOptions, as_json: bool) -> Result<ExitCode, CliError> {
    if as_json {
        return Err(usage_error("memory run inherits agent output and cannot wrap it in JSON; place agent --json after --"));
    }
    if !cfg!(unix) {
        return Err(CliError::new(
            "memory_launch_unsupported",
            "native memory launch is not available on this platform yet",
            EXIT_UNAVAILABLE,
        ));
    }
    let requested = options.project.unwrap_or_else(|| PathBuf::from("."));
    let requested = if requested.is_absolute() {
        requested
    } else {
        std::env::current_dir()
            .map_err(|_| usage_error("current directory is unavailable; provide --project"))?
            .join(requested)
    };
    let control = DiscoveryControl::default();
    let root =
        resolve_local_memory_directory(&requested, &control.read_control().map_err(map_error)?)
            .map_err(map_error)?;
    if !options.disabled {
        let parent = dirs::data_local_dir().map(|path| path.join("dev.voktty"));
        let observation = status(&root, parent.as_deref())?;
        let state = observation["scope"]["state"]
            .as_str()
            .unwrap_or("incomplete");
        if !matches!(state, "ready" | "absent" | "reserved") {
            return Err(CliError::new("memory_scope_unavailable", "memory scope is invalid, ambiguous or incomplete; inspect memory status before launching", EXIT_REQUEST));
        }
        let policy = observation["policy"]["mode"].as_str().unwrap_or("manual");
        if options.session && state != "ready" {
            return Err(CliError::new(
                "memory_scope_unavailable",
                "session memory requires a ready kit; initialize it explicitly before launching",
                EXIT_REQUEST,
            ));
        }
        if options.session && policy == "never" {
            return Err(CliError::new("memory_policy_never", "the stored Never policy blocks session memory; change it explicitly before launching", EXIT_REQUEST));
        }
        if options.session || policy == "always" {
            return Err(CliError::new("memory_delivery_unavailable", "this launch's memory delivery channel is not verified yet; use Project Memory to copy a startup message, or --no-memory to launch explicitly without integration; no agent was started", EXIT_UNAVAILABLE));
        }
    }
    eprintln!("Project memory is not connected for this launch. Use memory init, memory trust and memory use to manage it explicitly. Existing agent rule files still apply.");
    execute(&options.adapter, &options.args, &root)
}

#[cfg(unix)]
fn execute(adapter: &str, args: &[OsString], root: &std::path::Path) -> Result<ExitCode, CliError> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    // Replacing the wrapper preserves terminal ownership, signals and exit status.
    let _error = Command::new(adapter)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .exec();
    Err(CliError::new(
        "memory_launch_failed",
        "the agent executable could not be started; check its installation and PATH",
        EXIT_UNAVAILABLE,
    ))
}

#[cfg(not(unix))]
fn execute(
    _adapter: &str,
    _args: &[OsString],
    _root: &std::path::Path,
) -> Result<ExitCode, CliError> {
    Err(CliError::new(
        "memory_launch_unsupported",
        "native memory launch is not available on this platform yet",
        EXIT_UNAVAILABLE,
    ))
}
