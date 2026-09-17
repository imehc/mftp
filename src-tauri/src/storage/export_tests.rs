use std::fs;

use crate::ai::AiConnectionConfig;
use crate::models::ImportMode;
use crate::poetry::model::PoetryTranslationMode;

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

#[test]
fn ai_translation_export_round_trips_without_connection_config() {
    let source_root = std::env::temp_dir().join(format!("mftp-ai-export-{}", uuid::Uuid::new_v4()));
    let target_root = std::env::temp_dir().join(format!("mftp-ai-import-{}", uuid::Uuid::new_v4()));
    let source = Storage::new(source_root.clone()).unwrap();
    source
        .save_ai_connection(&AiConnectionConfig {
            base_url: "https://private-provider.example".into(),
            model: "translation-model".into(),
            streaming_enabled: true,
        })
        .unwrap();
    source
        .upsert_ai_poetry_translation(
            "poem-uid",
            &"a".repeat(64),
            "zh-CN",
            PoetryTranslationMode::Literal,
            1,
            "白话译文",
            "translation-model",
        )
        .unwrap();

    let raw = source
        .export_document(&[ExportSection::AiTranslations], None)
        .unwrap();
    assert!(raw.contains("aiTranslations"));
    assert!(!raw.contains("private-provider.example"));

    let target = Storage::new(target_root.clone()).unwrap();
    let report = target
        .import_document(&raw, None, ImportMode::Merge)
        .unwrap();
    assert_eq!(report.sections[0].section, ExportSection::AiTranslations);
    assert_eq!(target.all_poetry_translations().unwrap().len(), 1);
    target
        .import_document(&raw, None, ImportMode::Append)
        .unwrap();
    assert_eq!(target.all_poetry_translations().unwrap().len(), 1);

    fs::remove_dir_all(source_root).unwrap();
    fs::remove_dir_all(target_root).unwrap();
}
