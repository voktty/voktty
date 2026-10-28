use crate::document::js_trim;
use crate::{parse_agent_roster, parse_kit_config, resource, Issue, KitResult, PathCase};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Base,
    Content,
    Link,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RenderedFile {
    pub path: String,
    pub kind: FileKind,
    pub text: String,
}

pub(crate) fn placeholder_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\{([a-z][a-z0-9_]*)\}").expect("Fixed kit placeholder expression")
    })
}

fn metadata(source: &str) -> KitResult<Value> {
    let text = resource(source).ok_or_else(|| vec![Issue::new("KIT_RESOURCE_MISSING", vec![])])?;
    serde_json::from_str(text).map_err(|_| vec![Issue::new("KIT_TEMPLATE_INVALID", vec![])])
}

pub fn render_template(inputs: &Map<String, Value>) -> KitResult<Vec<RenderedFile>> {
    let manifest = metadata("manifest.json")?;
    let definitions = metadata("placeholders.json")?;
    let version = manifest["version"]
        .as_str()
        .ok_or_else(|| vec![Issue::new("KIT_TEMPLATE_INVALID", vec![])])?;
    let mut values = BTreeMap::new();
    for entry in definitions["placeholders"].as_array().into_iter().flatten() {
        let name = entry["name"]
            .as_str()
            .ok_or_else(|| vec![Issue::new("KIT_TEMPLATE_INVALID", vec![])])?;
        let supplied = inputs.get(name);
        if name == "kit_version" && supplied.is_some_and(|value| value.as_str() != Some(version)) {
            return Err(vec![Issue::new("KIT_VALUE_MISMATCH", vec![name.into()])]);
        }
        let value = if name == "kit_version" {
            Some(version)
        } else {
            supplied.unwrap_or(&entry["default"]).as_str()
        }
        .ok_or_else(|| vec![Issue::new("KIT_VALUE_INVALID", vec![name.into()])])?;
        if (entry["required"] == true && js_trim(value).is_empty())
            || value.len() > 16 * 1024
            || value.contains('\0')
            || placeholder_regex().is_match(value)
        {
            return Err(vec![Issue::new("KIT_VALUE_INVALID", vec![name.into()])]);
        }
        values.insert(name.to_owned(), value.to_owned());
    }
    for key in inputs.keys() {
        if !values.contains_key(key) {
            return Err(vec![Issue::new(
                "KIT_VALUE_UNKNOWN",
                vec![key.clone().into()],
            )]);
        }
    }
    let mut rendered = Vec::new();
    let mut total = 0;
    for entry in manifest["files"].as_array().into_iter().flatten() {
        let source = entry["source"]
            .as_str()
            .ok_or_else(|| vec![Issue::new("KIT_TEMPLATE_INVALID", vec![])])?;
        let raw = resource(source)
            .ok_or_else(|| vec![Issue::new("KIT_RESOURCE_MISSING", vec![source.into()])])?;
        let mut text = String::new();
        let mut previous = 0;
        for capture in placeholder_regex().captures_iter(raw) {
            let span = capture.get(0).expect("Kit placeholder match");
            text.push_str(&raw[previous..span.start()]);
            let value = values
                .get(&capture[1])
                .ok_or_else(|| vec![Issue::new("KIT_VALUE_UNKNOWN", vec![capture[1].into()])])?;
            if source.ends_with(".json") {
                let encoded = serde_json::to_string(value)
                    .map_err(|_| vec![Issue::new("KIT_VALUE_INVALID", vec![])])?;
                text.push_str(&encoded[1..encoded.len() - 1]);
            } else {
                text.push_str(value);
            }
            previous = span.end();
        }
        text.push_str(&raw[previous..]);
        total += text.len();
        if text.len() > 256 * 1024 || total > 1024 * 1024 {
            return Err(vec![Issue::new(
                "KIT_TEMPLATE_TOO_LARGE",
                vec![source.into()],
            )]);
        }
        if source.ends_with(".json") {
            crate::document::parse_document(&text)?;
        }
        let path = source
            .strip_prefix("dot-voktty/")
            .map(|path| format!(".voktty/{path}"))
            .or_else(|| source.strip_prefix("root/").map(str::to_owned))
            .ok_or_else(|| vec![Issue::new("KIT_TEMPLATE_INVALID", vec![])])?;
        let kind = serde_json::from_value(entry["kind"].clone())
            .map_err(|_| vec![Issue::new("KIT_TEMPLATE_INVALID", vec![])])?;
        rendered.push(RenderedFile { path, kind, text });
    }
    let config = rendered
        .iter()
        .find(|file| file.path == ".voktty/kit.json")
        .ok_or_else(|| vec![Issue::new("KIT_RESOURCE_MISSING", vec![])])?;
    let config = parse_kit_config(&config.text)?;
    if let Some(roster) = config.get("roster").and_then(Value::as_str) {
        let file = rendered
            .iter()
            .find(|file| file.path == format!(".voktty/{roster}"))
            .ok_or_else(|| vec![Issue::new("KIT_RESOURCE_MISSING", vec![])])?;
        parse_agent_roster(&file.text, PathCase::Insensitive)?;
    }
    Ok(rendered)
}
