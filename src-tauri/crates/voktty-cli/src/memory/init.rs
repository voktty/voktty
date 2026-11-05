use super::{
    map_error, terminal_text, usage_error, CliError, MarkerAccess, MemoryCommand, EXIT_REQUEST,
};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::io::{BufRead, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use voktty_memory_local::{
    path_policy, resolve_local_memory_directory, DiscoveryControl, MemoryReadAccess,
    MemoryWriteAccess, OwnedProjectInitializationPreview, ProjectInitializationRequest,
    PublicationError, PublicationWriteRequirements, ReadError,
};
use voktty_workspace_kit::{DeploymentAction, RootLinks};

#[cfg(test)]
#[path = "init_tests.rs"]
mod tests;

#[derive(Debug, Default, PartialEq)]
pub(crate) struct InitOptions {
    project: Option<PathBuf>,
    values: Map<String, Value>,
    agents: bool,
    claude: bool,
    preview: bool,
    yes: bool,
    accept_plan: Option<String>,
}

pub(super) fn parse(args: Vec<OsString>) -> Result<MemoryCommand, CliError> {
    if args == [OsString::from("--help")] {
        return Ok(MemoryCommand::Help);
    }
    let mut options = InitOptions {
        agents: true,
        claude: true,
        ..InitOptions::default()
    };
    let mut seen = BTreeSet::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let name = arg
            .to_str()
            .ok_or_else(|| usage_error("init options must be UTF-8"))?;
        if name != "--set" && !seen.insert(name.to_owned()) {
            return Err(usage_error("duplicate memory init option"));
        }
        match name {
            "--project" => {
                let path = args
                    .next()
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| usage_error("--project requires a directory"))?;
                if path.to_str().is_some_and(|s| s.starts_with('-')) {
                    return Err(usage_error(
                        "--project requires a directory; use ./ for names beginning with -",
                    ));
                }
                options.project = Some(path.into());
            }
            "--set" => {
                let pair = args
                    .next()
                    .ok_or_else(|| usage_error("--set requires name=value"))?;
                let (key, value) = pair
                    .to_str()
                    .and_then(|s| s.split_once('='))
                    .ok_or_else(|| usage_error("--set requires UTF-8 name=value"))?;
                if !matches!(
                    key,
                    "project_name"
                        | "project_summary"
                        | "owner_title"
                        | "primary_branch"
                        | "verify_commands"
                        | "language"
                        | "created_at"
                        | "default_runtime"
                        | "default_model"
                ) || value.len() > 16 * 1024
                    || value.contains('\0')
                    || options.values.contains_key(key)
                {
                    return Err(usage_error(
                        "unknown, duplicate or oversized init value; use memory --help",
                    ));
                }
                options.values.insert(key.to_owned(), value.into());
            }
            "--link-agents" => options.agents = true,
            "--link-claude" => options.claude = true,
            "--preview" => options.preview = true,
            "--yes" => options.yes = true,
            "--accept-plan" => {
                let digest = args
                    .next()
                    .and_then(|s| s.into_string().ok())
                    .filter(|s| {
                        s.len() == 64
                            && s.bytes()
                                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                    })
                    .ok_or_else(|| {
                        usage_error(
                            "--accept-plan requires a lowercase SHA-256 digest from --preview",
                        )
                    })?;
                options.accept_plan = Some(digest);
            }
            _ => return Err(usage_error("unknown memory init option; use memory --help")),
        }
    }
    if options.preview && (options.yes || options.accept_plan.is_some()) {
        return Err(usage_error(
            "use --preview separately from --yes or --accept-plan",
        ));
    }
    Ok(MemoryCommand::Init(options))
}

pub(super) struct InitReadAccess {
    pub(super) marker: MarkerAccess,
}
impl MemoryReadAccess for InitReadAccess {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.marker.root) || self.marker.allows_metadata(path)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        path == self.marker.root && path.to_str().is_some_and(path_policy::readable)
    }
    fn allows_read(&self, path: &Path) -> bool {
        (path.starts_with(&self.marker.root) && path.to_str().is_some_and(path_policy::readable))
            || self.marker.allows_read(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.marker.root) || self.marker.allows_enumeration(path)
    }
}

struct AcceptedWriteAccess {
    requirements: PublicationWriteRequirements,
}
impl AcceptedWriteAccess {
    fn staging(&self, path: &Path) -> bool {
        let valid_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix(".voktty-stage-"))
            .is_some_and(|name| {
                uuid::Uuid::parse_str(name).is_ok_and(|id| {
                    id.get_version_num() == 4
                        && id.get_variant() == uuid::Variant::RFC4122
                        && id.to_string() == name
                })
            });
        valid_name
            && self
                .requirements
                .create
                .iter()
                .filter(|entry| {
                    !self.requirements.recovery.contains(entry)
                        || entry.as_str() == voktty_memory_local::PROJECT_INITIALIZATION_RECORD
                })
                .chain(self.requirements.replace.iter())
                .any(|entry| self.requirements.root.join(entry).parent() == path.parent())
    }
}
impl MemoryWriteAccess for AcceptedWriteAccess {
    fn allows_create(&self, path: &Path) -> bool {
        path.starts_with(&self.requirements.root)
            && path.to_str().is_some_and(path_policy::writable)
            && (self
                .requirements
                .create
                .iter()
                .any(|entry| self.requirements.root.join(entry).starts_with(path))
                || self.staging(path))
    }
    fn allows_replace(&self, path: &Path) -> bool {
        path.to_str().is_some_and(path_policy::writable)
            && self
                .requirements
                .replace
                .iter()
                .any(|entry| path == self.requirements.root.join(entry))
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        path.to_str().is_some_and(path_policy::writable)
            && self
                .requirements
                .recovery
                .iter()
                .any(|entry| path == self.requirements.root.join(entry))
    }
}

fn publication_error(error: PublicationError) -> CliError {
    let code = match error {
        PublicationError::Scope => "memory_scope_conflict",
        PublicationError::Conflict => "memory_file_conflict",
        PublicationError::StalePreview => "memory_changed",
        PublicationError::PendingIntent
        | PublicationError::InvalidIntent
        | PublicationError::RecoveryRequired(_) => "memory_recovery_required",
        PublicationError::MigrationUnsupported | PublicationError::Unsupported => {
            "memory_unsupported"
        }
        _ => "memory_initialization_failed",
    };
    CliError::new(
        code,
        format!(
            "{error}; reload before retrying; published files are never rolled back automatically"
        ),
        EXIT_REQUEST,
    )
}

fn prepare(
    root: &Path,
    options: &InitOptions,
) -> Result<OwnedProjectInitializationPreview, CliError> {
    let control = DiscoveryControl::default();
    let access: Arc<dyn MemoryReadAccess> = Arc::new(InitReadAccess {
        marker: MarkerAccess {
            root: root.to_owned(),
        },
    });
    OwnedProjectInitializationPreview::prepare_at_project_root(
        ProjectInitializationRequest {
            origin: root.to_owned(),
            origin_access: access.clone(),
            destination: root.to_owned(),
            destination_access: access,
            inputs: options.values.clone(),
            links: RootLinks {
                agents: options.agents,
                claude: options.claude,
            },
        },
        &control,
    )
    .map_err(publication_error)
}

fn review(root: &Path, preview: &OwnedProjectInitializationPreview) -> Value {
    json!({"schema":2,"root":root,"planDigest":preview.acceptance_digest(),
        "deployment":preview.deployment(),
        "publicationBlocker":preview.publication_blocker().map(|error| error.to_string())})
}

fn show_review(value: &Value, as_json: bool) {
    if as_json {
        println!("{}", json!({"ok":true,"result":value}));
        return;
    }
    println!(
        "Project memory initialization: {}\nPlan digest: {}",
        value["root"].as_str().unwrap_or_default(),
        value["planDigest"].as_str().unwrap_or_default()
    );
    println!("Creates shared project files, which may be committed to Git. Does not enable memory or captures.");
    if let Some(entries) = value["deployment"]["entries"].as_array() {
        for entry in entries {
            println!(
                "\n{} {}",
                entry["action"].as_str().unwrap_or_default(),
                entry["path"].as_str().unwrap_or_default()
            );
            if entry["action"] != "skip" {
                println!(
                    "Before:\n{}\nAfter:\n{}",
                    terminal_text(entry["expected"].as_str().unwrap_or("(missing)")),
                    terminal_text(entry["proposed"].as_str().unwrap_or_default())
                );
            }
        }
    }
}

fn confirm(input: &mut impl BufRead, output: &mut impl Write) -> Result<bool, CliError> {
    write!(
        output,
        "\nApply exactly this reviewed plan? Type yes to continue [no]: "
    )
    .and_then(|_| output.flush())
    .map_err(|_| map_error(ReadError::Io))?;
    let mut answer = String::new();
    input
        .take(1025)
        .read_line(&mut answer)
        .map_err(|_| map_error(ReadError::Io))?;
    if answer.len() > 1024 {
        return Err(usage_error("initialization answer exceeds 1024 bytes"));
    }
    Ok(answer.trim() == "yes")
}

pub(super) fn run(mut options: InitOptions, as_json: bool) -> Result<ExitCode, CliError> {
    let interactive = !as_json && std::io::stdin().is_terminal() && std::io::stdout().is_terminal();
    let requested = options
        .project
        .clone()
        .unwrap_or_else(|| PathBuf::from("."));
    let requested = if requested.is_absolute() {
        requested
    } else {
        std::env::current_dir()
            .map_err(|_| map_error(ReadError::Unavailable))?
            .join(requested)
    };
    let control = DiscoveryControl::default();
    let root =
        resolve_local_memory_directory(&requested, &control.read_control().map_err(map_error)?)
            .map_err(map_error)?;
    options.values.entry("project_name").or_insert_with(|| {
        root.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Project")
            .into()
    });
    options.values.entry("created_at").or_insert_with(|| {
        chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now())
            .format("%Y-%m-%d")
            .to_string()
            .into()
    });
    voktty_workspace_kit::render_template(&options.values).map_err(|issues| {
        usage_error(format!(
            "invalid initialization values: {}",
            issues
                .iter()
                .take(16)
                .map(|issue| format!("{} at {:?}", issue.code, issue.path))
                .collect::<Vec<_>>()
                .join(", ")
        ))
    })?;
    let preview = prepare(&root, &options)?;
    let value = review(&root, &preview);
    if options.preview {
        show_review(&value, as_json);
        return Ok(ExitCode::SUCCESS);
    }
    if let Some(error) = preview.publication_blocker() {
        return Err(publication_error(error));
    }
    if options
        .accept_plan
        .as_ref()
        .is_some_and(|digest| *digest != preview.acceptance_digest())
    {
        return Err(CliError::new(
            "memory_changed",
            "the preview digest no longer matches; review --preview again",
            EXIT_REQUEST,
        ));
    }
    let sensitive = preview
        .deployment()
        .plan
        .entries
        .iter()
        .any(|entry| entry.action == DeploymentAction::Migrate);
    if sensitive && options.accept_plan.is_none() {
        if !interactive || options.yes {
            return Err(CliError::new("memory_review_required","replacements require --preview followed by --accept-plan <digest>; project files were not changed",EXIT_REQUEST));
        }
        show_review(&value, false);
        if !confirm(&mut std::io::stdin().lock(), &mut std::io::stderr())? {
            println!("Initialization cancelled; project files were not changed.");
            return Ok(ExitCode::SUCCESS);
        }
    }
    let access = AcceptedWriteAccess {
        requirements: preview.write_requirements(),
    };
    let digest = preview.acceptance_digest();
    match preview.publish(&digest, &access, &DiscoveryControl::default()) {
        Ok(report) => {
            let result = json!({"schema":1,"root":root,"planDigest":value["planDigest"],"created":report.created,"skipped":report.skipped,"migrated":report.migrated,"cleaned":report.cleaned,"contextActivated":false,"capturesActivated":false,"policyChanged":false});
            if as_json {
                println!("{}", json!({"ok":true,"result":result}));
            } else {
                println!("Project memory ready at {}.", root.display());
            }
            Ok(ExitCode::SUCCESS)
        }
        Err(failure) => {
            if as_json {
                eprintln!(
                    "{}",
                    json!({"ok":false,"error":{"code":"memory_publication_failed","message":failure.error.to_string()},"changes":{"created":failure.created,"migrated":failure.migrated,"cleaned":failure.cleaned,"possibleRecoveryFiles":failure.possible_recovery_files}})
                );
            } else {
                eprintln!("{}; reload before retrying. Already published files are preserved.\nAcknowledged changes: {:?}\nPossible recovery files: {:?}",failure.error,[failure.created,failure.migrated,failure.cleaned].concat(),failure.possible_recovery_files);
            }
            Ok(ExitCode::from(EXIT_REQUEST))
        }
    }
}
