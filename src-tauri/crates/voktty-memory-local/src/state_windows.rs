use super::*;
use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, GENERIC_ALL, GENERIC_WRITE, HANDLE};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo,
    SDDL_REVISION_1, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    EqualSid, GetAce, GetTokenInformation, IsValidAcl, IsValidSid, IsWellKnownSid, TokenUser,
    WinBuiltinAdministratorsSid, WinLocalSystemSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL,
    DACL_SECURITY_INFORMATION, INHERIT_ONLY_ACE, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    PSID, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_DELETE_CHILD, FILE_WRITE_ATTRIBUTES, FILE_WRITE_EA, WRITE_DAC, WRITE_OWNER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

struct Token(HANDLE);
impl Drop for Token {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}
pub(super) struct Descriptor(pub(super) PSECURITY_DESCRIPTOR);
impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}

fn user() -> Result<Vec<u64>, ReadError> {
    let mut handle = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) } == 0 {
        return Err(ReadError::Denied);
    }
    let token = Token(handle);
    let mut length = 0;
    unsafe { GetTokenInformation(token.0, TokenUser, std::ptr::null_mut(), 0, &mut length) };
    if length < size_of::<TOKEN_USER>() as u32 || length > 64 * 1024 {
        return Err(ReadError::Denied);
    }
    let mut storage = vec![0u64; (length as usize).div_ceil(8)];
    if unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            storage.as_mut_ptr().cast(),
            length,
            &mut length,
        )
    } == 0
    {
        return Err(ReadError::Denied);
    }
    Ok(storage)
}

fn trusted(sid: PSID, user: PSID) -> bool {
    unsafe {
        IsValidSid(sid) != 0
            && (EqualSid(sid, user) != 0
                || IsWellKnownSid(sid, WinLocalSystemSid) != 0
                || IsWellKnownSid(sid, WinBuiltinAdministratorsSid) != 0)
    }
}

pub(super) fn creation_descriptor() -> Result<Descriptor, ReadError> {
    let storage = user()?;
    let current = unsafe { (*(storage.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    let mut text = std::ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(current, &mut text) } == 0 || text.is_null() {
        return Err(ReadError::Denied);
    }
    let _text = Descriptor(text.cast());
    let mut length = 0;
    while length < 256 && unsafe { *text.add(length) } != 0 {
        length += 1;
    }
    if length == 256 {
        return Err(ReadError::Limit);
    }
    let sid = String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) })
        .map_err(|_| ReadError::InvalidInput)?;
    let sddl = format!("O:{sid}D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)");
    let wide = sddl.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut descriptor = std::ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(ReadError::Denied);
    }
    Ok(Descriptor(descriptor))
}

fn installer_sid() -> Result<Vec<u64>, ReadError> {
    let mut name = "TRUSTEDINSTALLER".encode_utf16().collect::<Vec<_>>();
    let name = UNICODE_STRING {
        Length: (name.len() * 2) as u16,
        MaximumLength: (name.len() * 2) as u16,
        Buffer: name.as_mut_ptr(),
    };
    let mut storage = vec![0u64; 16];
    let mut bytes = (storage.len() * 8) as u32;
    if unsafe {
        windows_sys::Wdk::Storage::FileSystem::RtlCreateServiceSid(
            &name,
            storage.as_mut_ptr().cast(),
            &mut bytes,
        )
    } != 0
        || bytes as usize > storage.len() * 8
        || unsafe { IsValidSid(storage.as_mut_ptr().cast()) } == 0
    {
        return Err(ReadError::Denied);
    }
    Ok(storage)
}

pub(super) fn qualify(file: &File, private: bool) -> Result<(), ReadError> {
    qualify_access(file, private, false, &ReadControl::default())
}

fn qualify_access(
    file: &File,
    private: bool,
    ancestor: bool,
    control: &ReadControl,
) -> Result<(), ReadError> {
    use crate::StorageStage;
    let user_storage =
        user().inspect_err(|_| control.record_storage_failure(StorageStage::WindowsToken, None))?;
    let current = unsafe { (*(user_storage.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    let installer = if ancestor {
        Some(installer_sid()?)
    } else {
        None
    };
    let allowed = |sid| {
        trusted(sid, current)
            || installer.as_ref().is_some_and(|installer| unsafe {
                IsValidSid(sid) != 0 && EqualSid(sid, installer.as_ptr().cast_mut().cast()) != 0
            })
    };
    let mut owner = std::ptr::null_mut();
    let mut acl: *mut ACL = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let status = unsafe {
        GetSecurityInfo(
            file.as_raw_handle(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            &mut acl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    let _descriptor = Descriptor(descriptor);
    if status != 0 {
        control.record_storage_failure(StorageStage::WindowsSecurityQuery, Some(status));
        return Err(ReadError::Denied);
    }
    if owner.is_null()
        || unsafe {
            IsValidSid(owner) == 0
                || (if ancestor {
                    !allowed(owner)
                } else {
                    EqualSid(owner, current) == 0
                })
        }
    {
        control.record_storage_failure(StorageStage::WindowsOwner, None);
        return Err(ReadError::Denied);
    }
    if acl.is_null() || unsafe { IsValidAcl(acl) == 0 } {
        control.record_storage_failure(StorageStage::WindowsAcl, None);
        return Err(ReadError::Denied);
    }
    let destructive = DELETE
        | FILE_DELETE_CHILD
        | FILE_WRITE_ATTRIBUTES
        | FILE_WRITE_EA
        | WRITE_DAC
        | WRITE_OWNER
        | GENERIC_ALL
        | GENERIC_WRITE;
    for index in 0..unsafe { (*acl).AceCount } {
        let mut pointer = std::ptr::null_mut();
        if unsafe { GetAce(acl, index.into(), &mut pointer) } == 0 || pointer.is_null() {
            control.record_storage_failure(StorageStage::WindowsAcl, None);
            return Err(ReadError::Denied);
        }
        let header = unsafe { &*pointer.cast::<ACE_HEADER>() };
        if header.AceFlags as u32 & INHERIT_ONLY_ACE != 0 {
            continue;
        }
        // Deny entries only restrict access. Unknown or object-specific grants
        // fail rather than assuming their effective permissions.
        if header.AceType == 1 {
            continue;
        }
        if header.AceType != 0 || (header.AceSize as usize) < size_of::<ACCESS_ALLOWED_ACE>() {
            control.record_storage_failure(StorageStage::WindowsAcl, None);
            return Err(ReadError::Denied);
        }
        let ace = unsafe { &*pointer.cast::<ACCESS_ALLOWED_ACE>() };
        let sid = (&ace.SidStart as *const u32).cast_mut().cast();
        if !allowed(sid) && (private && ace.Mask != 0 || ace.Mask & destructive != 0) {
            control.record_storage_failure(StorageStage::WindowsGrant, None);
            return Err(ReadError::Denied);
        }
    }
    Ok(())
}

impl Directory {
    pub(crate) fn qualify_ancestor(&self, control: &ReadControl) -> Result<(), ReadError> {
        control.check()?;
        let parent = self.ancestors.last().ok_or(ReadError::InvalidInput)?;
        let (file, observed) =
            reopen_directory(parent, OpenKind::PrivateDirectory).map_err(|error| {
                control.record_storage_failure(
                    crate::StorageStage::WindowsDirectoryOpen,
                    error.raw_os_error().map(|code| code as u32),
                );
                ReadError::Denied
            })?;
        if (observed.volume, observed.id) != self.identity() {
            return Err(ReadError::StaleRoot);
        }
        validate_requested_root(&final_path(&file)?)?;
        qualify_access(&file, false, true, control)?;
        control.check()
    }

    pub(crate) fn qualify_state(
        &self,
        private: bool,
        control: &ReadControl,
    ) -> Result<(), ReadError> {
        control.check()?;
        let parent = self.ancestors.last().ok_or(ReadError::InvalidInput)?;
        let (file, observed) =
            reopen_directory(parent, OpenKind::PrivateDirectory).map_err(|error| {
                control.record_storage_failure(
                    crate::StorageStage::WindowsDirectoryOpen,
                    error.raw_os_error().map(|code| code as u32),
                );
                ReadError::Denied
            })?;
        if (observed.volume, observed.id) != self.identity() {
            return Err(ReadError::StaleRoot);
        }
        validate_requested_root(&final_path(&file)?)?;
        qualify_access(&file, private, false, control)?;
        control.check()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{SetFileSecurityW, PROTECTED_DACL_SECURITY_INFORMATION};

    fn private_acl(path: &Path, extra: &str) {
        let storage = user().unwrap();
        let sid = unsafe { (*(storage.as_ptr().cast::<TOKEN_USER>())).User.Sid };
        let mut text = std::ptr::null_mut();
        assert_ne!(unsafe { ConvertSidToStringSidW(sid, &mut text) }, 0);
        let mut length = 0;
        while length < 256 && unsafe { *text.add(length) } != 0 {
            length += 1;
        }
        assert!(length < 256);
        let sid = unsafe { String::from_utf16(std::slice::from_raw_parts(text, length)).unwrap() };
        unsafe { LocalFree(text.cast()) };
        let sddl = format!("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;{sid}){extra}");
        let wide = sddl.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let mut descriptor = std::ptr::null_mut();
        assert_ne!(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    wide.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    std::ptr::null_mut(),
                )
            },
            0
        );
        let descriptor = Descriptor(descriptor);
        let wide = path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        assert_ne!(
            unsafe {
                SetFileSecurityW(
                    wide.as_ptr(),
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    descriptor.0,
                )
            },
            0
        );
    }

    #[test]
    fn captured_directory_can_be_reopened_for_security_and_listing() {
        struct Access;
        impl MemoryReadAccess for Access {
            fn allows_metadata(&self, _: &Path) -> bool {
                true
            }
            fn allows_read(&self, _: &Path) -> bool {
                false
            }
            fn allows_enumeration(&self, _: &Path) -> bool {
                true
            }
        }
        let parent = tempfile::tempdir().unwrap();
        private_acl(parent.path(), "");
        std::fs::write(parent.path().join("existing.txt"), "preserved").unwrap();
        let control = ReadControl::default().with_storage_diagnostics();
        let directory = Directory::open_root(parent.path(), &control).unwrap();
        directory.qualify_ancestor(&control).unwrap();
        directory.qualify_state(true, &control).unwrap();
        for _ in 0..2 {
            let listing = directory
                .entries(parent.path(), &Access, &control, 128)
                .unwrap();
            assert!(listing.complete);
            assert_eq!(listing.entries.len(), 1);
            assert_eq!(listing.entries[0].name, "existing.txt");
            assert!(matches!(listing.entries[0].kind, EntryKind::File));
        }
        assert!(control.storage_failure().is_none());
        assert_eq!(
            std::fs::read(parent.path().join("existing.txt")).unwrap(),
            b"preserved"
        );
        assert!(std::fs::rename(parent.path(), parent.path().with_extension("moved")).is_err());
    }

    #[test]
    fn directory_reopen_refuses_a_regular_file() {
        let file = tempfile::tempfile().unwrap();
        for kind in [OpenKind::PrivateDirectory, OpenKind::Enumerate] {
            assert!(reopen_directory(&file, kind).is_err());
        }
    }

    #[test]
    fn private_acl_allows_creation_and_preserves_installation_identity() {
        let parent = tempfile::tempdir().unwrap();
        private_acl(parent.path(), "");
        let store = crate::LocalMemoryStore::create_private(parent.path(), &ReadControl::default())
            .unwrap();
        let initial = store.initialize().unwrap();
        assert_eq!(
            crate::LocalMemoryStore::open_private(parent.path(), &ReadControl::default())
                .unwrap()
                .load()
                .unwrap(),
            initial
        );
    }

    #[test]
    fn broad_parent_control_is_refused_before_creating_state() {
        let parent = tempfile::tempdir().unwrap();
        private_acl(parent.path(), "(A;;FA;;;WD)");
        let control = ReadControl::default().with_storage_diagnostics();
        assert!(matches!(
            crate::LocalMemoryStore::create_private(parent.path(), &control),
            Err(ReadError::Denied)
        ));
        assert_eq!(
            control.storage_failure().unwrap().stage,
            crate::StorageStage::WindowsGrant
        );
        assert!(!parent
            .path()
            .join(crate::bootstrap::PRIVATE_DIRECTORY)
            .exists());
    }

    #[test]
    fn project_observation_does_not_require_private_storage_acl_qualification() {
        struct ProjectAccess;
        impl MemoryReadAccess for ProjectAccess {
            fn allows_metadata(&self, _: &Path) -> bool {
                true
            }
            fn allows_read(&self, _: &Path) -> bool {
                true
            }
        }
        let parent = tempfile::tempdir().unwrap();
        private_acl(parent.path(), "(A;;FA;;;WD)");
        std::fs::create_dir(parent.path().join(".voktty")).unwrap();
        let document = parent.path().join(".voktty/PROJECT.md");
        std::fs::write(&document, "owner project").unwrap();
        let control = ReadControl::default().with_storage_diagnostics();
        assert!(matches!(
            crate::LocalMemoryStore::create_private(parent.path(), &control),
            Err(ReadError::Denied)
        ));
        assert_eq!(
            control.storage_failure().unwrap().stage,
            crate::StorageStage::WindowsGrant
        );
        let project = crate::ProjectMemoryWorkspace::open(
            parent.path(),
            &ProjectAccess,
            &ReadControl::default(),
        )
        .unwrap();
        let facts = project
            .observe_deployment(Default::default(), &ReadControl::default())
            .unwrap();
        assert!(
            matches!(&facts[".voktty/PROJECT.md"], PathFact::File { text } if text == "owner project")
        );
        assert_eq!(std::fs::read_to_string(document).unwrap(), "owner project");
        assert!(!parent
            .path()
            .join(crate::bootstrap::PRIVATE_DIRECTORY)
            .exists());
    }

    #[test]
    fn broad_child_reads_are_refused_without_repairing_or_deleting_existing_data() {
        let parent = tempfile::tempdir().unwrap();
        private_acl(parent.path(), "");
        let store = crate::LocalMemoryStore::create_private(parent.path(), &ReadControl::default())
            .unwrap();
        let initial = store.initialize().unwrap();
        let child = parent.path().join(crate::bootstrap::PRIVATE_DIRECTORY);
        let before = std::fs::read(child.join("memory-local.json")).unwrap();
        private_acl(&child, "(A;;GR;;;WD)");
        assert!(matches!(
            crate::LocalMemoryStore::open_private(parent.path(), &ReadControl::default()),
            Err(ReadError::Denied)
        ));
        assert_eq!(
            std::fs::read(child.join("memory-local.json")).unwrap(),
            before
        );
        assert_eq!(store.load().unwrap(), initial);
    }

    #[test]
    fn broad_record_or_lock_access_is_refused_inside_an_otherwise_private_directory() {
        for name in ["memory-local.json", "memory-local.lock"] {
            let parent = tempfile::tempdir().unwrap();
            private_acl(parent.path(), "");
            let store =
                crate::LocalMemoryStore::create_private(parent.path(), &ReadControl::default())
                    .unwrap();
            store.initialize().unwrap();
            let root = parent.path().join(crate::bootstrap::PRIVATE_DIRECTORY);
            let before = std::fs::read(root.join("memory-local.json")).unwrap();
            private_acl(&root.join(name), "(A;;GW;;;WD)");
            assert!(matches!(store.load(), Err(crate::StoreError::InvalidStore)));
            assert!(matches!(
                store.initialize(),
                Err(crate::StoreError::InvalidStore)
            ));
            assert_eq!(
                std::fs::read(root.join("memory-local.json")).unwrap(),
                before
            );
        }
    }

    #[test]
    fn application_suffixes_get_private_acls_without_inheriting_broad_parent_reads() {
        let parent = tempfile::tempdir().unwrap();
        private_acl(parent.path(), "(A;OICI;GR;;;WD)");
        let application = parent.path().join("data/application");
        crate::LocalMemoryStore::prepare_application_parent(&application, &ReadControl::default())
            .unwrap();
        let directory = Directory::open_root(&application, &ReadControl::default()).unwrap();
        directory
            .qualify_state(true, &ReadControl::default())
            .unwrap();
        assert!(std::fs::read_dir(&application).unwrap().next().is_none());
        let store =
            crate::LocalMemoryStore::create_private(&application, &ReadControl::default()).unwrap();
        store.initialize().unwrap();
    }

    #[test]
    fn an_unsafe_existing_ancestor_blocks_preparation_before_creating_descendants() {
        let parent = tempfile::tempdir().unwrap();
        private_acl(parent.path(), "");
        let shared = parent.path().join("shared");
        let leaf = shared.join("private");
        std::fs::create_dir_all(&leaf).unwrap();
        private_acl(&shared, "(A;;FA;;;WD)");
        private_acl(&leaf, "");
        assert!(matches!(
            crate::LocalMemoryStore::prepare_application_parent(
                &leaf.join("new"),
                &ReadControl::default()
            ),
            Err(ReadError::Denied)
        ));
        assert!(!leaf.join("new").exists());
    }
}
