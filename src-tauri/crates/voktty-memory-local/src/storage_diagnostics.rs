use std::sync::{Arc, OnceLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageStage {
    ApplicationParent,
    PrivateDirectory,
    Preferences,
    WindowsToken,
    WindowsDirectoryOpen,
    WindowsSecurityQuery,
    WindowsOwner,
    WindowsAcl,
    WindowsGrant,
}

impl StorageStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ApplicationParent => "application-parent",
            Self::PrivateDirectory => "private-directory",
            Self::Preferences => "preferences",
            Self::WindowsToken => "windows-token",
            Self::WindowsDirectoryOpen => "windows-directory-open",
            Self::WindowsSecurityQuery => "windows-security-query",
            Self::WindowsOwner => "windows-owner",
            Self::WindowsAcl => "windows-acl",
            Self::WindowsGrant => "windows-grant",
        }
    }
}

/// Contains no paths, account identifiers, descriptors or document data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageFailure {
    pub stage: StorageStage,
    pub windows_error: Option<u32>,
}

#[derive(Clone, Default)]
pub(crate) struct StorageDiagnostics(Option<Arc<OnceLock<StorageFailure>>>);

impl StorageDiagnostics {
    pub(crate) fn enabled() -> Self {
        Self(Some(Arc::new(OnceLock::new())))
    }

    pub(crate) fn failure(&self) -> Option<StorageFailure> {
        self.0.as_ref().and_then(|failure| failure.get().copied())
    }

    pub(crate) fn record(&self, stage: StorageStage, windows_error: Option<u32>) {
        if let Some(failure) = &self.0 {
            let _ = failure.set(StorageFailure {
                stage,
                windows_error,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_first_failure_is_retained_across_clones() {
        let diagnostics = StorageDiagnostics::enabled();
        let worker = diagnostics.clone();
        worker.record(StorageStage::WindowsSecurityQuery, Some(5));
        worker.record(StorageStage::ApplicationParent, None);
        assert_eq!(
            diagnostics.failure(),
            Some(StorageFailure {
                stage: StorageStage::WindowsSecurityQuery,
                windows_error: Some(5),
            })
        );
        assert_eq!(StorageDiagnostics::enabled().failure(), None);
    }

    #[test]
    fn disabled_diagnostics_retain_nothing() {
        let diagnostics = StorageDiagnostics::default();
        diagnostics.record(StorageStage::WindowsOwner, None);
        assert_eq!(diagnostics.failure(), None);
    }
}
