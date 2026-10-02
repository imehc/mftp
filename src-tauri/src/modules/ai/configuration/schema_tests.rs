use super::super::{fixtures::*, model::AiKeyState, read::snapshot};
use super::*;

#[test]
fn all_supported_versions_migrate_without_losing_legacy_values() {
    for version in [0, 1, 2] {
        let mut conn = database();
        old_connection(&conn, version);
        init(&mut conn).unwrap();
        let view = snapshot(&mut conn).unwrap();
        assert_eq!(view.active_provider_id.as_deref(), Some(LEGACY_PROVIDER));
        assert_eq!(view.streaming_enabled, version < 2);
        assert_eq!(view.providers.len(), 1);
        let provider = &view.providers[0];
        assert_eq!(provider.base_url, "https://API.example.com:443/v1/");
        assert!(!provider.requires_address_repair);
        assert_eq!(provider.current_key_id.as_deref(), Some(LEGACY_KEY));
        assert_eq!(provider.current_model_id.as_deref(), Some(LEGACY_MODEL));
        assert_eq!(provider.models[0].model_id, "old-model");
        // There is deliberately no credential adapter. This must not claim that
        // the legacy key exists or that the remote service accepted it.
        assert_eq!(provider.keys[0].state, AiKeyState::SavedUnverified);
        let row: (String, i64) = conn
            .query_row(
                "SELECT credential_ref, updated_at FROM ai_provider_keys",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, ("default".into(), 123));
        assert!(!table_exists(&conn, "ai_connection"));
        assert_eq!(legacy_schema::read_version(&conn).unwrap(), VERSION);
        init(&mut conn).unwrap();
        assert_eq!(snapshot(&mut conn).unwrap(), view);
    }
}

#[test]
fn empty_database_stays_empty_without_guessing_an_orphan_credentials_address() {
    let mut conn = database();
    init(&mut conn).unwrap();
    let view = snapshot(&mut conn).unwrap();
    assert!(view.providers.is_empty());
    assert_eq!(view.active_provider_id, None);
    assert!(view.streaming_enabled);
    assert!(view.label_candidates.is_empty());
}

#[test]
fn translations_and_unrelated_metadata_survive_migration() {
    let mut conn = database();
    legacy_schema::init(&mut conn).unwrap();
    conn.execute_batch(
        "INSERT INTO app_meta VALUES('legacy_json_migrated', '1');
         INSERT INTO ai_poetry_translations VALUES(
         'translation', 'poem', 'fingerprint', 'zh-CN', 'literal', 1,
         'saved translation', 'ai', 'historical-model', 100, 200);",
    )
    .unwrap();
    init(&mut conn).unwrap();
    let value: (String, String, i64) = conn
        .query_row(
            "SELECT content, model, updated_at FROM ai_poetry_translations",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        value,
        ("saved translation".into(), "historical-model".into(), 200)
    );
    let marker: String = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'legacy_json_migrated'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(marker, "1");
}

#[test]
fn final_marker_failure_restores_original_v1_row_and_schema() {
    let mut conn = database();
    old_connection(&conn, 1);
    conn.execute_batch(
        "CREATE TRIGGER fail_upgrade BEFORE UPDATE ON app_meta
         BEGIN SELECT RAISE(ABORT, 'test version publication failure'); END;",
    )
    .unwrap();
    assert!(init(&mut conn).is_err());
    assert_eq!(legacy_schema::read_version(&conn).unwrap(), 1);
    assert!(!table_exists(&conn, "ai_providers"));
    assert!(conn
        .prepare("SELECT streaming_enabled FROM ai_connection")
        .is_err());
    let model: String = conn
        .query_row("SELECT model FROM ai_connection", [], |r| r.get(0))
        .unwrap();
    assert_eq!(model, "old-model");
    conn.execute_batch("DROP TRIGGER fail_upgrade").unwrap();
    init(&mut conn).unwrap();
    assert_eq!(snapshot(&mut conn).unwrap().providers.len(), 1);
}

#[test]
fn future_version_and_missing_v3_marker_do_not_recreate_legacy_tables() {
    let mut conn = database();
    init(&mut conn).unwrap();
    conn.execute(
        "UPDATE app_meta SET value = '99' WHERE key = 'ai_schema_version'",
        [],
    )
    .unwrap();
    assert_eq!(init(&mut conn).unwrap_err().code, "ai:schema_too_new");
    conn.execute("DELETE FROM app_meta WHERE key = 'ai_schema_version'", [])
        .unwrap();
    assert!(init(&mut conn).is_err());
    assert!(!table_exists(&conn, "ai_connection"));
    assert!(snapshot(&mut conn).unwrap().providers.is_empty());
}

#[test]
fn malformed_legacy_address_is_retained_and_marked_for_repair() {
    let mut conn = database();
    old_connection(&conn, 2);
    conn.execute(
        "UPDATE ai_connection SET base_url = 'old invalid address'",
        [],
    )
    .unwrap();
    init(&mut conn).unwrap();
    let view = snapshot(&mut conn).unwrap();
    assert_eq!(view.providers[0].base_url, "old invalid address");
    assert!(view.providers[0].requires_address_repair);
}

#[test]
fn endpoint_normalization_matches_request_construction_without_lowercasing_paths() {
    let expected = "https://example.com/v1/responses";
    for address in [
        "https://EXAMPLE.com:443",
        " https://example.com/v1/ ",
        "https://example.com/v1/responses",
    ] {
        assert_eq!(normalized_endpoint(address).unwrap(), expected);
    }
    assert_ne!(
        normalized_endpoint("https://example.com/Team").unwrap(),
        normalized_endpoint("https://example.com/team").unwrap()
    );
    for invalid in [
        "http://example.com",
        "https://user:password@example.com",
        "https://example.com?token=x",
    ] {
        assert!(normalized_endpoint(invalid).is_err());
    }
}

#[test]
fn reset_preserves_cleanup_journal_and_version_across_reopen() {
    let dir = TestDirectory::new();
    let path = dir.database_path();
    let mut conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);")
        .unwrap();
    init(&mut conn).unwrap();
    add_provider(&mut conn, "provider-a", "personal", "model-a");
    conn.execute("INSERT INTO ai_credential_journal VALUES('old-unpublished', 'failed-write', 'unpublished', 0)", []).unwrap();
    let tx = conn.transaction().unwrap();
    assert_eq!(reset(&tx, "reset-1", 123).unwrap(), 3);
    tx.commit().unwrap();
    drop(conn);
    let mut reopened = Connection::open(path).unwrap();
    reopened.pragma_update(None, "foreign_keys", "ON").unwrap();
    init(&mut reopened).unwrap();
    let view = snapshot(&mut reopened).unwrap();
    assert!(view.providers.is_empty());
    assert_eq!(view.revision, 1);
    let refs = reopened
        .prepare("SELECT credential_ref FROM ai_credential_journal ORDER BY credential_ref")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        refs,
        ["default", "old-unpublished", "private-reference-provider-a"]
    );
    assert_eq!(legacy_schema::read_version(&reopened).unwrap(), VERSION);
    let tx = reopened.transaction().unwrap();
    reset(&tx, "reset-2", 124).unwrap();
    tx.commit().unwrap();
    assert_eq!(snapshot(&mut reopened).unwrap().revision, 2);
}
