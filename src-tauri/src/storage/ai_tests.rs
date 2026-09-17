use std::fs;

use super::*;

fn test_storage() -> (Storage, std::path::PathBuf) {
    let root = std::env::temp_dir().join(format!("mftp-ai-storage-{}", uuid::Uuid::new_v4()));
    (Storage::new(root.clone()).unwrap(), root)
}

#[test]
fn connection_schema_is_idempotent_and_upserts() {
    let (storage, root) = test_storage();
    let config = AiConnectionConfig {
        base_url: "https://api.example.com".into(),
        model: "model-a".into(),
        streaming_enabled: true,
    };
    storage.save_ai_connection(&config).unwrap();
    assert_eq!(storage.ai_connection().unwrap(), Some(config.clone()));
    storage
        .save_ai_connection(&AiConnectionConfig {
            base_url: config.base_url,
            model: "model-b".into(),
            streaming_enabled: false,
        })
        .unwrap();

    drop(storage);
    let reopened = Storage::new(root.clone()).unwrap();
    let reopened_config = reopened.ai_connection().unwrap().unwrap();
    assert_eq!(reopened_config.model, "model-b");
    assert!(!reopened_config.streaming_enabled);
    let version: String = reopened
        .conn()
        .unwrap()
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'ai_schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, AI_SCHEMA_VERSION.to_string());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn version_one_connection_defaults_streaming_to_enabled() {
    let root = std::env::temp_dir().join(format!("mftp-ai-migration-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let conn = Connection::open(root.join("mftp.sqlite3")).unwrap();
    conn.execute_batch(
        r#"
            CREATE TABLE app_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            INSERT INTO app_meta(key, value) VALUES('ai_schema_version', '1');
            CREATE TABLE ai_connection (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            INSERT INTO ai_connection(id, base_url, model, updated_at)
            VALUES(1, 'https://api.example.com', 'model-a', 1);
            "#,
    )
    .unwrap();
    drop(conn);

    let storage = Storage::new(root.clone()).unwrap();
    assert!(storage.ai_connection().unwrap().unwrap().streaming_enabled);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn translations_are_isolated_by_uid_and_fingerprint() {
    let (storage, root) = test_storage();
    let fingerprint = "a".repeat(64);
    storage
        .upsert_ai_poetry_translation(
            "uid-a",
            &fingerprint,
            "zh-CN",
            PoetryTranslationMode::Literal,
            1,
            "译文甲",
            "model",
        )
        .unwrap();
    assert_eq!(
        storage
            .list_poetry_translations("uid-b", &fingerprint, "zh-CN", 1)
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        storage
            .list_poetry_translations("uid-a", &"b".repeat(64), "zh-CN", 1)
            .unwrap()
            .len(),
        0
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn repeated_generation_updates_one_record_and_user_edits_are_marked() {
    let (storage, root) = test_storage();
    let fingerprint = "c".repeat(64);
    for content in ["第一版", "第二版"] {
        storage
            .upsert_ai_poetry_translation(
                "uid",
                &fingerprint,
                "zh-CN",
                PoetryTranslationMode::Literary,
                1,
                content,
                "model",
            )
            .unwrap();
    }
    let translations = storage
        .list_poetry_translations("uid", &fingerprint, "zh-CN", 1)
        .unwrap();
    assert_eq!(translations.len(), 1);
    assert_eq!(translations[0].content, "第二版");

    let edited = storage
        .update_poetry_translation(
            "uid",
            &fingerprint,
            "zh-CN",
            PoetryTranslationMode::Literary,
            1,
            "人工修订",
        )
        .unwrap();
    assert_eq!(edited.source, PoetryTranslationSource::User);
    fs::remove_dir_all(root).unwrap();
}
