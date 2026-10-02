use super::model::{auth_type_to_db, host_from_row, Host, HostInput};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::storage::{now_ms, Storage};
use rusqlite::{params, OptionalExtension};

const SELECT_COLUMNS: &str = r#"
            SELECT id, label, host, port, username, auth_type, password, key_id,
                   default_path, created_at, updated_at
            FROM hosts"#;

#[derive(Clone)]
pub(crate) struct HostRepository {
    storage: Storage,
}

impl HostRepository {
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub(crate) fn list(&self) -> AppResult<Vec<Host>> {
        let conn = self.storage.conn()?;
        let mut stmt = conn.prepare(&format!(
            "{SELECT_COLUMNS} ORDER BY sort_order ASC, created_at ASC"
        ))?;
        let hosts = stmt
            .query_map([], host_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(hosts)
    }

    pub(crate) fn get(&self, id: &str) -> AppResult<Host> {
        let conn = self.storage.conn()?;
        conn.query_row(
            &format!("{SELECT_COLUMNS} WHERE id = ?1"),
            params![id],
            host_from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::custom(CustomErrorCode::HostNotFound).with_arg("id", id))
    }

    pub(crate) fn create(&self, input: HostInput) -> AppResult<Host> {
        let conn = self.storage.conn()?;
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

    pub(crate) fn update(&self, id: &str, input: HostInput) -> AppResult<Host> {
        let conn = self.storage.conn()?;
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
            return Err(AppError::custom(CustomErrorCode::HostNotFound).with_arg("id", id));
        }
        self.get(id)
    }

    pub(crate) fn delete(&self, id: &str) -> AppResult<()> {
        let conn = self.storage.conn()?;
        conn.execute("DELETE FROM hosts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub(crate) fn reorder(&self, ordered_ids: Vec<String>) -> AppResult<Vec<Host>> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction()?;
        for (index, id) in ordered_ids.iter().enumerate() {
            let changed = tx.execute(
                "UPDATE hosts SET sort_order = ?2 WHERE id = ?1",
                params![id, index as i64],
            )?;
            if changed == 0 {
                return Err(AppError::custom(CustomErrorCode::HostNotFound).with_arg("id", id));
            }
        }
        tx.commit()?;
        self.list()
    }
}
