use std::fs;

use super::super::schema::AI_SCHEMA_VERSION;
use super::*;
use rusqlite::Connection;

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
    AiRepository::new(storage.clone())
        .save_connection(&config)
        .unwrap();
    assert_eq!(
        AiRepository::new(storage.clone()).connection().unwrap(),
        Some(config.clone())
    );
    AiRepository::new(storage.clone())
        .save_connection(&AiConnectionConfig {
            base_url: config.base_url,
            model: "model-b".into(),
            streaming_enabled: false,
        })
        .unwrap();

    drop(storage);
    let reopened = Storage::new(root.clone()).unwrap();
    let reopened_config = AiRepository::new(reopened.clone())
        .connection()
        .unwrap()
        .unwrap();
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
    assert!(
        AiRepository::new(storage.clone())
            .connection()
            .unwrap()
            .unwrap()
            .streaming_enabled
    );
    fs::remove_dir_all(root).unwrap();
}
