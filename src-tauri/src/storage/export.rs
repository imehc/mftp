use crate::error::{AppError, AppResult};
use crate::models::{ExportSection, ImportPreview};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, Generate, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use serde_json::{json, Map, Value};
use std::convert::TryFrom;

use super::{now_ms, Storage};

// Argon2id parameters recorded in the file so future defaults can change
// without breaking old exports.
const KDF_M_COST: u32 = 19456;
const KDF_T_COST: u32 = 2;
const KDF_P_COST: u32 = 1;

fn derive_key(password: &str, salt: &[u8], m: u32, t: u32, p: u32) -> AppResult<[u8; 32]> {
    let params =
        Params::new(m, t, p, Some(32)).map_err(|e| AppError(format!("invalid kdf params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| AppError(format!("key derivation failed: {e}")))?;
    Ok(key)
}

fn encrypt_envelope(plain: &Value, password: &str) -> AppResult<Value> {
    // `Generate` uses the system CSPRNG re-exported by `aead` (already a
    // dependency via `chacha20poly1305`), so no extra crate is needed.
    let nonce = Nonce::generate();
    // Salt needs 16 bytes; build it from two CSPRNG-generated nonces.
    let salt_tail = Nonce::generate();
    let mut salt = [0u8; 16];
    salt[..12].copy_from_slice(nonce.as_slice());
    salt[12..].copy_from_slice(&salt_tail.as_slice()[..4]);
    let key = derive_key(password, &salt, KDF_M_COST, KDF_T_COST, KDF_P_COST)?;
    let key = Key::try_from(&key[..]).expect("key is 32 bytes");
    let cipher = ChaCha20Poly1305::new(&key);
    let plaintext =
        serde_json::to_vec(plain).map_err(|e| AppError(format!("serialize failed: {e}")))?;
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_slice())
        .map_err(|_| AppError("encryption failed".into()))?;
    Ok(json!({
        "app": "mftp",
        "format": 1,
        "encrypted": true,
        "kdf": {
            "algo": "argon2id",
            "salt": B64.encode(salt),
            "mCost": KDF_M_COST,
            "tCost": KDF_T_COST,
            "pCost": KDF_P_COST,
        },
        "cipher": "chacha20poly1305",
        "nonce": B64.encode(nonce),
        "data": B64.encode(ciphertext),
    }))
}

fn b64_field(obj: &Map<String, Value>, key: &str) -> AppResult<Vec<u8>> {
    let raw = obj
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError(format!("missing field: {key}")))?;
    B64.decode(raw)
        .map_err(|_| AppError(format!("invalid base64 in field: {key}")))
}

/// Decrypt an encrypted export back into its plain envelope.
pub(super) fn decrypt_envelope(doc: &Map<String, Value>, password: &str) -> AppResult<Value> {
    let kdf = doc
        .get("kdf")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError("missing kdf parameters".into()))?;
    if kdf.get("algo").and_then(Value::as_str) != Some("argon2id") {
        return Err(AppError("unsupported kdf algorithm".into()));
    }
    let salt = b64_field(kdf, "salt")?;
    let read_u32 = |key: &str| -> AppResult<u32> {
        kdf.get(key)
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| AppError(format!("missing kdf param: {key}")))
    };
    let key = derive_key(
        password,
        &salt,
        read_u32("mCost")?,
        read_u32("tCost")?,
        read_u32("pCost")?,
    )?;
    if doc.get("cipher").and_then(Value::as_str) != Some("chacha20poly1305") {
        return Err(AppError("unsupported cipher".into()));
    }
    let nonce = b64_field(doc, "nonce")?;
    let data = b64_field(doc, "data")?;
    let key =
        Key::try_from(&key[..]).map_err(|_| AppError("derived key has wrong length".into()))?;
    let cipher = ChaCha20Poly1305::new(&key);
    let nonce = Nonce::try_from(nonce.as_slice())
        .map_err(|_| AppError("wrong password or corrupted file".into()))?;
    let plaintext = cipher
        .decrypt(&nonce, data.as_slice())
        .map_err(|_| AppError("wrong password or corrupted file".into()))?;
    serde_json::from_slice(&plaintext).map_err(|e| AppError(format!("invalid decrypted data: {e}")))
}

pub(super) fn section_key(section: ExportSection) -> &'static str {
    match section {
        ExportSection::Vault => "vault",
        ExportSection::Hosts => "hosts",
    }
}

pub(super) fn section_from_key(key: &str) -> Option<ExportSection> {
    match key {
        "vault" => Some(ExportSection::Vault),
        "hosts" => Some(ExportSection::Hosts),
        _ => None,
    }
}

pub(super) fn parse_document(raw: &str) -> AppResult<Map<String, Value>> {
    let value: Value =
        serde_json::from_str(raw).map_err(|_| AppError("not a valid JSON file".into()))?;
    let obj = value
        .as_object()
        .filter(|obj| obj.get("app").and_then(Value::as_str) == Some("mftp"))
        .ok_or_else(|| AppError("not an mftp export file".into()))?;
    Ok(obj.clone())
}

fn plain_sections(doc: &Map<String, Value>) -> Vec<ExportSection> {
    doc.get("sections")
        .and_then(Value::as_object)
        .map(|sections| {
            sections
                .keys()
                .filter_map(|key| section_from_key(key))
                .collect()
        })
        .unwrap_or_default()
}

impl Storage {
    /// Build the versioned export envelope for the requested sections.
    /// Adding a new exportable module only requires a new `ExportSection`
    /// variant plus match arms here and in `section_key`/`section_from_key`.
    pub fn export_sections(&self, sections: &[ExportSection]) -> AppResult<Value> {
        let mut data = Map::new();
        for section in sections {
            let value = match section {
                ExportSection::Vault => json!(self.list_vault_entries()?),
                ExportSection::Hosts => json!(self.list_hosts()?),
            };
            data.insert(section_key(*section).to_string(), value);
        }
        Ok(json!({
            "app": "mftp",
            "format": 1,
            "exportedAt": now_ms(),
            "sections": data,
        }))
    }

    /// Serialize the export, optionally encrypting it with a password.
    pub fn export_document(
        &self,
        sections: &[ExportSection],
        password: Option<&str>,
    ) -> AppResult<String> {
        let plain = self.export_sections(sections)?;
        let doc = match password {
            Some(password) if !password.is_empty() => encrypt_envelope(&plain, password)?,
            _ => plain,
        };
        serde_json::to_string_pretty(&doc)
            .map_err(|e| AppError(format!("failed to serialize export: {e}")))
    }

    /// Detect whether a file is an mftp export and if it is encrypted.
    pub fn inspect_document(&self, raw: &str) -> AppResult<ImportPreview> {
        let doc = parse_document(raw)?;
        let encrypted = doc.get("encrypted").and_then(Value::as_bool) == Some(true);
        Ok(ImportPreview {
            encrypted,
            sections: if encrypted {
                Vec::new()
            } else {
                plain_sections(&doc)
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_then_decrypt_round_trips() {
        let plain = json!({ "sections": { "vault": [{ "title": "demo" }] } });
        let doc = encrypt_envelope(&plain, "secret").expect("encrypt");
        let obj = doc.as_object().expect("object");
        assert_eq!(obj.get("encrypted"), Some(&Value::Bool(true)));
        let decrypted = decrypt_envelope(obj, "secret").expect("decrypt");
        assert_eq!(decrypted, plain);
        assert!(decrypt_envelope(obj, "wrong").is_err());
    }
}
