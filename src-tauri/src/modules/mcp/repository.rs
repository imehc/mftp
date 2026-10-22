use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::model::{McpCredential, McpCredentialInput, McpIssuedCredential};
use crate::{
    error::{AppError, AppResult, CustomErrorCode},
    storage::{now_ms, Storage},
};

#[derive(Clone)]
pub(crate) struct Repository(pub(crate) Storage);

pub(crate) const DEFAULT_PORT: u16 = 6021;

pub(crate) fn invalid() -> AppError {
    AppError::custom(CustomErrorCode::McpConfigurationInvalid)
}

pub(crate) fn digest(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn init(connection: &mut rusqlite::Connection) -> AppResult<()> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: Option<String> = transaction
        .query_row(
            "SELECT value FROM app_meta WHERE key='mcp_schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if version
        .as_deref()
        .is_some_and(|version| version != "1" && version != "2")
    {
        return Err(invalid());
    }
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS mcp_settings (
        id INTEGER PRIMARY KEY CHECK(id=1), port INTEGER NOT NULL CHECK(port BETWEEN 1024 AND 65535)
    ); CREATE TABLE IF NOT EXISTS mcp_credentials (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,
        grants TEXT NOT NULL, created_at INTEGER NOT NULL
    );",
    )?;
    transaction.execute(
        "INSERT OR IGNORE INTO mcp_settings(id,port) VALUES(1,?1)",
        [DEFAULT_PORT],
    )?;
    if version.as_deref() == Some("1") {
        transaction.execute(
            "UPDATE mcp_settings SET port=?1 WHERE id=1 AND port=1489",
            [DEFAULT_PORT],
        )?;
    }
    transaction.execute("INSERT INTO app_meta(key,value) VALUES('mcp_schema_version','2') ON CONFLICT(key) DO UPDATE SET value=excluded.value", [])?;
    transaction.commit()?;
    Ok(())
}

impl Repository {
    pub(crate) fn port(&self) -> AppResult<u16> {
        Ok(self
            .0
            .conn()?
            .query_row("SELECT port FROM mcp_settings WHERE id=1", [], |row| {
                row.get(0)
            })?)
    }

    pub(crate) fn set_port(&self, port: u16) -> AppResult<()> {
        if port < 1024 {
            return Err(invalid());
        }
        self.0
            .conn()?
            .execute("UPDATE mcp_settings SET port=?1 WHERE id=1", [port])?;
        Ok(())
    }

    pub(crate) fn list(&self) -> AppResult<Vec<McpCredential>> {
        let connection = self.0.conn()?;
        let mut statement = connection.prepare(
            "SELECT id,name,grants,created_at FROM mcp_credentials ORDER BY created_at,id",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(id, name, grants, created_at)| {
                Ok(McpCredential {
                    id,
                    name,
                    grants: serde_json::from_str(&grants)?,
                    created_at: created_at as f64,
                })
            })
            .collect()
    }

    pub(crate) fn authenticate(&self, token_digest: &str) -> AppResult<McpCredential> {
        let connection = self.0.conn()?;
        let id: Option<String> = connection
            .query_row(
                "SELECT id FROM mcp_credentials WHERE digest=?1",
                [token_digest],
                |row| row.get(0),
            )
            .optional()?;
        self.list()?
            .into_iter()
            .find(|credential| Some(&credential.id) == id.as_ref())
            .ok_or_else(|| AppError::custom(CustomErrorCode::McpUnauthorized))
    }

    pub(crate) fn issue(
        &self,
        input: McpCredentialInput,
        replace: Option<&str>,
    ) -> AppResult<McpIssuedCredential> {
        let mut entropy = Zeroizing::new([0_u8; 32]);
        getrandom::fill(entropy.as_mut()).map_err(|_| invalid())?;
        let token = format!("mftp_{}", URL_SAFE_NO_PAD.encode(entropy.as_ref()));
        let mut connection = self.0.conn()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if replace.is_none()
            && transaction.query_row("SELECT COUNT(*) FROM mcp_credentials", [], |row| {
                row.get::<_, u32>(0)
            })? >= 16
        {
            return Err(invalid());
        }
        let id = replace
            .map(str::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let created_at = now_ms();
        let grants = serde_json::to_string(&input.grants)?;
        if replace.is_some() {
            if transaction.execute(
                "UPDATE mcp_credentials SET digest=?2,name=?3,grants=?4 WHERE id=?1",
                params![id, digest(&token), input.name, grants],
            )? != 1
            {
                return Err(invalid());
            }
        } else {
            transaction.execute("INSERT INTO mcp_credentials(id,name,digest,grants,created_at) VALUES(?1,?2,?3,?4,?5)", params![id,input.name,digest(&token),grants,created_at])?;
        }
        transaction.commit()?;
        let credential = self
            .list()?
            .into_iter()
            .find(|credential| credential.id == id)
            .ok_or_else(invalid)?;
        Ok(McpIssuedCredential { credential, token })
    }

    pub(crate) fn update(&self, id: &str, input: McpCredentialInput) -> AppResult<()> {
        if self.0.conn()?.execute(
            "UPDATE mcp_credentials SET name=?2,grants=?3 WHERE id=?1",
            params![id, input.name, serde_json::to_string(&input.grants)?],
        )? != 1
        {
            return Err(invalid());
        }
        Ok(())
    }

    pub(crate) fn delete(&self, id: &str) -> AppResult<()> {
        if self
            .0
            .conn()?
            .execute("DELETE FROM mcp_credentials WHERE id=?1", [id])?
            != 1
        {
            return Err(invalid());
        }
        Ok(())
    }
}
