use super::library_models::*;
use super::library_validation::{self as validate, invalid, missing, CHUNK};
use crate::error::AppResult;
use crate::storage::{now_ms, Storage};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

#[derive(Clone)]
pub(crate) struct ModelLibraryRepository {
    pub(super) storage: Storage,
}

impl ModelLibraryRepository {
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub(crate) fn begin(&self, input: ModelLibraryInput) -> AppResult<String> {
        let size = validate::input(&input)?;
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let count: i64 = tx.query_row("SELECT COUNT(*) FROM model_library", [], |r| r.get(0))?;
        let drafts: i64 = tx.query_row(
            "SELECT COUNT(*) FROM model_library WHERE ready = 0",
            [],
            |r| r.get(0),
        )?;
        if count >= 1000 || drafts >= 8 {
            return Err(invalid());
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO model_library(id, name, source_name, size, view_json, updated_at)
            VALUES(?1, ?2, ?2, ?3, ?4, ?5)",
            params![
                id,
                input.name,
                size,
                serde_json::to_string(&input.view)?,
                now_ms()
            ],
        )?;
        for resource in input.resources {
            tx.execute(
                "INSERT INTO model_resources(model_id, key, size) VALUES(?1, ?2, ?3)",
                params![id, resource.key, resource.size],
            )?;
        }
        tx.commit()?;
        Ok(id)
    }

    pub(crate) fn write(&self, id: &str, key: &str, offset: u32, bytes: &[u8]) -> AppResult<()> {
        if bytes.is_empty() || bytes.len() > CHUNK {
            return Err(invalid());
        }
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let range: Option<(u32, u32)> = tx.query_row(
            "SELECT r.size, r.written FROM model_resources r JOIN model_library m ON m.id = r.model_id
             WHERE r.model_id = ?1 AND r.key = ?2 AND m.ready = 0", params![id, key],
            |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        let (size, written) = range.ok_or_else(missing)?;
        // Contiguous fixed-size chunks make gaps, duplicate replay and read offsets unambiguous.
        if offset != written
            || offset > size
            || !(offset as usize).is_multiple_of(CHUNK)
            || bytes.len() != CHUNK.min((size - offset) as usize)
        {
            return Err(invalid());
        }
        tx.execute(
            "INSERT INTO model_chunks(model_id, key, offset, bytes) VALUES(?1, ?2, ?3, ?4)",
            params![id, key, offset, bytes],
        )?;
        tx.execute(
            "UPDATE model_resources SET written = written + ?3 WHERE model_id = ?1 AND key = ?2",
            params![id, key, bytes.len() as u32],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn commit(&self, id: &str) -> AppResult<()> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute(
            "UPDATE model_library SET ready = 1 WHERE id = ?1 AND ready = 0
            AND NOT EXISTS(SELECT 1 FROM model_resources WHERE model_id = ?1 AND size != written)",
            [id],
        )?;
        if changed != 1 {
            return Err(invalid());
        }
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn document(&self, id: &str) -> AppResult<ModelLibraryDocument> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction()?;
        let (source_name, json): (String, String) = tx
            .query_row(
                "SELECT source_name, view_json FROM model_library WHERE id = ?1 AND ready = 1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(missing)?;
        let view: ModelViewState = serde_json::from_str(&json)?;
        validate::view(&view)?;
        let resources = tx
            .prepare("SELECT key, size FROM model_resources WHERE model_id = ?1 ORDER BY key")?
            .query_map([id], |r| {
                Ok(ModelLibraryResource {
                    key: r.get(0)?,
                    size: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        tx.execute(
            "UPDATE model_thumbnail_cache SET touched_at = ?2 WHERE model_id = ?1",
            params![id, now_ms()],
        )?;
        tx.commit()?;
        Ok(ModelLibraryDocument {
            source_name,
            resources,
            view,
        })
    }

    pub(crate) fn read(&self, id: &str, key: &str, offset: u32) -> AppResult<Vec<u8>> {
        if !(offset as usize).is_multiple_of(CHUNK) {
            return Err(invalid());
        }
        self.storage
            .conn()?
            .query_row(
                "SELECT c.bytes FROM model_chunks c JOIN model_library m ON m.id = c.model_id
             WHERE c.model_id = ?1 AND c.key = ?2 AND c.offset = ?3 AND m.ready = 1",
                params![id, key, offset],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(missing)
    }

    pub(crate) fn edit(&self, id: &str, input: ModelLibraryEdit) -> AppResult<()> {
        if !validate::name(&input.name, 1024)
            || (!input.group.is_empty() && !validate::name(&input.group, 240))
        {
            return Err(invalid());
        }
        let changed = self.storage.conn()?.execute(
            "UPDATE model_library SET name = ?2, favorite = ?3, group_name = ?4, updated_at = ?5
             WHERE id = ?1 AND ready = 1",
            params![
                id,
                input.name.trim(),
                input.favorite,
                input.group.trim(),
                now_ms()
            ],
        )?;
        if changed != 1 {
            return Err(missing());
        }
        Ok(())
    }

    pub(crate) fn save_view(&self, id: &str, view: ModelViewState) -> AppResult<()> {
        validate::view(&view)?;
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute(
            "UPDATE model_library SET view_json = ?2 WHERE id = ?1 AND ready = 1",
            params![id, serde_json::to_string(&view)?],
        )?;
        if changed != 1 {
            return Err(missing());
        }
        tx.execute(
            "INSERT INTO app_meta(key, value) VALUES('model_viewer_last_id', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn delete(&self, id: &str, draft_only: bool) -> AppResult<()> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Cleanup of an interrupted upload cannot delete a successfully published model.
        let changed = tx.execute(
            "DELETE FROM model_library WHERE id = ?1 AND (?2 = 0 OR ready = 0)",
            params![id, draft_only],
        )?;
        if changed != 0 {
            tx.execute(
                "DELETE FROM app_meta WHERE key = 'model_viewer_last_id' AND value = ?1",
                [id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "library_tests.rs"]
mod tests;
