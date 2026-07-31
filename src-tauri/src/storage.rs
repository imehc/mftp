use crate::error::{AppError, AppResult};
use crate::models::{AuthType, Host, HostInput, SshKey};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const DB_FILE: &str = "mftp.sqlite3";

mod activity;
mod export;
mod import;
mod lan;
mod vault;

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
        let conn = self.conn()?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS app_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS hosts (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL,
                password TEXT,
                key_id TEXT,
                default_path TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ssh_keys (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                filename TEXT NOT NULL,
                private_key TEXT NOT NULL,
                has_passphrase INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_hosts_sort_order ON hosts(sort_order);

            CREATE TABLE IF NOT EXISTS lan_transfer_settings (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                device_name TEXT NOT NULL,
                port INTEGER NOT NULL,
                bind_host TEXT NOT NULL DEFAULT '',
                download_dir TEXT NOT NULL,
                auto_start INTEGER NOT NULL,
                security_mode TEXT NOT NULL,
                default_permission TEXT NOT NULL,
                max_concurrent_transfers INTEGER NOT NULL DEFAULT 3
            );

            CREATE TABLE IF NOT EXISTS lan_shared_dirs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lan_trusted_devices (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                ip TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lan_access_logs (
                id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                ip TEXT NOT NULL,
                request_type TEXT NOT NULL,
                result TEXT NOT NULL,
                detail TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_lan_access_logs_created_at
            ON lan_access_logs(created_at DESC);

            CREATE TABLE IF NOT EXISTS vault_entries (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                url TEXT,
                username TEXT,
                password TEXT,
                category TEXT,
                notes TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            DROP TABLE IF EXISTS lan_transfer_history;

            "#,
        )?;
        add_column_if_missing(
            &conn,
            "lan_transfer_settings",
            "bind_host",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        add_column_if_missing(
            &conn,
            "lan_transfer_settings",
            "max_concurrent_transfers",
            "INTEGER NOT NULL DEFAULT 3",
        )?;
        add_column_if_missing(
            &conn,
            "lan_access_logs",
            "source",
            "TEXT NOT NULL DEFAULT 'lan'",
        )?;
        vault::relax_vault_not_null_columns(&conn)?;
        // sort_order arrived after release builds existed; the relax rebuild
        // above copies columns positionally, so this must run after it.
        add_column_if_missing(
            &conn,
            "vault_entries",
            "sort_order",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_vault_entries_sort_order ON vault_entries(sort_order)",
            [],
        )?;
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
            let private_key = fs::read_to_string(&key_path).map_err(|error| {
                AppError(format!(
                    "迁移密钥失败：无法读取 {}: {error}",
                    key_path.display()
                ))
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

    pub fn list_hosts(&self) -> AppResult<Vec<Host>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, label, host, port, username, auth_type, password, key_id,
                   default_path, created_at, updated_at
            FROM hosts
            ORDER BY sort_order ASC, created_at ASC
            "#,
        )?;
        let hosts = stmt
            .query_map([], host_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(hosts)
    }

    pub fn get_host(&self, id: &str) -> AppResult<Host> {
        let conn = self.conn()?;
        conn.query_row(
            r#"
            SELECT id, label, host, port, username, auth_type, password, key_id,
                   default_path, created_at, updated_at
            FROM hosts
            WHERE id = ?1
            "#,
            params![id],
            host_from_row,
        )
        .optional()?
        .ok_or_else(|| AppError(format!("host not found: {id}")))
    }

    pub fn create_host(&self, input: HostInput) -> AppResult<Host> {
        let conn = self.conn()?;
        let ts = now_ms();
        let id = uuid::Uuid::new_v4().to_string();
        let sort_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM hosts",
            [],
            |row| row.get(0),
        )?;
        let host = Host {
            id,
            label: input.label,
            host: input.host,
            port: input.port,
            username: input.username,
            auth_type: input.auth_type,
            password: input.password,
            key_id: input.key_id,
            default_path: input.default_path,
            created_at: ts,
            updated_at: ts,
        };
        conn.execute(
            r#"
            INSERT INTO hosts(
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
                sort_order,
                host.created_at,
                host.updated_at,
            ],
        )?;
        Ok(host)
    }

    pub fn update_host(&self, id: &str, input: HostInput) -> AppResult<Host> {
        let conn = self.conn()?;
        let ts = now_ms();
        let changed = conn.execute(
            r#"
            UPDATE hosts
            SET label = ?2,
                host = ?3,
                port = ?4,
                username = ?5,
                auth_type = ?6,
                password = ?7,
                key_id = ?8,
                default_path = ?9,
                updated_at = ?10
            WHERE id = ?1
            "#,
            params![
                id,
                input.label,
                input.host,
                input.port,
                input.username,
                auth_type_to_db(input.auth_type),
                input.password,
                input.key_id,
                input.default_path,
                ts,
            ],
        )?;
        if changed == 0 {
            return Err(AppError(format!("host not found: {id}")));
        }
        self.get_host(id)
    }

    pub fn delete_host(&self, id: &str) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM hosts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn reorder_hosts(&self, ordered_ids: Vec<String>) -> AppResult<Vec<Host>> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        for (index, id) in ordered_ids.iter().enumerate() {
            let changed = tx.execute(
                "UPDATE hosts SET sort_order = ?2 WHERE id = ?1",
                params![id, index as i64],
            )?;
            if changed == 0 {
                return Err(AppError(format!("host not found: {id}")));
            }
        }
        tx.commit()?;
        self.list_hosts()
    }

    pub fn list_keys(&self) -> AppResult<Vec<SshKey>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, label, filename, has_passphrase, created_at
            FROM ssh_keys
            ORDER BY created_at ASC
            "#,
        )?;
        let keys = stmt
            .query_map([], ssh_key_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(keys)
    }

    pub fn get_key(&self, id: &str) -> AppResult<SshKey> {
        let conn = self.conn()?;
        conn.query_row(
            r#"
            SELECT id, label, filename, has_passphrase, created_at
            FROM ssh_keys
            WHERE id = ?1
            "#,
            params![id],
            ssh_key_from_row,
        )
        .optional()?
        .ok_or_else(|| AppError(format!("key not found: {id}")))
    }

    pub fn key_private_key(&self, id: &str) -> AppResult<String> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT private_key FROM ssh_keys WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError(format!("key not found: {id}")))
    }

    pub fn import_key(
        &self,
        label: String,
        source_path: &str,
        has_passphrase: bool,
    ) -> AppResult<SshKey> {
        let private_key = fs::read_to_string(source_path)?;
        let id = uuid::Uuid::new_v4().to_string();
        let filename = Path::new(source_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("id_key")
            .to_string();
        let key = SshKey {
            id,
            label,
            filename,
            has_passphrase,
            created_at: now_ms(),
        };
        let conn = self.conn()?;
        conn.execute(
            r#"
            INSERT INTO ssh_keys(
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
        Ok(key)
    }

    pub fn delete_key(&self, id: &str) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM ssh_keys WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }
}

fn auth_type_to_db(auth_type: AuthType) -> &'static str {
    match auth_type {
        AuthType::Password => "password",
        AuthType::Key => "key",
    }
}

fn auth_type_from_db(value: String) -> AppResult<AuthType> {
    match value.as_str() {
        "password" => Ok(AuthType::Password),
        "key" => Ok(AuthType::Key),
        _ => Err(AppError(format!("unknown auth type: {value}"))),
    }
}

pub(super) fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> AppResult<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|item| item == column) {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

fn host_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Host> {
    let auth_type: String = row.get(5)?;
    Ok(Host {
        id: row.get(0)?,
        label: row.get(1)?,
        host: row.get(2)?,
        port: row.get::<_, u16>(3)?,
        username: row.get(4)?,
        auth_type: auth_type_from_db(auth_type)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?,
        password: row.get(6)?,
        key_id: row.get(7)?,
        default_path: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn ssh_key_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SshKey> {
    let has_passphrase: i64 = row.get(3)?;
    Ok(SshKey {
        id: row.get(0)?,
        label: row.get(1)?,
        filename: row.get(2)?,
        has_passphrase: has_passphrase != 0,
        created_at: row.get(4)?,
    })
}

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) {}
