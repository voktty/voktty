use super::*;
use voktty_workspace_kit::FileKind;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Record {
    schema: u8,
    operation: String,
    pub scope: String,
    transaction: String,
    activity_lock: String,
    review_digest: String,
    pub origin_binding: String,
    pub destination_binding: String,
    pub template: Template,
    pub files: Vec<SavedFile>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Template {
    version: String,
    values: Map<String, Value>,
    links: Links,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Links {
    agents: bool,
    claude: bool,
}
impl Template {
    pub fn links(&self) -> RootLinks {
        RootLinks {
            agents: self.links.agents,
            claude: self.links.claude,
        }
    }
}
#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Action {
    Create,
    Skip,
    Migrate,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SavedFile {
    pub path: String,
    action: Action,
    expected: Option<String>,
    proposed: String,
    pub backup: Option<String>,
}

impl Record {
    pub fn parse(text: &str) -> Result<Self, PublicationError> {
        if text.len() > 256 * 1024 {
            return Err(ReadError::Limit.into());
        }
        let record: Self =
            serde_json::from_str(text).map_err(|_| PublicationError::InvalidIntent)?;
        if record.schema != 2
            || record.operation != "initialize-project"
            || record.activity_lock != "record-v1"
            || !matches!(
                record.scope.as_str(),
                "explicit-project-root" | "resolved-memory-scope"
            )
            || !uuid::Uuid::parse_str(&record.transaction).is_ok_and(|id| {
                id.get_version_num() == 4
                    && id.get_variant() == uuid::Variant::RFC4122
                    && id.to_string() == record.transaction
            })
            || [
                &record.review_digest,
                &record.origin_binding,
                &record.destination_binding,
            ]
            .into_iter()
            .any(|s| !crate::digest(s))
            || record.files.is_empty()
            || record.files.len() > 128
            || record
                .template
                .values
                .get("kit_version")
                .and_then(Value::as_str)
                != Some(&record.template.version)
        {
            return Err(PublicationError::InvalidIntent);
        }
        crate::template_inputs::validate_inputs(&record.template.values)?;
        let fresh = record.fresh()?;
        if record.files.len() != fresh.plan.entries.len() {
            return Err(PublicationError::InvalidIntent);
        }
        for (index, (file, entry)) in record.files.iter().zip(&fresh.plan.entries).enumerate() {
            if file.path != entry.path
                || !crate::digest(&file.proposed)
                || file.expected.as_ref().is_some_and(|s| !crate::digest(s))
            {
                return Err(PublicationError::InvalidIntent);
            }
            match file.action {
                Action::Create
                    if file.expected.is_none()
                        && file.backup.is_none()
                        && (file.path == ".voktty/kit.lock.json"
                            || file.proposed == hash(&entry.proposed)) => {}
                Action::Skip
                    if file.expected.as_ref() == Some(&file.proposed) && file.backup.is_none() => {}
                Action::Migrate
                    if matches!(
                        file.path.as_str(),
                        "AGENTS.md" | "CLAUDE.md" | ".voktty/.gitignore"
                    ) && file.expected.as_ref().is_some_and(|s| *s != file.proposed) =>
                {
                    let parent = file.path.rsplit_once('/').map_or("", |(parent, _)| parent);
                    let expected = format!(
                        "{parent}{}.voktty-migration-{}-{index}",
                        if parent.is_empty() { "" } else { "/" },
                        record.transaction
                    );
                    if file.backup.as_deref() != Some(&expected) {
                        return Err(PublicationError::InvalidIntent);
                    }
                }
                _ => return Err(PublicationError::InvalidIntent),
            }
        }
        Ok(record)
    }
    fn fresh(&self) -> Result<PreparedDeployment, PublicationError> {
        let files = render_template(&self.template.values).map_err(ReadError::Contract)?;
        let mut absent = files
            .iter()
            .map(|file| (file.path.clone(), PathFact::Absent))
            .collect::<BTreeMap<_, _>>();
        absent.insert(".voktty/kit.lock.json".into(), PathFact::Absent);
        // This unselected dependency contributes no deployment entry or IO grant.
        if self.template.links.claude && !self.template.links.agents {
            absent.insert(
                "AGENTS.md".into(),
                PathFact::File {
                    text: String::new(),
                },
            );
        }
        let fresh = prepare_deployment(
            &self.template.version,
            &files,
            &absent,
            self.template.links(),
        )
        .map_err(ReadError::Contract)?;
        if !fresh.plan.can_publish {
            return Err(PublicationError::InvalidIntent);
        }
        Ok(fresh)
    }
}

pub(super) struct RecoveryPlan {
    pub prepared: PreparedDeployment,
    pub restores: Vec<RecoveryRestore>,
    pub before: Vec<RecoveryFile>,
    pub after: Vec<RecoveryFile>,
    pub snapshot: BTreeMap<String, PathFact>,
}

impl RecoveryPlan {
    pub fn prepare(
        record: &Record,
        snapshot: BTreeMap<String, PathFact>,
    ) -> Result<Self, PublicationError> {
        let mut files = render_template(&record.template.values).map_err(ReadError::Contract)?;
        let mut facts = snapshot.clone();
        let mut restores = Vec::new();
        let mut before = Vec::new();
        let mut after = Vec::new();
        for saved in &record.files {
            let fact = snapshot
                .get(&saved.path)
                .ok_or(PublicationError::InvalidIntent)?;
            let current = match fact {
                PathFact::File { text } => Some(text.as_str()),
                PathFact::Absent => None,
                _ => return Err(PublicationError::Conflict),
            };
            let content = files
                .iter_mut()
                .find(|file| file.path == saved.path && file.kind == FileKind::Content);
            match saved.action {
                Action::Create | Action::Skip => {
                    if let Some(text) = current {
                        if let Some(content) = content {
                            content.text = text.into();
                        } else if hash(text) != saved.proposed {
                            return Err(PublicationError::Conflict);
                        }
                    } else if saved.action == Action::Skip {
                        return Err(PublicationError::Conflict);
                    }
                }
                Action::Migrate => {
                    let backup = saved
                        .backup
                        .as_ref()
                        .ok_or(PublicationError::InvalidIntent)?;
                    let backup_fact = snapshot
                        .get(backup)
                        .ok_or(PublicationError::InvalidIntent)?;
                    let expected = saved
                        .expected
                        .as_ref()
                        .ok_or(PublicationError::InvalidIntent)?;
                    let current_hash = current.map(hash);
                    match backup_fact {
                        PathFact::Absent
                            if current_hash.as_ref() == Some(expected)
                                || current_hash.as_ref() == Some(&saved.proposed) => {}
                        PathFact::File { text } if hash(text) == *expected && current.is_none() => {
                            restores.push(RecoveryRestore {
                                target: saved.path.clone(),
                                backup: backup.clone(),
                                text: text.clone(),
                            });
                            facts.insert(saved.path.clone(), PathFact::File { text: text.clone() });
                        }
                        PathFact::File { text }
                            if hash(text) == *expected
                                && current_hash.as_ref() == Some(&saved.proposed) =>
                        {
                            after.push(RecoveryFile {
                                path: backup.clone(),
                                text: text.clone(),
                            });
                        }
                        PathFact::File { text }
                            if hash(text) == saved.proposed
                                && current_hash.as_ref() == Some(expected) =>
                        {
                            before.push(RecoveryFile {
                                path: backup.clone(),
                                text: text.clone(),
                            });
                        }
                        _ => return Err(PublicationError::Conflict),
                    }
                }
            }
        }
        let prepared = prepare_deployment(
            &record.template.version,
            &files,
            &facts,
            record.template.links(),
        )
        .map_err(ReadError::Contract)?;
        if !prepared.plan.can_publish || prepared.plan.entries.len() != record.files.len() {
            return Err(PublicationError::Conflict);
        }
        for (saved, entry) in record.files.iter().zip(&prepared.plan.entries) {
            if saved.path != entry.path {
                return Err(PublicationError::InvalidIntent);
            }
            match saved.action {
                Action::Skip if entry.action == DeploymentAction::Skip => {}
                Action::Create
                    if matches!(
                        entry.action,
                        DeploymentAction::Create | DeploymentAction::Skip
                    ) && (entry.path != ".voktty/kit.lock.json"
                        || hash(&entry.proposed) == saved.proposed) => {}
                Action::Migrate if hash(&entry.proposed) == saved.proposed => {
                    if entry.action == DeploymentAction::Migrate
                        && entry.expected.as_ref().map(|text| hash(text)) == saved.expected
                    {
                        after.push(RecoveryFile {
                            path: saved.backup.clone().expect("validated backup"),
                            text: entry.expected.clone().expect("native original"),
                        });
                    } else if entry.action != DeploymentAction::Skip {
                        return Err(PublicationError::Conflict);
                    }
                }
                _ => return Err(PublicationError::Conflict),
            }
        }
        Ok(Self {
            prepared,
            restores,
            before,
            after,
            snapshot,
        })
    }
}
