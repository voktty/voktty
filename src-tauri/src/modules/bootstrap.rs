//! Android bootstrap: extracts the official Termux bootstrap archive into
//! the app's private data directory, providing a full Linux environment
//! with bash, coreutils, apt, dpkg, etc.
//!
//! Paths are patched from `com.termux` -> `app.voktty.voktty` so binaries
//! and scripts reference the correct locations.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

const MARKER: &str = ".voktty_bootstrapped";
const MARKER_VERSION: &str = "voktty-android-bootstrap-termux-v1";

// The Termux bootstrap zip is embedded at compile time.
// It contains bash, coreutils, apt, dpkg, shared libs, etc.
// The correct architecture-specific zip is selected via cfg(target_arch).
// IMPORTANT: Store outside gen/ - Tauri regenerates gen/ on each build!
#[cfg(target_arch = "aarch64")]
const BOOTSTRAP_ZIP: &[u8] =
    include_bytes!("../../bootstrap-zips/bootstrap-aarch64.zip");

#[cfg(target_arch = "x86_64")]
const BOOTSTRAP_ZIP: &[u8] =
    include_bytes!("../../bootstrap-zips/bootstrap-x86_64.zip");

#[cfg(target_arch = "arm")]
const BOOTSTRAP_ZIP: &[u8] =
    include_bytes!("../../bootstrap-zips/bootstrap-arm.zip");

#[cfg(target_arch = "x86")]
const BOOTSTRAP_ZIP: &[u8] =
    include_bytes!("../../bootstrap-zips/bootstrap-i686.zip");

/// The original Termux prefix path baked into all bootstrap binaries.
/// ELF binaries keep this path - we translate at runtime via LD_PRELOAD.
const OLD_TERMUX_FILES: &str = "/data/data/com.termux/files";

// -- Directory layout ------------------------------------------------

pub fn rootfs_dir() -> PathBuf {
    // On Android, dirs::home_dir() is unreliable - it may return the Termux
    // HOME path (/data/data/<pkg>/files/home) if HOME is already set from a
    // previous bootstrap. This causes a double "files" in the path.
    // Hardcode the app data directory instead.
    PathBuf::from("/data/data/app.voktty.voktty/files")
}

pub fn prefix_dir() -> PathBuf {
    rootfs_dir().join("usr")
}

pub fn home_dir() -> PathBuf {
    rootfs_dir().join("home")
}

pub fn bin_dir() -> PathBuf {
    prefix_dir().join("bin")
}

pub fn lib_dir() -> PathBuf {
    prefix_dir().join("lib")
}

pub fn tmp_dir() -> PathBuf {
    prefix_dir().join("tmp")
}

/// App-level cache dir: /data/data/app.voktty.voktty/cache/
/// apt stores downloaded packages here (NOT under files/usr/)
fn app_cache_dir() -> PathBuf {
    PathBuf::from("/data/data/app.voktty.voktty/cache")
}

pub fn etc_dir() -> PathBuf {
    prefix_dir().join("etc")
}

pub fn shell_path() -> String {
    format!(
        "{}:{}:/system/bin:/system/xbin",
        bin_dir().display(),
        prefix_dir().display()
    )
}

/// Return the path to the bash binary.
pub fn bash_path() -> PathBuf {
    bin_dir().join("bash")
}

// -- Bootstrap -------------------------------------------------------

pub fn ensure_bootstrapped(app: Option<&tauri::AppHandle>) -> Result<(), String> {
    let rootfs = rootfs_dir();
    let marker = rootfs.join(MARKER);

    log::info!("bootstrap: rootfs = {}", rootfs.display());
    log::info!("bootstrap: prefix = {}", prefix_dir().display());
    log::info!("bootstrap: embedded zip size = {} bytes", BOOTSTRAP_ZIP.len());
    emit_progress(app, "Checking...", 0, 0);

    let need_bootstrap = match fs::read_to_string(&marker) {
        Ok(v) => v.trim() != MARKER_VERSION,
        Err(_) => true,
    };

    let bash = bash_path();
    let bash_exists = bash.exists();
    if !need_bootstrap && !bash_exists {
        log::warn!(
            "bootstrap: marker says v{} but bash not found at {} - re-bootstrapping",
            MARKER_VERSION, bash.display()
        );
    }
    let need_bootstrap = need_bootstrap || !bash_exists;

    if need_bootstrap {
        emit_progress(app, "Setting up directories...", 0, 1);
        log::info!(
            "bootstrap: setting up Termux environment v{} at {}",
            MARKER_VERSION, rootfs.display()
        );

        for dir in &[&rootfs, &home_dir(), &prefix_dir(), &tmp_dir()] {
            fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
        }

        for sub in &["apt/archives/partial", "apt/archives"] {
            let d = app_cache_dir().join(sub);
            fs::create_dir_all(&d).map_err(|e| format!("mkdir {}: {e}", d.display()))?;
        }

        emit_progress(app, "Extracting bootstrap archive...", 0, 3650);
        log::info!("bootstrap: starting extraction...");
        extract_bootstrap(app)?;
        log::info!("bootstrap: extraction complete, bash exists = {}", bash_path().exists());

        emit_progress(app, "Creating symlinks...", 0, 0);
        for sub in &[
            "var/lib/apt/lists/partial",
            "var/lib/apt/lists",
            "var/cache/apt/archives/partial",
            "var/cache/apt/archives",
            "var/lib/dpkg/updates",
            "var/lib/dpkg/info",
            "var/lib/dpkg/parts",
            "var/lib/dpkg/triggers",
            "var/cache/debconf",
            "var/log/apt",
            "etc/apt/sources.list.d",
            "etc/apt/preferences.d",
            "etc/apt/trusted.gpg.d",
            "etc/logrotate.d",
        ] {
            let d = prefix_dir().join(sub);
            fs::create_dir_all(&d).map_err(|e| format!("mkdir {}: {e}", d.display()))?;
        }

        process_symlinks()?;
        emit_progress(app, "Patching binaries...", 0, 0);
        patch_scripts()?;
        patch_elf_runpaths()?;
        write_apt_config()?;
        write_sources_list()?;
        patch_pkg_script()?;
        cleanup_gpg_keyrings()?;
        write_shell_profile()?;
        install_path_translator()?;

        fs::write(&marker, MARKER_VERSION)
            .map_err(|e| format!("write marker: {e}"))?;
    } else {
        log::info!("bootstrap: already done (marker exists)");
    }

    fix_exec_permissions()?;
    emit_progress(app, "Ready!", 1, 1);
    log::info!("bootstrap: complete!");
    Ok(())
}

/// Emit bootstrap progress to the frontend.
fn emit_progress(app: Option<&tauri::AppHandle>, message: &str, current: usize, total: usize) {
    use serde::Serialize;
    use tauri::Emitter;
    #[derive(Serialize, Clone)]
    struct Progress<'a> {
        message: &'a str,
        current: usize,
        total: usize,
    }
    if let Some(handle) = app {
        let _ = handle.emit("voktty:bootstrap-progress", Progress { message, current, total });
    }
}

/// Extract the embedded bootstrap zip into $PREFIX.
fn extract_bootstrap(app: Option<&tauri::AppHandle>) -> Result<(), String> {
    let prefix = prefix_dir();
    let cursor = std::io::Cursor::new(BOOTSTRAP_ZIP);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("open bootstrap zip: {e}"))?;

    let total_files = archive.len();
    log::info!("bootstrap: extracting {total_files} files to {}", prefix.display());

    let mut extracted = 0usize;
    for i in 0..total_files {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {i}: {e}"))?;

        let name = file.name().to_string();

        // SYMLINKS.txt is handled separately
        if name == "SYMLINKS.txt" {
            continue;
        }

        let outpath = match name.strip_prefix('/') {
            Some(s) => PathBuf::from(s),
            None => PathBuf::from(&name),
        };
        let outpath = prefix.join(&outpath);

        if file.is_dir() {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("mkdir {}: {e}", outpath.display()))?;
            continue;
        }

        // Create parent directories
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir parent {}: {e}", parent.display()))?;
        }

        // Extract the file
        let mut buffer = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut buffer)
            .map_err(|e| format!("read {}: {e}", name))?;

        let mut f = fs::File::create(&outpath)
            .map_err(|e| format!("create {}: {e}", outpath.display()))?;
        f.write_all(&buffer)
            .map_err(|e| format!("write {}: {e}", outpath.display()))?;
        f.sync_all().ok();

        // Set executable for binaries
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if name.starts_with("bin/")
                || name.starts_with("lib/apt/methods/")
                || name.starts_with("lib/apt/solvers/")
                || name.starts_with("lib/apt/planners/")
                || name.starts_with("lib/dpkg/")
                || name.starts_with("libexec/")
            {
                let _ = fs::set_permissions(&outpath, fs::Permissions::from_mode(0o755));
            }
        }

        extracted += 1;
        if extracted % 200 == 0 {
            log::info!("bootstrap: extracted {extracted}/{total_files} files...");
            emit_progress(app, "Extracting packages...", extracted, total_files);
        }
    }

    log::info!("bootstrap: extracted {extracted} files");
    Ok(())
}

/// Read SYMLINKS.txt from the bootstrap zip, patch paths, and create symlinks.
fn process_symlinks() -> Result<(), String> {
    let prefix = prefix_dir();
    let our_rootfs = rootfs_dir().display().to_string();

    // Read SYMLINKS.txt from the zip
    let cursor = std::io::Cursor::new(BOOTSTRAP_ZIP);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("open zip for symlinks: {e}"))?;
    let mut file = archive
        .by_name("SYMLINKS.txt")
        .map_err(|e| format!("read SYMLINKS.txt: {e}"))?;

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("read SYMLINKS.txt: {e}"))?;

    let mut created = 0usize;
    let mut skipped = 0usize;

    for line in content.lines() {
        // Format: target<-source
        // source is where the symlink is created (relative to prefix)
        // target is what the symlink points to
        let parts: Vec<&str> = line.splitn(2, '\u{2190}').collect(); // <- is U+2190
        if parts.len() != 2 {
            // Try ASCII fallback
            let parts: Vec<&str> = line.splitn(2, '<').collect();
            if parts.len() != 2 {
                skipped += 1;
                continue;
            }
            process_symlink_entry(parts[0], parts[1], &prefix, &our_rootfs, &mut created)?;
        } else {
            process_symlink_entry(parts[0], parts[1], &prefix, &our_rootfs, &mut created)?;
        }
    }

    log::info!("bootstrap: created {created} symlinks ({skipped} skipped)");
    Ok(())
}

fn process_symlink_entry(
    target: &str,
    source: &str,
    prefix: &Path,
    our_rootfs: &str,
    created: &mut usize,
) -> Result<(), String> {
    // Patch paths: replace com.termux with our package
    let target = target.replace(OLD_TERMUX_FILES, our_rootfs);
    let source = source.replace(OLD_TERMUX_FILES, our_rootfs);

    // Resolve the link path (where the symlink is created)
    let link_path = if source.starts_with("./") {
        prefix.join(&source[2..])
    } else if source.starts_with('/') {
        PathBuf::from(&source)
    } else {
        prefix.join(&source)
    };

    // Resolve the target (what the symlink points to)
    let target_path = if target.starts_with('/') {
        PathBuf::from(&target)
    } else {
        // Relative to the link's parent directory
        match link_path.parent() {
            Some(p) => p.join(&target),
            None => PathBuf::from(&target),
        }
    };

    // Create parent directory if needed
    if let Some(parent) = link_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Skip if symlink already exists
    if link_path.exists() || link_path.is_symlink() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        if std::os::unix::fs::symlink(&target_path, &link_path).is_ok() {
            *created += 1;
        }
    }

    Ok(())
}

/// Patch text scripts to replace com.termux paths.
/// ELF binaries are handled at runtime by the LD_PRELOAD path translator.
fn patch_scripts() -> Result<(), String> {
    let our_rootfs = rootfs_dir().display().to_string();
    let prefix = prefix_dir();
    let mut patched = 0usize;

    patch_text_files(&prefix, &our_rootfs, &mut patched);
    log::info!("bootstrap: patched {patched} text files");
    Ok(())
}

fn patch_text_files(dir: &Path, our_rootfs: &str, count: &mut usize) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_symlink() {
            continue;
        }
        if path.is_dir() {
            patch_text_files(&path, our_rootfs, count);
            continue;
        }
        if !path.is_file() {
            continue;
        }

        // Read as bytes, check if it's text (not ELF)
        let data = match fs::read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };

        // Skip ELF binaries (handled by LD_PRELOAD)
        if data.len() >= 4 && data[0] == 0x7f && data[1] == b'E' && data[2] == b'L' && data[3] == b'F' {
            continue;
        }

        // Try as text
        if let Ok(text) = std::str::from_utf8(&data) {
            if text.contains(OLD_TERMUX_FILES) {
                let patched_text = text.replace(OLD_TERMUX_FILES, our_rootfs);
                let _ = fs::write(&path, patched_text);
                *count += 1;
            }
        }
    }
}

/// Patch DT_RUNPATH in all ELF binaries to remove com.termux paths.
fn patch_elf_runpaths() -> Result<(), String> {
    let prefix = prefix_dir();
    let mut patched = 0usize;
    patch_runpaths_recursive(&prefix, &mut patched);
    log::info!("bootstrap: cleared DT_RUNPATH in {patched} ELF binaries");
    Ok(())
}

fn patch_runpaths_recursive(dir: &Path, count: &mut usize) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_symlink() {
            continue;
        }
        if path.is_dir() {
            patch_runpaths_recursive(&path, count);
            continue;
        }
        if !path.is_file() {
            continue;
        }

        let mut data = match fs::read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };

        if patch_elf_runpath(&mut data) {
            let _ = fs::write(&path, &data);
            *count += 1;
        }
    }
}

/// Patch a single ELF binary's DT_RUNPATH. Returns true if modified.
fn patch_elf_runpath(data: &mut Vec<u8>) -> bool {
    // Check ELF magic + 64-bit
    if data.len() < 64 || &data[0..4] != b"\x7fELF" || data[4] != 2 {
        return false;
    }

    // Parse ELF64 header
    let e_phoff = u64::from_le_bytes(data[32..40].try_into().unwrap()) as usize;
    let e_phentsize = u16::from_le_bytes(data[54..56].try_into().unwrap()) as usize;
    let e_phnum = u16::from_le_bytes(data[56..58].try_into().unwrap()) as usize;
    if e_phoff == 0 || e_phnum == 0 || e_phentsize < 56 {
        return false;
    }

    // Find PT_DYNAMIC program header
    let mut dyn_off = None;
    let mut dyn_sz = None;
    for i in 0..e_phnum {
        let off = e_phoff + i * e_phentsize;
        if off + 56 > data.len() {
            break;
        }
        let p_type = u32::from_le_bytes(data[off..off + 4].try_into().unwrap());
        if p_type == 2 {
            // PT_DYNAMIC
            dyn_off = Some(u64::from_le_bytes(data[off + 8..off + 16].try_into().unwrap()) as usize);
            dyn_sz = Some(u64::from_le_bytes(data[off + 32..off + 40].try_into().unwrap()) as usize);
            break;
        }
    }

    let (dyn_off, dyn_sz) = match (dyn_off, dyn_sz) {
        (Some(o), Some(s)) if o + s <= data.len() => (o, s),
        _ => return false,
    };

    let mut runpath_entries: Vec<usize> = Vec::new();

    let num_entries = dyn_sz / 16;
    for i in 0..num_entries {
        let off = dyn_off + i * 16;
        if off + 16 > data.len() {
            break;
        }
        let d_tag = i64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        if d_tag == 0 {
            break; // DT_NULL
        }

        if d_tag == 0x1d || d_tag == 0x0f {
            // DT_RUNPATH or DT_RPATH
            runpath_entries.push(off);
        }
    }

    if runpath_entries.is_empty() {
        return false;
    }

    for off in &runpath_entries {
        data[off + 8..off + 16].copy_from_slice(&0u64.to_le_bytes());
    }

    true
}

/// Write apt config override.
fn write_apt_config() -> Result<(), String> {
    let prefix = prefix_dir().display().to_string();
    let conf_dir = prefix_dir().join("etc/apt/apt.conf.d");
    fs::create_dir_all(&conf_dir)
        .map_err(|e| format!("mkdir apt.conf.d: {e}"))?;

    let conf = format!(
        r#"// Voktty apt config overrides
Dir::Bin::methods "{prefix}/lib/apt/methods";
Acquire::AllowInsecureRepositories "true";
Acquire::AllowDowngradeToInsecureRepositories "true";
"#,
    );
    let conf_path = conf_dir.join("99voktty");
    fs::write(&conf_path, conf)
        .map_err(|e| format!("write apt config: {e}"))?;

    log::info!("bootstrap: wrote apt config override");
    Ok(())
}

/// Remove old-format GPG keyring files that gpgv 2.5.17 reports as unsupported filetype.
fn cleanup_gpg_keyrings() -> Result<(), String> {
    let trusted_dir = prefix_dir().join("etc/apt/trusted.gpg.d");

    if !trusted_dir.is_dir() {
        return Ok(());
    }

    let mut removed = 0;
    let entries = match fs::read_dir(&trusted_dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();

        if name.ends_with(".gpg") {
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }

    log::info!("bootstrap: removed {removed} old-format GPG keyring files");
    Ok(())
}

/// Write sources.list with [trusted=yes] so apt doesn't reject repos.
fn write_sources_list() -> Result<(), String> {
    let sources_path = prefix_dir().join("etc/apt/sources.list");

    let content =
        "deb [trusted=yes] https://packages-cf.termux.dev/apt/termux-main stable main\n";

    fs::write(&sources_path, content)
        .map_err(|e| format!("write sources.list: {e}"))?;

    log::info!("bootstrap: wrote sources.list with [trusted=yes]");
    Ok(())
}

/// Patch the `pkg` script to always add [trusted=yes] when it writes mirrors.
fn patch_pkg_script() -> Result<(), String> {
    let pkg_path = bin_dir().join("pkg");

    let content = match fs::read_to_string(&pkg_path) {
        Ok(c) => c,
        Err(_) => {
            log::warn!("bootstrap: pkg script not found, skipping patch");
            return Ok(());
        }
    };

    let patched = content
        .replace("deb ${", "deb [trusted=yes] ${")
        .replace("deb $mirror", "deb [trusted=yes] $mirror")
        .replace("deb $url", "deb [trusted=yes] $url")
        .replace("\"deb ", "\"deb [trusted=yes] ")
        .replace("'deb ", "'deb [trusted=yes] ");

    if patched != content {
        fs::write(&pkg_path, &patched)
            .map_err(|e| format!("patch pkg: {e}"))?;
        log::info!("bootstrap: patched pkg script with [trusted=yes]");
    }

    let termux_tools_dir = prefix_dir().join("share/termux");
    patch_scripts_trusted(&termux_tools_dir);

    Ok(())
}

fn patch_scripts_trusted(dir: &Path) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_symlink() {
            continue;
        }
        if path.is_dir() {
            patch_scripts_trusted(&path);
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if !content.contains("deb ") || content.contains("[trusted=yes]") {
            continue;
        }

        let patched = content
            .replace("deb ${", "deb [trusted=yes] ${")
            .replace("deb $mirror", "deb [trusted=yes] $mirror")
            .replace("deb $url", "deb [trusted=yes] $url")
            .replace("\"deb ", "\"deb [trusted=yes] ")
            .replace("'deb ", "'deb [trusted=yes] ");

        if patched != content {
            let _ = fs::write(&path, &patched);
        }
    }
}

/// Write shell profile (.profile, .bashrc) with proper environment.
fn write_shell_profile() -> Result<(), String> {
    let prefix = prefix_dir().display().to_string();

    let profile_content = format!(
        r#"# Voktty Android shell profile (Termux bootstrap)
# Auto-generated - do not edit unless you know what you're doing.

# Environment
export HOME={home}
export PREFIX={prefix}
export PATH={path}
export TMPDIR={tmpdir}
export TERM=xterm-256color
export COLORTERM=truecolor
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Library path - so dynamically linked binaries find their .so files
export LD_LIBRARY_PATH={libdir}

# LD_PRELOAD: path translator - makes Termux binaries work with our package name
if [ -f "{libdir}/libvoktty-path-translate.so" ]; then
    export LD_PRELOAD="{libdir}/libvoktty-path-translate.so"
fi

# Terminfo
export TERMINFO={prefix}/share/terminfo
export TERMINFO_DIRS={prefix}/share/terminfo

# dpkg admin directory override
export DPKG_ADMINDIR={prefix}/var/lib/dpkg

# Aliases
alias ll='ls -la'
alias la='ls -a'
alias l='ls -CF'
alias ..='cd ..'
alias ...='cd ../..'
alias grep='grep --color=auto'
alias pkg='apt'

# motd
if [ -f "$PREFIX/etc/motd" ]; then
    cat "$PREFIX/etc/motd" 2>/dev/null
fi
"#,
        home = home_dir().display(),
        prefix = prefix,
        path = shell_path(),
        tmpdir = tmp_dir().display(),
        libdir = lib_dir().display(),
    );

    let profile = home_dir().join(".profile");
    fs::write(&profile, &profile_content)
        .map_err(|e| format!("write .profile: {e}"))?;

    let bashrc = home_dir().join(".bashrc");
    if !bashrc.exists() {
        fs::write(&bashrc, "# Source profile\n. \"$HOME/.profile\"\n")
            .map_err(|e| format!("write .bashrc: {e}"))?;
    }

    let motd = etc_dir().join("motd");
    if !motd.exists() {
        let _ = fs::write(&motd, "Welcome to Voktty on Android\n");
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let sdcard = Path::new("/sdcard");
        let sdcard_link = home_dir().join("sdcard");
        if sdcard.exists() && fs::read_dir(sdcard).is_ok() {
            if !sdcard_link.exists() {
                let _ = symlink(sdcard, &sdcard_link);
            }
        } else if sdcard_link.exists() || fs::symlink_metadata(&sdcard_link).is_ok() {
            let _ = fs::remove_file(&sdcard_link);
        }

        let storage = Path::new("/storage/emulated/0");
        let storage_link = home_dir().join("storage");
        if storage.exists() && fs::read_dir(storage).is_ok() {
            if !storage_link.exists() {
                let _ = symlink(storage, &storage_link);
            }
        } else if storage_link.exists() || fs::symlink_metadata(&storage_link).is_ok() {
            let _ = fs::remove_file(&storage_link);
        }
    }

    log::info!("bootstrap: shell profile written");
    Ok(())
}

/// Fix executable permissions on all binaries in bin/.
fn fix_exec_permissions() -> Result<(), String> {
    #[cfg(unix)]
    {
        let prefix = prefix_dir();
        fix_dir_permissions_recursive(&prefix);
        let mut fixed = 0usize;
        chmod_elfs(&prefix, &mut fixed);
        log::info!("bootstrap: chmod 0o755 on {fixed} ELF binaries");
    }
    Ok(())
}

fn chmod_elfs(dir: &Path, count: &mut usize) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_symlink() {
                continue;
            }
            if path.is_dir() {
                chmod_elfs(&path, count);
                continue;
            }
            if !path.is_file() {
                continue;
            }

            let mut magic = [0u8; 4];
            let mut f = match fs::File::open(&path) {
                Ok(f) => f,
                Err(_) => continue,
            };
            if std::io::Read::read_exact(&mut f, &mut magic).is_err() {
                continue;
            }
            if magic != [0x7f, b'E', b'L', b'F'] {
                continue;
            }

            if fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).is_ok() {
                *count += 1;
            }
        }
    }
}

fn fix_dir_permissions_recursive(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if !dir.is_dir() {
            return;
        }

        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o755));

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && !path.is_symlink() {
                    fix_dir_permissions_recursive(&path);
                }
            }
        }
    }
}

/// Copy the LD_PRELOAD path translation library from the native lib dir
/// to $PREFIX/lib/ so it can be loaded via LD_PRELOAD.
fn install_path_translator() -> Result<(), String> {
    let dest = lib_dir().join("libvoktty-path-translate.so");

    if dest.exists() {
        return Ok(());
    }

    let native_dir = find_native_lib_dir();
    if let Some(ref dir) = native_dir {
        let src = dir.join("libvoktty-path-translate.so");
        if src.exists() {
            fs::create_dir_all(lib_dir())
                .map_err(|e| format!("mkdir lib: {e}"))?;
            fs::copy(&src, &dest)
                .map_err(|e| format!("copy path-translate.so: {e}"))?;
            log::info!("bootstrap: installed path translator to {}", dest.display());

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(0o755));
            }
            return Ok(());
        }
    }

    log::warn!("bootstrap: could not find libvoktty-path-translate.so in native lib dir");
    Ok(())
}

fn find_native_lib_dir() -> Option<PathBuf> {
    if let Ok(maps) = fs::read_to_string("/proc/self/maps") {
        for line in maps.lines() {
            if line.contains("libvoktty_lib.so") || line.contains("libvoktty-path-translate") {
                if let Some(path) = line.split_whitespace().last() {
                    if let Some(parent) = Path::new(path).parent() {
                        return Some(parent.to_path_buf());
                    }
                }
            }
        }
    }

    let pkg = "app.voktty.voktty";
    for arch in &["arm64", "arm64-v8a", "x86_64", "x86", "arm", "armeabi-v7a"] {
        if let Ok(entries) = fs::read_dir("/data/app") {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(pkg) {
                    let lib_dir = entry.path().join("lib").join(arch);
                    if lib_dir.is_dir() {
                        return Some(lib_dir);
                    }
                }
            }
        }
    }

    None
}

/// Force re-bootstrap by removing the marker file.
#[allow(dead_code)]
pub fn force_rebootstrap() -> io::Result<()> {
    let marker = rootfs_dir().join(MARKER);
    if marker.exists() {
        fs::remove_file(&marker)?;
    }
    Ok(())
}
