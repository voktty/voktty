use super::*;
use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, GENERIC_ALL, GENERIC_WRITE, HANDLE};
use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
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
struct Descriptor(PSECURITY_DESCRIPTOR);
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

pub(super) fn qualify(file: &File, private: bool) -> Result<(), ReadError> {
    let user_storage = user()?;
    let current = unsafe { (*(user_storage.as_ptr().cast::<TOKEN_USER>())).User.Sid };
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
    if status != 0
        || owner.is_null()
        || acl.is_null()
        || unsafe {
            IsValidSid(owner) == 0 || EqualSid(owner, current) == 0 || IsValidAcl(acl) == 0
        }
    {
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
            return Err(ReadError::Denied);
        }
        let ace = unsafe { &*pointer.cast::<ACCESS_ALLOWED_ACE>() };
        let sid = (&ace.SidStart as *const u32).cast_mut().cast();
        if !trusted(sid, current) && (private && ace.Mask != 0 || ace.Mask & destructive != 0) {
            return Err(ReadError::Denied);
        }
    }
    Ok(())
}

impl Directory {
    pub(crate) fn qualify_state(
        &self,
        private: bool,
        control: &ReadControl,
    ) -> Result<(), ReadError> {
        control.check()?;
        let parent = self.ancestors.last().ok_or(ReadError::InvalidInput)?;
        let (file, observed) = open_kind(Some(parent), OsStr::new("."), OpenKind::PrivateDirectory)
            .map_err(|_| ReadError::Denied)?;
        if (observed.volume, observed.id) != self.identity() {
            return Err(ReadError::StaleRoot);
        }
        validate_requested_root(&final_path(&file)?)?;
        qualify(&file, private)?;
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
        assert!(matches!(
            crate::LocalMemoryStore::create_private(parent.path(), &ReadControl::default()),
            Err(ReadError::Denied)
        ));
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
}
