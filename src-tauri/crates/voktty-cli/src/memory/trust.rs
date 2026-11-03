use super::{
    map_error, resolved_root, terminal_text, usage_error, CliError, MarkerAccess, MemoryCommand,
    EXIT_REQUEST,
};
use serde_json::json;
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use voktty_memory_local::{
    inspect_local_memory_scope, path_policy, resolve_local_memory_directory, DiscoveryControl,
    LocalMemoryStore, MemoryReadAccess, MemoryTrustError, MemoryTrustReview, MemoryWorkError,
    ReadError,
};

#[derive(Debug, Default, PartialEq)]
pub(crate) struct TrustOptions {
    project: Option<PathBuf>,
    role: Option<String>,
    preview: bool,
    accept_review: Option<String>,
}

pub(super) fn parse(args: Vec<OsString>) -> Result<MemoryCommand, CliError> {
    if args == [OsString::from("--help")] {
        return Ok(MemoryCommand::Help);
    }
    let mut options = TrustOptions::default();
    let mut seen = BTreeSet::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let name = arg
            .to_str()
            .ok_or_else(|| usage_error("trust options must be UTF-8"))?;
        if !seen.insert(name.to_owned()) {
            return Err(usage_error("duplicate memory trust option"));
        }
        match name {
            "--preview" => options.preview = true,
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
            "--role" => {
                let role = args
                    .next()
                    .and_then(|s| s.into_string().ok())
                    .filter(|s| {
                        s.len() <= 256
                            && s.strip_prefix(".voktty/team/roles/")
                                .and_then(|s| s.strip_suffix(".md"))
                                .is_some_and(|s| {
                                    !s.is_empty()
                                        && s.bytes().all(|c| {
                                            c.is_ascii_lowercase()
                                                || c.is_ascii_digit()
                                                || c == b'-'
                                        })
                                })
                    })
                    .ok_or_else(|| {
                        usage_error("--role requires .voktty/team/roles/<lowercase-name>.md")
                    })?;
                options.role = Some(role);
            }
            "--accept-review" => {
                options.accept_review = Some(args.next().and_then(|s| s.into_string().ok()).filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))).ok_or_else(|| usage_error("--accept-review requires the lowercase SHA-256 digest from trust --preview"))?);
            }
            _ => {
                return Err(usage_error(
                    "unknown memory trust option; use memory --help",
                ))
            }
        }
    }
    if options.preview == options.accept_review.is_some() {
        return Err(usage_error(
            "trust requires exactly one of --preview or --accept-review <digest>",
        ));
    }
    Ok(MemoryCommand::Trust(options))
}

pub(super) struct TrustReadAccess {
    marker: MarkerAccess,
    memory: PathBuf,
}
impl TrustReadAccess {
    pub(super) fn new(origin: PathBuf, memory: PathBuf) -> Self {
        Self {
            marker: MarkerAccess { root: origin },
            memory,
        }
    }
}
impl MemoryReadAccess for TrustReadAccess {
    fn allows_metadata(&self, path: &Path) -> bool {
        path.starts_with(&self.memory) || self.marker.allows_metadata(path)
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        (path == self.memory || path == self.marker.root)
            && path.to_str().is_some_and(path_policy::readable)
    }
    fn allows_read(&self, path: &Path) -> bool {
        (path.starts_with(&self.memory) && path.to_str().is_some_and(path_policy::readable))
            || self.marker.allows_read(path)
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        path.starts_with(&self.memory) || self.marker.allows_enumeration(path)
    }
}

pub(super) fn trust_error(error: MemoryTrustError) -> CliError {
    match error {
        MemoryTrustError::Worker(MemoryWorkError::Read(error)) => map_error(error),
        error => CliError::new(
            if error == MemoryTrustError::Changed {
                "memory_changed"
            } else {
                "memory_scope_unavailable"
            },
            format!("{error}; review again; no context was delivered"),
            EXIT_REQUEST,
        ),
    }
}

pub(super) fn run(options: TrustOptions, as_json: bool) -> Result<ExitCode, CliError> {
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
    let marker = MarkerAccess { root: root.clone() };
    let scope = inspect_local_memory_scope(&root, &marker, &control).map_err(map_error)?;
    if scope.scope.state != "ready"
        || !scope.scope.ancestry_complete
        || !scope.blocked_paths.is_empty()
    {
        return Err(CliError::new("memory_scope_unavailable", "trust requires one ready kit with complete ancestor discovery; preferences were not changed", EXIT_REQUEST));
    }
    let memory = resolved_root(&scope)
        .ok_or_else(|| map_error(ReadError::Unavailable))?
        .to_owned();
    let access = Arc::new(TrustReadAccess::new(marker.root, memory));
    let parent = super::origin::required_parent()?;
    let phase = control.read_control().map_err(map_error)?;
    LocalMemoryStore::prepare_application_parent(&parent, &phase).map_err(map_error)?;
    let store = Arc::new(LocalMemoryStore::create_private(&parent, &phase).map_err(map_error)?);
    store
        .initialize()
        .map_err(|error| map_error(ReadError::Store(error)))?;
    let review = MemoryTrustReview::prepare(store, root, access, options.role, &control)
        .map_err(trust_error)?;
    let digest = review.acceptance_digest().map_err(trust_error)?;
    let root = review.root().to_owned();
    if options.preview {
        let observed = review.observation();
        let result = json!({"schema":1,"root":root,"reviewDigest":digest,"config":observed.config,"instructions":observed.instructions,"trustStored":false,"policyChanged":false,"contextActivated":false,"capturesActivated":false,"projectFilesChanged":false});
        if as_json {
            println!("{}", json!({"ok":true,"result":result}));
        } else {
            println!("Instruction trust review\nMemory root: {}\nReview digest: {digest}\nConfiguration:\n{}", terminal_text(&root.display().to_string()), terminal_text(&serde_json::to_string_pretty(&observed.config).unwrap_or_default()));
            if let Some(files) = observed.instructions["files"].as_array() {
                for file in files {
                    println!(
                        "\n{} ({})\n{}",
                        terminal_text(file["path"].as_str().unwrap_or_default()),
                        file["fact"]["kind"].as_str().unwrap_or("unknown"),
                        terminal_text(file["fact"]["text"].as_str().unwrap_or_default())
                    );
                }
            }
            println!("\nAccept with memory trust --accept-review <review-digest> using the same project and role. This changes only instruction trust on this machine.");
        }
        return Ok(ExitCode::SUCCESS);
    }
    if options.accept_review.as_deref() != Some(digest.as_str()) {
        return Err(CliError::new("memory_changed", "the trust review digest no longer matches; run trust --preview again; preferences were not changed", EXIT_REQUEST));
    }
    review.accept(&control).map_err(trust_error)?;
    let result = json!({"schema":1,"root":root,"reviewDigest":digest,"trustStored":true,"policyChanged":false,"contextActivated":false,"capturesActivated":false,"projectFilesChanged":false});
    if as_json {
        println!("{}", json!({"ok":true,"result":result}));
    } else {
        println!("Instruction trust stored for {}. Policy is unchanged; no context was delivered or captures enabled.", terminal_text(&root.display().to_string()));
    }
    Ok(ExitCode::SUCCESS)
}
