use crate::ReadError;
use libc::{c_int, c_void};
use std::fs::File;
use std::os::fd::AsRawFd;

const ACL_TYPE_EXTENDED: c_int = 0x100;
const ACL_EXTENDED_DENY: c_int = 2;
const MAX_ENTRIES: c_int = 128;

extern "C" {
    fn acl_get_fd_np(fd: c_int, kind: c_int) -> *mut c_void;
    fn acl_valid(acl: *mut c_void) -> c_int;
    fn acl_get_entry(acl: *mut c_void, index: c_int, entry: *mut *mut c_void) -> c_int;
    fn acl_get_tag_type(entry: *mut c_void, tag: *mut c_int) -> c_int;
    fn acl_free(object: *mut c_void) -> c_int;
}

struct Acl(*mut c_void);
impl Drop for Acl {
    fn drop(&mut self) {
        unsafe { acl_free(self.0) };
    }
}

/// Extended allow entries can override mode bits. Refuse them until their
/// principals and effective permissions have a verified native policy.
pub(crate) fn restrictive_only(file: &File) -> Result<(), ReadError> {
    let pointer = unsafe { acl_get_fd_np(file.as_raw_fd(), ACL_TYPE_EXTENDED) };
    if pointer.is_null() {
        return if std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOENT) {
            Ok(())
        } else {
            Err(ReadError::Unsupported)
        };
    }
    let acl = Acl(pointer);
    if unsafe { acl_valid(acl.0) } != 0 {
        return Err(ReadError::Unsupported);
    }
    for index in 0..=MAX_ENTRIES {
        let mut entry = std::ptr::null_mut();
        if unsafe { acl_get_entry(acl.0, index, &mut entry) } != 0 {
            // Apple's validated, owned ACL uses EINVAL for its end index.
            return if std::io::Error::last_os_error().raw_os_error() == Some(libc::EINVAL) {
                Ok(())
            } else {
                Err(ReadError::Unsupported)
            };
        }
        if index == MAX_ENTRIES {
            return Err(ReadError::Limit);
        }
        let mut tag = 0;
        if entry.is_null()
            || unsafe { acl_get_tag_type(entry, &mut tag) } != 0
            || tag != ACL_EXTENDED_DENY
        {
            return Err(ReadError::Unsupported);
        }
    }
    Err(ReadError::Limit)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::process::Command;

    fn chmod(path: &std::path::Path, args: &[&str]) {
        assert!(Command::new("/bin/chmod")
            .args(args)
            .arg(path)
            .status()
            .unwrap()
            .success());
    }
    struct Clear(std::path::PathBuf);
    impl Drop for Clear {
        fn drop(&mut self) {
            let _ = Command::new("/bin/chmod").arg("-N").arg(&self.0).status();
        }
    }

    #[test]
    fn additional_acl_access_is_not_mistaken_for_private_mode_bits() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let _clear = Clear(dir.path().to_path_buf());
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        chmod(dir.path(), &["+a", "everyone allow write_security"]);
        let file = File::open(dir.path()).unwrap();
        assert!(matches!(
            restrictive_only(&file),
            Err(ReadError::Unsupported)
        ));
        assert_eq!(
            std::fs::metadata(dir.path()).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert!(matches!(
            restrictive_only(&file),
            Err(ReadError::Unsupported)
        ));
    }

    #[test]
    fn a_deny_only_acl_does_not_expand_the_native_permission_grant() {
        let dir = tempfile::tempdir().unwrap();
        let _clear = Clear(dir.path().to_path_buf());
        chmod(dir.path(), &["+a", "everyone deny delete"]);
        assert_eq!(restrictive_only(&File::open(dir.path()).unwrap()), Ok(()));
    }

    #[test]
    fn absent_extended_acl_is_distinct_from_an_unavailable_acl_query() {
        let dir = tempfile::tempdir().unwrap();
        chmod(dir.path(), &["-N"]);
        assert_eq!(restrictive_only(&File::open(dir.path()).unwrap()), Ok(()));
    }
}
