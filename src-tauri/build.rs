fn main() -> Result<(), Box<dyn std::error::Error>> {
    align_android_native_library();
    tauri_build::build();
    if !tauri_build::is_dev() {
        verify_frontend_target()?;
    }
    Ok(())
}

/// Android 15+ devices can use 16 KB memory pages and reject a 4 KB-aligned
/// native library at install time (INSTALL_FAILED_INVALID_APK). NDK r27 still
/// links 4 KB by default, so the page size has to be requested explicitly.
///
/// Emitting the flag from this build script instead of `.cargo/config.toml`
/// keeps it attached to the crate that produces the mobile libraries, and it
/// cannot be dropped by a `RUSTFLAGS` override: environment flags replace
/// config-level rustflags wholesale rather than merging with them.
fn align_android_native_library() {
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() != "android" {
        return;
    }
    println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
}

fn verify_frontend_target() -> Result<(), Box<dyn std::error::Error>> {
    let target = std::env::var("CARGO_CFG_TARGET_OS")?;
    let expected = format!("../dist/{target}");
    let platform_config = format!("tauri.{target}.conf.json");
    println!("cargo:rerun-if-changed={platform_config}");
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(platform_config)?)?;
    let overrides: serde_json::Value =
        serde_json::from_str(&std::env::var("TAURI_CONFIG").unwrap_or_else(|_| "{}".into()))?;
    let dist = overrides["build"]["frontendDist"]
        .as_str()
        .or_else(|| config["build"]["frontendDist"].as_str());
    if dist != Some(expected.as_str()) {
        return Err(format!("Native {target} build must use {expected}").into());
    }
    let manifest = format!("{expected}/build-platform.json");
    println!("cargo:rerun-if-changed={manifest}");
    let stamp: serde_json::Value = serde_json::from_slice(&std::fs::read(manifest)?)?;
    if stamp["platform"].as_str() != Some(target.as_str()) {
        return Err(format!("Frontend target does not match native {target}").into());
    }
    Ok(())
}
