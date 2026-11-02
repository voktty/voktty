#[path = "project_memory_access.rs"]
mod access;
#[path = "project_memory_wire.rs"]
mod wire;

use access::{AcceptedWrites, Access};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use voktty_memory_local::{
    inspect_local_memory_scope, read_local_memory_documents, resolve_local_memory_directory,
    DiscoveryControl, DiscoveryPurpose, InitializationPreview, LocalMemoryStore,
    LocalMemoryWorkspace, MemoryContextSession, MemoryPolicyReview, MemorySessionUse,
    MemoryTrustReview, OwnedInitializationPreview, ReadControl, ReadError,
};
use voktty_remote_protocol::{RemoteRequest, RemoteResponse};
use voktty_workspace_kit::RootLinks;
use wire::{Error, Handle, Request};

const MAX_RESOURCES: usize = 64;
const MAX_REQUEST_BYTES: usize = 512 * 1024;
const MAX_REPLY_BYTES: usize = 8 * 1024 * 1024;

pub(super) fn request_control(request: &RemoteRequest) -> DiscoveryControl {
    if request.params["operation"] == "inspect" {
        DiscoveryControl::new(Duration::from_secs(5))
    } else {
        DiscoveryControl::default()
    }
}

struct Review<T> {
    revision: u64,
    current: Option<(String, T)>,
}

impl<T> Default for Review<T> {
    fn default() -> Self {
        Self {
            revision: 0,
            current: None,
        }
    }
}

impl<T> Review<T> {
    fn reserve(&mut self, revision: u64) -> Result<(), Error> {
        wire::revision(revision, &mut self.revision)?;
        self.current = None;
        Ok(())
    }

    fn put(&mut self, value: T) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        self.current = Some((token.clone(), value));
        token
    }

    fn take(&mut self, token: &str) -> Result<T, Error> {
        if token.len() != 36
            || !self
                .current
                .as_ref()
                .is_some_and(|(current, _)| current == token)
        {
            return Err(Error::new("cancelled"));
        }
        self.current
            .take()
            .map(|(_, value)| value)
            .ok_or(Error::new("cancelled"))
    }

    fn cancel(&mut self, revision: u64) -> Result<bool, Error> {
        if revision == 0 || revision > 9_007_199_254_740_991 {
            return Err(Error::new("cancelled"));
        }
        if revision == self.revision && revision != 0 {
            return Ok(self.current.take().is_some());
        }
        if revision < self.revision {
            return Ok(false);
        }
        wire::revision(revision, &mut self.revision)?;
        Ok(self.current.take().is_some())
    }
}

struct Selection {
    token: String,
    source: Arc<Access>,
    preview: Review<OwnedInitializationPreview>,
    trust: Review<MemoryTrustReview>,
    policy: Review<MemoryPolicyReview>,
}

impl Selection {
    fn retire(&self) {
        self.source.retire();
    }
}

struct Presentation {
    token: String,
    revision: u64,
    selected: Option<Selection>,
}

impl Drop for Presentation {
    fn drop(&mut self) {
        if let Some(selected) = &self.selected {
            selected.retire();
        }
    }
}

struct Context {
    token: String,
    bound: Option<(MemoryContextSession, Arc<Access>)>,
}

impl Drop for Context {
    fn drop(&mut self) {
        if let Some((session, source)) = &self.bound {
            session.retire();
            source.retire();
        }
    }
}

/// Owned by one authenticated helper incarnation. Rehandshake drops its receipts.
pub(super) struct MemoryServer {
    parent: Option<PathBuf>,
    next_id: u64,
    presentations: HashMap<u64, Presentation>,
    contexts: HashMap<u64, Context>,
}

impl Default for MemoryServer {
    fn default() -> Self {
        Self {
            parent: dirs::data_local_dir().map(|path| path.join("dev.voktty")),
            next_id: 0,
            presentations: HashMap::new(),
            contexts: HashMap::new(),
        }
    }
}

impl MemoryServer {
    pub fn reset(&mut self) {
        self.presentations.clear();
        self.contexts.clear();
    }

    fn allocate(&mut self) -> Result<(u64, String), Error> {
        if self.presentations.len() + self.contexts.len() >= MAX_RESOURCES {
            return Err(Error::new("limit"));
        }
        let next = self
            .next_id
            .checked_add(1)
            .filter(|next| *next <= u64::from(u32::MAX))
            .ok_or(Error::new("limit"))?;
        self.next_id = next;
        Ok((next, uuid::Uuid::new_v4().to_string()))
    }

    fn presentation(&mut self, handle: &Handle) -> Result<&mut Presentation, Error> {
        self.presentations
            .get_mut(&handle.id)
            .filter(|value| handle.token.len() == 36 && value.token == handle.token)
            .ok_or(Error::new("cancelled"))
    }

    fn selected(&mut self, handle: &Handle, selection: &str) -> Result<&mut Selection, Error> {
        self.presentation(handle)?
            .selected
            .as_mut()
            .filter(|value| selection.len() == 36 && value.token == selection)
            .ok_or(Error::new("cancelled"))
    }

    fn context(&mut self, handle: &Handle) -> Result<&mut Context, Error> {
        self.contexts
            .get_mut(&handle.id)
            .filter(|value| handle.token.len() == 36 && value.token == handle.token)
            .ok_or(Error::new("cancelled"))
    }

    fn store(
        &self,
        initialize: bool,
        control: &ReadControl,
    ) -> Result<Arc<LocalMemoryStore>, Error> {
        let parent = self.parent.as_deref().ok_or(Error::new("unavailable"))?;
        if initialize {
            LocalMemoryStore::prepare_application_parent(parent, control)?;
        } else {
            LocalMemoryStore::check_application_parent(parent, control)?;
        }
        let store = if initialize {
            LocalMemoryStore::create_private(parent, control)?
        } else {
            LocalMemoryStore::open_private(parent, control)?
        };
        if initialize {
            store.initialize()
        } else {
            store.load()
        }
        .map_err(ReadError::Store)?;
        Ok(Arc::new(store))
    }

    #[cfg(test)]
    pub fn handle(&mut self, root: Option<&Path>, request: RemoteRequest) -> RemoteResponse {
        let control = request_control(&request);
        self.handle_with_control(root, request, &control)
    }

    pub fn handle_with_control(
        &mut self,
        root: Option<&Path>,
        request: RemoteRequest,
        control: &DiscoveryControl,
    ) -> RemoteResponse {
        let Some(root) = root else {
            return RemoteResponse::failure(
                request.id,
                "handshake_required",
                "handshake is required",
            );
        };
        if request.params.to_string().len() > MAX_REQUEST_BYTES {
            return RemoteResponse::failure(
                request.id,
                "limit",
                "memory request exceeds its limit",
            );
        }
        let params = match serde_json::from_value::<Request>(request.params) {
            Ok(params) => params,
            Err(_) => {
                return RemoteResponse::failure(
                    request.id,
                    "invalid_params",
                    "invalid memory request",
                )
            }
        };
        let result = match self.execute(root, params, control) {
            Ok(result) if result.to_string().len() <= MAX_REPLY_BYTES => {
                json!({"schema":1,"ok":true,"result":result})
            }
            Ok(_) => json!({"schema":1,"ok":false,"error":{"code":"limit"}}),
            Err(error) => json!({"schema":1,"ok":false,"error":error.value()}),
        };
        RemoteResponse::success(request.id, result)
    }

    fn execute(
        &mut self,
        root: &Path,
        request: Request,
        control: &DiscoveryControl,
    ) -> Result<Value, Error> {
        control.read_control()?;
        let value = match request {
            Request::Open {} => {
                let (id, token) = self.allocate()?;
                self.presentations.insert(
                    id,
                    Presentation {
                        token: token.clone(),
                        revision: 0,
                        selected: None,
                    },
                );
                Ok(json!({"id":id,"token":token}))
            }
            Request::Close { handle } => {
                self.presentation(&handle)?;
                self.presentations.remove(&handle.id);
                Ok(Value::Null)
            }
            Request::Clear { handle, revision } => {
                let presentation = self.presentation(&handle)?;
                wire::revision(revision, &mut presentation.revision)?;
                if let Some(selected) = presentation.selected.take() {
                    selected.retire();
                }
                Ok(Value::Null)
            }
            Request::Select {
                handle,
                path,
                revision,
                inspect_ancestors,
            } => {
                let presentation = self.presentation(&handle)?;
                wire::revision(revision, &mut presentation.revision)?;
                if let Some(selected) = presentation.selected.take() {
                    selected.retire();
                }
                let requested = validate_directory(root, &path, &control.read_control()?)?;
                let token = uuid::Uuid::new_v4().to_string();
                presentation.selected = Some(Selection {
                    token: token.clone(),
                    source: Arc::new(Access::new(root.to_owned(), requested, inspect_ancestors)),
                    preview: Review::default(),
                    trust: Review::default(),
                    policy: Review::default(),
                });
                Ok(json!(token))
            }
            Request::Inspect { handle, selection } => {
                let source = &self.selected(&handle, &selection)?.source;
                let observed =
                    inspect_local_memory_scope(&source.requested, source.as_ref(), control)?;
                let memory = observed
                    .scope
                    .root_key
                    .as_ref()
                    .and_then(|key| {
                        observed
                            .directories
                            .iter()
                            .find(|entry| &entry.directory_key == key)
                    })
                    .map(|entry| entry.path.clone());
                Ok(
                    json!({"schema":1,"scope":observed.scope,"root":memory,"blockedCount":observed.blocked_paths.len()}),
                )
            }
            Request::Initialize { handle, selection } => {
                self.selected(&handle, &selection)?;
                self.store(true, &control.read_control()?)?;
                Ok(Value::Null)
            }
            Request::Discover { handle, selection } => {
                let source = self.selected(&handle, &selection)?.source.clone();
                let store = self.store(false, &control.read_control()?)?;
                let workspace = LocalMemoryWorkspace::open(
                    &store,
                    &source.requested,
                    source.as_ref(),
                    &control.read_control()?,
                )?;
                let observed = workspace.observe_scope(DiscoveryPurpose::Discover, control)?;
                let memory = observed
                    .scope
                    .root_key
                    .as_ref()
                    .and_then(|key| {
                        observed
                            .directories
                            .iter()
                            .find(|entry| &entry.directory_key == key)
                    })
                    .map(|entry| entry.path.clone());
                Ok(
                    json!({"schema":1,"scope":observed.scope,"root":memory,"blockedCount":observed.blocked_paths.len()}),
                )
            }
            Request::Preview {
                handle,
                selection,
                revision,
                inputs,
                links,
            } => {
                let source = {
                    let selected = self.selected(&handle, &selection)?;
                    selected.preview.reserve(revision)?;
                    selected.source.clone()
                };
                let mut bytes = 0;
                if inputs.len() > 32 {
                    return Err(Error::new("limit"));
                }
                for (key, value) in &inputs {
                    bytes += key.len() + value.len();
                    if key.len() > 64 || value.len() > 16 * 1024 || bytes > 256 * 1024 {
                        return Err(Error::new("limit"));
                    }
                }
                let store = self.store(false, &control.read_control()?)?;
                let workspace = LocalMemoryWorkspace::open(
                    &store,
                    &source.requested,
                    source.as_ref(),
                    &control.read_control()?,
                )?;
                let values = inputs
                    .into_iter()
                    .map(|(key, value)| (key, Value::String(value)))
                    .collect();
                let preview = InitializationPreview::prepare(
                    &workspace,
                    &workspace,
                    &values,
                    RootLinks {
                        agents: links.agents,
                        claude: links.claude,
                    },
                    control,
                )?
                .into_owned(store.clone(), source.clone(), source.clone())?;
                let mut result = json!({"schema":1,"root":source.requested,"revision":revision,
                    "deployment":preview.deployment(),"isResuming":preview.is_resuming(),
                    "publicationBlocker":preview.publication_blocker().map(|error| Error::from(error).code),
                    "recoveryFiles":preview.recovery_files().iter().map(|file| json!({"path":file.path,"text":file.text})).collect::<Vec<_>>()});
                let token = self.selected(&handle, &selection)?.preview.put(preview);
                result["review"] = json!(token);
                Ok(result)
            }
            Request::Confirm {
                handle,
                selection,
                review,
            } => {
                let selected = self.selected(&handle, &selection)?;
                let preview = selected.preview.take(&review)?;
                let access = AcceptedWrites {
                    source: &selected.source,
                    requirements: preview.write_requirements(),
                };
                match preview.publish(&access, control) {
                    Ok(report) => Ok(
                        json!({"schema":1,"created":report.created,"skipped":report.skipped,
                        "migrated":report.migrated,"cleaned":report.cleaned}),
                    ),
                    Err(failure) => {
                        let mut error = Error::from(failure.error);
                        error.changes = Some(
                            json!({"created":failure.created,"migrated":failure.migrated,
                            "cleaned":failure.cleaned,"possibleRecoveryFiles":failure.possible_recovery_files}),
                        );
                        Err(error)
                    }
                }
            }
            Request::Cancel {
                handle,
                selection,
                revision,
            } => Ok(json!(self
                .selected(&handle, &selection)?
                .preview
                .cancel(revision)?)),
            Request::Documents {
                handle,
                selection,
                root,
            } => {
                let source = &self.selected(&handle, &selection)?.source;
                if root.len() > 4096 {
                    return Err(Error::new("limit"));
                }
                let documents = read_local_memory_documents(
                    &source.requested,
                    &root,
                    source.as_ref(),
                    control,
                )?;
                serde_json::to_value(documents).map_err(|_| Error::new("unavailable"))
            }
            Request::ReviewTrust {
                handle,
                selection,
                revision,
                role,
            } => {
                let source = {
                    let selected = self.selected(&handle, &selection)?;
                    selected.trust.reserve(revision)?;
                    selected.source.clone()
                };
                let store = self.store(false, &control.read_control()?)?;
                let review = MemoryTrustReview::prepare(
                    store,
                    source.requested.clone(),
                    source,
                    role,
                    control,
                )?;
                let observed = review.observation();
                let mut result = json!({"schema":1,"revision":revision,"root":review.root(),
                    "projectKey":observed.project_key,"config":observed.config,"instructions":observed.instructions,
                    "fingerprint":observed.fingerprint,"preference":observed.preference});
                let token = self.selected(&handle, &selection)?.trust.put(review);
                result["review"] = json!(token);
                Ok(result)
            }
            Request::ConfirmTrust {
                handle,
                selection,
                review,
            } => {
                let review = self.selected(&handle, &selection)?.trust.take(&review)?;
                let key = review.observation().project_key.clone();
                let snapshot = review.accept(control)?;
                Ok(json!({"schema":1,"preference":snapshot.project(&key)}))
            }
            Request::CancelTrust {
                handle,
                selection,
                revision,
            } => Ok(json!(self
                .selected(&handle, &selection)?
                .trust
                .cancel(revision)?)),
            Request::ReviewPolicy {
                handle,
                selection,
                revision,
                policy,
            } => {
                let source = {
                    let selected = self.selected(&handle, &selection)?;
                    selected.policy.reserve(revision)?;
                    selected.source.clone()
                };
                let policy = wire::policy(&policy)?;
                let store = self.store(false, &control.read_control()?)?;
                let review = MemoryPolicyReview::prepare(
                    store,
                    source.requested.clone(),
                    source,
                    policy,
                    control,
                )?;
                let mut result = json!({"schema":1,"revision":revision,"root":review.root(),
                    "projectKey":review.project_key(),"policy":review.policy(),"preference":review.preference()});
                let token = self.selected(&handle, &selection)?.policy.put(review);
                result["review"] = json!(token);
                Ok(result)
            }
            Request::ConfirmPolicy {
                handle,
                selection,
                review,
            } => {
                let review = self.selected(&handle, &selection)?.policy.take(&review)?;
                Ok(json!({"schema":1,"preference":review.accept(control)?}))
            }
            Request::CancelPolicy {
                handle,
                selection,
                revision,
            } => Ok(json!(self
                .selected(&handle, &selection)?
                .policy
                .cancel(revision)?)),
            Request::ContextOpen {} => {
                let (id, token) = self.allocate()?;
                self.contexts.insert(
                    id,
                    Context {
                        token: token.clone(),
                        bound: None,
                    },
                );
                Ok(json!({"id":id,"token":token}))
            }
            Request::ContextBind {
                handle,
                selection,
                review,
                context,
                mode,
            } => {
                if self.context(&context)?.bound.is_some() {
                    return Err(Error::new("cancelled"));
                }
                let mode = match mode.as_str() {
                    "enabled" => MemorySessionUse::Enabled,
                    "disabled" => MemorySessionUse::Disabled,
                    "inherit" => MemorySessionUse::Inherit,
                    _ => return Err(Error::new("invalidInput")),
                };
                let review = self.selected(&handle, &selection)?.trust.take(&review)?;
                let bound = MemoryContextSession::bind(review, mode, control)?;
                let result = json!({"schema":1,"root":bound.root()});
                let source = self.selected(&handle, &selection)?.source.clone();
                self.context(&context)?.bound = Some((bound, source));
                self.presentation(&handle)?.selected = None;
                Ok(result)
            }
            Request::ContextRead { context } => {
                let (bound, _) = self
                    .context(&context)?
                    .bound
                    .as_ref()
                    .ok_or(Error::new("cancelled"))?;
                serde_json::to_value(bound.read(control)?).map_err(|_| Error::new("unavailable"))
            }
            Request::ContextClose { context } => {
                self.context(&context)?;
                self.contexts.remove(&context.id);
                Ok(Value::Null)
            }
        }?;
        control.read_control()?;
        Ok(value)
    }
}

fn validate_directory(root: &Path, path: &str, control: &ReadControl) -> Result<PathBuf, Error> {
    let path = Path::new(path);
    if !path.is_absolute()
        || path
            .to_str()
            .is_none_or(|text| text.len() > 4096 || text.chars().any(char::is_control))
        || path.components().count() > 128
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        || !path.starts_with(root)
    {
        return Err(Error::new("denied"));
    }
    let resolved = resolve_local_memory_directory(path, control)?;
    if !resolved.starts_with(root) {
        return Err(Error::new("denied"));
    }
    Ok(resolved)
}

#[cfg(all(test, target_os = "linux"))]
#[path = "project_memory_tests.rs"]
mod tests;
