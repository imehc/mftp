use crate::error::{AppError, AppResult, CustomErrorCode};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AuthType {
    Password,
    Key,
}

pub(crate) fn auth_type_to_db(auth_type: AuthType) -> &'static str {
    match auth_type {
        AuthType::Password => "password",
        AuthType::Key => "key",
    }
}

fn auth_type_from_db(value: String) -> AppResult<AuthType> {
    match value.as_str() {
        "password" => Ok(AuthType::Password),
        "key" => Ok(AuthType::Key),
        // Compat read for rows written before the enum was constrained; the
        // stored value is untrusted data, so only the stable code surfaces.
        _ => Err(AppError::custom(CustomErrorCode::HostAuthTypeInvalid)),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    /// Directory to open first in SFTP; falls back to home then "/" if missing.
    #[serde(default)]
    pub default_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Payload for creating/updating a host (id/timestamps managed by backend).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HostInput {
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub default_path: Option<String>,
}

pub(crate) fn host_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Host> {
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
