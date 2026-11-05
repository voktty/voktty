use super::{
    map_error, terminal_text, usage_error, CliError, MarkerAccess, MemoryCommand, EXIT_REQUEST,
};
use serde_json::json;
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use voktty_memory_local::{
    resolve_local_memory_directory, DiscoveryControl, OwnedProjectRecoveryPreview,
    ProjectRecoveryRequest, PublicationError, ReadError,
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

fn recovery_error(error: PublicationError) -> CliError {
    let code = match error {
        PublicationError::Read(error) => return map_error(error),
        PublicationError::Store(error) => return map_error(ReadError::Store(error)),
        PublicationError::Scope => "memory_scope_conflict",
        PublicationError::Conflict => "memory_file_conflict",
        PublicationError::StalePreview => "memory_changed",
        PublicationError::PendingIntent => return CliError::new(
            "memory_recovery_unavailable",
            "the project initialization record cannot be recovered here; existing files were preserved",
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
    let access = Arc::new(super::init::InitReadAccess {
        marker: MarkerAccess { root: root.clone() },
    });
    let review = OwnedProjectRecoveryPreview::prepare(
        ProjectRecoveryRequest {
            origin: root.clone(),
            origin_access: access.clone(),
            destination: root.clone(),
            destination_access: access,
        },
        &control,
    )
    .map_err(recovery_error)?;
    let digest = review.acceptance_digest();
    if options.preview {
        let result = json!({"schema":2,"root":root,"reviewDigest":digest,
            "deployment":review.deployment(),
            "restorations":review.restorations().iter().map(|entry| json!({
                "target":entry.target,"backup":entry.backup,"text":entry.text
            })).collect::<Vec<_>>(),
            "cleanup":review.cleanup_files().iter().map(|file| json!({"path":file.path,"text":file.text})).collect::<Vec<_>>(),
            "recordCleanup":voktty_memory_local::PROJECT_INITIALIZATION_RECORD,
            "publicationBlocker":review.publication_blocker().map(|error|error.to_string()),
            "originalsRestored":false,"initializationCompleted":false,"policyChanged":false,
            "trustChanged":false,"contextActivated":false,"capturesActivated":false});
        if as_json {
            println!("{}", json!({"ok":true,"result":result}));
        } else {
            println!(
                "Project initialization recovery\nProject: {}\nReview digest: {digest}",
                terminal_text(&root.display().to_string())
            );
            for entry in review.restorations() {
                println!(
                    "\nRestore to: {}\nSaved original: {}\n{}",
                    terminal_text(&entry.target),
                    terminal_text(&entry.backup),
                    terminal_text(&entry.text)
                );
            }
            for entry in &review.deployment().plan.entries {
                if entry.action != voktty_workspace_kit::DeploymentAction::Skip {
                    println!(
                        "\n{:?} {}\nBefore:\n{}\nAfter:\n{}",
                        entry.action,
                        terminal_text(&entry.path),
                        terminal_text(entry.expected.as_deref().unwrap_or("(missing)")),
                        terminal_text(&entry.proposed)
                    );
                }
            }
            for file in review.cleanup_files() {
                println!(
                    "\nClean reviewed artifact after verification: {}\n{}",
                    terminal_text(&file.path),
                    terminal_text(&file.text)
                );
            }
            println!("\nAccept exactly this review with memory recover --accept-review <digest> using the same project. Completes initialization and cleans its project record after verification. Preserves project content; does not open global memory storage or start an agent.");
        }
        return Ok(ExitCode::SUCCESS);
    }
    if options.accept_review.as_deref() != Some(digest.as_str()) {
        return Err(CliError::new("memory_changed", "the recovery review digest no longer matches; run recover --preview again; no project files were changed", EXIT_REQUEST));
    }
    if let Some(error) = review.publication_blocker() {
        return Err(recovery_error(error));
    }
    let originals_restored = !review.restorations().is_empty();
    let access = super::init::AcceptedWriteAccess {
        requirements: review.write_requirements(),
    };
    match review.publish(&digest, &access, &DiscoveryControl::default()) {
        Ok(report) => {
            let result = json!({"schema":2,"root":root,"reviewDigest":digest,
                "created":report.created,"cleaned":report.cleaned,"skipped":report.skipped,"migrated":report.migrated,
                "originalsRestored":originals_restored,"initializationCompleted":true,"policyChanged":false,
                "trustChanged":false,"contextActivated":false,"capturesActivated":false});
            if as_json {
                println!("{}", json!({"ok":true,"result":result}));
            } else {
                println!("Project memory initialization recovered at {}. Existing project content was preserved; no agent was started.", terminal_text(&root.display().to_string()));
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
                eprintln!("{}\nAcknowledged changes: {:?}\nCleaned artifacts: {:?}\nPossible recovery files: {:?}", error.message,[failure.created,failure.migrated].concat(),failure.cleaned,failure.possible_recovery_files);
            }
            Ok(ExitCode::from(EXIT_REQUEST))
        }
    }
}

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
