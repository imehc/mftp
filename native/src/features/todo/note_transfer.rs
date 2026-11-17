//! Copies allocate independent resource identities; a failed batch rolls back completely.
use super::{database::TodoDatabase, session::Draft};
use crate::{
    components::rich_text::RichTextDocument,
    resources::images::{self, ImagePreviews},
};
use gpui_kit::{Image, ImageFormat};
use mftp_foundation::AppResult;
use mftp_todo::Database;
use rusqlite::{OptionalExtension, params};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

pub(crate) struct PastedImages {
    pub source: String,
    pub previews: ImagePreviews,
}

pub(super) fn read(database: &TodoDatabase, draft: &Draft, id: &str) -> AppResult<Arc<Image>> {
    let conn = database.conn()?;
    let value: Option<(String, Vec<u8>)> = conn.query_row(
        "SELECT mime,data FROM native_note_images WHERE id=?1 AND (item_id=?2 OR draft_id=?3) AND LENGTH(data)<=500000",
        params![id, draft.original.as_ref().map(|item| item.id.as_str()), draft.id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    let (mime, bytes) = value.ok_or_else(|| images::error("missing"))?;
    encoded_image(&mime, bytes)
}

pub(super) fn thumbnail(database: &TodoDatabase, item: &str, id: &str) -> AppResult<Arc<Image>> {
    let conn = database.conn()?;
    let bytes: Option<Vec<u8>> = conn.query_row(
        "SELECT thumbnail FROM native_note_images WHERE id=?1 AND item_id=?2 AND LENGTH(thumbnail)<=50000",
        params![id, item], |row| row.get(0),
    ).optional()?;
    let bytes = bytes.ok_or_else(|| images::error("missing"))?;
    Ok(images::preview(
        &mftp_image::prepare_image(&bytes, || false).map_err(images::prepare_error)?,
    ))
}

pub(super) fn paste(
    database: &TodoDatabase,
    draft: &Draft,
    source: &str,
    cancelled: &AtomicBool,
) -> AppResult<PastedImages> {
    let document = RichTextDocument::from_markdown(source);
    let ids = document.image_ids()?;
    let mut conn = database.conn()?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM native_note_images WHERE draft_id=?1",
        [&draft.id],
        |row| row.get(0),
    )?;
    if count + ids.len() as i64 > 32 {
        return Err(images::error("limit"));
    }
    let mut remap = HashMap::new();
    let mut previews = Vec::new();
    for id in ids {
        if cancelled.load(Ordering::Acquire) {
            return Err(images::error("cancelled"));
        }
        let new_id = uuid::Uuid::new_v4().to_string();
        // Committed resources are readable in this app partition; other temporary drafts are not.
        let changed = tx.execute("INSERT INTO native_note_images(id,item_id,draft_id,mime,width,height,data,thumbnail)
            SELECT ?1,NULL,?2,mime,width,height,data,thumbnail FROM native_note_images
            WHERE id=?3 AND (item_id IS NOT NULL OR draft_id=?2) AND LENGTH(data)<=500000 AND LENGTH(thumbnail)<=50000",
            params![new_id, draft.id, id])?;
        if changed != 1 {
            return Err(images::error("missing"));
        }
        let bytes: Vec<u8> = tx.query_row(
            "SELECT thumbnail FROM native_note_images WHERE id=?1",
            [&new_id],
            |row| row.get(0),
        )?;
        let prepared = mftp_image::prepare_image(&bytes, || cancelled.load(Ordering::Acquire))
            .map_err(images::prepare_error)?;
        previews.push((new_id.clone(), Some(images::preview(&prepared))));
        remap.insert(id, new_id);
    }
    let source = document.remap_images(&remap)?;
    if cancelled.load(Ordering::Acquire) {
        return Err(images::error("cancelled"));
    }
    tx.commit()?;
    Ok(PastedImages { source, previews })
}

fn encoded_image(mime: &str, bytes: Vec<u8>) -> AppResult<Arc<Image>> {
    let format = match mime {
        "image/png" => ImageFormat::Png,
        "image/jpeg" => ImageFormat::Jpeg,
        "image/webp" => ImageFormat::Webp,
        _ => return Err(images::error("unsupported")),
    };
    Ok(Arc::new(Image::from_bytes(format, bytes)))
}

pub(super) fn discard(database: &TodoDatabase, draft: &str, ids: &[String]) -> AppResult<()> {
    let mut conn = database.conn()?;
    let tx = conn.transaction()?;
    for id in ids {
        tx.execute(
            "DELETE FROM native_note_images WHERE id=?1 AND draft_id=?2 AND item_id IS NULL",
            params![id, draft],
        )?;
    }
    tx.commit()?;
    Ok(())
}
