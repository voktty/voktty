use super::*;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct RootInstance(String);
impl RootInstance {
    #[cfg(unix)]
    pub(crate) fn unix(
        volume: u64,
        file: u128,
        created: Option<std::time::SystemTime>,
    ) -> Option<Self> {
        let birth = created?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_nanos();
        (file != 0 && birth != 0)
            .then(|| Self(format!("unix-v1:{volume:016x}:{file:032x}:{birth:032x}")))
    }

    #[cfg(windows)]
    pub(crate) fn windows(volume: u64, file: u128, created: i64) -> Option<Self> {
        (file != 0 && created > 0).then(|| {
            Self(format!(
                "windows-v1:{volume:016x}:{file:032x}:{created:032x}"
            ))
        })
    }

    fn valid(value: &str) -> bool {
        if value.len() > 96 {
            return false;
        }
        let parts: Vec<_> = value.split(':').collect();
        parts.len() == 4
            && matches!(parts[0], "unix-v1" | "windows-v1")
            && [16, 32, 32]
                .into_iter()
                .zip(&parts[1..])
                .all(|(length, part)| {
                    part.len() == length
                        && part
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                })
            && parts[2].bytes().any(|byte| byte != b'0')
            && parts[3].bytes().any(|byte| byte != b'0')
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StoredBinding {
    project_key: String,
    root: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub(super) enum RootBindings {
    #[default]
    Legacy,
    Bound(Vec<StoredBinding>),
}
impl RootBindings {
    pub(super) fn is_legacy(&self) -> bool {
        matches!(self, Self::Legacy)
    }

    pub(super) fn deserialize<'de, D: serde::Deserializer<'de>>(
        source: D,
    ) -> Result<Self, D::Error> {
        Vec::<StoredBinding>::deserialize(source).map(Self::Bound)
    }

    pub(super) fn valid(&self, schema: u8, keys: &HashSet<&String>) -> bool {
        match self {
            Self::Legacy => schema == 1,
            Self::Bound(bindings) => {
                if schema != 2 || bindings.len() > MAX_PROJECTS {
                    return false;
                }
                let mut seen = HashSet::new();
                bindings.iter().all(|binding| {
                    keys.contains(&binding.project_key)
                        && seen.insert(&binding.project_key)
                        && RootInstance::valid(&binding.root)
                })
            }
        }
    }

    fn matches(&self, key: &str, root: Option<&RootInstance>) -> bool {
        match (self, root) {
            (Self::Bound(bindings), Some(root)) => bindings
                .iter()
                .any(|entry| entry.project_key == key && entry.root == root.0),
            _ => false,
        }
    }

    fn bind(&mut self, key: &str, root: &RootInstance) {
        if self.is_legacy() {
            *self = Self::Bound(Vec::new());
        }
        let Self::Bound(bindings) = self else {
            unreachable!("promoted bindings")
        };
        if let Some(entry) = bindings.iter_mut().find(|entry| entry.project_key == key) {
            entry.root.clone_from(&root.0);
        } else {
            bindings.push(StoredBinding {
                project_key: key.to_owned(),
                root: root.0.clone(),
            });
        }
        bindings.sort_by(|left, right| left.project_key.cmp(&right.project_key));
    }
}

impl LocalMemorySnapshot {
    pub(crate) fn project_for_root(
        &self,
        key: &str,
        root: Option<&RootInstance>,
    ) -> Option<ProjectPreference> {
        let mut preference = self.project(key)?.clone();
        if !self.bindings.matches(key, root) {
            if preference.policy != MemoryPolicy::Never {
                preference.policy = MemoryPolicy::Manual;
            }
            preference.instruction_digest = None;
        }
        Some(preference)
    }
}

impl LocalMemoryStore {
    pub(crate) fn policy_for_root(
        &self,
        revision: u64,
        installation: &str,
        key: &str,
        root: &RootInstance,
        policy: MemoryPolicy,
    ) -> Result<LocalMemorySnapshot, StoreError> {
        if !RootInstance::valid(&root.0) {
            return Err(StoreError::InvalidInput);
        }
        self.update_snapshot(revision, key, Some(installation), |snapshot, index| {
            let effective = snapshot
                .project_for_root(key, Some(root))
                .expect("current entry");
            snapshot.projects[index].instruction_digest = effective.instruction_digest;
            snapshot.projects[index].policy = policy;
            snapshot.bindings.bind(key, root);
            snapshot.schema = 2;
        })
    }

    pub(crate) fn trust_for_root(
        &self,
        revision: u64,
        installation: &str,
        key: &str,
        root: &RootInstance,
        instruction_digest: &str,
    ) -> Result<LocalMemorySnapshot, StoreError> {
        if !digest(instruction_digest) || !RootInstance::valid(&root.0) {
            return Err(StoreError::InvalidInput);
        }
        self.update_snapshot(revision, key, Some(installation), |snapshot, index| {
            let effective = snapshot
                .project_for_root(key, Some(root))
                .expect("current entry");
            snapshot.projects[index].policy = effective.policy;
            snapshot.projects[index].instruction_digest = Some(instruction_digest.to_owned());
            snapshot.bindings.bind(key, root);
            snapshot.schema = 2;
        })
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "preferences_tests.rs"]
mod tests;
