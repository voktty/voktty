use super::*;

#[cfg(any(target_os = "linux", target_os = "android"))]
fn known_local_filesystem(kind: u32) -> bool {
    matches!(
        kind,
        0xef53 | 0x9123683e | 0x01021994 | 0x58465342 | 0x794c7630 | 0x2fc12fc1 | 0xf2f52010
    )
}

impl Directory {
    pub(crate) fn qualify_ancestor(&self, control: &ReadControl) -> Result<(), ReadError> {
        control.check()?;
        let metadata = self.file.metadata().map_err(|_| ReadError::Io)?;
        if (metadata.uid() != 0 && metadata.uid() != unsafe { libc::geteuid() })
            || (metadata.mode() & 0o022 != 0 && metadata.mode() & 0o1000 == 0)
        {
            return Err(ReadError::Denied);
        }
        self.qualify_filesystem(control)
    }

    pub(crate) fn qualify_state(
        &self,
        private: bool,
        control: &ReadControl,
    ) -> Result<(), ReadError> {
        control.check()?;
        let metadata = self.file.metadata().map_err(|_| ReadError::Io)?;
        if !crate::owned_and_not_shared_writable(&metadata)
            || (private && metadata.mode() & 0o077 != 0)
        {
            return Err(ReadError::Denied);
        }
        self.qualify_filesystem(control)
    }

    fn qualify_filesystem(&self, control: &ReadControl) -> Result<(), ReadError> {
        self.qualify_project_filesystem(control)?;
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            crate::apple_acl::restrictive_only(&self.file)?;
            control.check()?;
        }
        Ok(())
    }

    pub(crate) fn qualify_project_filesystem(
        &self,
        control: &ReadControl,
    ) -> Result<(), ReadError> {
        control.check()?;
        let mut filesystem = std::mem::MaybeUninit::<libc::statfs>::uninit();
        if unsafe { libc::fstatfs(self.file.as_raw_fd(), filesystem.as_mut_ptr()) } != 0 {
            return Err(ReadError::Io);
        }
        let filesystem = unsafe { filesystem.assume_init() };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let local = known_local_filesystem(filesystem.f_type as u32);
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        let local = {
            let name = filesystem.f_fstypename.map(|byte| byte as u8);
            let end = name
                .iter()
                .position(|byte| *byte == 0)
                .ok_or(ReadError::Unsupported)?;
            filesystem.f_flags & libc::MNT_LOCAL as u32 != 0
                && matches!(&name[..end], b"apfs" | b"hfs")
        };
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "ios"
        )))]
        let local = false;
        control.check()?;
        if local {
            Ok(())
        } else {
            Err(ReadError::Unsupported)
        }
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "android")))]
mod tests {
    use super::known_local_filesystem;
    #[test]
    fn only_known_local_filesystems_can_store_native_preferences() {
        for kind in [
            0xef53, 0x9123683e, 0x01021994, 0x58465342, 0x794c7630, 0x2fc12fc1, 0xf2f52010,
        ] {
            assert!(known_local_filesystem(kind));
        }
        for kind in [
            0,
            0x6969,
            0xff534d42,
            0x65735546,
            0x517b,
            0x01021997,
            u32::MAX,
        ] {
            assert!(!known_local_filesystem(kind));
        }
    }
}
