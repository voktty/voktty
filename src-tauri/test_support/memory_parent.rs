pub fn memory_parent() -> tempfile::TempDir {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").expect("Windows test profile is available");
    #[cfg(not(windows))]
    let base = std::env::temp_dir();
    let directory = tempfile::tempdir_in(std::fs::canonicalize(base).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    #[cfg(windows)]
    set_current_owner(directory.path());
    directory
}

#[cfg(windows)]
fn set_current_owner(path: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::Authorization::{SetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenUser, OWNER_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = std::ptr::null_mut();
    assert_ne!(
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) },
        0
    );
    let mut length = 0;
    unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut length) };
    assert!((std::mem::size_of::<TOKEN_USER>() as u32..=64 * 1024).contains(&length));
    let mut storage = vec![0u64; (length as usize).div_ceil(8)];
    let success = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            storage.as_mut_ptr().cast(),
            length,
            &mut length,
        )
    };
    unsafe { CloseHandle(token) };
    assert_ne!(success, 0);
    let current = unsafe { (*(storage.as_ptr().cast::<TOKEN_USER>())).User.Sid };
    let mut wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    assert_eq!(
        unsafe {
            SetNamedSecurityInfoW(
                wide.as_mut_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                current,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        },
        0
    );
}
