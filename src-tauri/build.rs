fn main() {
    configure_sidecar();
    configure_test_manifest();
    tauri_build::build()
}

/// Give test binaries the Common-Controls 6 dependency the app binary already
/// gets from `tauri_build`.
///
/// `rfd`, reached through `tauri-plugin-dialog`, imports `TaskDialogIndirect`,
/// which only comctl32 version 6 exports. Without the manifest the Windows
/// loader binds to the version 5 copy in System32 and every test binary that
/// links that symbol dies with STATUS_ENTRYPOINT_NOT_FOUND before `main`.
///
/// Scoped to tests so the app binary keeps exactly one manifest, and written
/// into `OUT_DIR` so no absolute path is ever committed.
fn configure_test_manifest() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };

    let manifest = std::path::Path::new(&out_dir).join("common-controls.manifest");
    if std::fs::write(&manifest, COMMON_CONTROLS_MANIFEST).is_err() {
        return;
    }

    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
        manifest.display()
    );
}

const COMMON_CONTROLS_MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#;

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
