use std::collections::{HashMap, HashSet};

use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::model::{TodoItem, TodoItemInput, TodoPriority};
use super::note_assets::insert_image;
use super::note_image::MAX_IMAGE_BYTES;
use super::note_model::TodoNoteDocument;
use super::note_repository::details_in;
use super::note_service::prepare_image;
use super::repository::{normalize_input, row_to_item, SELECT_COLUMNS};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::models::ImportMode;
use crate::storage::{now_ms, Storage};

const MAX_BACKUP_ASSETS: usize = 24_000_000;
const MAX_BACKUP_NOTES: usize = 8_000_000;
const MAX_BACKUP_ITEMS: usize = 10_000;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImageBackup {
    id: String,
    data_base64: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NoteBackup {
    item: TodoItem,
    document: TodoNoteDocument,
    images: Vec<ImageBackup>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TodoBackup {
    version: u32,
    items: Vec<NoteBackup>,
}

fn invalid() -> AppError {
    AppError::custom(CustomErrorCode::AppDataSectionInvalid).with_arg("section", "todo")
}

pub(crate) fn export(storage: &Storage) -> AppResult<Value> {
    let mut conn = storage.conn()?;
    let tx = conn.transaction()?;
    let rich: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM todo_notes)", [], |row| {
        row.get(0)
    })?;
    if !rich {
        let items = {
            let mut stmt = tx.prepare(&format!("SELECT {SELECT_COLUMNS} FROM todo_items"))?;
            let rows = stmt
                .query_map([], row_to_item)?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        return Ok(json!(items));
    }
    let (count, assets, notes): (i64, i64, i64) = tx.query_row(
        "SELECT (SELECT COUNT(*) FROM todo_items),
        (SELECT COALESCE(SUM(LENGTH(data)),0) FROM todo_note_images WHERE item_id IS NOT NULL),
        (SELECT COALESCE(SUM(LENGTH(CAST(document AS BLOB))),0) FROM todo_notes)",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if count > MAX_BACKUP_ITEMS as i64
        || assets > MAX_BACKUP_ASSETS as i64
        || notes > MAX_BACKUP_NOTES as i64
    {
        return Err(AppError::custom(CustomErrorCode::AppDataTooLarge));
    }
    let ids = {
        let mut stmt = tx.prepare("SELECT id FROM todo_items ORDER BY id")?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let mut items = Vec::new();
    for id in ids {
        let details = details_in(&tx, &id)?;
        let mut images = Vec::new();
        for asset_id in details.document.unique_image_ids() {
            let bytes: Vec<u8> = tx
                .query_row(
                    "SELECT data FROM todo_note_images WHERE id=?1 AND item_id=?2",
                    params![asset_id, id],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(invalid)?;
            images.push(ImageBackup {
                id: asset_id.into(),
                data_base64: STANDARD.encode(bytes),
            });
        }
        images.sort_by(|left, right| left.id.cmp(&right.id));
        items.push(NoteBackup {
            item: details.item,
            document: details.document,
            images,
        });
    }
    tx.commit()?;
    Ok(serde_json::to_value(TodoBackup { version: 3, items })?)
}

pub(crate) fn import(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<(u32, u32)> {
    let mut data: TodoBackup = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if !(2..=3).contains(&data.version) || data.items.len() > MAX_BACKUP_ITEMS {
        return Err(invalid());
    }
    let mut asset_bytes = 0;
    let mut note_bytes = 0;
    let mut item_ids = HashSet::new();
    let mut asset_ids = HashSet::new();
    for entry in &data.items {
        entry.document.validate()?;
        normalize_input(TodoItemInput {
            title: entry.item.title.clone(),
            category: entry.item.category.clone(),
            notes: None,
            due_date: entry.item.due_date.clone(),
            due_at: entry.item.due_at,
            completed: entry.item.completed,
            priority: entry.item.priority,
        })?;
        if !item_ids.insert(entry.item.id.as_str())
            || entry.item.id.is_empty()
            || entry
                .item
                .completed_at
                .is_some_and(|time| !(0..=253_402_300_799_999).contains(&time))
            || entry
                .item
                .abandoned_at
                .is_some_and(|time| !(0..=253_402_300_799_999).contains(&time))
        {
            return Err(invalid());
        }
        let references = entry.document.unique_image_ids();
        if references.len() != entry.images.len() {
            return Err(invalid());
        }
        note_bytes += serde_json::to_vec(&entry.document)?.len();
        for image in &entry.images {
            if !references.contains(image.id.as_str())
                || !asset_ids.insert(image.id.as_str())
                || image.data_base64.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4
            {
                return Err(invalid());
            }
            asset_bytes += image.data_base64.len().div_ceil(4) * 3;
        }
    }
    if asset_bytes > MAX_BACKUP_ASSETS || note_bytes > MAX_BACKUP_NOTES {
        return Err(AppError::custom(CustomErrorCode::AppDataTooLarge));
    }
    let mut prepared = HashMap::new();
    for entry in &data.items {
        for image in &entry.images {
            let bytes = STANDARD.decode(&image.data_base64).map_err(|_| invalid())?;
            if bytes.len() > MAX_IMAGE_BYTES {
                return Err(invalid());
            }
            let image_data = prepare_image(&bytes)?;
            if image_data.image.bytes != bytes {
                return Err(invalid());
            }
            prepared.insert(image.id.clone(), image_data);
        }
    }
    if mode == ImportMode::Overwrite {
        conn.execute("DELETE FROM todo_note_drafts", [])?;
        conn.execute("DELETE FROM todo_items", [])?;
    }
    let (mut inserted, mut updated) = (0, 0);
    for entry in &mut data.items {
        if mode == ImportMode::Append {
            entry.item.id = uuid::Uuid::new_v4().to_string();
        }
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM todo_items WHERE id=?1)",
            [&entry.item.id],
            |row| row.get(0),
        )?;
        if exists && mode != ImportMode::Merge {
            return Err(invalid());
        }
        if exists {
            conn.execute(
                "DELETE FROM todo_note_drafts WHERE item_id=?1",
                [&entry.item.id],
            )?;
            conn.execute("DELETE FROM todo_notes WHERE item_id=?1", [&entry.item.id])?;
            conn.execute(
                "DELETE FROM todo_note_images WHERE item_id=?1",
                [&entry.item.id],
            )?;
        }
        let mut remap = HashMap::new();
        for image in &entry.images {
            let id = uuid::Uuid::new_v4().to_string();
            let image_data = prepared.remove(&image.id).ok_or_else(invalid)?;
            remap.insert(image.id.clone(), (id, image_data));
        }
        entry
            .document
            .remap_images(|id| Ok(remap.get(id).ok_or_else(invalid)?.0.clone()))?;
        let notes = entry.document.plain_text();
        let item = &entry.item;
        // Preserve the mutually exclusive invariant even if a backup carries both flags.
        let abandoned = item.abandoned;
        let completed = item.completed && !abandoned;
        conn.execute("INSERT INTO todo_items(id,title,category,notes,due_date,due_at,completed,completed_at,created_at,updated_at,revision,priority,abandoned,abandoned_at)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?12,?13)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,notes=excluded.notes,due_date=excluded.due_date,
            due_at=excluded.due_at,completed=excluded.completed,completed_at=excluded.completed_at,updated_at=excluded.updated_at,revision=todo_items.revision+1,
            priority=excluded.priority,abandoned=excluded.abandoned,abandoned_at=excluded.abandoned_at",
            params![item.id, item.title, item.category, notes, item.due_date, item.due_at, completed as i64,
                item.completed_at.filter(|_| completed), item.created_at, if exists { now_ms() } else { item.updated_at },
                item.priority.map(TodoPriority::as_str), abandoned as i64, item.abandoned_at.filter(|_| abandoned)])?;
        for (_, (id, image)) in remap {
            insert_image(conn, &id, Some(&item.id), None, &image)?;
        }
        let images = entry.document.image_ids();
        conn.execute("INSERT INTO todo_notes(item_id,document,first_image_id,image_count) VALUES(?1,?2,?3,?4)",
            params![item.id, serde_json::to_string(&entry.document)?, images.first(), images.len() as i64])?;
        if exists {
            updated += 1;
        } else {
            inserted += 1;
        }
    }
    Ok((inserted, updated))
}
