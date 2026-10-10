use std::fs::File;
use std::io::Read;
use std::path::Path;

const MANIFEST_LIMIT: u64 = 64 * 1024;
const MAX_PACKAGE_ANCESTORS: usize = 6;

pub(super) fn is_pi_npm_package(candidate: &Path) -> bool {
    let Ok(real_path) = std::fs::canonicalize(candidate) else {
        return false;
    };
    let Some(mut directory) = real_path.parent() else {
        return false;
    };

    for _ in 0..MAX_PACKAGE_ANCESTORS {
        if let Ok(name) = read_package_name(&directory.join("package.json")) {
            return name.as_deref().is_some_and(|name| {
                name.eq_ignore_ascii_case("@earendil-works/pi-coding-agent")
                    || name.eq_ignore_ascii_case("@mariozechner/pi-coding-agent")
            });
        }

        let Some(parent) = directory.parent() else {
            return false;
        };
        if parent == directory {
            return false;
        }
        directory = parent;
    }

    false
}

fn read_package_name(path: &Path) -> Result<Option<String>, ()> {
    let file = File::open(path).map_err(|_| ())?;
    let mut contents = Vec::with_capacity(MANIFEST_LIMIT as usize);
    file.take(MANIFEST_LIMIT + 1)
        .read_to_end(&mut contents)
        .map_err(|_| ())?;
    if contents.len() as u64 > MANIFEST_LIMIT {
        return Err(());
    }

    let package: serde_json::Value = serde_json::from_slice(&contents).map_err(|_| ())?;
    Ok(package
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned))
}
