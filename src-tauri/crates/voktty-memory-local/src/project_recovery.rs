use super::*;
use std::collections::BTreeSet;

#[path = "project_recovery_plan.rs"]
mod plan;

pub struct ProjectRecoveryRequest {
    pub origin: PathBuf,
    pub origin_access: Arc<dyn MemoryReadAccess>,
    pub destination: PathBuf,
    pub destination_access: Arc<dyn MemoryReadAccess>,
}

/// Exact native project review. Neither the record nor its display data grants IO.
pub struct OwnedProjectRecoveryPreview {
    origin: OwnedProjectMemoryWorkspace,
    destination: OwnedProjectMemoryWorkspace,
    placement: InitializationPlacement,
    record_text: String,
    record: plan::Record,
    plan: plan::RecoveryPlan,
    created: Instant,
}

impl OwnedProjectRecoveryPreview {
    pub fn prepare(
        request: ProjectRecoveryRequest,
        control: &DiscoveryControl,
    ) -> Result<Self, PublicationError> {
        supported()?;
        let origin = ProjectMemoryWorkspace::open(
            &request.origin,
            request.origin_access.as_ref(),
            &control.read_control()?,
        )?
        .retain(request.origin_access.clone())?;
        let destination = ProjectMemoryWorkspace::open(
            &request.destination,
            request.destination_access.as_ref(),
            &control.read_control()?,
        )?
        .retain(request.destination_access.clone())?;
        validate_project_root(destination.root())?;
        let target = destination.borrow();
        let (_lock, record_text) = hold_record(&target, control)?;
        let record = plan::Record::parse(&record_text)?;
        if hash(&origin.review_binding()?.to_string()) != record.origin_binding
            || hash(&destination.review_binding()?.to_string()) != record.destination_binding
        {
            return Err(PublicationError::StalePreview);
        }
        let placement = if record.scope == "explicit-project-root" {
            InitializationPlacement::ProjectRoot
        } else {
            InitializationPlacement::Resolved(uuid::Uuid::new_v4().to_string())
        };
        let snapshot = observe(&target, &record, control)?;
        let plan = plan::RecoveryPlan::prepare(&record, snapshot)?;
        let preview = Self {
            origin,
            destination,
            placement,
            record_text,
            record,
            plan,
            created: Instant::now(),
        };
        preview.check(&preview.plan.snapshot, control)?;
        Ok(preview)
    }

    pub fn root(&self) -> &Path {
        self.destination.root()
    }
    pub fn deployment(&self) -> &PreparedDeployment {
        &self.plan.prepared
    }
    pub fn restorations(&self) -> &[RecoveryRestore] {
        &self.plan.restores
    }
    pub fn cleanup_files(&self) -> Vec<&RecoveryFile> {
        self.plan.before.iter().chain(&self.plan.after).collect()
    }
    pub fn acceptance_digest(&self) -> String {
        hash(&serde_json::json!({"schema":1,"operation":"recover-project-initialization",
            "record":self.record_text,"deployment":self.plan.prepared,
            "snapshot":self.plan.snapshot.iter().map(|(path, fact)| serde_json::json!({"path":path,"fact":crate::reader::fact_value(fact)})).collect::<Vec<_>>()
        }).to_string())
    }
    pub fn publication_blocker(&self) -> Option<PublicationError> {
        if !cfg!(any(target_os = "linux", target_os = "android", windows))
            && (!self.plan.restores.is_empty()
                || !self.plan.before.is_empty()
                || !self.plan.after.is_empty())
        {
            return Some(PublicationError::MigrationUnsupported);
        }
        publication_blocker(&self.plan.prepared)
    }
    pub fn write_requirements(&self) -> PublicationWriteRequirements {
        let mut result = PublicationWriteRequirements {
            root: self.root().to_owned(),
            create: Vec::new(),
            replace: Vec::new(),
            recovery: vec![PROJECT_INITIALIZATION_RECORD.into()],
        };
        for entry in &self.plan.prepared.plan.entries {
            match entry.action {
                DeploymentAction::Create => result.create.push(entry.path.clone()),
                DeploymentAction::Migrate => {
                    result.replace.push(entry.path.clone());
                    let index = self
                        .record
                        .files
                        .iter()
                        .position(|file| file.path == entry.path)
                        .expect("validated inventory");
                    result.create.push(
                        self.record.files[index]
                            .backup
                            .clone()
                            .expect("validated migration"),
                    );
                }
                _ => {}
            }
        }
        for entry in &self.plan.restores {
            result.create.push(entry.target.clone());
        }
        result.recovery.extend(
            self.plan
                .before
                .iter()
                .chain(&self.plan.after)
                .map(|file| file.path.clone()),
        );
        result
            .recovery
            .extend(self.plan.restores.iter().map(|entry| entry.backup.clone()));
        result.create.sort();
        result.create.dedup();
        result.recovery.sort();
        result.recovery.dedup();
        result
    }

    pub fn revalidate(&self, control: &DiscoveryControl) -> Result<(), PublicationError> {
        let target = self.destination.borrow();
        let (_lock, text) = hold_record(&target, control)?;
        if text != self.record_text {
            return Err(PublicationError::StalePreview);
        }
        self.check(&self.plan.snapshot, control)
    }

    fn check(
        &self,
        snapshot: &BTreeMap<String, PathFact>,
        control: &DiscoveryControl,
    ) -> Result<(), PublicationError> {
        ensure_fresh(self.created, Instant::now())?;
        let source = self.origin.borrow();
        let target = self.destination.borrow();
        validate_placement_for(&self.placement, &source, &target, true, control)?;
        if matches!(self.placement, InitializationPlacement::Resolved(_))
            && source.root() != target.root()
            && !source
                .recovery_artifacts(&control.read_control()?)?
                .is_empty()
        {
            return Err(PublicationError::PendingIntent);
        }
        let actual = observe(&target, &self.record, control)?;
        if actual.len() != snapshot.len()
            || actual
                .iter()
                .any(|(path, fact)| !same_fact(fact, &snapshot[path]))
            || !matches!(target.read_artifact(PROJECT_INITIALIZATION_RECORD, &control.read_control()?)?, PathFact::File {text} if text == self.record_text)
        {
            return Err(PublicationError::StalePreview);
        }
        source.validate_root(&control.read_control()?)?;
        target.validate_root(&control.read_control()?)?;
        ensure_fresh(self.created, Instant::now())?;
        control.read_control()?;
        Ok(())
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
        let target = self.destination.borrow();
        let (lock, text) = hold_record(&target, control)?;
        if text != self.record_text {
            return Err(PublicationError::StalePreview);
        }
        self.check(&self.plan.snapshot, control)?;
        if let Some(error) = self.publication_blocker() {
            return Err(error);
        }
        let requirements = self.write_requirements();
        for path in requirements
            .create
            .iter()
            .chain(&requirements.replace)
            .chain(&requirements.recovery)
        {
            if !target
                .root()
                .join(path)
                .to_str()
                .is_some_and(crate::path_policy::writable)
            {
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
        let mut snapshot = self.plan.snapshot.clone();
        for file in &self.plan.before {
            self.check(&snapshot, control)?;
            publication::cleanup_project(&target, file, access, control)?;
            snapshot.insert(file.path.clone(), PathFact::Absent);
            report.cleaned.push(file.path.clone());
        }
        for entry in &self.plan.restores {
            self.check(&snapshot, control)?;
            restore(&target, entry, access, control)?;
            snapshot.insert(
                entry.target.clone(),
                PathFact::File {
                    text: entry.text.clone(),
                },
            );
            snapshot.insert(entry.backup.clone(), PathFact::Absent);
            report.created.push(entry.target.clone());
            report.cleaned.push(entry.backup.clone());
        }
        for (index, entry) in self.plan.prepared.plan.entries.iter().enumerate() {
            self.check(&snapshot, control)?;
            match entry.action {
                DeploymentAction::Skip => report.skipped.push(entry.path.clone()),
                DeploymentAction::Create => {
                    publication::create_project(
                        &target,
                        &entry.path,
                        &entry.proposed,
                        access,
                        control,
                    )?;
                    report.created.push(entry.path.clone());
                }
                DeploymentAction::Migrate => {
                    let backup = self.record.files[index]
                        .backup
                        .as_ref()
                        .expect("validated migration");
                    publication::migrate_project(&target, entry, backup, access, control)?;
                    snapshot.insert(
                        backup.clone(),
                        PathFact::File {
                            text: entry.expected.clone().expect("native original"),
                        },
                    );
                    report.migrated.push(entry.path.clone());
                }
                _ => return Err(PublicationError::Conflict),
            }
            snapshot.insert(
                entry.path.clone(),
                PathFact::File {
                    text: entry.proposed.clone(),
                },
            );
        }
        self.check(&snapshot, control)?;
        for file in &self.plan.after {
            self.check(&snapshot, control)?;
            publication::cleanup_project(&target, file, access, control)?;
            snapshot.insert(file.path.clone(), PathFact::Absent);
            report.cleaned.push(file.path.clone());
        }
        self.check(&snapshot, control)?;
        drop(lock);
        publication::cleanup_project(
            &target,
            &RecoveryFile {
                path: PROJECT_INITIALIZATION_RECORD.into(),
                text: self.record_text.clone(),
            },
            access,
            control,
        )?;
        report.cleaned.push(PROJECT_INITIALIZATION_RECORD.into());
        target.validate_root(&control.read_control()?)?;
        self.origin
            .borrow()
            .validate_root(&control.read_control()?)?;
        Ok(())
    }
}

fn hash(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}
fn same_fact(left: &PathFact, right: &PathFact) -> bool {
    match (left, right) {
        (PathFact::Absent, PathFact::Absent) => true,
        (PathFact::File { text: left }, PathFact::File { text: right }) => left == right,
        _ => false,
    }
}
fn hold_record(
    target: &ProjectMemoryWorkspace<'_>,
    control: &DiscoveryControl,
) -> Result<(std::fs::File, String), PublicationError> {
    #[cfg(any(unix, windows))]
    {
        Ok(target.hold_initialization_record(&control.read_control()?)?)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, control);
        Err(PublicationError::Unsupported)
    }
}
fn observe(
    target: &ProjectMemoryWorkspace<'_>,
    record: &plan::Record,
    control: &DiscoveryControl,
) -> Result<BTreeMap<String, PathFact>, PublicationError> {
    let allowed = record
        .files
        .iter()
        .filter_map(|file| file.backup.clone())
        .chain(std::iter::once(PROJECT_INITIALIZATION_RECORD.into()))
        .collect::<BTreeSet<_>>();
    let unknown = target
        .recovery_artifacts(&control.read_control()?)?
        .into_iter()
        .filter(|path| !allowed.contains(path))
        .collect::<Vec<_>>();
    if !unknown.is_empty() {
        return Err(PublicationError::RecoveryRequired(unknown));
    }
    let mut snapshot =
        target.observe_deployment(record.template.links(), &control.read_control()?)?;
    for file in &record.files {
        if let Some(backup) = &file.backup {
            snapshot.insert(
                backup.clone(),
                target.read_artifact(backup, &control.read_control()?)?,
            );
        }
    }
    Ok(snapshot)
}
fn restore(
    target: &ProjectMemoryWorkspace<'_>,
    entry: &RecoveryRestore,
    access: &dyn MemoryWriteAccess,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    {
        target
            .checked_root(&control.read_control()?)?
            .restore_original(
                target.root(),
                entry,
                target.access(),
                access,
                &control.read_control()?,
            )
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
    {
        let _ = (target, entry, access, control);
        Err(PublicationError::MigrationUnsupported)
    }
}
