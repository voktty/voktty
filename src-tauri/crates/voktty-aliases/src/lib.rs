use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
const MAX_ALIASES: usize = 256;
const MAX_ARGS: usize = 128;
const MAX_VALUE_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AliasFile {
    pub schema_version: u32,
    #[serde(default)]
    pub aliases: BTreeMap<String, AliasDefinition>,
}

impl Default for AliasFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            aliases: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AliasDefinition {
    #[serde(default)]
    pub description: String,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    #[serde(default)]
    pub disabled_workspaces: Vec<String>,
    #[serde(default)]
    pub disabled_profiles: Vec<String>,
    pub target: AliasTarget,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase", tag = "kind")]
pub enum AliasTarget {
    Command {
        executable: String,
        #[serde(default)]
        args: Vec<String>,
    },
    Builtin {
        action: BuiltinAction,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BuiltinAction {
    Ipme,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AliasSource {
    Preinstalled,
    User,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAlias {
    pub name: String,
    pub source: AliasSource,
    pub definition: AliasDefinition,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AliasContext {
    pub workspace: Option<String>,
    pub profile: Option<String>,
}

impl AliasDefinition {
    pub fn is_enabled(&self, context: &AliasContext) -> bool {
        self.enabled
            && !matches_context(&self.disabled_workspaces, context.workspace.as_deref())
            && !matches_context(&self.disabled_profiles, context.profile.as_deref())
    }
}

pub fn config_path() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|dir| dir.join("voktty").join("aliases.json"))
        .ok_or_else(|| "could not resolve the user configuration directory".to_string())
}

pub fn preinstalled() -> AliasFile {
    let mut aliases = BTreeMap::new();
    aliases.insert(
        "ipme".to_string(),
        AliasDefinition {
            description: "Show local IP addresses and optionally request the public IP".into(),
            enabled: true,
            disabled_workspaces: Vec::new(),
            disabled_profiles: Vec::new(),
            target: AliasTarget::Builtin {
                action: BuiltinAction::Ipme,
            },
        },
    );
    AliasFile {
        schema_version: SCHEMA_VERSION,
        aliases,
    }
}

pub fn load_user(path: &Path) -> Result<AliasFile, String> {
    match fs::read(path) {
        Ok(bytes) => parse(&bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AliasFile::default()),
        Err(error) => Err(format!("could not read {}: {error}", path.display())),
    }
}

pub fn parse(bytes: &[u8]) -> Result<AliasFile, String> {
    let file: AliasFile = serde_json::from_slice(bytes)
        .map_err(|error| format!("invalid alias configuration JSON: {error}"))?;
    validate(&file)?;
    Ok(file)
}

pub fn validate(file: &AliasFile) -> Result<(), String> {
    if file.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported alias schema version {}; expected {SCHEMA_VERSION}",
            file.schema_version
        ));
    }
    if file.aliases.len() > MAX_ALIASES {
        return Err(format!(
            "alias configuration exceeds the {MAX_ALIASES} entry limit"
        ));
    }
    for (name, definition) in &file.aliases {
        validate_name(name)?;
        validate_value("description", &definition.description)?;
        validate_scopes("disabledWorkspaces", &definition.disabled_workspaces)?;
        validate_scopes("disabledProfiles", &definition.disabled_profiles)?;
        if let AliasTarget::Command { executable, args } = &definition.target {
            if executable.trim().is_empty() {
                return Err(format!("alias '{name}' has an empty executable"));
            }
            validate_value("executable", executable)?;
            if args.len() > MAX_ARGS {
                return Err(format!(
                    "alias '{name}' exceeds the {MAX_ARGS} argument limit"
                ));
            }
            for argument in args {
                validate_value("argument", argument)?;
            }
        }
    }
    Ok(())
}

pub fn effective(user: &AliasFile) -> BTreeMap<String, ResolvedAlias> {
    let mut aliases = preinstalled()
        .aliases
        .into_iter()
        .map(|(name, definition)| {
            let resolved = ResolvedAlias {
                name: name.clone(),
                source: AliasSource::Preinstalled,
                definition,
            };
            (name, resolved)
        })
        .collect::<BTreeMap<_, _>>();
    for (name, definition) in &user.aliases {
        aliases.insert(
            name.clone(),
            ResolvedAlias {
                name: name.clone(),
                source: AliasSource::User,
                definition: definition.clone(),
            },
        );
    }
    aliases
}

pub fn resolve(
    user: &AliasFile,
    name: &str,
    context: &AliasContext,
) -> Result<ResolvedAlias, String> {
    let alias = effective(user)
        .remove(name)
        .ok_or_else(|| format!("unknown alias '{name}'"))?;
    if !alias.definition.is_enabled(context) {
        return Err(format!("alias '{name}' is disabled in this context"));
    }
    Ok(alias)
}

pub fn merge(base: &AliasFile, imported: &AliasFile) -> Result<AliasFile, String> {
    validate(base)?;
    validate(imported)?;
    let mut merged = base.clone();
    merged.aliases.extend(imported.aliases.clone());
    validate(&merged)?;
    Ok(merged)
}

pub fn ensure_file(path: &Path) -> Result<AliasFile, String> {
    let file = load_user(path)?;
    if !path.exists() {
        write_atomic(path, &file)?;
    }
    Ok(file)
}

pub fn write_atomic(path: &Path, file: &AliasFile) -> Result<(), String> {
    validate(file)?;
    let parent = path
        .parent()
        .ok_or_else(|| "alias configuration path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("could not create alias configuration: {error}"))?;
    serde_json::to_writer_pretty(&mut temporary, file)
        .map_err(|error| format!("could not serialize alias configuration: {error}"))?;
    temporary
        .write_all(b"\n")
        .map_err(|error| format!("could not write alias configuration: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("could not sync alias configuration: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("could not publish {}: {}", path.display(), error.error))?;
    Ok(())
}

pub fn validate_name(name: &str) -> Result<(), String> {
    let valid_length = !name.is_empty() && name.len() <= 64;
    let mut bytes = name.bytes();
    let valid_first = bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_');
    let valid_rest = bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
    let reserved = matches!(name.to_ascii_lowercase().as_str(), "voktty" | "voktty-cli")
        || is_windows_device_name(name);
    if valid_length && valid_first && valid_rest && !reserved {
        Ok(())
    } else {
        Err(format!("invalid or reserved alias name '{name}'"))
    }
}

fn enabled_by_default() -> bool {
    true
}

fn matches_context(patterns: &[String], value: Option<&str>) -> bool {
    value.is_some_and(|value| patterns.iter().any(|pattern| pattern == value))
}

fn validate_scopes(field: &str, values: &[String]) -> Result<(), String> {
    if values.len() > MAX_ARGS {
        return Err(format!("{field} exceeds the {MAX_ARGS} entry limit"));
    }
    for value in values {
        if value.is_empty() {
            return Err(format!("{field} cannot contain an empty value"));
        }
        validate_value(field, value)?;
    }
    Ok(())
}

fn validate_value(field: &str, value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES || value.contains('\0') {
        Err(format!("{field} is too long or contains a null byte"))
    } else {
        Ok(())
    }
}

fn is_windows_device_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(executable: &str) -> AliasDefinition {
        AliasDefinition {
            description: String::new(),
            enabled: true,
            disabled_workspaces: Vec::new(),
            disabled_profiles: Vec::new(),
            target: AliasTarget::Command {
                executable: executable.into(),
                args: vec!["fixed argument".into()],
            },
        }
    }

    #[test]
    fn user_aliases_override_preinstalled_aliases() {
        let mut user = AliasFile::default();
        user.aliases.insert("ipme".into(), command("custom-ip"));
        let alias = resolve(&user, "ipme", &AliasContext::default()).expect("resolve alias");
        assert_eq!(alias.source, AliasSource::User);
        assert!(matches!(
            alias.definition.target,
            AliasTarget::Command { ref executable, .. } if executable == "custom-ip"
        ));
    }

    #[test]
    fn context_can_disable_an_alias_without_deleting_it() {
        let mut user = AliasFile::default();
        let mut definition = command("tool");
        definition.disabled_workspaces = vec!["private".into()];
        user.aliases.insert("build".into(), definition);
        let context = AliasContext {
            workspace: Some("private".into()),
            profile: None,
        };
        assert!(resolve(&user, "build", &context).is_err());
        assert!(resolve(&user, "build", &AliasContext::default()).is_ok());
    }

    #[test]
    fn schema_rejects_shell_names_and_oversized_arguments() {
        let mut file = AliasFile::default();
        file.aliases.insert("../escape".into(), command("tool"));
        assert!(validate(&file).is_err());
        file.aliases.clear();
        file.aliases.insert("CON".into(), command("tool"));
        assert!(validate(&file).is_err());
    }

    #[test]
    fn import_merges_entries_with_imported_precedence() {
        let mut base = AliasFile::default();
        base.aliases.insert("one".into(), command("old"));
        let mut imported = AliasFile::default();
        imported.aliases.insert("one".into(), command("new"));
        imported.aliases.insert("two".into(), command("second"));
        let merged = merge(&base, &imported).expect("merge aliases");
        assert_eq!(merged.aliases.len(), 2);
        assert!(matches!(
            merged.aliases["one"].target,
            AliasTarget::Command { ref executable, .. } if executable == "new"
        ));
    }

    #[test]
    fn configuration_round_trips_atomically() {
        let temp = tempfile::tempdir().expect("temp directory");
        let path = temp.path().join("aliases.json");
        let mut file = AliasFile::default();
        file.aliases.insert("hello".into(), command("printf"));
        write_atomic(&path, &file).expect("write aliases");
        assert_eq!(load_user(&path).expect("read aliases"), file);

        file.aliases.insert("second".into(), command("echo"));
        write_atomic(&path, &file).expect("replace aliases");
        assert_eq!(load_user(&path).expect("read replaced aliases"), file);
    }
}
