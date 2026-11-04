use super::{map_error, usage_error, CliError, MemoryCommand};
use std::ffi::OsString;
use std::process::ExitCode;
use voktty_memory_local::ReadError;

#[derive(Debug, Default, PartialEq)]
pub(crate) struct MigrationOptions {
    preview: bool,
    accept_review: Option<String>,
}

pub(super) fn parse(args: Vec<OsString>) -> Result<MemoryCommand, CliError> {
    if args == [OsString::from("--help")] {
        return Ok(MemoryCommand::Help);
    }
    let mut options = MigrationOptions::default();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--preview" && !options.preview {
            options.preview = true;
        } else if arg == "--accept-review" && options.accept_review.is_none() {
            options.accept_review = Some(args.next().and_then(|s| s.into_string().ok())
                .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
                .ok_or_else(|| usage_error("--accept-review requires the lowercase SHA-256 digest from migrate-storage --preview"))?);
        } else {
            return Err(usage_error("migrate-storage accepts exactly one --preview or --accept-review <digest>; no project or storage path override is available"));
        }
    }
    if options.preview == options.accept_review.is_some() {
        return Err(usage_error(
            "migrate-storage requires exactly one --preview or --accept-review <digest>",
        ));
    }
    Ok(MemoryCommand::MigrateStorage(options))
}

pub(super) fn run(options: MigrationOptions, as_json: bool) -> Result<ExitCode, CliError> {
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (options, as_json);
        Err(map_error(ReadError::Unsupported))
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        use super::EXIT_REQUEST;
        use serde_json::json;
        use voktty_memory_local::{OriginMigrationReview, ReadControl};
        let base = dirs::data_local_dir().ok_or_else(|| map_error(ReadError::Unavailable))?;
        let control = ReadControl::default();
        let review = OriginMigrationReview::prepare(&base, &control).map_err(map_error)?;
        let digest = review.digest().to_owned();
        let summary = review.summary().clone();
        if options.preview {
            if as_json {
                println!(
                    "{}",
                    json!({"ok":true,"result":{"schema":1,"reviewDigest":digest,"summary":summary,
                    "source":"dev.voktty/project-memory","destination":"app.voktty.voktty/project-memory",
                    "stateMoved":false,"policyChanged":false,"trustChanged":false,"projectFilesChanged":false,
                    "contextActivated":false,"capturesActivated":false}})
                );
            } else {
                println!("Review this machine's complete legacy memory installation.\nFrom: dev.voktty/project-memory\nTo: app.voktty.voktty/project-memory\nProjects: {}\nPolicies: {} Manual, {} Always, {} Never\nStored instruction digests: {}\nRecovery journal: {}\nPending reservation: {}\nReview digest: {digest}\n\nAcceptance moves the existing objects and preserves their identity and bytes. It leaves a permanent marker blocking old writers. No stores are merged, no project files change, and no session or model is started. Accept only this review with memory migrate-storage --accept-review <digest>.", summary.projects,summary.manual,summary.always,summary.never,summary.stored_trust,summary.recovery_journal,summary.pending_reservation);
            }
            return Ok(ExitCode::SUCCESS);
        }
        if options.accept_review.as_deref() != Some(digest.as_str()) {
            return Err(CliError::new("memory_changed", "the storage migration review changed; run migrate-storage --preview again; no origin was moved", EXIT_REQUEST));
        }
        match review.accept(&digest, &control) {
            Ok(()) => {
                if as_json {
                    println!(
                        "{}",
                        json!({"ok":true,"result":{"schema":1,"reviewDigest":digest,"summary":summary,
                        "stateMoved":true,"legacyWriterBlocked":true,"policyChanged":false,"trustChanged":false,
                        "projectFilesChanged":false,"contextActivated":false,"capturesActivated":false}})
                    );
                } else {
                    println!("Legacy memory storage moved to the Desktop origin. Identity, preferences and recovery bytes are preserved. Keep the legacy marker: it blocks old writers. No project files, policy or trust changed; no context or captures were enabled.");
                }
                Ok(ExitCode::SUCCESS)
            }
            Err(failure) => {
                let error = map_error(failure.error);
                if as_json {
                    eprintln!(
                        "{}",
                        json!({"ok":false,"error":{"code":error.code,"message":error.message},"changes":{
                        "applicationParentMayExist":failure.application_parent_may_exist,
                        "reservationCreated":failure.reservation_created,"stateMoved":failure.moved}})
                    );
                } else {
                    eprintln!("{}\nApplication parent may exist: {}\nReservation created: {}\nState moved: {}\nPreserve both origins. Obtain a fresh migration review before retrying.",error.message,failure.application_parent_may_exist,failure.reservation_created,failure.moved);
                }
                Ok(ExitCode::from(EXIT_REQUEST))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_migration_choice_is_required_before_native_io() {
        for args in [
            vec![],
            vec!["--yes"],
            vec!["--force"],
            vec!["--preview", "--preview"],
            vec!["--project", "."],
            vec!["--accept-review"],
            vec!["--accept-review", "bad"],
            vec!["--preview", "--accept-review", &"a".repeat(64)],
        ] {
            assert!(parse(args.iter().map(|arg| OsString::from(*arg)).collect()).is_err());
        }
        assert!(matches!(
            parse(vec!["--preview".into()]).unwrap(),
            MemoryCommand::MigrateStorage(_)
        ));
    }
}
