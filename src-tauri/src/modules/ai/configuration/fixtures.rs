use rusqlite::{params, Connection};

pub(super) struct TestDirectory(pub std::path::PathBuf);

impl TestDirectory {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!("mftp-ai-v3-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub(super) fn database_path(&self) -> std::path::PathBuf {
        self.0.join("ai.sqlite3")
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);")
        .unwrap();
    conn
}

pub(super) fn old_connection(conn: &Connection, version: i64) {
    conn.execute_batch(
        "CREATE TABLE ai_connection(id INTEGER PRIMARY KEY, base_url TEXT NOT NULL,
         model TEXT NOT NULL, updated_at INTEGER NOT NULL);
         INSERT INTO ai_connection VALUES(1, 'https://API.example.com:443/v1/', 'old-model', 123);",
    )
    .unwrap();
    if version > 0 {
        conn.execute(
            "INSERT INTO app_meta VALUES('ai_schema_version', ?1)",
            [version.to_string()],
        )
        .unwrap();
    }
    if version >= 2 {
        conn.execute_batch(
            "ALTER TABLE ai_connection ADD COLUMN streaming_enabled INTEGER NOT NULL DEFAULT 1;
             UPDATE ai_connection SET streaming_enabled = 0;",
        )
        .unwrap();
    }
}

pub(super) fn add_provider(conn: &mut Connection, id: &str, label: &str, model: &str) {
    let tx = conn.transaction().unwrap();
    tx.execute(
        "INSERT INTO ai_providers(id, name, base_url, endpoint_key, current_key_id,
         current_model_id, created_at, updated_at) VALUES(?1, ?1, ?2, ?2, ?3, ?4, 1, 1)",
        params![
            id,
            format!("https://{id}.example.com/v1/responses"),
            format!("{id}-key"),
            format!("{id}-model")
        ],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO ai_provider_keys VALUES(?1, ?2, ?3, ?4, 1, 1)",
        params![
            format!("{id}-key"),
            id,
            label,
            format!("private-reference-{id}")
        ],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO ai_provider_models VALUES(?1, ?2, ?3, ?4, NULL, 0, 1, 1)",
        params![format!("{id}-model"), id, model, model.trim()],
    )
    .unwrap();
    tx.commit().unwrap();
}

pub(super) fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [name],
        |r| r.get(0),
    )
    .unwrap()
}
