use crate::document::{js_trim, parse_document_with_limit};
use crate::template::placeholder_regex;
use crate::validation::{validate_structure, Contract};
use crate::{
    evaluate_memory_use, memory_project_key, parse_kit_config, resource, Issue, KitResult,
    MemoryUseDecision,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const HEADER: &str =
    include_str!("../../../../templates/workspace-kit/contracts/memory-context-header.txt");
const MAX_PACKET_BYTES: usize = 24 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InstructionRecord {
    pub path: String,
    pub kind: &'static str,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InstructionFingerprint {
    pub schema: u8,
    pub role: Option<String>,
    pub files: Vec<InstructionRecord>,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryContextPacket {
    pub schema: u8,
    pub project_key: String,
    pub instruction_digest: String,
    pub digest: String,
    pub bytes: usize,
    pub content_state: &'static str,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MemoryContextResult {
    pub schema: u8,
    pub decision: MemoryUseDecision,
    pub packet: Option<MemoryContextPacket>,
}

fn issue(code: &'static str) -> Vec<Issue> {
    vec![Issue::new(code, vec![])]
}
fn encoded(value: &impl Serialize) -> KitResult<String> {
    serde_json::to_string(value).map_err(|_| issue("KIT_CONTEXT_TEXT_INVALID"))
}
fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn text(fact: &Value) -> Option<&str> {
    if fact["kind"] == "file" {
        fact["text"].as_str()
    } else {
        None
    }
}
fn bounded_text(text: &str) -> KitResult<usize> {
    if text.contains('\0') {
        return Err(issue("KIT_CONTEXT_TEXT_INVALID"));
    }
    if text.len() > 256 * 1024 {
        return Err(issue("KIT_CONTEXT_TEXT_TOO_LARGE"));
    }
    Ok(text.len())
}
fn manifest() -> Value {
    serde_json::from_str(resource("manifest.json").expect("embedded manifest"))
        .expect("validated manifest")
}

fn fingerprint(snapshot: &Value) -> KitResult<InstructionFingerprint> {
    let manifest = manifest();
    let mut required: BTreeSet<_> = manifest["files"]
        .as_array()
        .expect("manifest files")
        .iter()
        .filter(|file| file["kind"] == "base")
        .map(|file| {
            format!(
                ".voktty/{}",
                file["source"]
                    .as_str()
                    .expect("manifest source")
                    .strip_prefix("dot-voktty/")
                    .expect("base source")
            )
        })
        .collect();
    let role = snapshot["role"].as_str().map(str::to_owned);
    if let Some(role) = &role {
        required.insert(role.clone());
    }
    let mut allowed = required.clone();
    allowed.extend(["AGENTS.md".into(), "CLAUDE.md".into()]);
    let mut seen = BTreeSet::new();
    let mut observed = BTreeMap::new();
    let mut total = 0;
    for (index, entry) in snapshot["files"]
        .as_array()
        .expect("validated files")
        .iter()
        .enumerate()
    {
        let path = entry["path"].as_str().unwrap_or_default();
        let fact = &entry["fact"];
        if !allowed.contains(path) || !seen.insert(path) {
            return Err(vec![Issue::new(
                "KIT_INSTRUCTION_INVENTORY",
                vec!["files".into(), index.into(), "path".into()],
            )]);
        }
        if fact["kind"] == "blocked" || (required.contains(path) && fact["kind"] != "file") {
            return Err(vec![Issue::new(
                "KIT_INSTRUCTION_UNAVAILABLE",
                vec!["files".into(), index.into()],
            )]);
        }
        if let Some(text) = text(fact) {
            total += bounded_text(text)?;
        }
        observed.insert(path, fact);
    }
    if seen.len() != allowed.len() {
        return Err(vec![Issue::new(
            "KIT_INSTRUCTION_INVENTORY",
            vec!["files".into()],
        )]);
    }
    if total > 1024 * 1024 {
        return Err(issue("KIT_CONTEXT_TEXT_TOO_LARGE"));
    }
    let files: Vec<_> = observed
        .into_iter()
        .map(|(path, fact)| InstructionRecord {
            path: path.into(),
            kind: if text(fact).is_some() {
                "file"
            } else {
                "absent"
            },
            sha256: text(fact).map(|text| digest(text.as_bytes())),
        })
        .collect();
    let mut fields = vec![role.clone().unwrap_or_default(), files.len().to_string()];
    for file in &files {
        fields.extend([
            file.path.clone(),
            file.kind.into(),
            file.sha256.clone().unwrap_or_default(),
        ]);
    }
    let mut hash = Sha256::new();
    hash.update(b"voktty-memory-instructions-v1\0");
    for field in fields {
        hash.update((field.len() as u32).to_be_bytes());
        hash.update(field.as_bytes());
    }
    Ok(InstructionFingerprint {
        schema: 1,
        role,
        files,
        digest: hex::encode(hash.finalize()),
    })
}

pub fn instruction_fingerprint(text: &str) -> KitResult<InstructionFingerprint> {
    let input = parse_document_with_limit(text, 2 * 1024 * 1024)?;
    validate_structure(&input, Contract::MemoryInstructions)?;
    fingerprint(&input)
}

#[derive(Serialize)]
struct Section {
    path: String,
    mode: &'static str,
    text: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Body {
    schema: u8,
    project_key: String,
    root: String,
    project: String,
    language: String,
    instruction_digest: String,
    role: Option<String>,
    content_state: &'static str,
    pointers: Vec<String>,
    warnings: Vec<&'static str>,
    sections: Vec<Section>,
}
fn packet_text(body: &Body) -> KitResult<String> {
    Ok(format!("{HEADER}{}", encoded(body)?))
}
fn prefix_for_json(text: &str, limit: usize) -> String {
    let mut used = 2;
    let mut output = String::new();
    for scalar in text.chars() {
        let size = match scalar {
            '"' | '\\' | '\u{0008}' | '\t' | '\n' | '\u{000c}' | '\r' => 2,
            c if c < '\u{0020}' => 6,
            c => c.len_utf8(),
        };
        if used + size > limit {
            break;
        }
        used += size;
        output.push(scalar);
    }
    output
}

pub fn build_memory_context(source: &str) -> KitResult<MemoryContextResult> {
    let input = parse_document_with_limit(source, 4 * 1024 * 1024)?;
    validate_structure(&input, Contract::MemoryContext)?;
    let mut use_facts = input["use"].clone();
    let mut decision = evaluate_memory_use(&encoded(&use_facts)?)?;
    if !decision.context_allowed && decision.reason != "KIT_MEMORY_INSTRUCTIONS_CHANGED" {
        return Ok(MemoryContextResult {
            schema: 1,
            decision,
            packet: None,
        });
    }
    let project_key = memory_project_key(&encoded(&input["identity"])?)?;
    if use_facts["projectKey"].as_str() != Some(&project_key) {
        return Err(vec![Issue::new(
            "KIT_CONTEXT_PROJECT_MISMATCH",
            vec!["identity".into()],
        )]);
    }
    let config = parse_kit_config(&encoded(&input["config"])?)?;
    let instructions = fingerprint(&input["instructions"])?;
    use_facts["instructionDigest"] = json!(instructions.digest);
    decision = evaluate_memory_use(&encoded(&use_facts)?)?;
    if !decision.context_allowed {
        return Ok(MemoryContextResult {
            schema: 1,
            decision,
            packet: None,
        });
    }
    let project =
        text(&input["project"]).ok_or_else(|| issue("KIT_CONTEXT_DOCUMENT_UNAVAILABLE"))?;
    let context =
        text(&input["context"]).ok_or_else(|| issue("KIT_CONTEXT_DOCUMENT_UNAVAILABLE"))?;
    bounded_text(project)?;
    bounded_text(context)?;
    let seed = |source: &str| {
        placeholder_regex()
            .replace_all(source, |captures: &regex::Captures<'_>| {
                config["values"][&captures[1]]
                    .as_str()
                    .unwrap_or(&captures[0])
                    .to_owned()
            })
            .into_owned()
    };
    let known_seeds =
        config.get("values").is_some() && config["kitVersion"] == manifest()["version"];
    let content_state = if js_trim(project).is_empty()
        || js_trim(context).is_empty()
        || (known_seeds
            && (project == seed(resource("dot-voktty/PROJECT.md").expect("embedded project seed"))
                || context
                    == seed(resource("dot-voktty/CONTEXT.md").expect("embedded context seed"))))
    {
        "initial"
    } else if known_seeds {
        "available"
    } else {
        "unknown"
    };
    let facts: BTreeMap<_, _> = input["instructions"]["files"]
        .as_array()
        .expect("validated files")
        .iter()
        .map(|entry| (entry["path"].as_str().unwrap_or_default(), &entry["fact"]))
        .collect();
    let mut sections = vec![Section {
        path: ".voktty/INIT.md".into(),
        mode: "pointer",
        text: None,
    }];
    if let Some(role) = &instructions.role {
        sections.push(Section {
            path: role.clone(),
            mode: "pointer",
            text: None,
        });
    }
    for path in [".voktty/PROJECT.md", ".voktty/CONTEXT.md"] {
        sections.push(Section {
            path: path.into(),
            mode: "pointer",
            text: None,
        });
    }
    let mut pointers = vec![".voktty/INDEX.md".into(), ".voktty/RULES.md".into()];
    let plan = &input["activePlan"];
    if plan["kind"] == "file" {
        pointers.push(plan["path"].as_str().unwrap_or_default().into());
    }
    let warnings = if !plan.is_null() && plan["kind"] != "file" {
        vec!["KIT_CONTEXT_PLAN_UNAVAILABLE"]
    } else {
        vec![]
    };
    let mut body = Body {
        schema: 1,
        project_key: project_key.clone(),
        root: input["identity"]["canonicalRoot"]
            .as_str()
            .unwrap_or_default()
            .into(),
        project: config["project"].as_str().unwrap_or_default().into(),
        language: config["language"].as_str().unwrap_or_default().into(),
        instruction_digest: instructions.digest.clone(),
        role: instructions.role.clone(),
        content_state,
        pointers,
        warnings,
        sections,
    };
    if packet_text(&body)?.len() > MAX_PACKET_BYTES {
        return Err(issue("KIT_CONTEXT_BUDGET"));
    }
    for index in 0..body.sections.len() {
        let section = &body.sections[index];
        let fact_text = match section.path.as_str() {
            ".voktty/PROJECT.md" => project,
            ".voktty/CONTEXT.md" => context,
            path => text(
                facts
                    .get(path)
                    .copied()
                    .ok_or_else(|| issue("KIT_INSTRUCTION_UNAVAILABLE"))?,
            )
            .ok_or_else(|| issue("KIT_INSTRUCTION_UNAVAILABLE"))?,
        };
        let instruction = !matches!(
            section.path.as_str(),
            ".voktty/PROJECT.md" | ".voktty/CONTEXT.md"
        );
        let cap = if instruction {
            if section.path == ".voktty/INIT.md" {
                12288
            } else {
                4096
            }
        } else {
            3072
        };
        let available = MAX_PACKET_BYTES
            .checked_sub(packet_text(&body)?.len())
            .ok_or_else(|| issue("KIT_CONTEXT_BUDGET"))?
            + 4;
        let budget = cap.min(available);
        if encoded(&fact_text)?.len() <= budget {
            body.sections[index].mode = "full";
            body.sections[index].text = Some(fact_text.into());
        } else if !instruction && budget >= 2 {
            body.sections[index].mode = "excerpt";
            body.sections[index].text = Some(prefix_for_json(fact_text, budget));
        }
    }
    let text = packet_text(&body)?;
    if text.len() > MAX_PACKET_BYTES {
        return Err(issue("KIT_CONTEXT_BUDGET"));
    }
    let packet = MemoryContextPacket {
        schema: 1,
        project_key,
        instruction_digest: instructions.digest,
        digest: digest(text.as_bytes()),
        bytes: text.len(),
        content_state,
        text,
    };
    Ok(MemoryContextResult {
        schema: 1,
        decision,
        packet: Some(packet),
    })
}
