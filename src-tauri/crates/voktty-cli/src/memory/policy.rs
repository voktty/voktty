use super::{map_error, usage_error, CliError, MarkerAccess, MemoryCommand, EXIT_REQUEST};
use serde_json::json;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use voktty_memory_local::{
    inspect_local_memory_scope, resolve_local_memory_directory, DiscoveryControl, LocalMemoryStore,
    MemoryPolicy, MemoryPolicyError, MemoryPolicyReview, MemoryWorkError,
};

#[derive(Debug, PartialEq)]
pub(crate) struct UseOptions {
    project: Option<PathBuf>,
    mode: MemoryPolicy,
    preview: bool,
}

pub(super) fn parse(args: Vec<OsString>) -> Result<MemoryCommand, CliError> {
    if args == [OsString::from("--help")] {
        return Ok(MemoryCommand::Help);
    }
    let mut args = args.into_iter();
    let mut mode = None;
    let mut project = None;
    let mut preview = false;
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--always" | "--never" | "--manual") if mode.is_none() => {
                mode = Some(match arg.to_str() {
                    Some("--always") => MemoryPolicy::Always,
                    Some("--never") => MemoryPolicy::Never,
                    _ => MemoryPolicy::Manual,
                });
            }
            Some("--project") if project.is_none() => {
                let path = args.next().filter(|s| !s.is_empty()).ok_or_else(|| usage_error("--project requires a directory"))?;
                if path.to_str().is_some_and(|s| s.starts_with('-')) { return Err(usage_error("--project requires a directory; use ./ for names beginning with -")); }
                project = Some(path.into());
            }
            Some("--preview") if !preview => preview = true,
            Some("--session") => return Err(usage_error("--session requires an addressable conversation and cannot store a global policy; use Project Memory in that conversation; standalone session launch is not available yet")),
            _ => return Err(usage_error("use requires exactly one of --always, --never or --manual, optional --project and --preview")),
        }
    }
    Ok(MemoryCommand::Use(UseOptions {
        project,
        mode: mode.ok_or_else(|| usage_error("use requires --always, --never or --manual"))?,
        preview,
    }))
}

fn policy_error(error: MemoryPolicyError) -> CliError {
    match error {
        MemoryPolicyError::Worker(MemoryWorkError::Read(error)) => {
            let mut error = map_error(error);
            error.message.push_str("; a policy write may already have completed; reload status before retrying");
            error
        }
        error => CliError::new(
            if error == MemoryPolicyError::Changed { "memory_changed" } else { "memory_scope_unavailable" },
            format!("{error}; reload status before retrying; no instruction trust or capture permission was granted"),
            EXIT_REQUEST,
        ),
    }
}

fn mode_name(mode: MemoryPolicy) -> &'static str {
    match mode {
        MemoryPolicy::Always => "always",
        MemoryPolicy::Never => "never",
        MemoryPolicy::Manual => "manual",
    }
}

pub(super) fn run(options: UseOptions, as_json: bool) -> Result<ExitCode, CliError> {
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
    let access = Arc::new(MarkerAccess { root: root.clone() });
    let scope = inspect_local_memory_scope(&root, access.as_ref(), &control).map_err(map_error)?;
    if scope.scope.state != "ready"
        || !scope.scope.ancestry_complete
        || !scope.blocked_paths.is_empty()
    {
        return Err(CliError::new("memory_scope_unavailable","policy requires one ready kit with complete ancestor discovery; project files and preferences were not changed",EXIT_REQUEST));
    }
    let parent = dirs::data_local_dir()
        .ok_or_else(|| usage_error("native application data directory is unavailable"))?
        .join("dev.voktty");
    let phase = control.read_control().map_err(map_error)?;
    LocalMemoryStore::prepare_application_parent(&parent, &phase).map_err(map_error)?;
    let store = Arc::new(LocalMemoryStore::create_private(&parent, &phase).map_err(map_error)?);
    store
        .initialize()
        .map_err(|error| map_error(voktty_memory_local::ReadError::Store(error)))?;
    let review = MemoryPolicyReview::prepare(store, root, access, options.mode, &control)
        .map_err(policy_error)?;
    let root = review.root().to_owned();
    let previous = review
        .preference()
        .map(|p| p.policy)
        .unwrap_or(MemoryPolicy::Manual);
    let has_stored_trust = if options.preview {
        review
            .preference()
            .is_some_and(|p| p.instruction_digest.is_some())
    } else {
        review
            .accept(&control)
            .map_err(policy_error)?
            .instruction_digest
            .is_some()
    };
    let trust = if has_stored_trust {
        "stored_not_checked"
    } else {
        "not_accepted"
    };
    let result = json!({"schema":1,"root":root,"scope":"project-on-this-machine",
        "previousMode":mode_name(previous),"mode":mode_name(options.mode),"policyStored":!options.preview,
        "trust":trust,"contextActivated":false,"capturesActivated":false,"projectFilesChanged":false});
    if as_json {
        println!("{}", json!({"ok":true,"result":result}));
    } else {
        println!(
            "Project memory policy {}: {}\nMemory root: {}",
            if options.preview {
                "preview"
            } else {
                "stored on this machine"
            },
            mode_name(options.mode),
            root.display()
        );
        println!("Instruction trust: {trust}. No context or capture was activated.");
        println!("Existing linked rules and already delivered context remain with their runtimes.");
    }
    Ok(ExitCode::SUCCESS)
}
