use super::*;
use std::collections::BTreeSet;

impl OwnedProjectInitializationPreview {
    fn backup(&self, index: usize) -> Option<String> {
        let entry = &self.prepared.plan.entries[index];
        if entry.action != DeploymentAction::Migrate {
            return None;
        }
        let parent = entry.path.rsplit_once('/').map_or("", |(parent, _)| parent);
        Some(format!(
            "{parent}{}.voktty-migration-{}-{index}",
            if parent.is_empty() { "" } else { "/" },
            self.transaction
        ))
    }

    pub fn write_requirements(&self) -> PublicationWriteRequirements {
        let mut requirements = PublicationWriteRequirements {
            root: self.root().to_owned(),
            create: Vec::new(),
            replace: Vec::new(),
            recovery: Vec::new(),
        };
        for (index, entry) in self.prepared.plan.entries.iter().enumerate() {
            match entry.action {
                DeploymentAction::Create => requirements.create.push(entry.path.clone()),
                DeploymentAction::Migrate => {
                    requirements.replace.push(entry.path.clone());
                    let backup = self.backup(index).expect("native migration");
                    requirements.create.push(backup.clone());
                    requirements.recovery.push(backup);
                }
                _ => {}
            }
        }
        if !requirements.create.is_empty() || !requirements.replace.is_empty() {
            requirements
                .create
                .push(PROJECT_INITIALIZATION_RECORD.into());
            requirements
                .recovery
                .push(PROJECT_INITIALIZATION_RECORD.into());
        }
        requirements
    }

    fn record_text(&self) -> Result<String, PublicationError> {
        let fingerprint = |text: &str| hex::encode(Sha256::digest(text.as_bytes()));
        let record = serde_json::json!({
            "schema":2,"operation":"initialize-project","scope":self.placement.name(),"transaction":self.transaction,
            "activityLock":"record-v1",
            "template": {"version":self.template_values["kit_version"],
                "values":self.template_values,
                "links":{"agents":self.links.agents,"claude":self.links.claude}},
            "reviewDigest":self.acceptance_digest(),
            "originBinding":fingerprint(&self.origin.review_binding()?.to_string()),
            "destinationBinding":fingerprint(&self.destination.review_binding()?.to_string()),
            "files":self.prepared.plan.entries.iter().enumerate().map(|(index, entry)| {
                serde_json::json!({"path":entry.path,"action":entry.action,"expected":entry.expected.as_deref().map(fingerprint),
                    "proposed":fingerprint(&entry.proposed),"backup":self.backup(index)})
            }).collect::<Vec<_>>()
        }).to_string();
        if record.len() > 256 * 1024 {
            return Err(ReadError::Limit.into());
        }
        Ok(record)
    }

    pub fn publish(
        self,
        digest: &str,
        access: &dyn MemoryWriteAccess,
        control: &DiscoveryControl,
    ) -> Result<PublicationReport, Box<PublicationFailure>> {
        let mut report = PublicationReport::default();
        self.publish_inner(digest, access, control, &mut report)
            .map_err(|error| {
                Box::new(PublicationFailure {
                    error,
                    created: report.created.clone(),
                    migrated: report.migrated.clone(),
                    cleaned: report.cleaned.clone(),
                    possible_recovery_files: self.write_requirements().recovery,
                })
            })?;
        Ok(report)
    }

    fn publish_inner(
        &self,
        digest: &str,
        access: &dyn MemoryWriteAccess,
        control: &DiscoveryControl,
        report: &mut PublicationReport,
    ) -> Result<(), PublicationError> {
        if digest != self.acceptance_digest() {
            return Err(PublicationError::StalePreview);
        }
        let _publication = publication_guard()?;
        self.revalidate(control)?;
        if let Some(error) = self.publication_blocker() {
            return Err(error);
        }
        let requirements = self.write_requirements();
        if requirements.create.is_empty() && requirements.replace.is_empty() {
            report.skipped = self
                .prepared
                .plan
                .entries
                .iter()
                .map(|entry| entry.path.clone())
                .collect();
            return Ok(());
        }
        for path in requirements
            .create
            .iter()
            .chain(&requirements.replace)
            .chain(&requirements.recovery)
        {
            let full = self.root().join(path);
            if !full.to_str().is_some_and(crate::path_policy::writable) {
                return Err(ReadError::Denied.into());
            }
        }
        if requirements
            .create
            .iter()
            .any(|path| !access.allows_create(&self.root().join(path)))
            || requirements
                .replace
                .iter()
                .any(|path| !access.allows_replace(&self.root().join(path)))
            || requirements
                .recovery
                .iter()
                .any(|path| !access.allows_remove_staging(&self.root().join(path)))
        {
            return Err(ReadError::Denied.into());
        }
        let record = self.record_text()?;
        let target = self.destination.borrow();
        #[cfg(any(unix, windows))]
        let record_lock = target
            .checked_root(&control.read_control()?)?
            .create_initialization_record(
                target.root(),
                &record,
                target.access(),
                access,
                &control.read_control()?,
            )
            .map_err(|error| {
                if error == ReadError::Unavailable {
                    PublicationError::Conflict
                } else {
                    error.into()
                }
            })?;
        #[cfg(not(any(unix, windows)))]
        return Err(PublicationError::Unsupported);
        report.created.push(PROJECT_INITIALIZATION_RECORD.into());
        let mut completed = BTreeSet::new();
        self.check_progress(&record, &completed, false, control)?;
        for (index, entry) in self.prepared.plan.entries.iter().enumerate() {
            self.validate_record(&record, control)?;
            if entry.action == DeploymentAction::Skip {
                report.skipped.push(entry.path.clone());
                completed.insert(index);
                continue;
            }
            if entry.path == ".voktty/kit.json" {
                self.check_progress(&record, &completed, false, control)?;
            }
            if entry.action == DeploymentAction::Migrate {
                migrate_project(
                    &target,
                    entry,
                    &self.backup(index).expect("native migration"),
                    access,
                    control,
                )?;
                report.migrated.push(entry.path.clone());
            } else {
                create_project(&target, &entry.path, &entry.proposed, access, control)?;
                report.created.push(entry.path.clone());
            }
            completed.insert(index);
        }
        self.check_progress(&record, &completed, false, control)?;
        for (index, entry) in self.prepared.plan.entries.iter().enumerate() {
            if let Some(path) = self.backup(index) {
                self.validate_record(&record, control)?;
                cleanup_project(
                    &target,
                    &RecoveryFile {
                        path: path.clone(),
                        text: entry.expected.clone().expect("native original"),
                    },
                    access,
                    control,
                )?;
                report.cleaned.push(path);
            }
        }
        self.check_progress(&record, &completed, true, control)?;
        // No project or backup mutation follows this release. The remaining
        // cleanup compares the exact record again and preserves replacements.
        #[cfg(any(unix, windows))]
        drop(record_lock);
        cleanup_project(
            &target,
            &RecoveryFile {
                path: PROJECT_INITIALIZATION_RECORD.into(),
                text: record,
            },
            access,
            control,
        )?;
        report.cleaned.push(PROJECT_INITIALIZATION_RECORD.into());
        self.origin
            .borrow()
            .validate_root(&control.read_control()?)?;
        target.validate_root(&control.read_control()?)?;
        control.read_control()?;
        Ok(())
    }

    fn validate_record(
        &self,
        record: &str,
        control: &DiscoveryControl,
    ) -> Result<(), PublicationError> {
        ensure_fresh(self.created_at, Instant::now())?;
        self.origin
            .borrow()
            .validate_root(&control.read_control()?)?;
        let target = self.destination.borrow();
        if !matches!(target.read_artifact(PROJECT_INITIALIZATION_RECORD, &control.read_control()?)?, PathFact::File { text } if text == record)
        {
            return Err(PublicationError::RecoveryRequired(vec![
                PROJECT_INITIALIZATION_RECORD.into(),
            ]));
        }
        Ok(())
    }

    fn check_progress(
        &self,
        record: &str,
        completed: &BTreeSet<usize>,
        cleaned: bool,
        control: &DiscoveryControl,
    ) -> Result<(), PublicationError> {
        self.validate_record(record, control)?;
        let source = self.origin.borrow();
        let target = self.destination.borrow();
        let allowed = self
            .write_requirements()
            .recovery
            .into_iter()
            .collect::<BTreeSet<_>>();
        let unknown = target
            .recovery_artifacts(&control.read_control()?)?
            .into_iter()
            .filter(|path| !allowed.contains(path))
            .collect::<Vec<_>>();
        if !unknown.is_empty() {
            return Err(PublicationError::RecoveryRequired(unknown));
        }
        if matches!(self.placement, InitializationPlacement::Resolved(_))
            && source.root() != target.root()
            && !source
                .recovery_artifacts(&control.read_control()?)?
                .is_empty()
        {
            return Err(PublicationError::PendingIntent);
        }
        self.validate_placement(&source, &target, true, control)?;
        let facts = target.observe_deployment(self.links, &control.read_control()?)?;
        for (index, entry) in self.prepared.plan.entries.iter().enumerate() {
            let expected = if completed.contains(&index) {
                Some(entry.proposed.as_str())
            } else {
                entry.expected.as_deref()
            };
            if !matches_expected(&facts[&entry.path], expected) {
                return Err(PublicationError::StalePreview);
            }
            if let Some(backup) = self.backup(index) {
                let expected = if completed.contains(&index) && !cleaned {
                    entry.expected.as_deref()
                } else {
                    None
                };
                if !matches_expected(
                    &target.read_artifact(&backup, &control.read_control()?)?,
                    expected,
                ) {
                    return Err(PublicationError::RecoveryRequired(vec![backup]));
                }
            }
        }
        self.validate_record(record, control)
    }
}

fn create_project(
    target: &ProjectMemoryWorkspace<'_>,
    path: &str,
    text: &str,
    access: &dyn MemoryWriteAccess,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    #[cfg(any(unix, windows))]
    {
        target
            .checked_root(&control.read_control()?)?
            .create_text(
                target.root(),
                path,
                text,
                target.access(),
                access,
                &control.read_control()?,
            )
            .map_err(|error| {
                if error == ReadError::Unavailable {
                    PublicationError::Conflict
                } else {
                    error.into()
                }
            })
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, path, text, access, control);
        Err(PublicationError::Unsupported)
    }
}

fn migrate_project(
    target: &ProjectMemoryWorkspace<'_>,
    entry: &voktty_workspace_kit::DeploymentEntry,
    backup: &str,
    access: &dyn MemoryWriteAccess,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    {
        target.checked_root(&control.read_control()?)?.replace_text(
            target.root(),
            &Migration {
                path: &entry.path,
                expected: entry
                    .expected
                    .as_deref()
                    .ok_or(PublicationError::Conflict)?,
                proposed: &entry.proposed,
                backup,
            },
            target.access(),
            access,
            &control.read_control()?,
        )
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
    {
        let _ = (target, entry, backup, access, control);
        Err(PublicationError::MigrationUnsupported)
    }
}

fn cleanup_project(
    target: &ProjectMemoryWorkspace<'_>,
    file: &RecoveryFile,
    access: &dyn MemoryWriteAccess,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    #[cfg(unix)]
    if file.path == PROJECT_INITIALIZATION_RECORD {
        return target
            .checked_root(&control.read_control()?)?
            .cleanup_initialization_record(
                target.root(),
                &file.text,
                target.access(),
                access,
                &control.read_control()?,
            )
            .map_err(|error| {
                if error == ReadError::Unavailable {
                    PublicationError::RecoveryRequired(vec![file.path.clone()])
                } else {
                    error.into()
                }
            });
    }
    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    {
        target
            .checked_root(&control.read_control()?)?
            .cleanup_migration(
                target.root(),
                file,
                target.access(),
                access,
                &control.read_control()?,
            )
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
    {
        let _ = (target, file, access, control);
        Err(PublicationError::Unsupported)
    }
}
