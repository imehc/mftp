use std::sync::OnceLock;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use super::model::TodoPriority;
use super::note_assets::image_info;
use super::note_model::{
    TodoNoteDetails, TodoNoteDocument, TodoNoteDraft, TodoNoteSaveInput, TodoNoteSummary,
    MAX_DRAFTS,
};
use super::repository::{normalize_input, row_to_item, TodoRepository, SELECT_COLUMNS};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::storage::{bool_to_int, now_ms};

pub(super) fn runtime_id() -> &'static str {
    static RUNTIME: OnceLock<String> = OnceLock::new();
    RUNTIME.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

pub(super) fn details_in(conn: &Connection, id: &str) -> AppResult<TodoNoteDetails> {
    let item = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM todo_items WHERE id=?1"),
            [id],
            row_to_item,
        )
        .optional()?
        .ok_or_else(|| AppError::custom(CustomErrorCode::TodoItemNotFound))?;
    let revision = conn.query_row("SELECT revision FROM todo_items WHERE id=?1", [id], |row| {
        row.get(0)
    })?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT document FROM todo_notes WHERE item_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    let document = match raw {
        Some(raw) => {
            let document: TodoNoteDocument = serde_json::from_str(&raw)
                .map_err(|_| AppError::custom(CustomErrorCode::TodoNoteInvalid))?;
            document.validate()?;
            document
        }
        None => TodoNoteDocument::from_plain_text(item.notes.as_deref()),
    };
    Ok(TodoNoteDetails {
        item,
        document,
        revision,
    })
}

pub(super) fn draft_owner(conn: &Connection, id: &str) -> AppResult<(Option<String>, Option<i64>)> {
    conn.query_row(
        "SELECT item_id, base_revision FROM todo_note_drafts WHERE id=?1 AND runtime_id=?2",
        params![id, runtime_id()],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteDraftClosed))
}

impl TodoRepository {
    pub(crate) fn note_details(&self, id: &str) -> AppResult<TodoNoteDetails> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction()?;
        let details = details_in(&tx, id)?;
        tx.commit()?;
        Ok(details)
    }

    pub(crate) fn note_summaries(&self) -> AppResult<Vec<TodoNoteSummary>> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction()?;
        let rows = {
            let mut stmt = tx.prepare(
                "SELECT n.item_id, t.revision, n.image_count, n.first_image_id
                FROM todo_notes n JOIN todo_items t ON t.id=n.item_id ORDER BY n.item_id",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, u32>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let summaries = rows
            .into_iter()
            .map(|(item_id, revision, image_count, first)| {
                let first_image = first
                    .map(|id| image_info(&tx, &id, Some(&item_id), None, false))
                    .transpose()?;
                Ok(TodoNoteSummary {
                    item_id,
                    revision,
                    image_count,
                    first_image,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        tx.commit()?;
        Ok(summaries)
    }

    pub(crate) fn begin_note_draft(&self, item_id: Option<&str>) -> AppResult<TodoNoteDraft> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "DELETE FROM todo_note_drafts WHERE runtime_id<>?1",
            [runtime_id()],
        )?;
        let count: i64 = tx.query_row("SELECT COUNT(*) FROM todo_note_drafts", [], |row| {
            row.get(0)
        })?;
        if count >= MAX_DRAFTS {
            return Err(AppError::custom(CustomErrorCode::TodoNoteDraftLimit));
        }
        let details = item_id.map(|id| details_in(&tx, id)).transpose()?;
        let id = uuid::Uuid::new_v4().to_string();
        let base_revision = details.as_ref().map(|details| details.revision);
        tx.execute(
            "INSERT INTO todo_note_drafts(id,runtime_id,item_id,base_revision) VALUES(?1,?2,?3,?4)",
            params![id, runtime_id(), item_id, base_revision],
        )?;
        let document = details
            .as_ref()
            .map(|details| details.document.clone())
            .unwrap_or_else(|| TodoNoteDocument::from_plain_text(None));
        tx.commit()?;
        Ok(TodoNoteDraft {
            id,
            item: details.map(|details| details.item),
            document,
            base_revision,
        })
    }

    pub(crate) fn close_note_draft(&self, id: &str) -> AppResult<()> {
        self.storage.conn()?.execute(
            "DELETE FROM todo_note_drafts WHERE id=?1 AND runtime_id=?2",
            params![id, runtime_id()],
        )?;
        Ok(())
    }

    pub(crate) fn ensure_note_draft(&self, id: &str) -> AppResult<()> {
        draft_owner(&self.storage.conn()?, id)?;
        Ok(())
    }

    pub(crate) fn save_note(&self, input: TodoNoteSaveInput) -> AppResult<TodoNoteDetails> {
        input.document.validate()?;
        let mut metadata = input.metadata;
        metadata.notes = None;
        let mut metadata = normalize_input(metadata)?;
        metadata.notes = input.document.plain_text();
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (item_id, base_revision) = draft_owner(&tx, &input.draft_id)?;
        let references = input.document.unique_image_ids();
        for asset_id in &references {
            let valid: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM todo_note_images WHERE id=?1 AND (item_id=?2 OR draft_id=?3))",
                params![asset_id, item_id, input.draft_id], |row| row.get(0))?;
            if !valid {
                return Err(AppError::custom(CustomErrorCode::TodoNoteImageMissing));
            }
        }
        let now = now_ms();
        let id = match item_id {
            Some(id) => {
                let changed = tx.execute("UPDATE todo_items SET title=?2, category=?3, notes=?4, due_date=?5, due_at=?6,
                    completed=?7, completed_at=CASE WHEN ?7=0 THEN NULL WHEN completed=0 THEN ?8 ELSE completed_at END,
                    abandoned=CASE WHEN ?7=1 THEN 0 ELSE abandoned END,
                    abandoned_at=CASE WHEN ?7=1 THEN NULL ELSE abandoned_at END,
                    priority=?10, updated_at=?8, revision=revision+1 WHERE id=?1 AND revision=?9",
                    params![id, metadata.title, metadata.category, metadata.notes, metadata.due_date, metadata.due_at, bool_to_int(metadata.completed), now, base_revision, metadata.priority.map(TodoPriority::as_str)])?;
                if changed != 1 {
                    return Err(AppError::custom(CustomErrorCode::TodoNoteConflict));
                }
                id
            }
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                tx.execute("INSERT INTO todo_items(id,title,category,notes,due_date,due_at,completed,completed_at,created_at,updated_at,revision,priority)
                    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,1,?10)",
                    params![id, metadata.title, metadata.category, metadata.notes, metadata.due_date, metadata.due_at, bool_to_int(metadata.completed), metadata.completed.then_some(now), now, metadata.priority.map(TodoPriority::as_str)])?;
                id
            }
        };
        for asset_id in &references {
            tx.execute(
                "UPDATE todo_note_images SET item_id=?2, draft_id=NULL WHERE id=?1 AND draft_id=?3",
                params![asset_id, id, input.draft_id],
            )?;
        }
        let owned = {
            let mut stmt = tx.prepare("SELECT id FROM todo_note_images WHERE item_id=?1")?;
            let rows = stmt
                .query_map([&id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        for asset_id in owned {
            if !references.contains(asset_id.as_str()) {
                tx.execute(
                    "DELETE FROM todo_note_images WHERE id=?1 AND item_id=?2",
                    params![asset_id, id],
                )?;
            }
        }
        if input.document.blocks.is_empty() {
            tx.execute("DELETE FROM todo_notes WHERE item_id=?1", [&id])?;
        } else {
            let images = input.document.image_ids();
            tx.execute("INSERT INTO todo_notes(item_id,document,first_image_id,image_count) VALUES(?1,?2,?3,?4)
                ON CONFLICT(item_id) DO UPDATE SET document=excluded.document,first_image_id=excluded.first_image_id,image_count=excluded.image_count",
                params![id, serde_json::to_string(&input.document)?, images.first(), images.len() as i64])?;
        }
        tx.execute(
            "DELETE FROM todo_note_drafts WHERE id=?1 AND runtime_id=?2",
            params![input.draft_id, runtime_id()],
        )?;
        let details = details_in(&tx, &id)?;
        tx.commit()?;
        self.notify_changed(&details.item.id);
        Ok(details)
    }
}
