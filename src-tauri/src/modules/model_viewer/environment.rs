use super::library_validation::{invalid, missing, name, CHUNK};
use super::repository::ModelLibraryRepository;
use crate::error::AppResult;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use specta::Type;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelEnvironment {
    pub id: String,
    pub name: String,
    pub size: u32,
}

fn header(bytes: &[u8]) -> AppResult<()> {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(16384)]);
    if !text.starts_with("#?RADIANCE\n")
        && !text.starts_with("#?RGBE\n")
        && !text.starts_with("#?RADIANCE\r\n")
        && !text.starts_with("#?RGBE\r\n")
    {
        return Err(invalid());
    }
    if !text.lines().any(|line| line == "FORMAT=32-bit_rle_rgbe") {
        return Err(invalid());
    }
    let dimensions = text
        .lines()
        .find(|line| line.starts_with("-Y "))
        .ok_or_else(invalid)?;
    let parts: Vec<_> = dimensions.split_whitespace().collect();
    if parts.len() != 4 || parts[2] != "+X" {
        return Err(invalid());
    }
    let height = parts[1].parse::<u32>().map_err(|_| invalid())?;
    let width = parts[3].parse::<u32>().map_err(|_| invalid())?;
    if height == 0 || height > 1024 || width == 0 || width > 2048 {
        return Err(invalid());
    }
    Ok(())
}

impl ModelLibraryRepository {
    pub(crate) fn environment_begin(&self, file_name: &str, size: u32) -> AppResult<String> {
        if !name(file_name, 240)
            || !file_name.to_ascii_lowercase().ends_with(".hdr")
            || file_name.contains(['/', '\\', ':'])
            || size == 0
            || size > 32 * 1024 * 1024
        {
            return Err(invalid());
        }
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let drafts: i64 = tx.query_row(
            "SELECT COUNT(*) FROM model_environment WHERE ready = 0",
            [],
            |r| r.get(0),
        )?;
        if drafts >= 2 {
            return Err(invalid());
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO model_environment(id, name, size) VALUES(?1, ?2, ?3)",
            params![id, file_name, size],
        )?;
        tx.commit()?;
        Ok(id)
    }
    pub(crate) fn environment_write(&self, id: &str, offset: u32, bytes: &[u8]) -> AppResult<()> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (size, written): (u32, u32) = tx
            .query_row(
                "SELECT size, written FROM model_environment WHERE id = ?1 AND ready = 0",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(missing)?;
        if offset != written
            || offset >= size
            || !(offset as usize).is_multiple_of(CHUNK)
            || bytes.len() != CHUNK.min((size - offset) as usize)
        {
            return Err(invalid());
        }
        if offset == 0 {
            header(bytes)?;
        }
        tx.execute(
            "INSERT INTO model_environment_chunks(id, offset, bytes) VALUES(?1, ?2, ?3)",
            params![id, offset, bytes],
        )?;
        tx.execute(
            "UPDATE model_environment SET written = written + ?2 WHERE id = ?1",
            params![id, bytes.len() as u32],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub(crate) fn environment_commit(&self, id: &str) -> AppResult<()> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let complete: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM model_environment WHERE id = ?1 AND ready = 0 AND written = size)", [id], |r| r.get(0))?;
        if !complete {
            return Err(invalid());
        }
        tx.execute("DELETE FROM model_environment WHERE ready = 1", [])?;
        tx.execute("UPDATE model_environment SET ready = 1 WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }
    pub(crate) fn environment_current(&self) -> AppResult<Option<ModelEnvironment>> {
        Ok(self
            .storage
            .conn()?
            .query_row(
                "SELECT id, name, size FROM model_environment WHERE ready = 1",
                [],
                |r| {
                    Ok(ModelEnvironment {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        size: r.get(2)?,
                    })
                },
            )
            .optional()?)
    }
    pub(crate) fn environment_read(&self, id: &str, offset: u32) -> AppResult<Vec<u8>> {
        if !(offset as usize).is_multiple_of(CHUNK) {
            return Err(invalid());
        }
        self.storage.conn()?.query_row("SELECT c.bytes FROM model_environment_chunks c JOIN model_environment e ON e.id = c.id WHERE c.id = ?1 AND c.offset = ?2 AND e.ready = 1", params![id, offset], |r| r.get(0)).optional()?.ok_or_else(missing)
    }
    pub(crate) fn environment_abort(&self, id: &str) -> AppResult<()> {
        self.storage.conn()?.execute(
            "DELETE FROM model_environment WHERE id = ?1 AND ready = 0",
            [id],
        )?;
        Ok(())
    }
    pub(crate) fn environment_clear(&self) -> AppResult<()> {
        self.storage
            .conn()?
            .execute("DELETE FROM model_environment", [])?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "environment_tests.rs"]
mod tests;
