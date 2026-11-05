use super::{map_error, usage_error, CliError, MemoryCommand, EXIT_UNAVAILABLE};
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;
use voktty_memory_local::{resolve_local_memory_directory, DiscoveryControl};

#[cfg(target_os = "linux")]
mod adapters;

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
    let requested = options
        .project
        .clone()
        .unwrap_or_else(|| PathBuf::from("."));
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
    if options.session {
        return with_memory(&root, &options);
    }
    eprintln!("Project memory uses the agent's existing rule files for this launch; no context prefix was added. Use --session for an explicit initial prompt packet.");
    execute(&options.adapter, &options.args, &root)
}

#[cfg(target_os = "linux")]
fn with_memory(root: &std::path::Path, options: &RunOptions) -> Result<ExitCode, CliError> {
    use super::{resolved_root, trust::TrustReadAccess, MarkerAccess, EXIT_REQUEST};
    use std::os::fd::AsRawFd;
    use std::os::unix::{
        fs::{MetadataExt, OpenOptionsExt},
        process::CommandExt,
    };
    use std::sync::Arc;
    use voktty_memory_local::{
        MemoryContextSession, MemoryTrustError, ProjectMemoryWorkspace, ReadError,
    };
    let adapter = adapters::Adapter::parse(&options.adapter).ok_or_else(adapters::unavailable)?;
    adapters::arguments(adapter, &options.args, "")?;
    let directory = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(root)
        .map_err(|_| adapters::unavailable())?;
    let directory_identity = directory.metadata().map_err(|_| adapters::unavailable())?;
    let control = DiscoveryControl::default();
    let marker = MarkerAccess {
        root: root.to_owned(),
    };
    let origin =
        ProjectMemoryWorkspace::open(root, &marker, &control.read_control().map_err(map_error)?)
            .map_err(map_error)?;
    let scope = origin
        .observe_scope(voktty_memory_local::DiscoveryPurpose::Discover, &control)
        .map_err(map_error)?;
    let resolve_scope = |scope: &voktty_memory_local::NativeScopeObservation| {
        if scope.scope.state != "ready"
            || !scope.scope.ancestry_complete
            || !scope.blocked_paths.is_empty()
        {
            return Err(CliError::new("memory_scope_unavailable", "session memory requires one ready project kit with complete ancestor discovery; no agent was started", EXIT_REQUEST));
        }
        resolved_root(scope)
            .map(std::path::Path::to_owned)
            .ok_or_else(|| map_error(ReadError::Unavailable))
    };
    let memory = resolve_scope(&scope)?;
    let access = TrustReadAccess::new(root.to_owned(), memory.clone());
    let project_error = |error: MemoryTrustError| match error {
        MemoryTrustError::Worker(voktty_memory_local::MemoryWorkError::Read(error)) => {
            map_error(error)
        }
        _ => CliError::new(
            "memory_scope_unavailable",
            "project memory changed or its scope is unavailable; no agent was started",
            EXIT_REQUEST,
        ),
    };
    let session =
        MemoryContextSession::bind_project(root.to_owned(), Arc::new(access), None, &control)
            .map_err(project_error)?;
    let packet = session
        .read(&control)
        .map_err(project_error)?
        .packet
        .ok_or_else(adapters::unavailable)?;
    let admitted = adapters::Admission::prepare(root, adapter)?;
    let args = adapters::arguments(adapter, &options.args, &packet.text)?;
    let current = session.read(&control).map_err(project_error)?;
    if current.packet.as_ref() != Some(&packet) {
        return Err(adapters::unavailable());
    }
    let current = std::fs::metadata(root).map_err(|_| adapters::unavailable())?;
    if (current.dev(), current.ino()) != (directory_identity.dev(), directory_identity.ino()) {
        return Err(adapters::unavailable());
    }
    let executable = admitted.path()?;
    let fd = directory.as_raw_fd();
    let mut command = std::process::Command::new(executable);
    command.args(args);
    // The captured directory stays the child's cwd even if its path is renamed.
    unsafe {
        command.pre_exec(move || {
            if libc::fchdir(fd) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
    eprintln!("Project memory prepared for {}'s initial user prompt. Provider acceptance and reading are not verified; future turns and resume are managed by the agent.", adapter.command());
    let _error = command.exec();
    Err(CliError::new(
        "memory_launch_failed",
        "the admitted agent could not be started; no delivery receipt was recorded",
        EXIT_UNAVAILABLE,
    ))
}

#[cfg(not(target_os = "linux"))]
fn with_memory(_root: &std::path::Path, _options: &RunOptions) -> Result<ExitCode, CliError> {
    Err(CliError::new(
        "memory_launch_unsupported",
        "native memory launch is not available on this platform yet",
        EXIT_UNAVAILABLE,
    ))
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
