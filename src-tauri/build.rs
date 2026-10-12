use std::{env, fs, path::PathBuf};

fn main() {
    configure_sidecar();
    // Avoid putting a second manifest in Tauri's resource library.
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
    embed_windows_manifest();
}

const WINDOWS_APP_MANIFEST: &str = r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
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

/// Embed Tauri's default Common Controls v6 manifest into every Windows target.
/// Tauri normally puts it in a resource library linked to app binaries only;
/// embedding it here lets library test executables load the same controls.
fn embed_windows_manifest() {
    if env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "windows"
        || env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default() != "msvc"
    {
        return;
    }
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is required"));
    let manifest_path = out_dir.join("windows_app_manifest.xml");
    fs::write(&manifest_path, WINDOWS_APP_MANIFEST).expect("failed to write test manifest");

    // Unscoped arguments also reach the library's #[test] executable.
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
        manifest_path.display()
    );
    println!("cargo:rustc-link-arg=/WX");
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
