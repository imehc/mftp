//! Native documents and metadata commit under one SQLite revision and transaction.

use super::{database::TodoDatabase, session::Draft};
use crate::components::rich_text::RichTextDocument;
use mftp_foundation::{AppError, AppResult, CustomErrorCode, time::now_ms};
use mftp_todo::{
    Database,
    model::TodoItem,
    repository::{SELECT_COLUMNS, normalize_input, row_to_item},
};
use rusqlite::{Connection, OptionalExtension, params};

pub(super) fn init(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    let version: Option<String> = tx
        .query_row(
            "SELECT value FROM app_meta WHERE key='native_note_schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if version
        .as_deref()
        .is_some_and(|version| !matches!(version, "1" | "2"))
    {
        return Err(AppError::external(
            "native:rich_text_invalid",
            "Unsupported native note schema",
        ));
    }
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_rich_text_notes(
        item_id TEXT PRIMARY KEY REFERENCES todo_items(id) ON DELETE CASCADE,
        document TEXT NOT NULL
    );",
    )?;
    super::note_images::init(&tx)?;
    super::note_summary::migrate(&tx)?;
    tx.execute("INSERT INTO app_meta(key,value) VALUES('native_note_schema_version','2') ON CONFLICT(key) DO UPDATE SET value=excluded.value", [])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(super) fn load(
    database: &TodoDatabase,
    id: &str,
    plain: Option<&str>,
) -> AppResult<RichTextDocument> {
    let source: Option<String> = database
        .conn()?
        .query_row(
            "SELECT document FROM native_rich_text_notes WHERE item_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    match source {
        Some(source) => {
            if source.len() > 2 * crate::components::rich_text::MAX_DOCUMENT_BYTES {
                return Err(AppError::external(
                    "native:rich_text_invalid",
                    "Stored document exceeds budget",
                ));
            }
            let document: RichTextDocument = serde_json::from_str(&source).map_err(|_| {
                AppError::external("native:rich_text_invalid", "Invalid stored document")
            })?;
            document.validate()?;
            Ok(document)
        }
        None => Ok(RichTextDocument::from_plain_text(plain.unwrap_or_default())),
    }
}

pub(super) fn load_at_revision(
    database: &TodoDatabase,
    id: &str,
    revision: i64,
    plain: Option<&str>,
) -> AppResult<RichTextDocument> {
    let mut conn = database.conn()?;
    let tx = conn.transaction()?;
    let current: i64 =
        tx.query_row("SELECT revision FROM todo_items WHERE id=?1", [id], |row| {
            row.get(0)
        })?;
    if current != revision {
        return Err(AppError::custom(CustomErrorCode::TodoNoteConflict));
    }
    let source: Option<String> = tx
        .query_row(
            "SELECT document FROM native_rich_text_notes WHERE item_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    let document = match source {
        Some(source) if source.len() <= 2 * crate::components::rich_text::MAX_DOCUMENT_BYTES => {
            let document: RichTextDocument = serde_json::from_str(&source).map_err(|_| {
                AppError::external("native:rich_text_invalid", "Invalid stored document")
            })?;
            document.validate()?;
            document
        }
        Some(_) => {
            return Err(AppError::external(
                "native:rich_text_invalid",
                "Stored document exceeds budget",
            ));
        }
        None => RichTextDocument::from_plain_text(plain.unwrap_or_default()),
    };
    tx.commit()?;
    Ok(document)
}

pub(super) fn has_document(database: &TodoDatabase, id: &str) -> AppResult<bool> {
    Ok(database.conn()?.query_row(
        "SELECT EXISTS(SELECT 1 FROM native_rich_text_notes WHERE item_id=?1)",
        [id],
        |row| row.get(0),
    )?)
}

pub(super) fn commit(database: &TodoDatabase, draft: &Draft) -> AppResult<TodoItem> {
    let document = draft
        .document
        .clone()
        .unwrap_or_else(|| RichTextDocument::from_plain_text(&draft.notes));
    document.validate()?;
    let encoded = serde_json::to_string(&document)?;
    let mut input = draft.validated_input()?;
    input.notes = Some(document.plain_text()?);
    let input = normalize_input(input)?;
    let id = draft
        .original
        .as_ref()
        .map_or(draft.id.as_str(), |item| item.id.as_str());
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(AppError::external(
            "native:state_invalid",
            "Invalid draft identity",
        ));
    }
    let mut conn = database.conn()?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = now_ms();
    if draft.original.is_some() {
        let revision: Option<i64> = tx
            .query_row("SELECT revision FROM todo_items WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        let revision =
            revision.ok_or_else(|| AppError::custom(CustomErrorCode::TodoItemNotFound))?;
        if draft.revision != Some(revision) {
            return Err(AppError::custom(CustomErrorCode::TodoNoteConflict));
        }
        tx.execute("UPDATE todo_items SET title=?2,category=?3,notes=?4,due_date=?5,due_at=?6,priority=?7,
            completed=?8,updated_at=?9,revision=revision+1,
            abandoned=CASE WHEN ?8=1 THEN 0 ELSE abandoned END,
            abandoned_at=CASE WHEN ?8=1 THEN NULL ELSE abandoned_at END,
            completed_at=CASE WHEN ?8=0 THEN NULL WHEN completed=0 THEN ?9 ELSE completed_at END WHERE id=?1",
            params![id,input.title,input.category,input.notes,input.due_date,input.due_at,
                input.priority.map(|priority| priority.as_str()),input.completed,now])?;
    } else {
        tx.execute("INSERT INTO todo_items(id,title,category,notes,due_date,due_at,priority,completed,created_at,updated_at,completed_at)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10)",
            params![id,input.title,input.category,input.notes,input.due_date,input.due_at,
                input.priority.map(|priority| priority.as_str()),input.completed,now,input.completed.then_some(now)])?;
    }
    tx.execute(
        "INSERT INTO native_rich_text_notes(item_id,document) VALUES(?1,?2)
        ON CONFLICT(item_id) DO UPDATE SET document=excluded.document",
        params![id, encoded],
    )?;
    super::note_images::commit(&tx, draft, id, &document)?;
    super::note_summary::update(&tx, id, &document)?;
    let item = tx.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM todo_items WHERE id=?1"),
        [id],
        row_to_item,
    )?;
    tx.commit()?;
    Ok(item)
}

#[cfg(test)]
mod tests;
