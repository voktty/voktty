use super::{
    existing_store, map_error, terminal_text, usage_error, CliError, MarkerAccess, MemoryCommand,
    EXIT_REQUEST,
};
use serde_json::json;
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use voktty_memory_local::{
    path_policy, resolve_local_memory_directory, DiscoveryControl, LocalMemoryWorkspace,
    MemoryWriteAccess, OwnedRecoveryReview, PublicationError, PublicationWriteRequirements,
    ReadError,
};

#[derive(Debug, Default, PartialEq)]
pub(crate) struct RecoveryOptions {
    project: Option<PathBuf>,
    preview: bool,
    accept_review: Option<String>,
}

pub(super) fn parse(args: Vec<OsString>) -> Result<MemoryCommand, CliError> {
    if args == [OsString::from("--help")] {
        return Ok(MemoryCommand::Help);
    }
    let mut options = RecoveryOptions::default();
    let mut seen = BTreeSet::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let name = arg
            .to_str()
            .ok_or_else(|| usage_error("recover options must be UTF-8"))?;
        if !seen.insert(name.to_owned()) {
            return Err(usage_error("duplicate memory recover option"));
        }
        match name {
            "--project" => {
                let path = args.next().filter(|s| !s.is_empty()).ok_or_else(|| usage_error("--project requires a directory"))?;
                if path.to_str().is_some_and(|s| s.starts_with('-')) {
                    return Err(usage_error("--project requires a directory; use ./ for names beginning with -"));
                }
                options.project = Some(path.into());
            }
            "--preview" => options.preview = true,
            "--accept-review" => {
                options.accept_review = Some(args.next().and_then(|s| s.into_string().ok()).filter(|s|
                    s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                ).ok_or_else(|| usage_error("--accept-review requires the lowercase SHA-256 digest from recover --preview"))?);
            }
            _ => return Err(usage_error("recover accepts --project and exactly one of --preview or --accept-review <digest>; use memory --help")),
        }
    }
    if options.preview == options.accept_review.is_some() {
        return Err(usage_error(
            "recover requires exactly one of --preview or --accept-review <digest>",
        ));
    }
    Ok(MemoryCommand::Recover(options))
}

struct RestorationAccess {
    requirements: PublicationWriteRequirements,
}

impl MemoryWriteAccess for RestorationAccess {
    fn allows_create(&self, path: &Path) -> bool {
        path.to_str().is_some_and(path_policy::writable)
            && self
                .requirements
                .create
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

fn recovery_error(error: PublicationError) -> CliError {
    let code = match error {
        PublicationError::Read(error) => return map_error(error),
        PublicationError::Store(error) => return map_error(ReadError::Store(error)),
        PublicationError::Scope => "memory_scope_conflict",
        PublicationError::Conflict => "memory_file_conflict",
        PublicationError::StalePreview => "memory_changed",
        PublicationError::PendingIntent => return CliError::new(
            "memory_recovery_unavailable",
            "no matching interrupted deployment is available for this project and installation; existing state and files were preserved",
            EXIT_REQUEST,
        ),
        PublicationError::InvalidIntent => "memory_invalid_recovery",
        PublicationError::RecoveryRequired(_) => "memory_recovery_required",
        PublicationError::MigrationUnsupported | PublicationError::Unsupported => "memory_unsupported",
        PublicationError::Io => "memory_recovery_failed",
    };
    CliError::new(
        code,
        format!("{error}; review again before retrying; completed moves are preserved"),
        EXIT_REQUEST,
    )
}

pub(super) fn run(options: RecoveryOptions, as_json: bool) -> Result<ExitCode, CliError> {
    let requested = options.project.unwrap_or_else(|| PathBuf::from("."));
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
    let parent = super::origin::required_parent()?;
    let store = Arc::new(existing_store(&parent, &control)?.ok_or_else(|| {
        CliError::new(
            "memory_recovery_unavailable",
            "no existing private recovery state is available; nothing was initialized or restored",
            EXIT_REQUEST,
        )
    })?);
    let access = Arc::new(super::init::InitReadAccess {
        marker: MarkerAccess { root: root.clone() },
    });
    let workspace = LocalMemoryWorkspace::open(
        &store,
        &root,
        access.as_ref(),
        &control.read_control().map_err(map_error)?,
    )
    .map_err(map_error)?;
    let review = OwnedRecoveryReview::prepare(
        &workspace,
        &workspace,
        store.clone(),
        access.clone(),
        access.clone(),
        &control,
    )
    .map_err(recovery_error)?;
    let digest = review.acceptance_digest();
    if options.preview {
        let result = json!({"schema":1,"root":root,"reviewDigest":digest,
            "entries":review.entries().iter().map(|entry| json!({
                "target":entry.target,"backup":entry.backup,"text":entry.text
            })).collect::<Vec<_>>(),
            "originalsRestored":false,"initializationCompleted":false,"policyChanged":false,
            "trustChanged":false,"contextActivated":false,"capturesActivated":false});
        if as_json {
            println!("{}", json!({"ok":true,"result":result}));
        } else {
            println!(
                "Saved originals review\nProject: {}\nReview digest: {digest}",
                terminal_text(&root.display().to_string())
            );
            for entry in review.entries() {
                println!(
                    "\nRestore to: {}\nSaved original: {}\n{}",
                    terminal_text(&entry.target),
                    terminal_text(&entry.backup),
                    terminal_text(&entry.text)
                );
            }
            println!("\nAccept only this review with memory recover --accept-review <digest> using the same project. Existing files are preserved. This does not finish initialization or change trust, use policy or capture permission.");
        }
        return Ok(ExitCode::SUCCESS);
    }
    if options.accept_review.as_deref() != Some(digest.as_str()) {
        return Err(CliError::new("memory_changed", "the recovery review digest no longer matches; run recover --preview again; no originals were restored", EXIT_REQUEST));
    }
    let access = RestorationAccess {
        requirements: review.write_requirements(),
    };
    match review.restore(&digest, &access, &DiscoveryControl::default()) {
        Ok(report) => {
            let result = json!({"schema":1,"root":root,"reviewDigest":digest,
                "created":report.created,"cleaned":report.cleaned,"skipped":report.skipped,"migrated":report.migrated,
                "originalsRestored":true,"initializationCompleted":false,"policyChanged":false,
                "trustChanged":false,"contextActivated":false,"capturesActivated":false});
            if as_json {
                println!("{}", json!({"ok":true,"result":result}));
            } else {
                println!("Saved originals restored at {}. Run memory init --preview for a new initialization review. Trust and use policy are unchanged; no context or captures were enabled.", terminal_text(&root.display().to_string()));
            }
            Ok(ExitCode::SUCCESS)
        }
        Err(failure) => {
            let error = recovery_error(failure.error);
            if as_json {
                eprintln!(
                    "{}",
                    json!({"ok":false,"error":{"code":error.code,"message":error.message},
                    "changes":{"created":failure.created,"migrated":failure.migrated,"cleaned":failure.cleaned,"possibleRecoveryFiles":failure.possible_recovery_files}})
                );
            } else {
                eprintln!("{}\nAcknowledged restored paths: {:?}\nConsumed backups: {:?}\nPossible recovery files: {:?}", error.message,failure.created,failure.cleaned,failure.possible_recovery_files);
            }
            Ok(ExitCode::from(EXIT_REQUEST))
        }
    }
}

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
