use sha2::{Digest, Sha256};

pub(super) fn prepare(config: &mut tauri::Config) {
    if config.identifier == "com.imehc.mftp" {
        return;
    }
    // Set this at runtime: tauri-utils 2.10.1 emits Vec<u8> for the config's
    // [u8; 16] field in generate_context!. Each alternate identity keeps a
    // stable WKWebsiteDataStore without sharing production's default store.
    let digest = Sha256::digest(config.identifier.as_bytes());
    let mut identifier = [0; 16];
    identifier.copy_from_slice(&digest[..16]);
    for window in &mut config.app.windows {
        if window.data_store_identifier.is_none() {
            window.data_store_identifier = Some(identifier);
        }
    }
}

#[cfg(test)]
#[path = "runtime_config_tests.rs"]
mod tests;
