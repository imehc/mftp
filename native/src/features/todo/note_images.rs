//! Native resource ownership is independent of Tauri's document protocol.
use super::{database::TodoDatabase, session::Draft};
use crate::{
    components::rich_text::RichTextDocument,
    resources::images::{self, ImageInput},
};
use gpui_kit::Image;
use mftp_foundation::{AppError, AppResult, CustomErrorCode};
use mftp_image::MAX_IMAGE_BYTES;
use mftp_todo::Database;
use rusqlite::{Connection, OptionalExtension, params};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub(super) fn init(conn: &Connection) -> AppResult<()> {
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key='native_image_schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if version.as_deref().is_some_and(|version| version != "1") {
        return Err(images::error("schema_invalid"));
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_note_images(
        id TEXT PRIMARY KEY,
        item_id TEXT REFERENCES todo_items(id) ON DELETE CASCADE,
        draft_id TEXT,
        mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        data BLOB NOT NULL CHECK(LENGTH(data)<=500000),
        thumbnail BLOB NOT NULL CHECK(LENGTH(thumbnail)<=50000),
        CHECK((item_id IS NULL)!=(draft_id IS NULL))
    );",
    )?;
    conn.execute("INSERT INTO app_meta(key,value) VALUES('native_image_schema_version','1') ON CONFLICT(key) DO NOTHING", [])?;
    Ok(())
}

pub(super) fn import(
    database: &TodoDatabase,
    draft: &str,
    id: &str,
    input: &ImageInput,
    cancelled: &AtomicBool,
) -> AppResult<Arc<Image>> {
    let prepared = input.prepare(cancelled)?;
    if cancelled.load(Ordering::Acquire) {
        return Err(images::error("cancelled"));
    }
    let conn = database.conn()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM native_note_images WHERE draft_id=?1",
        [draft],
        |row| row.get(0),
    )?;
    // Keep a bounded reserve for undo while the document itself allows ten images.
    if count >= 32 {
        return Err(images::error("limit"));
    }
    conn.execute("INSERT INTO native_note_images(id,draft_id,mime,width,height,data,thumbnail) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![id,draft,prepared.image().format().to_mime_type(),prepared.image().width(),prepared.image().height(),prepared.image().bytes(),prepared.thumbnail().bytes()])?;
    Ok(images::preview(&prepared))
}

pub(super) fn load(
    database: &TodoDatabase,
    draft: &Draft,
) -> AppResult<Vec<(String, Option<Arc<Image>>)>> {
    let document = draft
        .document
        .clone()
        .unwrap_or_else(|| RichTextDocument::from_plain_text(&draft.notes));
    let conn = database.conn()?;
    let mut previews = Vec::new();
    for id in document.image_ids()? {
        let bytes: Option<Vec<u8>> = conn.query_row("SELECT thumbnail FROM native_note_images WHERE id=?1 AND (item_id=?2 OR draft_id=?3) AND LENGTH(thumbnail)<=50000",
            params![id,draft.original.as_ref().map(|item| item.id.as_str()),draft.id], |row| row.get(0)).optional()?;
        let preview = match bytes {
            Some(bytes) => Some(images::preview(
                &mftp_image::prepare_image(&bytes, || false).map_err(images::prepare_error)?,
            )),
            None => None,
        };
        previews.push((id, preview));
    }
    Ok(previews)
}

pub(super) fn commit(
    conn: &Connection,
    draft: &Draft,
    item: &str,
    document: &RichTextDocument,
) -> AppResult<()> {
    let references = document.image_ids()?;
    for id in &references {
        let valid: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM native_note_images WHERE id=?1 AND (item_id=?2 OR draft_id=?3) AND LENGTH(data)<=?4)",
            params![id,item,draft.id,MAX_IMAGE_BYTES as i64], |row| row.get(0))?;
        if !valid {
            return Err(AppError::custom(CustomErrorCode::TodoNoteImageMissing));
        }
        conn.execute(
            "UPDATE native_note_images SET item_id=?2,draft_id=NULL WHERE id=?1 AND draft_id=?3",
            params![id, item, draft.id],
        )?;
    }
    let existing: Vec<String> = conn
        .prepare("SELECT id FROM native_note_images WHERE item_id=?1")?
        .query_map([item], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for id in existing {
        if !references.contains(&id) {
            conn.execute(
                "DELETE FROM native_note_images WHERE id=?1 AND item_id=?2",
                params![id, item],
            )?;
        }
    }
    conn.execute(
        "DELETE FROM native_note_images WHERE draft_id=?1",
        [&draft.id],
    )?;
    Ok(())
}

pub(super) fn prune_drafts(conn: &Connection, active: Option<&str>) -> AppResult<()> {
    conn.execute("DELETE FROM native_note_images WHERE draft_id IS NOT NULL AND (?1 IS NULL OR draft_id!=?1)", [active])?;
    Ok(())
}
