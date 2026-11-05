use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use voktty_memory_local::{
    MemoryPolicy, MemoryPolicyError, MemoryTrustError, MemoryWorkError, PublicationError,
    ReadError, StoreError,
};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Handle {
    pub id: u64,
    pub token: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Links {
    pub agents: bool,
    pub claude: bool,
}

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(super) enum Request {
    Open {},
    Close {
        handle: Handle,
    },
    Select {
        handle: Handle,
        path: String,
        revision: u64,
        #[serde(default)]
        inspect_ancestors: bool,
    },
    Clear {
        handle: Handle,
        revision: u64,
    },
    Inspect {
        handle: Handle,
        selection: String,
    },
    Discover {
        handle: Handle,
        selection: String,
    },
    Initialize {
        handle: Handle,
        selection: String,
    },
    Preview {
        handle: Handle,
        selection: String,
        revision: u64,
        inputs: BTreeMap<String, String>,
        links: Links,
    },
    Confirm {
        handle: Handle,
        selection: String,
        review: String,
    },
    Cancel {
        handle: Handle,
        selection: String,
        revision: u64,
    },
    ReviewRecovery {
        schema: u8,
        handle: Handle,
        selection: String,
        revision: u64,
    },
    ConfirmRecovery {
        schema: u8,
        handle: Handle,
        selection: String,
        review: String,
        digest: String,
    },
    CancelRecovery {
        handle: Handle,
        selection: String,
        revision: u64,
    },
    Documents {
        handle: Handle,
        selection: String,
        root: String,
    },
    ReviewTrust {
        handle: Handle,
        selection: String,
        revision: u64,
        role: Option<String>,
    },
    ConfirmTrust {
        handle: Handle,
        selection: String,
        review: String,
    },
    CancelTrust {
        handle: Handle,
        selection: String,
        revision: u64,
    },
    ReviewPolicy {
        handle: Handle,
        selection: String,
        revision: u64,
        policy: String,
    },
    ConfirmPolicy {
        handle: Handle,
        selection: String,
        review: String,
    },
    CancelPolicy {
        handle: Handle,
        selection: String,
        revision: u64,
    },
    ContextOpen {},
    ContextBind {
        handle: Handle,
        selection: String,
        review: String,
        context: Handle,
        mode: String,
    },
    ContextRead {
        context: Handle,
    },
    ContextClose {
        context: Handle,
    },
}

#[derive(Debug)]
pub(super) struct Error {
    pub code: &'static str,
    pub changes: Option<Value>,
    pub storage: Option<Value>,
}

impl Error {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            changes: None,
            storage: None,
        }
    }
    pub fn value(self) -> Value {
        let mut value = json!({"code":self.code});
        if let Some(changes) = self.changes {
            value["changes"] = changes;
        }
        if let Some(storage) = self.storage {
            value["storage"] = storage;
        }
        value
    }
}

impl From<ReadError> for Error {
    fn from(error: ReadError) -> Self {
        Self::new(match error {
            ReadError::InvalidInput | ReadError::Store(StoreError::InvalidInput) => "invalidInput",
            ReadError::Denied => "denied",
            ReadError::Cancelled => "cancelled",
            ReadError::Timeout => "timeout",
            ReadError::Busy | ReadError::Store(StoreError::Busy) => "busy",
            ReadError::Limit | ReadError::Store(StoreError::Limit) => "limit",
            ReadError::Unsupported => "unsupported",
            ReadError::Store(StoreError::Missing) => "missingState",
            ReadError::Store(StoreError::InvalidStore) => "invalidState",
            ReadError::StaleRoot
            | ReadError::StaleInstallation
            | ReadError::Store(StoreError::Conflict) => "stale",
            _ => "unavailable",
        })
    }
}

impl From<MemoryWorkError> for Error {
    fn from(error: MemoryWorkError) -> Self {
        match error {
            MemoryWorkError::Read(error) => error.into(),
            _ => Self::new("unavailable"),
        }
    }
}

impl From<MemoryTrustError> for Error {
    fn from(error: MemoryTrustError) -> Self {
        match error {
            MemoryTrustError::Worker(error) => error.into(),
            MemoryTrustError::ScopeUnavailable => Self::new("scope"),
            MemoryTrustError::Changed => Self::new("stale"),
        }
    }
}

impl From<MemoryPolicyError> for Error {
    fn from(error: MemoryPolicyError) -> Self {
        match error {
            MemoryPolicyError::Worker(error) => error.into(),
            MemoryPolicyError::ScopeUnavailable => Self::new("scope"),
            MemoryPolicyError::Changed => Self::new("stale"),
        }
    }
}

impl From<PublicationError> for Error {
    fn from(error: PublicationError) -> Self {
        match error {
            PublicationError::Read(error) => error.into(),
            PublicationError::Store(error) => ReadError::Store(error).into(),
            PublicationError::Scope => Self::new("scope"),
            PublicationError::Conflict => Self::new("conflict"),
            PublicationError::StalePreview => Self::new("stale"),
            PublicationError::InvalidIntent => Self::new("invalidRecovery"),
            PublicationError::PendingIntent => Self::new("pendingRecovery"),
            PublicationError::Unsupported => Self::new("unsupported"),
            PublicationError::MigrationUnsupported => Self::new("migrationUnsupported"),
            PublicationError::RecoveryRequired(_) => Self::new("recoveryRequired"),
            PublicationError::Io => Self::new("unavailable"),
        }
    }
}

pub(super) fn policy(value: &str) -> Result<MemoryPolicy, Error> {
    match value {
        "manual" => Ok(MemoryPolicy::Manual),
        "always" => Ok(MemoryPolicy::Always),
        "never" => Ok(MemoryPolicy::Never),
        _ => Err(Error::new("invalidInput")),
    }
}

pub(super) fn revision(next: u64, previous: &mut u64) -> Result<(), Error> {
    if next == 0 || next > 9_007_199_254_740_991 || next <= *previous {
        return Err(Error::new("cancelled"));
    }
    *previous = next;
    Ok(())
}
