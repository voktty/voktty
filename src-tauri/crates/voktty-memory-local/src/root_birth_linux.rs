use std::fs::{File, Metadata};
use std::os::fd::AsRawFd;
use std::os::unix::fs::MetadataExt;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const REQUIRED: u32 = 0x0001 | 0x0100 | 0x0800; // STATX_TYPE | STATX_INO | STATX_BTIME

// Linux UAPI statx is 256 bytes on every supported architecture. Older musl
// bindings omit it even when the running kernel supports the syscall.
#[repr(C)]
#[derive(Default)]
struct Timestamp {
    seconds: i64,
    nanos: u32,
    reserved: i32,
}

#[repr(C)]
#[derive(Default)]
struct Statx {
    mask: u32,
    block_size: u32,
    attributes: u64,
    links: u32,
    uid: u32,
    gid: u32,
    mode: u16,
    spare: u16,
    inode: u64,
    size: u64,
    blocks: u64,
    attributes_mask: u64,
    accessed: Timestamp,
    birth: Timestamp,
    changed: Timestamp,
    modified: Timestamp,
    rdev_major: u32,
    rdev_minor: u32,
    dev_major: u32,
    dev_minor: u32,
    tail: [u64; 14],
}

const _: () = assert!(std::mem::size_of::<Statx>() == 256);

pub(super) fn read(file: &File, metadata: &Metadata) -> Option<SystemTime> {
    let mut result = Statx::default();
    // AT_EMPTY_PATH reads the retained object, including after a rename. No
    // path lookup or libc statx symbol can redirect or disable this fallback.
    let status = unsafe {
        libc::syscall(
            libc::SYS_statx,
            file.as_raw_fd(),
            c"".as_ptr(),
            libc::AT_EMPTY_PATH | libc::AT_SYMLINK_NOFOLLOW,
            REQUIRED,
            &mut result as *mut Statx,
        )
    };
    if status != 0 {
        return None;
    }
    validated_birth(&result, metadata.dev(), metadata.ino())
}

fn validated_birth(result: &Statx, device: u64, inode: u64) -> Option<SystemTime> {
    if result.mask & REQUIRED != REQUIRED
        || result.mode as libc::mode_t & libc::S_IFMT != libc::S_IFDIR
        || inode == 0
        || result.inode != inode
        || result.dev_major != libc::major(device)
        || result.dev_minor != libc::minor(device)
        || result.birth.nanos >= 1_000_000_000
    {
        return None;
    }
    let seconds = u64::try_from(result.birth.seconds).ok()?;
    let duration = Duration::new(seconds, result.birth.nanos);
    if duration.is_zero() {
        return None;
    }
    UNIX_EPOCH.checked_add(duration)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::ReadControl;
    use crate::reader_unix::Directory;

    fn observation() -> Statx {
        Statx {
            mask: REQUIRED,
            mode: libc::S_IFDIR as u16,
            inode: 42,
            dev_major: 8,
            dev_minor: 1,
            birth: Timestamp {
                seconds: 123,
                nanos: 456,
                ..Timestamp::default()
            },
            ..Statx::default()
        }
    }

    #[test]
    fn kernel_layout_and_birth_precision_match_the_persisted_identity() {
        assert_eq!(std::mem::offset_of!(Statx, inode), 0x20);
        assert_eq!(std::mem::offset_of!(Statx, birth), 0x50);
        assert_eq!(std::mem::offset_of!(Statx, dev_major), 0x88);
        assert_eq!(std::mem::offset_of!(Statx, tail), 0x90);
        assert_eq!(
            validated_birth(&observation(), libc::makedev(8, 1), 42),
            Some(UNIX_EPOCH + Duration::new(123, 456))
        );
    }

    #[test]
    fn absent_fields_wrong_identity_and_invalid_birth_never_supply_an_identity() {
        let device = libc::makedev(8, 1);
        for missing in [0x0001, 0x0100, 0x0800] {
            let mut result = observation();
            result.mask &= !missing;
            assert!(validated_birth(&result, device, 42).is_none());
        }
        for (device, inode) in [
            (device, 0),
            (device, 43),
            (libc::makedev(9, 1), 42),
            (libc::makedev(8, 2), 42),
        ] {
            assert!(validated_birth(&observation(), device, inode).is_none());
        }
        let mut result = observation();
        result.mode = libc::S_IFREG as u16;
        assert!(validated_birth(&result, device, 42).is_none());
        for (seconds, nanos) in [(-1, 0), (0, 0), (123, 1_000_000_000), (123, u32::MAX)] {
            let mut result = observation();
            result.birth.seconds = seconds;
            result.birth.nanos = nanos;
            assert!(validated_birth(&result, device, 42).is_none());
        }
    }

    #[test]
    fn retained_descriptor_birth_survives_rename_without_adopting_a_replacement() {
        let project = tempfile::tempdir_in("/dev/shm").unwrap();
        let root = project.path().join("current");
        std::fs::create_dir(&root).unwrap();
        let file = File::open(&root).unwrap();
        let metadata = file.metadata().unwrap();
        let birth = read(&file, &metadata).expect("tmpfs supports birth time");
        if let Ok(created) = metadata.created() {
            assert_eq!(birth, created);
        }
        let directory = Directory::open_root(&root, &ReadControl::default()).unwrap();
        let bound = directory
            .root_instance()
            .expect("GNU and musl must bind roots");
        assert_eq!(
            serde_json::to_value(bound).unwrap(),
            serde_json::to_value(
                crate::preferences::RootInstance::unix(
                    metadata.dev(),
                    metadata.ino().into(),
                    Some(birth)
                )
                .unwrap()
            )
            .unwrap()
        );
        std::fs::rename(&root, project.path().join("previous")).unwrap();
        std::fs::create_dir(&root).unwrap();
        assert_eq!(read(&file, &metadata), Some(birth));
        let replacement = File::open(&root).unwrap();
        assert!(read(&replacement, &metadata).is_none());
    }
}
