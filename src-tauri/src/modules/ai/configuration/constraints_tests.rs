use super::super::{fixtures::*, read::snapshot};
use super::*;

fn assert_constraint<T>(result: rusqlite::Result<T>) {
    assert!(
        matches!(result, Err(rusqlite::Error::SqliteFailure(error, _))
        if error.code == rusqlite::ErrorCode::ConstraintViolation)
    );
}

#[test]
fn provider_selection_cannot_reference_another_providers_key_or_model() {
    let mut conn = database();
    init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "personal", "model-a");
    add_provider(&mut conn, "b", "personal", "model-b");
    for sql in [
        "UPDATE ai_providers SET current_key_id = 'b-key' WHERE id = 'a'",
        "UPDATE ai_providers SET current_model_id = 'b-model' WHERE id = 'a'",
    ] {
        let tx = conn.transaction().unwrap();
        tx.execute(sql, []).unwrap();
        assert_constraint(tx.commit());
    }
    let view = snapshot(&mut conn).unwrap();
    let a = view.providers.iter().find(|p| p.id == "a").unwrap();
    assert_eq!(a.current_key_id.as_deref(), Some("a-key"));
    assert_eq!(a.current_model_id.as_deref(), Some("a-model"));
    assert_constraint(conn.execute(
        "UPDATE ai_settings SET active_provider_id = 'nonexistent'",
        [],
    ));
}

#[test]
fn children_are_unique_per_provider_and_credential_references_are_never_shared() {
    let mut conn = database();
    init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "personal", " model-a ");
    add_provider(&mut conn, "b", "personal", "model-a");
    assert_constraint(conn.execute(
        "INSERT INTO ai_provider_keys VALUES('duplicate-label', 'a', 'personal', NULL, 1, 1)",
        [],
    ));
    assert_constraint(conn.execute(
        "UPDATE ai_provider_keys SET credential_ref = 'private-reference-a' WHERE provider_id = 'b'", [],
    ));
    assert_constraint(conn.execute(
        "INSERT INTO ai_provider_models VALUES('duplicate-model', 'a', 'model-a', 'model-a', NULL, 0, 1, 1)", [],
    ));
    assert_constraint(conn.execute(
        "INSERT INTO ai_provider_models VALUES('orphan', 'nonexistent', 'model', 'model', NULL, 0, 1, 1)", [],
    ));
}

#[test]
fn equivalent_endpoints_are_rejected_but_case_sensitive_paths_remain_distinct() {
    let mut conn = database();
    init(&mut conn).unwrap();
    for (id, address) in [
        ("a", "https://example.com"),
        ("b", "https://example.com/Team"),
        ("c", "https://example.com/team"),
    ] {
        conn.execute(
            "INSERT INTO ai_providers(id, name, base_url, endpoint_key, created_at, updated_at) VALUES(?1, ?1, ?2, ?3, 1, 1)",
            params![id, address, normalized_endpoint(address).unwrap()],
        ).unwrap();
    }
    assert_constraint(conn.execute(
        "INSERT INTO ai_providers(id, name, base_url, endpoint_key, created_at, updated_at) VALUES('d', 'd', ?1, ?2, 1, 1)",
        params!["https://EXAMPLE.com:443/v1/", normalized_endpoint("https://EXAMPLE.com:443/v1/").unwrap()],
    ));
    assert_eq!(snapshot(&mut conn).unwrap().providers.len(), 3);
}

#[test]
fn deleting_selected_provider_cascades_only_its_children_and_clears_active_selection() {
    let mut conn = database();
    init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "personal", "model-a");
    add_provider(&mut conn, "b", "team", "model-b");
    conn.execute("UPDATE ai_settings SET active_provider_id = 'a'", [])
        .unwrap();
    conn.execute("DELETE FROM ai_providers WHERE id = 'a'", [])
        .unwrap();
    let view = snapshot(&mut conn).unwrap();
    assert_eq!(view.active_provider_id, None);
    assert_eq!(view.providers.len(), 1);
    assert_eq!(view.providers[0].id, "b");
    assert_eq!(view.providers[0].keys[0].id, "b-key");
    assert_eq!(view.providers[0].models[0].id, "b-model");
    // Production deletion must additionally queue credential cleanup in 4C.
}

#[test]
fn outer_transaction_failure_restores_reset_data_and_cleanup_queue() {
    let mut conn = database();
    init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "personal", "model-a");
    let before = snapshot(&mut conn).unwrap();
    {
        let tx = conn.transaction().unwrap();
        reset(&tx, "reset-attempt", 1).unwrap();
        // A later maintenance participant fails, so the caller rolls back.
        tx.rollback().unwrap();
    }
    assert_eq!(snapshot(&mut conn).unwrap(), before);
    let pending: i64 = conn
        .query_row("SELECT COUNT(*) FROM ai_credential_journal", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(pending, 0);
}

#[test]
fn reset_revision_overflow_cannot_wrap_and_revalidate_stale_requests() {
    let mut conn = database();
    init(&mut conn).unwrap();
    add_provider(&mut conn, "a", "personal", "model-a");
    conn.execute("UPDATE ai_settings SET revision = 9007199254740991", [])
        .unwrap();
    let tx = conn.transaction().unwrap();
    assert!(reset(&tx, "overflow-attempt", 1).is_err());
    tx.rollback().unwrap();
    assert_eq!(snapshot(&mut conn).unwrap().providers.len(), 1);
}
