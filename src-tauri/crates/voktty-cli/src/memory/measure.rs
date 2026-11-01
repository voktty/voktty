use super::*;
use voktty_memory_local::measure_local_memory;

#[derive(Debug, PartialEq)]
pub(crate) struct MeasureOptions {
    project: Option<PathBuf>,
    heading: String,
}

pub(super) fn parse(args: Vec<OsString>) -> Result<MemoryCommand, CliError> {
    let mut args = args.into_iter();
    let mut project = None;
    let mut heading = None;
    while let Some(flag) = args.next() {
        let value = args
            .next()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                usage_error(
                    "memory measure accepts --project <directory> and --up-next-heading <heading>",
                )
            })?;
        if flag == "--project" && project.is_none() {
            if value.to_str().is_some_and(|value| value.starts_with('-')) {
                return Err(usage_error(
                    "--project requires a directory; use ./ for names beginning with -",
                ));
            }
            project = Some(PathBuf::from(value));
        } else if flag == "--up-next-heading" && heading.is_none() {
            let value = value
                .into_string()
                .map_err(|_| usage_error("Up next heading must be UTF-8"))?;
            voktty_workspace_kit::inspect_memory_text("", &value).map_err(|_| {
                usage_error(
                    "Up next heading must be nonblank, single-line text of at most 128 UTF-8 bytes",
                )
            })?;
            heading = Some(value);
        } else {
            return Err(usage_error("unknown or duplicate memory measure option"));
        }
    }
    Ok(MemoryCommand::Measure(MeasureOptions {
        project,
        heading: heading.unwrap_or_else(|| "Up next".into()),
    }))
}

struct MeasurementAccess(MarkerAccess);

impl MeasurementAccess {
    fn kit_path(&self, path: &Path, predicate: impl Fn(&Path) -> bool) -> bool {
        path.to_str().is_some_and(path_policy::readable)
            && self.0.root.ancestors().any(|ancestor| {
                path.strip_prefix(ancestor.join(".voktty"))
                    .is_ok_and(&predicate)
            })
    }
}

impl MemoryReadAccess for MeasurementAccess {
    fn allows_metadata(&self, path: &Path) -> bool {
        self.0.allows_metadata(path)
            || self.kit_path(path, |relative| {
                ["plans", "continuity", "continuity/handoffs"]
                    .iter()
                    .any(|name| relative == Path::new(name))
                    || relative.parent() == Some(Path::new("continuity/handoffs"))
            })
    }
    fn allows_workspace_root(&self, path: &Path) -> bool {
        self.0.allows_workspace_root(path)
    }
    fn allows_read(&self, path: &Path) -> bool {
        self.0.allows_read(path)
            || self.kit_path(path, |relative| {
                [
                    "CONTEXT.md",
                    "PROJECT.md",
                    "plans/INDEX.md",
                    "plans/TRACKING.md",
                    "continuity/CHANGELOG.md",
                ]
                .iter()
                .any(|name| relative == Path::new(name))
            })
    }
    fn allows_enumeration(&self, path: &Path) -> bool {
        self.0.allows_enumeration(path)
            || self.kit_path(path, |relative| {
                relative == Path::new("continuity/handoffs")
            })
    }
}

pub(super) fn run(options: MeasureOptions, as_json: bool) -> Result<ExitCode, CliError> {
    let project = options.project.unwrap_or_else(|| PathBuf::from("."));
    let project = if project.is_absolute() {
        project
    } else {
        std::env::current_dir()
            .map_err(|_| map_error(ReadError::Unavailable))?
            .join(project)
    };
    let control = DiscoveryControl::default();
    let project =
        resolve_local_memory_directory(&project, &control.read_control().map_err(map_error)?)
            .map_err(map_error)?;
    let access = MeasurementAccess(MarkerAccess {
        root: project.clone(),
    });
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .ok_or_else(|| map_error(ReadError::Unavailable))?;
    let measured = measure_local_memory(&project, &access, now, &options.heading, &control)
        .map_err(map_error)?;
    let success = measured.report.complete && !measured.report.exceeded;
    if as_json {
        println!(
            "{}",
            json!({"ok":true, "result":{"schema":1,"transport":"local","root":measured.root,"measurements":measured.report.measurements,"complete":measured.report.complete,"exceeded":measured.report.exceeded}})
        );
    } else {
        println!(
            "Memory root: {}",
            terminal_text(&measured.root.to_string_lossy())
        );
        for entry in &measured.report.measurements {
            println!(
                "{} {}: {} / {} ({})",
                entry.path,
                entry.metric,
                entry
                    .value
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| "unknown".into()),
                entry.limit,
                entry.status
            );
        }
        println!("No files were changed or compacted.");
    }
    Ok(if success {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(EXIT_REQUEST)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measurement_authority_cannot_read_instructions_handoff_bodies_or_private_state() {
        let directory = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        let access = MeasurementAccess(MarkerAccess { root: root.clone() });
        for path in [
            ".voktty/INIT.md",
            "AGENTS.md",
            "CLAUDE.md",
            ".env",
            ".voktty/state/private.json",
            ".voktty/sessions/one.json",
            ".voktty/continuity/handoffs/2026-10-01-0000-solo.md",
        ] {
            assert!(!access.allows_read(&root.join(path)), "{path}");
        }
        assert!(access.allows_read(&root.join(".voktty/plans/TRACKING.md")));
        assert!(access.allows_metadata(&root.join(".voktty/continuity/handoffs/legacy.md")));
        assert!(access.allows_enumeration(&root.join(".voktty/continuity/handoffs")));
        assert!(!access.allows_enumeration(&root.join(".voktty/state")));
    }
}
