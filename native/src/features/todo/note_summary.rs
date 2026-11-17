//! Compact list metadata is committed with the document, never with image bytes.
use super::database::TodoDatabase;
use crate::components::rich_text::RichTextDocument;
use mftp_foundation::AppResult;
use mftp_todo::Database;
use rusqlite::{Connection, params};
use std::collections::HashMap;

#[derive(Clone, Default)]
pub(crate) struct NoteSummary {
    pub first_image: Option<String>,
    pub image_count: usize,
}

pub(crate) struct Projection {
    pub todos: mftp_todo::TodoProjection,
    pub notes: HashMap<String, NoteSummary>,
}

pub(super) fn migrate(conn: &Connection) -> AppResult<()> {
    let present: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('native_rich_text_notes') WHERE name='image_count')",
        [], |row| row.get(0),
    )?;
    if present {
        return Ok(());
    }
    conn.execute_batch(
        "ALTER TABLE native_rich_text_notes ADD COLUMN first_image TEXT;
        ALTER TABLE native_rich_text_notes ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;",
    )?;
    let documents: Vec<(String, String)> = conn
        .prepare("SELECT item_id,document FROM native_rich_text_notes")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (id, encoded) in documents {
        let document: RichTextDocument = serde_json::from_str(&encoded)?;
        update(conn, &id, &document)?;
    }
    Ok(())
}

pub(super) fn update(conn: &Connection, item: &str, document: &RichTextDocument) -> AppResult<()> {
    let images = document.image_ids()?;
    conn.execute(
        "UPDATE native_rich_text_notes SET first_image=?2,image_count=?3 WHERE item_id=?1",
        params![item, images.first(), images.len() as i64],
    )?;
    Ok(())
}

pub(super) fn load(database: &TodoDatabase) -> AppResult<HashMap<String, NoteSummary>> {
    let conn = database.conn()?;
    Ok(conn.prepare("SELECT item_id,first_image,image_count FROM native_rich_text_notes WHERE image_count>0")?
        .query_map([], |row| Ok((row.get(0)?, NoteSummary {
            first_image: row.get(1)?, image_count: row.get::<_, i64>(2)?.max(0) as usize,
        })))?.collect::<Result<_, _>>()?)
}
