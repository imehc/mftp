use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use super::note_image::PreparedNoteImage;
use super::note_model::{
    TodoNoteImageData, TodoNoteImageImport, TodoNoteImageInfo, MAX_NOTE_IMAGES,
};
use super::note_repository::draft_owner;
use super::repository::TodoRepository;
use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) fn image_info(
    conn: &Connection,
    id: &str,
    item_id: Option<&str>,
    draft_id: Option<&str>,
    thumbnail: bool,
) -> AppResult<TodoNoteImageInfo> {
    let columns = if thumbnail {
        "thumbnail_mime,thumbnail_width,thumbnail_height,LENGTH(thumbnail)"
    } else {
        "mime_type,width,height,LENGTH(data)"
    };
    conn.query_row(
        &format!(
            "SELECT id,{columns} FROM todo_note_images WHERE id=?1 AND (item_id=?2 OR draft_id=?3)"
        ),
        params![id, item_id, draft_id],
        |row| {
            Ok(TodoNoteImageInfo {
                id: row.get(0)?,
                mime_type: row.get(1)?,
                width: row.get(2)?,
                height: row.get(3)?,
                byte_length: row.get(4)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteImageMissing))
}

pub(super) fn insert_image(
    conn: &Connection,
    id: &str,
    item_id: Option<&str>,
    draft_id: Option<&str>,
    prepared: &PreparedNoteImage,
) -> AppResult<()> {
    conn.execute("INSERT INTO todo_note_images(id,item_id,draft_id,mime_type,width,height,data,thumbnail_mime,thumbnail_width,thumbnail_height,thumbnail)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![id, item_id, draft_id, prepared.image.format.to_mime_type(), prepared.image.width, prepared.image.height,
            prepared.image.bytes, prepared.thumbnail.format.to_mime_type(), prepared.thumbnail.width, prepared.thumbnail.height, prepared.thumbnail.bytes])?;
    Ok(())
}

fn check_draft_capacity(conn: &Connection, draft_id: &str) -> AppResult<()> {
    draft_owner(conn, draft_id)?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM todo_note_images WHERE draft_id=?1",
        [draft_id],
        |row| row.get(0),
    )?;
    if count >= MAX_NOTE_IMAGES as i64 {
        return Err(AppError::custom(CustomErrorCode::TodoNoteImageLimit));
    }
    Ok(())
}

impl TodoRepository {
    pub(super) fn store_draft_image(
        &self,
        draft_id: &str,
        prepared: PreparedNoteImage,
    ) -> AppResult<TodoNoteImageImport> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        check_draft_capacity(&tx, draft_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        insert_image(&tx, &id, None, Some(draft_id), &prepared)?;
        let image = image_info(&tx, &id, None, Some(draft_id), false)?;
        tx.commit()?;
        Ok(TodoNoteImageImport {
            image,
            compressed: prepared.compressed,
        })
    }

    pub(crate) fn copy_note_image(
        &self,
        draft_id: &str,
        source_item_id: &str,
        asset_id: &str,
    ) -> AppResult<TodoNoteImageInfo> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        check_draft_capacity(&tx, draft_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        let changed = tx.execute("INSERT INTO todo_note_images(id,item_id,draft_id,mime_type,width,height,data,thumbnail_mime,thumbnail_width,thumbnail_height,thumbnail)
            SELECT ?1,NULL,?2,mime_type,width,height,data,thumbnail_mime,thumbnail_width,thumbnail_height,thumbnail FROM todo_note_images WHERE id=?3 AND item_id=?4",
            params![id, draft_id, asset_id, source_item_id])?;
        if changed != 1 {
            return Err(AppError::custom(CustomErrorCode::TodoNoteImageMissing));
        }
        let image = image_info(&tx, &id, None, Some(draft_id), false)?;
        tx.commit()?;
        Ok(image)
    }

    pub(crate) fn note_image_data(
        &self,
        asset_id: &str,
        item_id: Option<&str>,
        draft_id: Option<&str>,
        thumbnail: bool,
    ) -> AppResult<TodoNoteImageData> {
        if item_id.is_none() && draft_id.is_none() {
            return Err(AppError::custom(CustomErrorCode::TodoNoteInvalid));
        }
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction()?;
        let owner = draft_id
            .map(|id| draft_owner(&tx, id))
            .transpose()?
            .and_then(|(owner, _)| owner);
        if let (Some(item_id), Some(owner)) = (item_id, owner.as_deref()) {
            if item_id != owner {
                return Err(AppError::custom(CustomErrorCode::TodoNoteInvalid));
            }
        }
        let image = image_info(
            &tx,
            asset_id,
            item_id.or(owner.as_deref()),
            draft_id,
            thumbnail,
        )?;
        let column = if thumbnail { "thumbnail" } else { "data" };
        let bytes: Vec<u8> = tx.query_row(
            &format!("SELECT {column} FROM todo_note_images WHERE id=?1"),
            [asset_id],
            |row| row.get(0),
        )?;
        tx.commit()?;
        Ok(TodoNoteImageData {
            image,
            data_base64: STANDARD.encode(bytes),
        })
    }
}
