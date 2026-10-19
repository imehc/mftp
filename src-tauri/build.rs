fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri_build::build();
    if !tauri_build::is_dev() {
        verify_frontend_target()?;
    }
    Ok(())
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
