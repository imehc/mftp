use crate::error::{AppError, AppResult};
use crate::modules::hosts::model::{auth_type_to_db, Host};
use crate::modules::keys::model::SshKey;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const DB_FILE: &str = "mftp.sqlite3";
pub(crate) mod activity;
mod data;
mod export;
mod helpers;
mod import;

pub(crate) use helpers::{add_column_if_missing, bool_to_int};

use helpers::restrict_file_permissions;

#[derive(Clone)]
pub struct Storage {
    root: PathBuf,
    db_path: PathBuf,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Storage {
    pub fn new(root: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&root)?;
        let storage = Storage {
            db_path: root.join(DB_FILE),
            root,
        };
        storage.sweep_bt_tombstones();
        storage.init_db()?;
        restrict_file_permissions(&storage.db_path);
        storage.migrate_legacy_json()?;
        Ok(storage)
    }

    pub(super) fn conn(&self) -> AppResult<Connection> {
        let conn = Connection::open(&self.db_path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }

    fn init_db(&self) -> AppResult<()> {
        let mut conn = self.conn()?;
        // Must run before the shared schema below creates `activity_logs`,
        // otherwise the rename guard can no longer tell old from new.
        activity::migrate_table_name(&conn)?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS app_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                ip TEXT NOT NULL,
                request_type TEXT NOT NULL,
                result TEXT NOT NULL,
                detail TEXT,
                error_payload TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
            ON activity_logs(created_at DESC);

            "#,
        )?;
        add_column_if_missing(
            &conn,
            "activity_logs",
            "source",
            "TEXT NOT NULL DEFAULT 'lan'",
        )?;
        activity::ensure_error_payload_column(&conn)?;
        crate::modules::hosts::schema::init(&conn)?;
        crate::modules::keys::schema::init(&conn)?;
        crate::modules::lan_transfer::schema::init(&mut conn)?;
        crate::modules::vault::schema::init(&conn)?;
        crate::modules::bt::schema::init(&mut conn)?;
        crate::modules::todo::schema::init(&mut conn)?;
        crate::modules::ai::schema::init(&mut conn)?;
        Ok(())
    }

    fn hosts_file(&self) -> PathBuf {
        self.root.join("hosts.json")
    }

    fn keys_file(&self) -> PathBuf {
        self.root.join("keys.json")
    }

    fn legacy_keys_dir(&self) -> PathBuf {
        self.root.join("keys")
    }

    fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> AppResult<T> {
        if !path.exists() {
            return Ok(T::default());
        }
        let raw = fs::read_to_string(path)?;
        if raw.trim().is_empty() {
            return Ok(T::default());
        }
        Ok(serde_json::from_str(&raw)?)
    }

    fn migration_done(&self, conn: &Connection) -> AppResult<bool> {
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'legacy_json_migrated'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.as_deref() == Some("1"))
    }

    fn set_migration_done(&self, conn: &Connection) -> AppResult<()> {
        conn.execute(
            "INSERT INTO app_meta(key, value) VALUES('legacy_json_migrated', '1')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        )?;
        Ok(())
    }

    fn migrate_legacy_json(&self) -> AppResult<()> {
        let mut conn = self.conn()?;
        if self.migration_done(&conn)? {
            return Ok(());
        }

        let existing_hosts: i64 =
            conn.query_row("SELECT COUNT(*) FROM hosts", [], |row| row.get(0))?;
        let existing_keys: i64 =
            conn.query_row("SELECT COUNT(*) FROM ssh_keys", [], |row| row.get(0))?;
        if existing_hosts > 0 || existing_keys > 0 {
            self.set_migration_done(&conn)?;
            return Ok(());
        }

        let hosts: Vec<Host> = Self::read_json(&self.hosts_file())?;
        let keys: Vec<SshKey> = Self::read_json(&self.keys_file())?;
        let tx = conn.transaction()?;

        for (index, host) in hosts.iter().enumerate() {
            tx.execute(
                r#"
                INSERT OR IGNORE INTO hosts(
                    id, label, host, port, username, auth_type, password, key_id,
                    default_path, sort_order, created_at, updated_at
                )
                VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                "#,
                params![
                    host.id,
                    host.label,
                    host.host,
                    host.port,
                    host.username,
                    auth_type_to_db(host.auth_type.clone()),
                    host.password,
                    host.key_id,
                    host.default_path,
                    index as i64,
                    host.created_at,
                    host.updated_at,
                ],
            )?;
        }

        for key in keys {
            let key_path = self.legacy_keys_dir().join(&key.filename);
            // The IO error keeps its own external code; the context and the
            // key file name (never the absolute path) aid diagnosis.
            let private_key = fs::read_to_string(&key_path).map_err(|error| {
                AppError::from_io(&error)
                    .context("failed to migrate legacy SSH key")
                    .with_arg("filename", &key.filename)
            })?;
            tx.execute(
                r#"
                INSERT OR IGNORE INTO ssh_keys(
                    id, label, filename, private_key, has_passphrase, created_at
                )
                VALUES(?1, ?2, ?3, ?4, ?5, ?6)
                "#,
                params![
                    key.id,
                    key.label,
                    key.filename,
                    private_key,
                    bool_to_int(key.has_passphrase),
                    key.created_at,
                ],
            )?;
        }

        tx.execute(
            "INSERT INTO app_meta(key, value) VALUES('legacy_json_migrated', '1')",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    // Only BT adapters/repositories and storage-backed tests need this path.
    #[cfg(any(desktop, target_os = "android", test))]
    pub(crate) fn root_path(&self) -> &Path {
        &self.root
    }
}
