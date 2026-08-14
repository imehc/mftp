use crate::error::{AppError, AppResult};
use crate::models::{AuthType, Host, SshKey};
use rusqlite::Connection;
use std::fs;
use std::path::Path;

pub(super) fn auth_type_to_db(auth_type: AuthType) -> &'static str {
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

pub(super) fn add_column_if_missing(
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

pub(super) fn host_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Host> {
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

pub(super) fn ssh_key_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SshKey> {
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
pub(super) fn restrict_file_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
pub(super) fn restrict_file_permissions(_path: &Path) {}
