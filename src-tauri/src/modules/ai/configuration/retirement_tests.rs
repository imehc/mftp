use super::{fixtures::*, read::snapshot, schema};
use crate::modules::ai::legacy_schema;

#[test]
fn v4_and_v5_upgrade_preserve_connections_keys_models_and_selection() {
    for version in [4, 5] {
        let directory = TestDirectory::new();
        let path = directory.database_path();
        let mut conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        schema::init(&mut conn).unwrap();
        add_provider(&mut conn, "a", "key", "model");
        conn.execute(
            "UPDATE ai_settings SET active_provider_id = 'a', streaming_enabled = 0",
            [],
        )
        .unwrap();
        let before = snapshot(&mut conn).unwrap();
        conn.execute(
            "UPDATE app_meta SET value = ?1 WHERE key = 'ai_schema_version'",
            [version.to_string()],
        )
        .unwrap();
        if version == 5 {
            conn.execute_batch("CREATE TABLE ai_model_request_policies(model_id TEXT PRIMARY KEY REFERENCES ai_provider_models(id), policy_json TEXT NOT NULL); INSERT INTO ai_model_request_policies VALUES('a-model', '{\"version\":1}');").unwrap();
        }
        let reference: String = conn
            .query_row("SELECT credential_ref FROM ai_provider_keys", [], |r| {
                r.get(0)
            })
            .unwrap();
        schema::init(&mut conn).unwrap();
        assert_eq!(snapshot(&mut conn).unwrap(), before);
        assert_eq!(legacy_schema::read_version(&conn).unwrap(), schema::VERSION);
        assert!(!table_exists(&conn, "ai_model_request_policies"));
        assert_eq!(
            conn.query_row("SELECT credential_ref FROM ai_provider_keys", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            reference
        );
        drop(conn);
        let mut reopened = rusqlite::Connection::open(&path).unwrap();
        schema::init(&mut reopened).unwrap();
        assert_eq!(snapshot(&mut reopened).unwrap(), before);
    }
}

#[test]
fn retirement_and_schema_marker_roll_back_together_on_publication_failure() {
    let mut conn = database();
    schema::init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "key", "model");
    conn.execute_batch("UPDATE app_meta SET value = '5' WHERE key = 'ai_schema_version'; CREATE TABLE ai_model_request_policies(model_id TEXT PRIMARY KEY REFERENCES ai_provider_models(id), policy_json TEXT NOT NULL); INSERT INTO ai_model_request_policies VALUES('a-model', 'old game preferences'); CREATE TRIGGER fail_retirement BEFORE UPDATE ON app_meta BEGIN SELECT RAISE(ABORT, 'test marker failure'); END;").unwrap();
    assert!(schema::init(&mut conn).is_err());
    assert_eq!(legacy_schema::read_version(&conn).unwrap(), 5);
    assert_eq!(
        conn.query_row(
            "SELECT policy_json FROM ai_model_request_policies",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "old game preferences"
    );
    assert_eq!(
        snapshot(&mut conn).unwrap().providers[0].models[0].model_id,
        "model"
    );
    conn.execute_batch("DROP TRIGGER fail_retirement").unwrap();
    schema::init(&mut conn).unwrap();
    assert!(!table_exists(&conn, "ai_model_request_policies"));
}
