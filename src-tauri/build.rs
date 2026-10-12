fn main() {
    configure_sidecar();
    tauri_build::build();
    ensure_test_manifest();
}

use std::{env, fs, path::PathBuf};

const COMCTL_V6_NAME: &str = "Microsoft.Windows.Common-Controls";
const COMCTL_V6_VERSION: &str = "6.0.0.0";
const COMCTL_V6_STANZA: &str = concat!(
    "  <dependency>\n",
    "    <dependentAssembly>\n",
    "      <assemblyIdentity\n",
    "        type=\"win32\"\n",
    "        name=\"Microsoft.Windows.Common-Controls\"\n",
    "        version=\"6.0.0.0\"\n",
    "        processorArchitecture=\"*\"\n",
    "        publicKeyToken=\"6595b64144ccf1df\"\n",
    "        language=\"*\"\n",
    "      />\n",
    "    </dependentAssembly>\n",
    "  </dependency>\n",
);
const MINIMAL_V6_MANIFEST: &str = "\
<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<assembly xmlns=\"urn:schemas-microsoft-com:asm.v1\" manifestVersion=\"1.0\">\n\
  <dependency>\n\
    <dependentAssembly>\n\
      <assemblyIdentity\n\
        type=\"win32\"\n\
        name=\"Microsoft.Windows.Common-Controls\"\n\
        version=\"6.0.0.0\"\n\
        processorArchitecture=\"*\"\n\
        publicKeyToken=\"6595b64144ccf1df\"\n\
        language=\"*\"\n\
      />\n\
    </dependentAssembly>\n\
  </dependency>\n\
</assembly>\n";

/// Reuse Tauri's manifest and attach it to test targets as well as the app.
/// Tauri's Windows resource helper links the manifest to binary targets, but
/// library unit-test binaries need their own Common Controls v6 dependency.
fn ensure_test_manifest() {
    if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows"
        || env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default() != "msvc"
    {
        return;
    }
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is required"));
    let manifest = fs::read_to_string(out_dir.join("resource.rc"))
        .ok()
        .and_then(|resource| extract_manifest_from_rc(&resource))
        .map(|manifest| ensure_comctl_v6(&manifest))
        .unwrap_or_else(|| {
            println!("cargo:warning=using a minimal Common Controls v6 manifest for test binaries");
            MINIMAL_V6_MANIFEST.to_string()
        });
    let manifest_path = out_dir.join("test_manifest.xml");
    fs::write(&manifest_path, manifest).expect("failed to write test manifest");

    // Unscoped arguments also reach the library's #[test] executable.
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
        manifest_path.display()
    );
    println!("cargo:rustc-link-arg=/WX");
}

fn extract_manifest_from_rc(resource: &str) -> Option<String> {
    let mut lines = resource
        .lines()
        .map(str::trim)
        .skip_while(|line| *line != "1 24");
    lines.next()?;
    if lines.next()? != "{" {
        return None;
    }
    let mut manifest = String::new();
    for line in lines {
        if line == "}" {
            break;
        }
        let inner = line.strip_prefix('\"')?.strip_suffix('\"')?;
        let inner = inner.strip_prefix(' ').unwrap_or(inner);
        let inner = inner.strip_suffix(' ').unwrap_or(inner);
        manifest.push_str(&unescape_rc_string(inner));
        manifest.push('\n');
    }
    Some(manifest)
}

fn ensure_comctl_v6(manifest: &str) -> String {
    if manifest.contains(COMCTL_V6_NAME) && manifest.contains(COMCTL_V6_VERSION) {
        return manifest.to_string();
    }
    match manifest.rfind("</assembly>") {
        Some(index) => {
            let (head, tail) = manifest.split_at(index);
            format!("{head}{COMCTL_V6_STANZA}{tail}")
        }
        None => MINIMAL_V6_MANIFEST.to_string(),
    }
}

fn unescape_rc_string(escaped: &str) -> String {
    let mut unescaped = String::with_capacity(escaped.len());
    let mut chars = escaped.chars();
    while let Some(character) = chars.next() {
        if character != '\\' && character != '\"' {
            unescaped.push(character);
            continue;
        }
        match chars.next() {
            Some('\"') if character == '\"' => unescaped.push('\"'),
            Some('\\') if character == '\\' => unescaped.push('\\'),
            Some('\'') if character == '\\' => unescaped.push('\''),
            Some('n') if character == '\\' => unescaped.push('\n'),
            Some('t') if character == '\\' => unescaped.push('\t'),
            Some('r') if character == '\\' => unescaped.push('\r'),
            Some(other) => {
                unescaped.push(character);
                unescaped.push(other);
            }
            None => unescaped.push(character),
        }
    }
    unescaped
}

fn configure_sidecar() {
    let Ok(target) = std::env::var("TARGET") else {
        return;
    };

    if target.contains("android") || target.contains("ios") {
        let mut config = std::env::var("TAURI_CONFIG")
            .map(|value| serde_json::from_str(&value).expect("parse TAURI_CONFIG"))
            .unwrap_or_else(|_| serde_json::json!({}));
        config["bundle"]["externalBin"] = serde_json::json!([]);
        std::env::set_var(
            "TAURI_CONFIG",
            serde_json::to_string(&config).expect("serialize TAURI_CONFIG"),
        );
        return;
    }

    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let path = std::path::PathBuf::from("binaries").join(format!("voktty-cli-{target}{extension}"));
    let valid =
        std::fs::metadata(&path).is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0);
    if valid {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!(
            "release sidecar {} is missing or empty; run pnpm build:cli before packaging",
            path.display()
        );
    }

    let mut config = std::env::var("TAURI_CONFIG")
        .map(|value| serde_json::from_str(&value).expect("parse TAURI_CONFIG"))
        .unwrap_or_else(|_| serde_json::json!({}));
    config["bundle"]["externalBin"] = serde_json::json!([]);
    std::env::set_var(
        "TAURI_CONFIG",
        serde_json::to_string(&config).expect("serialize TAURI_CONFIG"),
    );
}
