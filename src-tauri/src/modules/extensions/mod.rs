use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ExtensionCommandContrib {
    pub command: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ExtensionKeybindingContrib {
    pub command: String,
    pub key: String,
    #[serde(default)]
    pub mac: Option<String>,
    #[serde(default)]
    pub win: Option<String>,
    #[serde(default)]
    pub linux: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ExtensionAiToolContrib {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ExtensionPanelContrib {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ExtensionLanguageContrib {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ExtensionContributes {
    #[serde(default)]
    pub commands: Vec<ExtensionCommandContrib>,
    #[serde(default)]
    pub keybindings: Vec<ExtensionKeybindingContrib>,
    #[serde(default, rename = "aiTools")]
    pub ai_tools: Vec<ExtensionAiToolContrib>,
    #[serde(default, rename = "agentTools")]
    pub agent_tools: Vec<ExtensionAiToolContrib>,
    #[serde(default)]
    pub panels: Vec<ExtensionPanelContrib>,
    #[serde(default)]
    pub languages: Vec<ExtensionLanguageContrib>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ExtensionPackageJson {
    pub name: String,
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub main: Option<String>,
    #[serde(default)]
    pub contributes: Option<ExtensionContributes>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub publisher: String,
    pub icon: Option<String>,
    pub main: String,
    pub entry_path: String,
    pub folder_path: String,
    pub folder_name: String,
    pub contributes: ExtensionContributes,
}

pub fn get_extensions_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let ext_dir = home.join(".voktty").join("extensions");
    if !ext_dir.exists() {
        fs::create_dir_all(&ext_dir).map_err(|e| e.to_string())?;
    }
    Ok(ext_dir)
}

#[tauri::command]
pub async fn extensions_get_dir() -> Result<String, String> {
    let dir = get_extensions_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn extensions_list() -> Result<Vec<ExtensionInfo>, String> {
    const MAX_EXTENSIONS: usize = 500;
    let ext_dir = get_extensions_dir()?;
    let canonical_root = fs::canonicalize(&ext_dir).map_err(|e| e.to_string())?;
    let mut list = Vec::new();

    let entries = match fs::read_dir(&ext_dir) {
        Ok(e) => e,
        Err(err) => return Err(err.to_string()),
    };

    for entry in entries.flatten().take(MAX_EXTENSIONS) {
        let path = match fs::canonicalize(entry.path()) {
            Ok(path) if path.starts_with(&canonical_root) => path,
            _ => continue,
        };
        if !path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let pkg_path = path.join("package.json");
        if !pkg_path.exists() {
            continue;
        }

        let content = match read_extension_manifest(&pkg_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let pkg: ExtensionPackageJson = match serde_json::from_str(&content) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let publisher = pkg.publisher.unwrap_or_else(|| "community".to_string());
        let id = format!("{}.{}", publisher, pkg.name);
        let display_name = pkg.display_name.unwrap_or_else(|| pkg.name.clone());
        let version = pkg.version.unwrap_or_else(|| "0.1.0".to_string());
        let description = pkg.description.unwrap_or_default();
        let main = pkg.main.unwrap_or_else(|| "dist/extension.js".to_string());
        let entry_path = path.join(&main).to_string_lossy().to_string();
        let contributes = pkg.contributes.unwrap_or_default();

        list.push(ExtensionInfo {
            id,
            name: pkg.name,
            display_name,
            version,
            description,
            publisher,
            icon: pkg.icon,
            main,
            entry_path,
            folder_path: path.to_string_lossy().to_string(),
            folder_name,
            contributes,
        });
    }

    Ok(list)
}

fn read_extension_manifest(path: &Path) -> Result<String, String> {
    const MAX_MANIFEST_BYTES: u64 = 512 * 1024;
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Extension manifest is not a file".to_string());
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("Extension manifest exceeds the 512 KiB limit".to_string());
    }
    fs::read_to_string(path).map_err(|e| format!("Failed to read extension manifest: {e}"))
}

#[tauri::command]
pub async fn extensions_read_code(entry_path: String) -> Result<String, String> {
    let ext_dir = get_extensions_dir()?;
    let path = resolve_extension_entry(Path::new(&entry_path), &ext_dir)?;
    fs::read_to_string(path).map_err(|e| format!("Failed to read extension code: {e}"))
}

fn resolve_extension_entry(path: &Path, extension_dir: &Path) -> Result<PathBuf, String> {
    const MAX_EXTENSION_BYTES: u64 = 2 * 1024 * 1024;
    let root = fs::canonicalize(extension_dir)
        .map_err(|e| format!("Failed to resolve extension directory: {e}"))?;
    let canonical =
        fs::canonicalize(path).map_err(|e| format!("Extension entry file does not exist: {e}"))?;
    if !canonical.starts_with(&root) {
        return Err("Extension entry is outside the extension directory".to_string());
    }
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Extension entry is not a file".to_string());
    }
    if metadata.len() > MAX_EXTENSION_BYTES {
        return Err("Extension entry exceeds the 2 MiB limit".to_string());
    }
    Ok(canonical)
}

#[tauri::command]
pub async fn extensions_open_dir() -> Result<(), String> {
    let dir = get_extensions_dir()?;
    let path_str = dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn extensions_delete(folder_name: String) -> Result<(), String> {
    if folder_name.contains('/') || folder_name.contains('\\') || folder_name.contains("..") {
        return Err("Invalid folder name".to_string());
    }
    let ext_dir = get_extensions_dir()?;
    let target = ext_dir.join(folder_name);
    if target.exists() && target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{read_extension_manifest, resolve_extension_entry};
    use std::fs;

    #[test]
    fn extension_entry_must_remain_inside_extension_directory() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("extensions");
        let extension = root.join("publisher.demo");
        fs::create_dir_all(&extension).unwrap();
        let allowed = extension.join("index.js");
        let denied = temp.path().join("secret.js");
        fs::write(&allowed, "module.exports = {};").unwrap();
        fs::write(&denied, "secret").unwrap();
        assert!(resolve_extension_entry(&allowed, &root).is_ok());
        assert!(resolve_extension_entry(&denied, &root).is_err());
    }

    #[test]
    fn extension_entry_is_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("extensions");
        fs::create_dir_all(&root).unwrap();
        let oversized = root.join("large.js");
        fs::write(&oversized, vec![b'x'; 2 * 1024 * 1024 + 1]).unwrap();
        assert!(resolve_extension_entry(&oversized, &root).is_err());
    }

    #[test]
    fn extension_manifest_is_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let manifest = temp.path().join("package.json");
        fs::write(&manifest, vec![b'x'; 512 * 1024 + 1]).unwrap();
        assert!(read_extension_manifest(&manifest).is_err());
    }
}
