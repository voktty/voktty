use crate::document::{js_trim, parse_document};
use crate::validation::{validate_structure, Contract};
use crate::{Issue, KitResult};
use sha2::{Digest, Sha256};

pub fn memory_project_key(text: &str) -> KitResult<String> {
    if text.len() > 16384 {
        return Err(vec![Issue::new("KIT_DOCUMENT_TOO_LARGE", vec![])]);
    }
    let input = parse_document(text)?;
    validate_structure(&input, Contract::MemoryIdentity)?;
    let root = input["canonicalRoot"].as_str().unwrap_or_default();
    for field in ["machineId", "filesystemId"] {
        if js_trim(input[field].as_str().unwrap_or_default()).is_empty() {
            return Err(vec![Issue::new(
                "KIT_IDENTITY_FIELD_INVALID",
                vec![field.into()],
            )]);
        }
    }
    let bytes = root.as_bytes();
    let absolute = root.starts_with('/')
        || root.starts_with("\\\\")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'/' | b'\\'));
    if !absolute {
        return Err(vec![Issue::new(
            "KIT_IDENTITY_ROOT_INVALID",
            vec!["canonicalRoot".into()],
        )]);
    }
    let mut hash = Sha256::new();
    hash.update(b"voktty-memory-project-v1\0");
    for field in ["kind", "machineId", "filesystemId", "canonicalRoot"] {
        let value = input[field].as_str().unwrap_or_default().as_bytes();
        if value.len() > 4096 {
            return Err(vec![Issue::new("KIT_IDENTITY_FIELD_TOO_LARGE", vec![])]);
        }
        hash.update((value.len() as u32).to_be_bytes());
        hash.update(value);
    }
    Ok(hex::encode(hash.finalize()))
}
