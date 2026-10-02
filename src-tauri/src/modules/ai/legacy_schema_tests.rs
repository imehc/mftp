use super::*;
use crate::modules::ai::{AiConnectionConfig, AiRepository};
use crate::storage::Storage;

fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
        .unwrap();
    conn
}

fn version(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'ai_schema_version'",
        [],
        |r| r.get(0),
    )
    .optional()
    .unwrap()
}

fn tables(conn: &Connection) -> Vec<String> {
    conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn lost_marker_does_not_replay_alter_or_change_saved_data() {
    let mut conn = database();
    init(&mut conn).unwrap();
    conn.execute_batch(
        "INSERT INTO ai_connection VALUES(1, 'https://example.com', 'saved-model', 123, 0);
         INSERT INTO ai_poetry_translations VALUES(
            'translation', 'poem', 'fingerprint', 'zh-CN', 'literal', 1,
            'saved translation', 'ai', 'saved-model', 123, 123);
         DELETE FROM app_meta WHERE key = 'ai_schema_version';",
    )
    .unwrap();
    for _ in 0..2 {
        init(&mut conn).unwrap();
    }
    let row: (String, String, i64, i64) = conn
        .query_row(
            "SELECT base_url, model, updated_at, streaming_enabled FROM ai_connection",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        row,
        ("https://example.com".into(), "saved-model".into(), 123, 0)
    );
    let body: String = conn
        .query_row("SELECT content FROM ai_poetry_translations", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(body, "saved translation");
    assert_eq!(version(&conn), Some(AI_SCHEMA_VERSION.to_string()));
}

#[test]
fn future_version_is_rejected_before_ai_ddl() {
    let mut conn = database();
    conn.execute(
        "INSERT INTO app_meta VALUES('ai_schema_version', '999')",
        [],
    )
    .unwrap();
    let before = tables(&conn);
    let error = init(&mut conn).unwrap_err();
    assert_eq!(error.code, "ai:schema_too_new");
    assert_eq!(tables(&conn), before);
    assert_eq!(version(&conn).as_deref(), Some("999"));
}

#[test]
fn invalid_version_is_not_silently_treated_as_an_empty_database() {
    for raw in ["invalid", "-1", "999999999999999999999999"] {
        let mut conn = database();
        conn.execute(
            "INSERT INTO app_meta VALUES('ai_schema_version', ?1)",
            [raw],
        )
        .unwrap();
        let before = tables(&conn);
        assert!(init(&mut conn).is_err());
        assert_eq!(tables(&conn), before);
        assert_eq!(version(&conn).as_deref(), Some(raw));
    }
}

#[test]
fn failed_version_publication_rolls_back_schema_and_can_retry() {
    let mut conn = database();
    conn.execute_batch(
        "CREATE TRIGGER reject_version BEFORE INSERT ON app_meta
         BEGIN SELECT RAISE(ABORT, 'test marker failure'); END;",
    )
    .unwrap();
    let before = tables(&conn);
    assert!(init(&mut conn).is_err());
    assert_eq!(tables(&conn), before);
    assert_eq!(version(&conn), None);
    conn.execute_batch("DROP TRIGGER reject_version").unwrap();
    init(&mut conn).unwrap();
    assert_eq!(version(&conn), Some(AI_SCHEMA_VERSION.to_string()));
}

#[test]
fn shared_reset_rolls_back_ai_rows_and_reopen_does_not_restore_deleted_config() {
    let root = std::env::temp_dir().join(format!("mftp-ai-reset-{}", uuid::Uuid::new_v4()));
    let storage = Storage::new(root.clone()).unwrap();
    let repo = AiRepository::new(storage.clone());
    let config = AiConnectionConfig {
        base_url: "https://example.com".into(),
        model: "saved-model".into(),
        streaming_enabled: false,
    };
    repo.save_connection(&config).unwrap();
    let conn = storage.conn().unwrap();
    // app_meta is processed after the module reset, exercising the caller's transaction.
    conn.execute_batch(
        "INSERT INTO app_meta VALUES('reset-test-setting', 'value');
         CREATE TRIGGER reject_reset BEFORE DELETE ON app_meta
         WHEN OLD.key = 'reset-test-setting'
         BEGIN SELECT RAISE(ABORT, 'test reset failure'); END;",
    )
    .unwrap();
    assert!(storage.reset_database().is_err());
    assert_eq!(repo.connection().unwrap(), Some(config));
    conn.execute_batch("DROP TRIGGER reject_reset").unwrap();
    storage.reset_database().unwrap();
    drop(conn);
    drop(repo);
    drop(storage);
    let reopened = Storage::new(root.clone()).unwrap();
    assert_eq!(
        AiRepository::new(reopened.clone()).connection().unwrap(),
        None
    );
    assert_eq!(
        version(&reopened.conn().unwrap()),
        Some(crate::modules::ai::schema::AI_SCHEMA_VERSION.to_string())
    );
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_v1_upgrade_preserves_the_old_row_and_column_layout() {
    let mut conn = database();
    conn.execute_batch(
        "INSERT INTO app_meta VALUES('ai_schema_version', '1');
         CREATE TABLE ai_connection (
            id INTEGER PRIMARY KEY, base_url TEXT NOT NULL,
            model TEXT NOT NULL, updated_at INTEGER NOT NULL);
         INSERT INTO ai_connection VALUES(1, 'https://example.com', 'old-model', 123);
         CREATE TRIGGER reject_version BEFORE UPDATE ON app_meta
         BEGIN SELECT RAISE(ABORT, 'test upgrade failure'); END;",
    )
    .unwrap();
    assert!(init(&mut conn).is_err());
    assert_eq!(version(&conn).as_deref(), Some("1"));
    assert!(conn
        .prepare("SELECT streaming_enabled FROM ai_connection")
        .is_err());
    let model: String = conn
        .query_row("SELECT model FROM ai_connection", [], |r| r.get(0))
        .unwrap();
    assert_eq!(model, "old-model");
    conn.execute_batch("DROP TRIGGER reject_version").unwrap();
    init(&mut conn).unwrap();
    let streaming: i64 = conn
        .query_row("SELECT streaming_enabled FROM ai_connection", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(streaming, 1);
}
