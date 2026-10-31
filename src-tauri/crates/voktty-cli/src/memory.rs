use super::{usage_error, CliError, EXIT_REQUEST, EXIT_UNAVAILABLE};
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;
use voktty_memory_local::{
    inspect_local_memory_scope, path_policy, resolve_local_memory_directory, DiscoveryControl,
    DiscoveryPurpose, LocalMemoryStore, LocalMemoryWorkspace, MemoryPolicy, MemoryReadAccess,
    NativeScopeObservation, ReadError, StoreError,
};

#[cfg(test)]
#[path = "memory_tests.rs"]
mod tests;

#[derive(Debug, PartialEq)]
pub(super) enum MemoryCommand {
    Help,
    Status { project: Option<PathBuf> },
}

pub(super) fn parse(args: Vec<OsString>) -> Result<MemoryCommand, CliError> {
    let mut args = args.into_iter();
    let command = args.next();
    let command = command
        .as_deref()
        .unwrap_or_else(|| std::ffi::OsStr::new("help"));
    let command = command
        .to_str()
        .ok_or_else(|| usage_error("memory command must be UTF-8"))?;
    match command {
        "help" | "--help" | "-h" => {
            if args.next().is_some() {
                return Err(usage_error("unexpected memory help arguments"));
            }
            Ok(MemoryCommand::Help)
        }
        "status" => {
            let mut project = None;
            while let Some(arg) = args.next() {
                if arg != "--project" || project.is_some() {
                    return Err(usage_error("memory status accepts only one --project <directory>"));
                }
                let value = args.next().filter(|s| !s.is_empty()).ok_or_else(|| {
                    usage_error("--project requires a directory")
                })?;
                if value.to_str().is_some_and(|s| s.starts_with('-')) {
                    return Err(usage_error("--project requires a directory; use ./ for names beginning with -"));
                }
                project = Some(PathBuf::from(value));
            }
            Ok(MemoryCommand::Status { project })
        }
        _ => Err(usage_error("available memory command: status [--project <directory>]; initialize or change use through Project Memory in Voktty")),
    }
}

struct MarkerAccess {
    root: PathBuf,
}

impl MarkerAccess {
    fn marker(&self, path: &Path) -> bool {
        self.root.ancestors().any(|ancestor| {
            let kit = ancestor.join(".voktty");
            path == kit || path.parent() == Some(kit.as_path())
        })
    }
}

impl MemoryReadAccess for MarkerAccess {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.root.ancestors().any(|ancestor| ancestor == path) || self.marker(path)
    }

    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.root.ancestors().any(|ancestor| ancestor == path)
            && path.to_str().is_some_and(path_policy::readable)
    }

    fn allows_read(&self, path: &Path) -> bool {
        self.root
            .ancestors()
            .any(|ancestor| path == ancestor.join(".voktty/kit.json"))
            && path.to_str().is_some_and(path_policy::readable)
    }

    fn allows_enumeration(&self, path: &Path) -> bool {
        self.root
            .ancestors()
            .any(|ancestor| path == ancestor.join(".voktty"))
    }
}

fn map_error(error: ReadError) -> CliError {
    let code = match error {
        ReadError::Denied => "memory_denied",
        ReadError::Unsupported => "memory_unsupported",
        ReadError::Timeout => "memory_timeout",
        ReadError::Busy | ReadError::Store(StoreError::Busy) => "memory_busy",
        ReadError::Limit => "memory_limit",
        ReadError::StaleRoot
        | ReadError::StaleInstallation
        | ReadError::Store(StoreError::Conflict) => "memory_changed",
        ReadError::Store(StoreError::InvalidStore) => "memory_invalid_state",
        _ => "memory_unavailable",
    };
    CliError::new(
        code,
        format!("{error}; no memory was enabled or delivered"),
        EXIT_UNAVAILABLE,
    )
}

fn resolved_root(observation: &NativeScopeObservation) -> Option<&Path> {
    observation.scope.root_key.as_ref().and_then(|key| {
        observation
            .directories
            .iter()
            .find(|directory| &directory.directory_key == key)
            .map(|directory| directory.path.as_path())
    })
}

fn existing_store(
    parent: &Path,
    control: &DiscoveryControl,
) -> Result<Option<LocalMemoryStore>, CliError> {
    for path in [parent.to_path_buf(), parent.join("project-memory")] {
        match std::fs::symlink_metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(map_error(ReadError::Io)),
            Ok(_) => {}
        }
    }
    let phase = control.read_control().map_err(map_error)?;
    LocalMemoryStore::check_application_parent(parent, &phase).map_err(map_error)?;
    let store = LocalMemoryStore::open_private(parent, &phase).map_err(map_error)?;
    match store.load() {
        Ok(_) => Ok(Some(store)),
        Err(StoreError::Missing) => Ok(None),
        Err(error) => Err(map_error(ReadError::Store(error))),
    }
}

fn status(project: &Path, parent: Option<&Path>) -> Result<Value, CliError> {
    let control = DiscoveryControl::new(Duration::from_secs(5));
    let root = resolve_local_memory_directory(project, &control.read_control().map_err(map_error)?)
        .map_err(map_error)?;
    let access = MarkerAccess { root: root.clone() };
    let mut observation =
        inspect_local_memory_scope(&root, &access, &control).map_err(map_error)?;
    let mut policy = json!({"state":"not_checked", "mode":null});
    let mut trust = "not_checked";
    if observation.scope.state == "ready" && parent.is_some() {
        let store = parent
            .map(|parent| existing_store(parent, &control))
            .transpose()?
            .flatten();
        if let Some(store) = store {
            let phase = control.read_control().map_err(map_error)?;
            let workspace =
                LocalMemoryWorkspace::open(&store, &root, &access, &phase).map_err(map_error)?;
            observation = workspace
                .observe_scope(DiscoveryPurpose::Discover, &control)
                .map_err(map_error)?;
            if observation.scope.state != "ready" {
                return Err(map_error(ReadError::StaleRoot));
            }
            let memory_root =
                resolved_root(&observation).ok_or_else(|| map_error(ReadError::Unavailable))?;
            let memory = LocalMemoryWorkspace::open(&store, memory_root, &access, &phase)
                .map_err(map_error)?;
            let (snapshot, preference) = memory.observe_preference(&phase).map_err(map_error)?;
            let mode = match preference
                .as_ref()
                .map(|p| p.policy)
                .unwrap_or(MemoryPolicy::Manual)
            {
                MemoryPolicy::Manual => "manual",
                MemoryPolicy::Always => "always",
                MemoryPolicy::Never => "never",
            };
            policy = json!({"state":"observed", "mode":mode});
            trust = if preference
                .as_ref()
                .is_some_and(|p| p.instruction_digest.is_some())
            {
                "stored_not_checked"
            } else {
                "not_accepted"
            };
            let verified = workspace
                .observe_scope(DiscoveryPurpose::Discover, &control)
                .map_err(map_error)?;
            let (current, current_preference) =
                memory.observe_preference(&phase).map_err(map_error)?;
            if serde_json::to_value(&verified.scope).ok()
                != serde_json::to_value(&observation.scope).ok()
                || current.revision() != snapshot.revision()
                || current.installation_id() != snapshot.installation_id()
                || current_preference != preference
            {
                return Err(map_error(ReadError::StaleRoot));
            }
        } else {
            policy = json!({"state":"uninitialized", "mode":"manual"});
            trust = "not_accepted";
        }
    } else if observation.scope.state == "ready" {
        policy = json!({"state":"unavailable", "mode":null});
    }
    control.read_control().map_err(map_error)?;
    let state = &observation.scope.state;
    Ok(json!({
        "schema":1,
        "transport":"local",
        "directory":root,
        "root":if state == "ready" { resolved_root(&observation) } else { None },
        "scope":{
            "state":state,
            "ancestryComplete":observation.scope.ancestry_complete,
            "descendantsChecked":false,
            "ancestorKits":observation.directories.iter().filter(|d| d.state == "valid").map(|d| &d.path).collect::<Vec<_>>(),
            "blockedCount":observation.blocked_paths.len(),
        },
        "policy":policy,
        "trust":trust,
        "capabilities":{"discovery":true, "initialization":false, "contextDelivery":false, "capture":false},
    }))
}

pub(super) fn run(command: MemoryCommand, as_json: bool) -> Result<ExitCode, CliError> {
    match command {
        MemoryCommand::Help => {
            println!("Usage: voktty memory status [--project <directory>] [--json]\n\nInspects local memory markers without creating a kit or starting an agent.\nUses the current directory when --project is omitted. Instruction trust is not rechecked.\nInitialize or change use through Project Memory in Voktty.");
            Ok(ExitCode::SUCCESS)
        }
        MemoryCommand::Status { project } => {
            let project = project.unwrap_or_else(|| PathBuf::from("."));
            let project = if project.is_absolute() {
                project
            } else {
                std::env::current_dir()
                    .map_err(|_| map_error(ReadError::Unavailable))?
                    .join(project)
            };
            let parent = dirs::data_local_dir().map(|path| path.join("dev.voktty"));
            let result = status(&project, parent.as_deref())?;
            let available = matches!(
                result["scope"]["state"].as_str(),
                Some("ready" | "absent" | "reserved")
            );
            if as_json {
                println!("{}", json!({"ok":true,"result":result}));
            } else {
                println!(
                    "Project memory: {}\nDirectory: {}",
                    result["scope"]["state"].as_str().unwrap_or("incomplete"),
                    result["directory"].as_str().unwrap_or_default()
                );
                if let Some(root) = result["root"].as_str() {
                    println!("Memory root: {root}");
                }
                if !available {
                    if let Some(kits) = result["scope"]["ancestorKits"].as_array() {
                        for root in kits.iter().filter_map(Value::as_str) {
                            println!("Ancestor kit: {root}");
                        }
                    }
                }
                println!(
                    "Policy: {} ({})\nTrust: {}",
                    result["policy"]["mode"].as_str().unwrap_or("not checked"),
                    result["policy"]["state"].as_str().unwrap_or("not_checked"),
                    result["trust"].as_str().unwrap_or("not_checked")
                );
                println!("No context was delivered. Initialize or change use through Project Memory in Voktty.");
            }
            Ok(if available {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(EXIT_REQUEST)
            })
        }
    }
}
