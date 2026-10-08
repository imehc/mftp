use super::library_models::{ModelLibraryCatalog, ModelLibraryEntry};
use super::library_validation::invalid;
use super::repository::ModelLibraryRepository;
use crate::error::AppResult;
use crate::storage::now_ms;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

const DEFAULT_LIMIT: u32 = 64 * 1024 * 1024;
fn limit(conn: &Connection) -> AppResult<u32> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'model_viewer_cache_limit'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    value.map_or(Ok(DEFAULT_LIMIT), |v| {
        v.parse::<u32>().map_err(|_| invalid())
    })
}
fn evict(conn: &Connection, max: u32) -> AppResult<()> {
    let mut bytes: i64 = conn.query_row(
        "SELECT COALESCE(SUM(LENGTH(bytes)), 0) FROM model_thumbnail_cache",
        [],
        |r| r.get(0),
    )?;
    let entries = conn.prepare("SELECT model_id, LENGTH(bytes) FROM model_thumbnail_cache ORDER BY touched_at, model_id")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
    for (id, size) in entries {
        if bytes <= i64::from(max) {
            break;
        }
        conn.execute(
            "DELETE FROM model_thumbnail_cache WHERE model_id = ?1",
            [id],
        )?;
        bytes -= size;
    }
    Ok(())
}

impl ModelLibraryRepository {
    pub(crate) fn catalog(&self) -> AppResult<ModelLibraryCatalog> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction()?;
        let entries = tx.prepare("SELECT m.id, m.name, m.source_name, m.size, m.favorite, m.group_name, m.updated_at,
            c.model_id IS NOT NULL FROM model_library m LEFT JOIN model_thumbnail_cache c ON c.model_id = m.id
            WHERE m.ready = 1 ORDER BY m.favorite DESC, m.updated_at DESC, m.id")?
            .query_map([], |r| {
                Ok(ModelLibraryEntry { id: r.get(0)?, name: r.get(1)?, source_name: r.get(2)?,
                    size: r.get(3)?, favorite: r.get(4)?, group: r.get(5)?, updated_at: r.get::<_, i64>(6)? as f64,
                    has_thumbnail: r.get(7)? })
            })?.collect::<Result<Vec<_>, _>>()?;
        let library_bytes = tx.query_row(
            "SELECT COALESCE(SUM(size), 0) FROM model_library WHERE ready = 1",
            [],
            |r| r.get::<_, i64>(0),
        )? as f64;
        let cache_bytes = tx.query_row(
            "SELECT COALESCE(SUM(LENGTH(bytes)), 0) FROM model_thumbnail_cache",
            [],
            |r| r.get::<_, i64>(0),
        )? as f64;
        let cache_limit = limit(&tx)?;
        let last_id = tx
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'model_viewer_last_id' AND EXISTS(
            SELECT 1 FROM model_library WHERE id = value AND ready = 1)",
                [],
                |r| r.get(0),
            )
            .optional()?;
        tx.commit()?;
        Ok(ModelLibraryCatalog {
            entries,
            library_bytes,
            cache_bytes,
            cache_limit,
            last_id,
        })
    }

    pub(crate) fn read_thumbnail(&self, id: &str) -> AppResult<Option<String>> {
        let bytes: Option<Vec<u8>> = self
            .storage
            .conn()?
            .query_row(
                "SELECT bytes FROM model_thumbnail_cache WHERE model_id = ?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(bytes.map(|b| format!("data:image/png;base64,{}", STANDARD.encode(b))))
    }

    pub(crate) fn thumbnail(&self, id: &str, bytes: &[u8]) -> AppResult<()> {
        // Accept only bounded PNG thumbnails; arbitrary HTML/SVG never becomes image data.
        if bytes.len() > 256 * 1024
            || bytes.len() < 24
            || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || &bytes[12..16] != b"IHDR"
        {
            return Err(invalid());
        }
        let width = u32::from_be_bytes(bytes[16..20].try_into().map_err(|_| invalid())?);
        let height = u32::from_be_bytes(bytes[20..24].try_into().map_err(|_| invalid())?);
        if width == 0 || height == 0 || width > 256 || height > 256 {
            return Err(invalid());
        }
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let max = limit(&tx)?;
        if bytes.len() <= max as usize {
            tx.execute("INSERT INTO model_thumbnail_cache(model_id, bytes, touched_at)
                SELECT id, ?2, ?3 FROM model_library WHERE id = ?1 AND ready = 1
                ON CONFLICT(model_id) DO UPDATE SET bytes = excluded.bytes, touched_at = excluded.touched_at",
                params![id, bytes, now_ms()])?;
        }
        evict(&tx, max)?;
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn configure_cache(&self, max: u32, clear: bool) -> AppResult<()> {
        if max > 256 * 1024 * 1024 {
            return Err(invalid());
        }
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO app_meta(key, value) VALUES('model_viewer_cache_limit', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [max.to_string()],
        )?;
        evict(&tx, if clear { 0 } else { max })?;
        tx.commit()?;
        Ok(())
    }
}
