use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryRestore {
    pub target: String,
    pub backup: String,
    pub text: String,
}

/// Native-owned review. Display entries do not grant restoration authority.
pub struct OwnedRecoveryReview {
    origin: crate::reader::OwnedMemoryWorkspace,
    destination: crate::reader::OwnedMemoryWorkspace,
    intent: Intent,
    snapshot: crate::LocalMemorySnapshot,
    entries: Vec<RecoveryRestore>,
    created: Instant,
}

fn candidates(
    destination: &LocalMemoryWorkspace<'_>,
    intent: &Intent,
    control: &DiscoveryControl,
) -> Result<Vec<RecoveryRestore>, PublicationError> {
    let mut entries = Vec::new();
    let mut targets = std::collections::BTreeSet::new();
    for (index, file) in intent.files.iter().enumerate() {
        let Some(original) = &file.original else {
            continue;
        };
        if !targets.insert(&file.path) || targets.len() > 3 {
            return Err(PublicationError::InvalidIntent);
        }
        match destination.read_publication_artifact(&file.path, &phase(control))? {
            PathFact::Absent => {}
            PathFact::File { .. } => continue,
            _ => return Err(PublicationError::Conflict),
        }
        let backup = intent
            .backup(index)
            .ok_or(PublicationError::InvalidIntent)?;
        if !matches!(destination.read_publication_artifact(&backup, &phase(control))?,
            PathFact::File { text } if text == *original)
        {
            return Err(PublicationError::RecoveryRequired(vec![backup]));
        }
        entries.push(RecoveryRestore {
            target: file.path.clone(),
            backup,
            text: original.clone(),
        });
    }
    Ok(entries)
}

fn restore_entry(
    destination: &LocalMemoryWorkspace<'_>,
    entry: &RecoveryRestore,
    access: &dyn MemoryWriteAccess,
    control: &DiscoveryControl,
) -> Result<(), PublicationError> {
    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    {
        destination.checked_root(&phase(control))?.restore_original(
            destination.root(),
            entry,
            destination.access(),
            access,
            &phase(control),
        )
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
    {
        let _ = (destination, entry, access, control);
        Err(PublicationError::MigrationUnsupported)
    }
}

impl OwnedRecoveryReview {
    pub fn prepare(
        origin: &LocalMemoryWorkspace<'_>,
        destination: &LocalMemoryWorkspace<'_>,
        store: Arc<LocalMemoryStore>,
        origin_access: Arc<dyn MemoryReadAccess>,
        destination_access: Arc<dyn MemoryReadAccess>,
        control: &DiscoveryControl,
    ) -> Result<Self, PublicationError> {
        let held_origin = origin.retain(store.clone(), origin_access)?;
        let held_destination = destination.retain(store.clone(), destination_access)?;
        let _lock = store.try_lock_deployment()?;
        let snapshot = store.load()?;
        let intent = load_intent(&store)?.ok_or(PublicationError::PendingIntent)?;
        if intent.origin != origin.project_key()
            || intent.destination != destination.project_key()
            || intent.origin_id != binding(origin, control)?
            || intent.destination_id != binding(destination, control)?
            || snapshot.installation_id() != origin.identity()["machineId"]
            || snapshot.installation_id() != destination.identity()["machineId"]
        {
            return Err(PublicationError::PendingIntent);
        }
        let entries = candidates(destination, &intent, control)?;
        if entries.is_empty() {
            return Err(PublicationError::Conflict);
        }
        if store.load()? != snapshot
            || load_intent(&store)?.as_ref() != Some(&intent)
            || binding(origin, control)? != intent.origin_id
            || binding(destination, control)? != intent.destination_id
        {
            return Err(PublicationError::StalePreview);
        }
        phase(control).check()?;
        Ok(Self {
            origin: held_origin,
            destination: held_destination,
            intent,
            snapshot,
            entries,
            created: Instant::now(),
        })
    }

    pub fn entries(&self) -> &[RecoveryRestore] {
        &self.entries
    }

    pub fn acceptance_digest(&self) -> String {
        hex::encode(Sha256::digest(
            serde_json::json!({
                "schema":1,"operation":"restore-originals","intent":self.intent,
                "revision":self.snapshot.revision(),"installation":self.snapshot.installation_id(),
                "entries":self.entries.iter().map(|entry| serde_json::json!({
                    "target":entry.target,"backup":entry.backup,"text":entry.text
                })).collect::<Vec<_>>()
            })
            .to_string()
            .as_bytes(),
        ))
    }

    pub fn revalidate(&self, control: &DiscoveryControl) -> Result<(), PublicationError> {
        let destination = self.destination.borrow();
        let _lock = destination.store().try_lock_deployment()?;
        self.revalidate_locked(control)
    }

    fn revalidate_locked(&self, control: &DiscoveryControl) -> Result<(), PublicationError> {
        ensure_fresh(self.created, Instant::now())?;
        let origin = self.origin.borrow();
        let destination = self.destination.borrow();
        let store = destination.store();
        if store.load()? != self.snapshot
            || load_intent(store)?.as_ref() != Some(&self.intent)
            || binding(&origin, control)? != self.intent.origin_id
            || binding(&destination, control)? != self.intent.destination_id
            || candidates(&destination, &self.intent, control)? != self.entries
        {
            return Err(PublicationError::StalePreview);
        }
        if binding(&origin, control)? != self.intent.origin_id
            || binding(&destination, control)? != self.intent.destination_id
        {
            return Err(PublicationError::StalePreview);
        }
        ensure_fresh(self.created, Instant::now())?;
        phase(control).check()?;
        Ok(())
    }

    pub fn write_requirements(&self) -> PublicationWriteRequirements {
        PublicationWriteRequirements {
            root: self.destination.root().to_owned(),
            create: self
                .entries
                .iter()
                .map(|entry| entry.target.clone())
                .collect(),
            replace: Vec::new(),
            recovery: self
                .entries
                .iter()
                .map(|entry| entry.backup.clone())
                .collect(),
        }
    }

    /// Restores originals only. The interrupted intent remains for a new deployment review.
    pub fn restore(
        self,
        digest: &str,
        access: &dyn MemoryWriteAccess,
        control: &DiscoveryControl,
    ) -> Result<PublicationReport, Box<PublicationFailure>> {
        let mut report = PublicationReport::default();
        let run = || -> Result<(), PublicationError> {
            if digest != self.acceptance_digest() {
                return Err(PublicationError::StalePreview);
            }
            let _publication = publication_guard()?;
            let origin = self.origin.borrow();
            let destination = self.destination.borrow();
            let store = destination.store();
            let _lock = store.try_lock_deployment()?;
            self.revalidate_locked(control)?;
            for entry in &self.entries {
                ensure_fresh(self.created, Instant::now())?;
                if store.load()? != self.snapshot
                    || load_intent(store)?.as_ref() != Some(&self.intent)
                    || binding(&origin, control)? != self.intent.origin_id
                    || binding(&destination, control)? != self.intent.destination_id
                {
                    return Err(PublicationError::StalePreview);
                }
                restore_entry(&destination, entry, access, control)?;
                if binding(&origin, control)? != self.intent.origin_id
                    || binding(&destination, control)? != self.intent.destination_id
                    || store.load()? != self.snapshot
                    || load_intent(store)?.as_ref() != Some(&self.intent)
                    || !matches!(destination.read_publication_artifact(&entry.target, &phase(control))?,
                        PathFact::File { text } if text == entry.text)
                    || !matches!(
                        destination.read_publication_artifact(&entry.backup, &phase(control))?,
                        PathFact::Absent
                    )
                {
                    return Err(PublicationError::RecoveryRequired(vec![
                        entry.backup.clone(),
                        entry.target.clone(),
                    ]));
                }
                report.created.push(entry.target.clone());
                report.cleaned.push(entry.backup.clone());
            }
            Ok(())
        };
        let mut run = run;
        run().map_err(|error| {
            Box::new(PublicationFailure {
                error,
                created: report.created.clone(),
                migrated: Vec::new(),
                cleaned: report.cleaned.clone(),
                possible_recovery_files: self
                    .entries
                    .iter()
                    .map(|entry| entry.backup.clone())
                    .collect(),
            })
        })?;
        Ok(report)
    }
}
