use super::*;
use std::collections::BTreeSet;
use std::sync::Weak;
use voktty_memory_local::{
    MemoryWriteAccess, OwnedInitializationPreview, PublicationWriteRequirements,
};

#[derive(Default)]
struct Budget {
    paths: usize,
    bytes: usize,
}
impl Budget {
    fn insert(&mut self, set: &mut BTreeSet<PathBuf>, path: PathBuf) -> Result<(), ReadError> {
        if set.contains(&path) {
            return Ok(());
        }
        let bytes = path.to_str().ok_or(ReadError::InvalidInput)?.len();
        if self.paths == 512 || self.bytes + bytes > 2 * 1024 * 1024 {
            return Err(ReadError::Limit);
        }
        self.paths += 1;
        self.bytes += bytes;
        set.insert(path);
        Ok(())
    }
}

struct WriteScope {
    root: PathBuf,
    create: BTreeSet<PathBuf>,
    replace: BTreeSet<PathBuf>,
    recovery: BTreeSet<PathBuf>,
    stage_parents: BTreeSet<PathBuf>,
}

fn uuid_v4(text: &str) -> bool {
    uuid::Uuid::parse_str(text).is_ok_and(|id| {
        id.get_version_num() == 4
            && id.get_variant() == uuid::Variant::RFC4122
            && id.to_string() == text
    })
}
fn backup_name(relative: &str) -> bool {
    let path = Path::new(relative);
    if !matches!(
        path.parent().and_then(Path::to_str),
        Some("") | Some(".voktty")
    ) {
        return false;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix(".voktty-migration-"))
        .and_then(|suffix| suffix.rsplit_once('-'))
        .is_some_and(|(id, index)| {
            uuid_v4(id)
                && index
                    .parse::<usize>()
                    .is_ok_and(|n| n < 128 && n.to_string() == index)
        })
}
fn relative_path(root: &Path, relative: &str) -> Result<PathBuf, ReadError> {
    let path = Path::new(relative);
    if relative.is_empty()
        || relative.len() > 256
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(ReadError::InvalidInput);
    }
    let full = native_spelling(&root.join(path))?;
    if !full.to_str().is_some_and(path_policy::writable) {
        return Err(ReadError::Denied);
    }
    Ok(full)
}

impl WriteScope {
    fn build(requirements: PublicationWriteRequirements) -> Result<Self, ReadError> {
        if requirements.create.len() > 128
            || requirements.replace.len() > 3
            || requirements.recovery.len() > 3
        {
            return Err(ReadError::Limit);
        }
        let root = native_spelling(&requirements.root)?;
        if root.to_str().ok_or(ReadError::InvalidInput)?.len() > 4096
            || root.components().count() > 128
        {
            return Err(ReadError::Limit);
        }
        if !root.is_absolute()
            || root
                .components()
                .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
            || !root.to_str().is_some_and(path_policy::writable)
        {
            return Err(ReadError::Denied);
        }
        let mut scope = Self {
            root,
            create: BTreeSet::new(),
            replace: BTreeSet::new(),
            recovery: BTreeSet::new(),
            stage_parents: BTreeSet::new(),
        };
        let mut budget = Budget {
            paths: 1,
            bytes: scope.root.to_str().ok_or(ReadError::InvalidInput)?.len(),
        };
        for relative in requirements.recovery {
            if !backup_name(&relative) {
                return Err(ReadError::InvalidInput);
            }
            let path = relative_path(&scope.root, &relative)?;
            budget.insert(&mut scope.recovery, path)?;
        }
        for relative in requirements.replace {
            if !matches!(
                relative.as_str(),
                ".voktty/.gitignore" | "AGENTS.md" | "CLAUDE.md"
            ) {
                return Err(ReadError::Denied);
            }
            let path = relative_path(&scope.root, &relative)?;
            budget.insert(&mut scope.replace, path)?;
        }
        for relative in requirements.create {
            let path = relative_path(&scope.root, &relative)?;
            if !scope.recovery.contains(&path) {
                budget.insert(
                    &mut scope.stage_parents,
                    path.parent().ok_or(ReadError::InvalidInput)?.to_owned(),
                )?;
            }
            for parent in path
                .ancestors()
                .skip(1)
                .take_while(|parent| *parent != scope.root && parent.starts_with(&scope.root))
            {
                budget.insert(&mut scope.create, parent.to_owned())?;
            }
            budget.insert(&mut scope.create, path)?;
        }
        Ok(scope)
    }
    fn staging(&self, path: &Path) -> bool {
        path.parent()
            .is_some_and(|parent| self.stage_parents.contains(parent))
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| name.strip_prefix(".voktty-stage-"))
                .is_some_and(uuid_v4)
    }
}

/// Constructed only for an exact native review at explicit confirmation.
/// Read grants alone never construct this write authority.
pub(super) struct NativeMemoryWriteAuthority {
    scope: WriteScope,
    roots: Vec<PathBuf>,
    origin: Arc<Access>,
    destination: Arc<Access>,
    review: Weak<AtomicBool>,
}

impl NativeMemoryWriteAuthority {
    pub(super) fn capture(
        registry: &WorkspaceRegistry,
        preview: &OwnedInitializationPreview,
        origin: Arc<Access>,
        destination: Arc<Access>,
        review: &Arc<AtomicBool>,
    ) -> Result<Self, MemoryWorkError> {
        let authority = Self {
            roots: authorized_roots(registry)?,
            scope: WriteScope::build(preview.write_requirements())?,
            origin,
            destination,
            review: Arc::downgrade(review),
        };
        if !authority.allowed(&authority.scope.root) {
            return Err(ReadError::Denied.into());
        }
        Ok(authority)
    }
    fn allowed(&self, path: &Path) -> bool {
        self.origin.live.load(Ordering::Acquire)
            && self.destination.live.load(Ordering::Acquire)
            && self
                .review
                .upgrade()
                .is_some_and(|live| live.load(Ordering::Acquire))
            && path.is_absolute()
            && !path
                .components()
                .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
            && path.starts_with(&self.scope.root)
            && self.roots.iter().any(|root| path.starts_with(root))
            && path.to_str().is_some_and(path_policy::writable)
    }
    fn checked(&self, path: &Path) -> Option<PathBuf> {
        let path = native_spelling(path).ok()?;
        self.allowed(&path).then_some(path)
    }
}

impl MemoryWriteAccess for NativeMemoryWriteAuthority {
    fn allows_create(&self, path: &Path) -> bool {
        self.checked(path)
            .is_some_and(|path| self.scope.create.contains(&path) || self.scope.staging(&path))
    }
    fn allows_replace(&self, path: &Path) -> bool {
        self.checked(path)
            .is_some_and(|path| self.scope.replace.contains(&path))
    }
    fn allows_remove_staging(&self, path: &Path) -> bool {
        self.checked(path)
            .is_some_and(|path| self.scope.recovery.contains(&path))
    }
}

#[cfg(all(test, target_os = "linux"))]
#[path = "write_authority_tests.rs"]
mod tests;
