use serde::{Deserialize, Serialize};
use tauri::command;
use voktty_aliases::{AliasFile, ResolvedAlias};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasesStateDto {
    pub config_path: String,
    pub effective: Vec<ResolvedAlias>,
    pub user: AliasFile,
    pub preinstalled: AliasFile,
}

#[command]
pub fn aliases_get_config_path() -> Result<String, String> {
    let path = voktty_aliases::config_path()?;
    Ok(path.to_string_lossy().into_owned())
}

#[command]
pub fn aliases_get_state() -> Result<AliasesStateDto, String> {
    let path = voktty_aliases::config_path()?;
    let user = voktty_aliases::load_user(&path).unwrap_or_default();
    let preinstalled = voktty_aliases::preinstalled();
    let effective = voktty_aliases::effective(&user).into_values().collect();

    Ok(AliasesStateDto {
        config_path: path.to_string_lossy().into_owned(),
        effective,
        user,
        preinstalled,
    })
}

#[command]
pub fn aliases_save_user(user: AliasFile) -> Result<AliasesStateDto, String> {
    voktty_aliases::validate(&user)?;
    let path = voktty_aliases::config_path()?;
    voktty_aliases::write_atomic(&path, &user)?;

    // If active process runtime bin directory exists, refresh launchers
    if let Ok(descriptor_path) = crate::modules::control::descriptor_path() {
        if let Some(control_dir) = descriptor_path.parent() {
            let bin_dir = control_dir
                .join("run")
                .join(std::process::id().to_string())
                .join("bin");
            if bin_dir.exists() {
                let _ = crate::modules::control::prepare_alias_launchers(&bin_dir);
            }
        }
    }

    aliases_get_state()
}

#[command]
pub fn aliases_toggle_alias(name: String, enabled: bool) -> Result<AliasesStateDto, String> {
    let path = voktty_aliases::config_path()?;
    let mut user = voktty_aliases::load_user(&path).unwrap_or_default();

    if let Some(def) = user.aliases.get_mut(&name) {
        def.enabled = enabled;
    } else {
        // If it's a preinstalled alias being toggled, copy its definition and update enabled
        let preinstalled = voktty_aliases::preinstalled();
        if let Some(pre) = preinstalled.aliases.get(&name) {
            let mut def = pre.clone();
            def.enabled = enabled;
            user.aliases.insert(name, def);
        } else {
            return Err(format!("alias '{name}' not found"));
        }
    }

    aliases_save_user(user)
}

#[command]
pub fn aliases_reset_alias(name: String) -> Result<AliasesStateDto, String> {
    let path = voktty_aliases::config_path()?;
    let mut user = voktty_aliases::load_user(&path).unwrap_or_default();
    user.aliases.remove(&name);
    aliases_save_user(user)
}
