use super::{usage_error, CliError, EXIT_REQUEST, EXIT_UNAVAILABLE};
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;
use voktty_memory_local::{
    inspect_local_memory_scope, path_policy, resolve_local_memory_directory, DiscoveryControl,
    MemoryReadAccess, NativeScopeObservation, ReadError, StoreError,
};

#[cfg(test)]
#[path = "memory_tests.rs"]
mod tests;

mod init;
mod launch;
mod measure;
mod migrate_storage;
mod origin;
mod policy;
mod recovery;
mod trust;

#[derive(Debug, PartialEq)]
pub(super) enum MemoryCommand {
    Help,
    Status { project: Option<PathBuf> },
    Init(init::InitOptions),
    Use(policy::UseOptions),
    Trust(trust::TrustOptions),
    Run(launch::RunOptions),
    Measure(measure::MeasureOptions),
    Recover(recovery::RecoveryOptions),
    MigrateStorage(migrate_storage::MigrationOptions),
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
                    return Err(usage_error(
                        "memory status accepts only one --project <directory>",
                    ));
                }
                let value = args
                    .next()
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| usage_error("--project requires a directory"))?;
                if value.to_str().is_some_and(|s| s.starts_with('-')) {
                    return Err(usage_error(
                        "--project requires a directory; use ./ for names beginning with -",
                    ));
                }
                project = Some(PathBuf::from(value));
            }
            Ok(MemoryCommand::Status { project })
        }
        "init" => init::parse(args.collect()),
        "use" => policy::parse(args.collect()),
        "trust" => trust::parse(args.collect()),
        "run" => launch::parse(args.collect()),
        "measure" => measure::parse(args.collect()),
        "recover" => recovery::parse(args.collect()),
        "migrate-storage" => migrate_storage::parse(args.collect()),
        _ => Err(usage_error(
            "available memory commands: status|init|recover|use|trust|run|measure|migrate-storage; use memory --help",
        )),
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

fn terminal_text(value: &str) -> String {
    let mut text = String::new();
    for c in value.chars() {
        if (c.is_control() && !matches!(c, '\n' | '\t'))
            || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        {
            text.extend(c.escape_default());
        } else {
            text.push(c);
        }
    }
    text
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

fn status(project: &Path) -> Result<Value, CliError> {
    let control = DiscoveryControl::new(Duration::from_secs(5));
    let root = resolve_local_memory_directory(project, &control.read_control().map_err(map_error)?)
        .map_err(map_error)?;
    let access = MarkerAccess { root: root.clone() };
    let observation = inspect_local_memory_scope(&root, &access, &control).map_err(map_error)?;
    control.read_control().map_err(map_error)?;
    Ok(status_report(
        &root,
        &observation,
        json!({"state":"not_checked", "mode":null}),
        "not_checked",
    ))
}

fn status_report(
    root: &Path,
    observation: &NativeScopeObservation,
    policy: Value,
    trust: &str,
) -> Value {
    let state = &observation.scope.state;
    json!({
        "schema":1,
        "transport":"local",
        "directory":root,
        "root":if state == "ready" { resolved_root(observation) } else { None },
        "scope":{
            "state":state,
            "ancestryComplete":observation.scope.ancestry_complete,
            "descendantsChecked":false,
            "ancestorKits":observation.directories.iter().filter(|d| d.state == "valid").map(|d| &d.path).collect::<Vec<_>>(),
            "blockedCount":observation.blocked_paths.len(),
        },
        "policy":policy,
        "trust":trust,
        "capabilities":{"discovery":true, "initialization":true, "persistentPolicy":true, "measurement":true, "contextDelivery":cfg!(target_os = "linux"), "capture":false,
            "recovery":{"preview":true,"completeInitialization":cfg!(any(target_os = "linux", target_os = "android", windows))},
            "initialPromptLaunch":{"platform":"linux","codexVersions":["0.165.0"],"claudeVersions":["2.1.312"],"resume":false,"compaction":false}},
    })
}

pub(super) fn run(command: MemoryCommand, as_json: bool) -> Result<ExitCode, CliError> {
    match command {
        MemoryCommand::Help => {
            println!("Storage migration: voktty memory migrate-storage --preview | --accept-review <sha256> [--json]\nReviews this machine's entire legacy memory installation before moving it to Desktop storage.\nLinux and Android only. Preserves identity, policy, stored trust and recovery bytes.\nRefuses an existing destination store; never merges installations. Leaves a permanent\nmarker to block old writers. No project path, force, automatic acceptance or model launch.\n");
            println!("Recovery: voktty memory recover [--project <directory>]\n                              --preview | --accept-review <sha256> [--json]\nReviews and completes interrupted initialization from the project's record.\nPreserves project content and original rules; refuses live or unknown operations.\nDoes not open global memory storage, change permissions or start an agent.\nNo force or automatic acceptance; review the complete plan before applying it.\n");
            println!("Measure: voktty memory measure [--project <directory>] [--up-next-heading <heading>] [--json]\nReports configured character, Up next and handoff limits without private state or writes.\nThe default heading is Up next; pass the exact translated heading when needed.\nUnknown or exceeded metrics exit 5. This command does not compact or archive files.\n");
            println!("Launch: voktty memory run [--project <directory>] [--session|--no-memory]\n                          codex|claude|agy [-- <agent-args...>]\nWithout memory, Unix launch preserves all agent arguments and terminal IO.\nOn Linux, --session reads project files without global storage and prefixes the initial user prompt\nin Codex 0.165.0 or Claude 2.1.312, preserving verified interactive options and the request.\nNative agent approvals remain in force. Context argv may be visible in local process listings.\nResume, remote/cwd overrides, other versions and unverified modes require the manual\nstartup-message alternative. Run never initializes state or grants captures. Wrapper\n--json is unavailable; agent --json is forwarded only without integration. Windows launch is unavailable.\n");
            println!("Trust: voktty memory trust [--project <directory>] [--role .voktty/team/roles/<name>.md]\n                          --preview | --accept-review <sha256> [--json]\nReviews complete instructions, then accepts only the matching review on this machine.\nDoes not change use policy, grant tools or enable context delivery or captures.\n");
            println!("Policy: voktty memory use --always|--never|--manual [--project <directory>] [--preview] [--json]\n\nStores this machine's project policy without accepting instructions or enabling captures.\nFor a new compatible launch use memory run --session; use --no-memory to disable integration.\nChanging an existing conversation requires Project Memory in that conversation.\n");
            println!("Usage: voktty memory status [--project <directory>] [--json]\n       voktty memory init [--project <directory>] [--set <name=value>]...\n                          [--preview | --accept-plan <sha256>] [--json]\n\nStatus reads markers without changing project files. Init creates or repairs the\nproject kit and both AGENTS.md/CLAUDE.md links in the current directory.\nUse --project for another directory or --preview to inspect without writing.\nInit never opens application memory storage or starts an agent.\nExisting rules and private-ignore replacements require a reviewed --accept-plan\nor interactive acceptance. Unknown conflicts are never overwritten.\nCompatibility: --yes and --link-agents/--link-claude remain accepted; --yes never\nbypasses the reviewed digest for replacements.\n--set names: project_name, project_summary, owner_title, primary_branch, verify_commands,\n             language, created_at (YYYY-MM-DD), default_runtime, default_model.\nDefaults: folder name, current UTC date, English and the shared template defaults.\nProject memory may be committed to Git; review content before sharing it.");
            Ok(ExitCode::SUCCESS)
        }
        MemoryCommand::Init(options) => init::run(options, as_json),
        MemoryCommand::Use(options) => policy::run(options, as_json),
        MemoryCommand::Trust(options) => trust::run(options, as_json),
        MemoryCommand::Run(options) => launch::run(options, as_json),
        MemoryCommand::Measure(options) => measure::run(options, as_json),
        MemoryCommand::Recover(options) => recovery::run(options, as_json),
        MemoryCommand::MigrateStorage(options) => migrate_storage::run(options, as_json),
        MemoryCommand::Status { project } => {
            let project = project.unwrap_or_else(|| PathBuf::from("."));
            let project = if project.is_absolute() {
                project
            } else {
                std::env::current_dir()
                    .map_err(|_| map_error(ReadError::Unavailable))?
                    .join(project)
            };
            let result = status(&project)?;
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
