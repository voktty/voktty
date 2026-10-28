use serde_json::Value;
use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn collect_sources(root: &Path, relative: &str, files: &mut BTreeSet<String>) {
    assert!(
        relative.split('/').count() <= 64,
        "Kit source nesting exceeds the limit"
    );
    for entry in fs::read_dir(root.join(relative)).expect("Kit source directory must be readable") {
        let entry = entry.expect("Kit source entry must be readable");
        let name = entry
            .file_name()
            .into_string()
            .expect("Kit source names must be UTF-8");
        let path = format!("{relative}/{name}");
        let kind = entry
            .file_type()
            .expect("Kit source metadata must be readable");
        assert!(!kind.is_symlink(), "Kit source links are not supported");
        if kind.is_dir() {
            collect_sources(root, &path, files);
        } else {
            assert!(kind.is_file(), "Kit sources must be regular files");
            files.insert(path);
            assert!(files.len() <= 128, "Kit source inventory exceeds the limit");
        }
    }
}

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory"))
        .join("../../../templates/workspace-kit");
    println!("cargo:rerun-if-changed={}", root.display());
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(root.join("manifest.json")).expect("Kit manifest"),
    )
    .expect("Kit manifest JSON");
    assert_eq!(manifest["schema"], 1);
    let version = manifest["version"].as_str().expect("Kit template version");
    let parts: Vec<_> = version.split('.').collect();
    assert!(
        version.len() <= 32
            && parts.len() == 3
            && parts
                .iter()
                .all(|part| !part.is_empty() && part.bytes().all(|c| c.is_ascii_digit()))
    );
    let entries = manifest["files"].as_array().expect("Kit file list");
    assert!(!entries.is_empty() && entries.len() <= 128);
    let mut sources = BTreeSet::new();
    let mut targets = BTreeSet::new();
    let mut actual = BTreeSet::new();
    collect_sources(&root, "dot-voktty", &mut actual);
    collect_sources(&root, "root", &mut actual);
    let mut total = 0;
    for entry in entries {
        let source = entry["source"].as_str().expect("Kit source path");
        let parts: Vec<_> = source.split('/').collect();
        assert!(
            source.len() <= 256 && parts.len() >= 2 && matches!(parts[0], "dot-voktty" | "root")
        );
        assert!(parts.iter().all(|part| !part.is_empty()
            && *part != "."
            && *part != ".."
            && part
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))));
        assert!(sources.insert(source.to_owned()), "Duplicate kit source");
        let target = if parts[0] == "dot-voktty" {
            format!(".voktty/{}", parts[1..].join("/"))
        } else {
            parts[1..].join("/")
        };
        assert!(
            targets.insert(target.to_ascii_lowercase()),
            "Duplicate or case-aliased kit destination"
        );
        let kind = entry["kind"].as_str().expect("Kit file kind");
        assert!(matches!(kind, "base" | "content" | "link"));
        assert_eq!(kind == "link", parts[0] == "root");
        let metadata = fs::symlink_metadata(root.join(source)).expect("Kit source metadata");
        assert!(
            metadata.file_type().is_file(),
            "Kit source must be a regular file"
        );
        assert!(
            metadata.len() <= 256 * 1024,
            "Kit source exceeds the file limit"
        );
        let text = fs::read_to_string(root.join(source)).expect("Kit UTF-8 resource");
        total += text.len();
        assert!(text.len() <= 256 * 1024 && total <= 1024 * 1024 && !text.contains('\0'));
    }
    assert_eq!(sources, actual, "Kit manifest must cover every source");
    sources.extend(["manifest.json".to_owned(), "placeholders.json".to_owned()]);
    let mut generated = String::from("pub const RESOURCES: &[(&str, &str)] = &[\n");
    for source in sources {
        let absolute = root.join(&source).canonicalize().expect("Kit source path");
        generated.push_str(&format!(
            "({source:?}, include_str!({:?})),\n",
            absolute.to_str().expect("Kit source path must be UTF-8")
        ));
    }
    generated.push_str("];\n");
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    fs::write(output.join("resources.rs"), generated).expect("Write embedded kit resources");
}
