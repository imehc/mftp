use super::super::{fixtures::*, schema};
use super::*;

#[test]
fn candidate_projection_is_trimmed_sorted_deduplicated_and_derived_from_saved_rows() {
    let mut conn = database();
    schema::init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "personal", " model-standard ");
    add_provider(&mut conn, "b", "personal", "model-standard");
    add_provider(&mut conn, "c", "team", "model-fast");
    let view = snapshot(&mut conn).unwrap();
    assert_eq!(view.label_candidates, ["personal", "team"]);
    assert_eq!(view.model_candidates, ["model-fast", "model-standard"]);
    // A draft/rolled-back change never becomes a separate remembered value.
    let tx = conn.transaction().unwrap();
    tx.execute(
        "UPDATE ai_provider_keys SET label = 'draft-only' WHERE provider_id = 'a'",
        [],
    )
    .unwrap();
    tx.rollback().unwrap();
    assert_eq!(snapshot(&mut conn).unwrap(), view);
    conn.execute("DELETE FROM ai_providers WHERE id = 'a'", [])
        .unwrap();
    assert_eq!(
        snapshot(&mut conn).unwrap().label_candidates,
        ["personal", "team"]
    );
    conn.execute("DELETE FROM ai_providers WHERE id = 'b'", [])
        .unwrap();
    assert_eq!(snapshot(&mut conn).unwrap().label_candidates, ["team"]);
}

#[test]
fn public_snapshot_cannot_serialize_credential_references_or_journal_contents() {
    let mut conn = database();
    schema::init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "personal", "model-a");
    conn.execute("INSERT INTO ai_credential_journal VALUES('private-journal-reference', 'private-operation', 'retired', 1)", []).unwrap();
    let view = snapshot(&mut conn).unwrap();
    let public = serde_json::to_string(&view).unwrap();
    for private in [
        "private-reference",
        "private-journal",
        "private-operation",
        "credentialRef",
        "credential_ref",
        "apiKey",
    ] {
        assert!(
            !public.contains(private),
            "Unexpected private field: {private}"
        );
        assert!(!format!("{view:?}").contains(private));
    }
    assert_eq!(view.providers[0].keys[0].state, AiKeyState::SavedUnverified);
    conn.execute("UPDATE ai_provider_keys SET credential_ref = NULL", [])
        .unwrap();
    let missing = snapshot(&mut conn).unwrap();
    assert_eq!(missing.providers[0].keys[0].state, AiKeyState::Missing);
    assert_eq!(missing.label_candidates, ["personal"]);
}

#[test]
fn candidates_and_each_providers_selection_survive_reopen() {
    let dir = TestDirectory::new();
    let path = dir.database_path();
    let mut conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);")
        .unwrap();
    schema::init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "personal", "model-a");
    add_provider(&mut conn, "b", "team", "model-b");
    conn.execute(
        "UPDATE ai_settings SET active_provider_id = 'b', streaming_enabled = 0",
        [],
    )
    .unwrap();
    let before = snapshot(&mut conn).unwrap();
    drop(conn);
    let mut reopened = Connection::open(path).unwrap();
    reopened.pragma_update(None, "foreign_keys", "ON").unwrap();
    schema::init(&mut reopened).unwrap();
    assert_eq!(snapshot(&mut reopened).unwrap(), before);
    let tx = reopened.transaction().unwrap();
    schema::reset(&tx, "reset", 1).unwrap();
    tx.commit().unwrap();
    let reset = snapshot(&mut reopened).unwrap();
    assert!(reset.label_candidates.is_empty());
    assert!(reset.model_candidates.is_empty());
}

#[test]
fn read_failures_are_errors_instead_of_empty_configuration() {
    let mut conn = database();
    assert!(snapshot(&mut conn).is_err());
    schema::init(&mut conn).unwrap();
    conn.execute("DROP TABLE ai_provider_keys", []).unwrap();
    add_bare_provider(&conn);
    assert!(snapshot(&mut conn).is_err());
}

fn add_bare_provider(conn: &Connection) {
    // No selected child ids are set; reads must still notice the missing table.
    conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
    conn.execute("INSERT INTO ai_providers(id, name, base_url, created_at, updated_at) VALUES('a', 'a', 'https://example.com', 1, 1)", []).unwrap();
}
